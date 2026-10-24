import { canEditWorld, defineMessages, IMPASSABLE_WALK_SECONDS, MAX_TILES_PER_PAGE, TILE_USED_IN, tileUsedIn, type EditableUniverse, type EditorTile, type TileListPayload, type TileListQuery, type TileSettings } from '@multiverse-kiln/shared';

import { formatDuration, t } from '../../localization';
import { describeEditorError, type EditorApi } from '../../network/editorApi';
import { getElement, setOptions, showMessage } from '../dom';
import { tileName } from '../tileNames';
import { colorToHex } from './colors';
import { editorMessages } from './editorMessages';
import type { SavableTab } from './SaveBar';
import { describeCommitFailure, joinTags, markStagedRow, StagedChanges, stagedPage, stagedTag, type StagedState } from './stagedChanges';
import { TileDialog } from './TileDialog';

/**
 * Text the Tilesets tab shows in more than one place (see src/localization.ts)
 */
const messages = defineMessages({
	usedIn: {
		id: 'editor.tiles.usedInValue',
		defaultMessage: '{usedIn, select, both {Both} indoors {Indoors} outdoors {Outdoors} other {Neither}}',
		description: 'Whether indoor areas only, outdoor areas only, both or neither can paint with a tile: in the Where column and as the choices of the Where filter'
	}
});

/**
 * How long the name filter waits after the last key before searching, in milliseconds
 */
const SEARCH_DELAY_MS = 250;

/**
 * The Tilesets tab: every tile the universe can paint with, filtered and a page at a time, opening the
 * tile editor. Changes wait on the page until the tab is saved: changed tiles show their changes on the
 * page they are on, and tiles added since show at the top of the first page, whatever the filters. Maps
 * paint only with saved tiles
 */
export class TilesetsTab implements SavableTab
{
	private readonly nameFilter = getElement('tile-filter-name', HTMLInputElement);
	private readonly passableFilter = getElement('tile-filter-passable', HTMLSelectElement);
	private readonly usedInFilter = getElement('tile-filter-used-in', HTMLSelectElement);
	private readonly customFilter = getElement('tile-filter-custom', HTMLSelectElement);
	private readonly editedFilter = getElement('tile-filter-edited', HTMLSelectElement);
	private readonly addButton = getElement('tile-add', HTMLButtonElement);
	private readonly rows = getElement('tile-rows', HTMLTableSectionElement);
	private readonly empty = getElement('tile-empty', HTMLElement);
	private readonly error = getElement('tile-list-error', HTMLElement);
	private readonly page = getElement('tile-page', HTMLElement);
	private readonly previousButton = getElement('tile-previous', HTMLButtonElement);
	private readonly nextButton = getElement('tile-next', HTMLButtonElement);
	private readonly dialog = new TileDialog();

	/**
	 * The changes made since the tiles were last saved
	 */
	readonly changes = new StagedChanges<TileSettings>();

	private universe: EditableUniverse | undefined;

	/**
	 * The page of tiles shown, as it was last loaded
	 */
	private tiles: EditorTile[] = [];

	/**
	 * Every tile loaded since the universe was opened, by ID, to name a tile whose change failed to save
	 * when it isn't on the page shown
	 */
	private readonly known = new Map<number, EditorTile>();

	/**
	 * How many matching tiles come before the page shown
	 */
	private offset = 0;

	/**
	 * Changes with every request for a page, so a page that arrives after a newer request is ignored
	 */
	private requestVersion = 0;

	private searchTimer: number | undefined;

	/**
	 * @param api The editor's API
	 */
	constructor(private readonly api: EditorApi)
	{
		setOptions(this.usedInFilter, [
			{
				value: '',
				label: t(editorMessages.filterAny)
			},
			...TILE_USED_IN.map((usedIn) => ({
				value: usedIn,
				label: t(messages.usedIn, {
					usedIn
				})
			}))
		]);

		for (const filter of [this.passableFilter, this.usedInFilter, this.customFilter, this.editedFilter])
		{
			filter.addEventListener('change', () =>
			{
				this.offset = 0;
				void this.refresh();
			});
		}

		for (const filter of [this.passableFilter, this.customFilter, this.editedFilter])
		{
			setOptions(filter, [
				{
					value: '',
					label: t(editorMessages.filterAny)
				},
				{
					value: 'true',
					label: t(editorMessages.filterYes)
				},
				{
					value: 'false',
					label: t(editorMessages.filterNo)
				}
			]);
		}

		this.nameFilter.addEventListener('input', () =>
		{
			window.clearTimeout(this.searchTimer);
			this.searchTimer = window.setTimeout(() =>
			{
				this.offset = 0;
				void this.refresh();
			}, SEARCH_DELAY_MS);
		});

		this.previousButton.addEventListener('click', () =>
		{
			this.offset = Math.max(0, this.offset - MAX_TILES_PER_PAGE);
			void this.refresh();
		});

		this.nextButton.addEventListener('click', () =>
		{
			this.offset += MAX_TILES_PER_PAGE;
			void this.refresh();
		});

		this.addButton.addEventListener('click', () =>
		{
			this.openTile(undefined);
		});
	}

