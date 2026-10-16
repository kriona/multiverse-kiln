import { canEditWorld, defineMessages, IMPASSABLE_COST, MAX_TILES_PER_PAGE, type EditableUniverse, type EditorTile, type TileListPayload, type TileListQuery } from '@multiverse-kiln/shared';

import { formatList, t } from '../../localization';
import { describeEditorError, type EditorApi } from '../../network/editorApi';
import { getElement, setOptions, showMessage } from '../dom';
import { colorToHex } from './colors';
import { TileDialog } from './TileDialog';
import { tileName } from './tileNames';

/**
 * Text the Tilesets tab shows in more than one place (see src/localization.ts)
 */
const messages = defineMessages({
	percent: {
		id: 'editor.tiles.percent',
		defaultMessage: '{cost, number, percent}',
		description: 'A tile\'s movement or vision cost as a percentage, e.g. 50%. Change only for a language whose percentages the number format gets wrong'
	}
});

/**
 * How long the name filter waits after the last key before searching, in milliseconds
 */
const SEARCH_DELAY_MS = 250;

/**
 * The Tilesets tab: every tile the universe can paint with, filtered and a page at a time, opening the tile editor
 */
export class TilesetsTab
{
	private readonly nameFilter = getElement('tile-filter-name', HTMLInputElement);
	private readonly passableFilter = getElement('tile-filter-passable', HTMLSelectElement);
	private readonly customFilter = getElement('tile-filter-custom', HTMLSelectElement);
	private readonly editedFilter = getElement('tile-filter-edited', HTMLSelectElement);
	private readonly addButton = getElement('tile-add', HTMLButtonElement);
	private readonly rows = getElement('tile-rows', HTMLTableSectionElement);
	private readonly empty = getElement('tile-empty', HTMLElement);
	private readonly page = getElement('tile-page', HTMLElement);
	private readonly previousButton = getElement('tile-previous', HTMLButtonElement);
	private readonly nextButton = getElement('tile-next', HTMLButtonElement);
	private readonly dialog: TileDialog;

	private universe: EditableUniverse | undefined;

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
		this.dialog = new TileDialog(api);

		for (const filter of [this.passableFilter, this.customFilter, this.editedFilter])
		{
			setOptions(filter, [
				{
					value: '',
					label: t({
						id: 'editor.tiles.filterAny',
						defaultMessage: 'Any',
						description: 'Choice of a yes-or-no tile filter that shows every tile'
					})
				},
				{
					value: 'true',
					label: t({
						id: 'editor.tiles.filterYes',
						defaultMessage: 'Yes',
						description: 'Choice of a yes-or-no tile filter, e.g. Passable: Yes'
					})
				},
				{
					value: 'false',
					label: t({
						id: 'editor.tiles.filterNo',
						defaultMessage: 'No',
						description: 'Choice of a yes-or-no tile filter, e.g. Passable: No'
					})
				}
			]);

			filter.addEventListener('change', () =>
			{
				this.offset = 0;
				void this.refresh();
			});
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
		this.nameFilter.value = '';
		this.passableFilter.value = '';
		this.customFilter.value = '';
		this.editedFilter.value = '';
		this.addButton.hidden = !canEditWorld(universe.role);
		void this.refresh();
	}

	/**
	 * Loads and shows the page of tiles the filters and offset ask for
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

		this.rows.replaceChildren(...page.tiles.map((tile) => this.createRow(tile, universe)));
		showMessage(this.empty, ((page.tiles.length === 0)
			? t({
				id: 'editor.tiles.none',
				defaultMessage: 'No tiles match.',
				description: 'Shown instead of the table when no tile matches the filters'
			})
			: undefined));
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
	 * A tile's row in the table: its color, name (opening the tile editor), costs, and whether it is custom or edited
	 *
	 * @param tile The tile
	 * @param universe The universe whose tile it is
	 * @return The row
	 */
	private createRow(tile: EditorTile, universe: EditableUniverse): HTMLTableRowElement
	{
		const row = document.createElement('tr');
		const swatch = document.createElement('span');
		const nameButton = document.createElement('button');
		const tags = [
			(tile.custom
				? t({
					id: 'editor.tiles.customTag',
					defaultMessage: 'custom',
					description: 'In the last column of the tile table, for a tile made for this universe'
				})
				: undefined),
			(tile.edited
				? t({
					id: 'editor.tiles.editedTag',
					defaultMessage: 'edited',
					description: 'In the last column of the tile table, for one of the ruleset\'s tiles that this universe changed'
				})
				: undefined)
		].filter((tag) => (tag !== undefined));
		const cells = [
			swatch,
			nameButton,
			((tile.movementCost >= IMPASSABLE_COST)
				? t({
					id: 'editor.tiles.impassable',
					defaultMessage: 'impassable',
					description: 'In the movement cost column, for a tile that can\'t be walked into'
				})
				: t(messages.percent, { cost: tile.movementCost / 100 })),
			t(messages.percent, { cost: tile.visionCost / 100 }),
			formatList(tags)
		];

		swatch.className = 'swatch';
		swatch.style.backgroundColor = colorToHex(tile.color);
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

		return(row);
	}

	/**
	 * Opens the tile editor, refreshing the list after a change
	 *
	 * @param tile The tile, or undefined to add one
	 */
	private openTile(tile: EditorTile | undefined): void
	{
		if (this.universe)
		{
			this.dialog.open(this.universe, tile, () =>
			{
				void this.refresh();
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