	/**
	 * Lists a universe's tiles from the first page, with no filters
	 *
	 * @param universe The universe
	 */
	open(universe: EditableUniverse): void
	{
		this.universe = universe;
		this.offset = 0;
		this.tiles = [];
		this.known.clear();
		this.changes.clear();
		showMessage(this.error, undefined);
		this.nameFilter.value = '';
		this.passableFilter.value = '';
		this.usedInFilter.value = '';
		this.customFilter.value = '';
		this.editedFilter.value = '';
		this.addButton.hidden = !canEditWorld(universe.role);
		void this.refresh();
	}

	/**
	 * Whether the player may change the tiles
	 *
	 * @return True for a creator or builder
	 */
	canSave(): boolean
	{
		return((this.universe !== undefined) && canEditWorld(this.universe.role));
	}

	/**
	 * Saves the changes in the order they were made, stopping at the first the server refuses
	 *
	 * @return True when every change was saved
	 */
	async save(): Promise<boolean>
	{
		const universe = this.universe;

		if (!universe)
		{
			return(false);
		}

		showMessage(this.error, undefined);

		const failure = await this.changes.commit({
			create: (settings) => this.api.createTile(universe.id, settings),
			save: (tileId, settings) => this.api.saveTile(universe.id, tileId, settings),
			remove: (tileId) => this.api.deleteTile(universe.id, tileId)
		});

		await this.refresh();

		if (failure)
		{
			const tile = this.tileWithChanges(failure.change.id);

			showMessage(this.error, describeCommitFailure(failure, (tile ? tileName(tile, universe.ruleset) : ''), !tile?.custom));

			return(false);
		}

		return(true);
	}

	/**
	 * Loads the page of tiles the filters and offset ask for, then shows it with the changes made since
	 */
	private async refresh(): Promise<void>
	{
		const universe = this.universe;
		const version = ++this.requestVersion;

		if (!universe)
		{
			return;
		}

		const query: TileListQuery = {
			name: (this.nameFilter.value.trim() || undefined),
			passable: filterValue(this.passableFilter),
			usedIn: TILE_USED_IN.find((usedIn) => (usedIn === this.usedInFilter.value)),
			custom: filterValue(this.customFilter),
			edited: filterValue(this.editedFilter),
			offset: this.offset,
			limit: MAX_TILES_PER_PAGE
		};
		let page: TileListPayload;

		try
		{
			page = await this.api.listTiles(universe.id, query);
		}
		catch (error)
		{
			if (version === this.requestVersion)
			{
				showMessage(this.empty, describeEditorError(error, {
					id: 'editor.tiles.listFailed',
					defaultMessage: 'Could not list the tiles.',
					description: 'Shown on the Tilesets tab when the tiles couldn\'t be loaded'
				}));
			}

			return;
		}

		if (version !== this.requestVersion)
		{
			return;
		}

		// Deleting the last tile of the last page leaves nothing to show there
		if ((page.tiles.length === 0) && (this.offset > 0))
		{
			this.offset = Math.max(0, this.offset - MAX_TILES_PER_PAGE);
			void this.refresh();
			return;
		}

		this.tiles = page.tiles;

		for (const tile of page.tiles)
		{
			this.known.set(tile.id, tile);
		}

		this.render();
		this.page.textContent = ((page.total === 0)
			? ''
			: t({
				id: 'pager.range',
				defaultMessage: '{first, number}-{last, number} of {total, number}',
				description: 'Which items of a list a page shows, e.g. 1-500 of 1200'
			}, {
				first: this.offset + 1,
				last: this.offset + page.tiles.length,
				total: page.total
			}));
		this.previousButton.disabled = (this.offset === 0);
		this.nextButton.disabled = ((this.offset + page.tiles.length) >= page.total);
	}

	/**
	 * Shows the page of tiles with the changes made since it was loaded, and on the first page the tiles
	 * added since, first
	 */
	private render(): void
	{
		const universe = this.universe;

		if (!universe)
		{
			return;
		}

		const shown = stagedPage(this.tiles, this.changes, (this.offset === 0), (id, settings) => ({
			id,
			key: null,
			...settings,
			custom: true,
			edited: false
		}));

		this.rows.replaceChildren(...shown.map(({ item, state }) => this.createRow(item, state, universe)));
		showMessage(this.empty, ((shown.length === 0)
			? t({
				id: 'editor.tiles.none',
				defaultMessage: 'No tiles match.',
				description: 'Shown instead of the table when no tile matches the filters'
			})
			: undefined));
	}

	/**
	 * A tile as the list shows it, with its changes, wherever it is
	 *
	 * @param tileId The tile's ID
	 * @return The tile, or undefined when it isn't known
	 */
	private tileWithChanges(tileId: number): EditorTile | undefined
	{
		const known = this.known.get(tileId);
		const settings = this.changes.settingsOf(tileId);

		if (!known)
		{
			return((settings === undefined) ? undefined : { id: tileId, key: null, ...settings, custom: true, edited: false });
		}

		return({ ...known, ...settings });
	}

	/**
	 * A tile's row in the table: its color, name (opening the tile editor), costs, where it is used, and
	 * whether it is custom, edited or not saved yet
	 *
	 * @param tile The tile
	 * @param state How it differs from what is saved
	 * @param universe The universe whose tile it is
	 * @return The row
	 */
	private createRow(tile: EditorTile, state: StagedState, universe: EditableUniverse): HTMLTableRowElement
	{
		const row = document.createElement('tr');
		const swatch = document.createElement('span');
		const nameButton = document.createElement('button');
		const tags = [
			(tile.custom
				? t(editorMessages.customTag)
				: undefined),
			(tile.edited
				? t(editorMessages.editedTag)
				: undefined),
			stagedTag(state, !tile.custom)
		];
		const cells = [
			swatch,
			nameButton,
			((tile.walkSeconds === IMPASSABLE_WALK_SECONDS)
				? t({
					id: 'editor.tiles.impassable',
					defaultMessage: 'impassable',
					description: 'In the walk time column, for a tile that can\'t be walked into'
				})
				: formatDuration(tile.walkSeconds)),
			t({
				id: 'editor.tiles.percent',
				defaultMessage: '{cost, number, percent}',
				description: 'A tile\'s vision cost as a percentage, e.g. 50%. Change only for a language whose percentages the number format gets wrong'
			}, { cost: tile.visionCost / 100 }),
			t(messages.usedIn, {
				usedIn: tileUsedIn(tile)
			}),
			joinTags(...tags)
		];

		// Screen readers read the color's hex code, which the color picker in the tile dialog also shows
		swatch.className = 'swatch';
		swatch.style.backgroundColor = colorToHex(tile.color);
		swatch.setAttribute('role', 'img');
		swatch.setAttribute('aria-label', colorToHex(tile.color));
		nameButton.type = 'button';
		nameButton.className = 'link-button';
		nameButton.textContent = tileName(tile, universe.ruleset);
		nameButton.addEventListener('click', () =>
		{
			this.openTile(tile);
		});

		for (const content of cells)
		{
			const cell = document.createElement('td');

			cell.append(content);
			row.append(cell);
		}

		return(markStagedRow(row, state, !tile.custom));
	}

	/**
	 * Opens the tile editor, showing its changes in the list
	 *
	 * @param tile The tile, or undefined to add one
	 */
	private openTile(tile: EditorTile | undefined): void
	{
		if (this.universe)
		{
			this.dialog.open(this.universe, tile, this.changes.edit(tile?.id), () =>
			{
				this.render();
			});
		}
	}
}

/**
 * A yes/no/any filter's value
 *
 * @param select The filter
 * @return true, false, or undefined for any
 */
function filterValue(select: HTMLSelectElement): boolean | undefined
{
	return(((select.value === '') ? undefined : (select.value === 'true')));
}
