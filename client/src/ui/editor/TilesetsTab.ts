import { canEditWorld, defineMessages, IMPASSABLE_WALK_SECONDS, MAX_TILES_PER_PAGE, TILE_SORT_COLUMNS, TILE_USED_IN, tileUsedIn, type EditableUniverse, type EditorTile, type TileListPayload, type TileListQuery, type TileSettings, type TileSortColumn, type UploadedTileGraphic } from '@multiverse-kiln/shared';

import { formatDuration, t } from '../../localization';
import { describeEditorError, EditorApiError, type EditorApi } from '../../network/editorApi';
import { getElement, setOptions, showMessage } from '../dom';
import { TableSorter } from '../tableSorter';
import { tileName } from '../tileNames';
import { editorMessages } from './editorMessages';
import { combineChanges, type SavableTab } from './SaveBar';
import { describeCommitFailure, joinTags, markStagedRow, StagedAdditions, StagedChanges, StagedDeletions, stagedPage, stagedTag, type StagedState } from './stagedChanges';
import { TileDialog } from './TileDialog';
import type { StagedUpload } from './TileGraphicDialog';
import { showTileSwatch, type ShownUpload } from './tileSwatches';

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
 * The Tilesets tab: every tile the universe can paint with, filtered, sorted by a column (by the server,
 * before paging) and a page at a time, opening the
 * tile editor. Changes wait on the page until the tab is saved: changed tiles show their changes on the
 * page they are on, and tiles added since show at the top of the first page, whatever the filters. Maps
 * paint only with saved tiles
 *
 * Tilesets uploaded and deleted from the tile editor wait too. Saving uploads the new ones first, so the
 * tiles staged to use them can name them, then saves the tiles, then deletes the tilesets marked to delete
 */
export class TilesetsTab implements SavableTab
{
	private readonly nameFilter = getElement('tile-filter-name', HTMLInputElement);
	private readonly passableFilter = getElement('tile-filter-passable', HTMLSelectElement);
	private readonly usedInFilter = getElement('tile-filter-used-in', HTMLSelectElement);
	private readonly enabledFilter = getElement('tile-filter-enabled', HTMLSelectElement);
	private readonly customFilter = getElement('tile-filter-custom', HTMLSelectElement);
	private readonly editedFilter = getElement('tile-filter-edited', HTMLSelectElement);
	private readonly addButton = getElement('tile-add', HTMLButtonElement);
	private readonly rows = getElement('tile-rows', HTMLTableSectionElement);
	private readonly empty = getElement('tile-empty', HTMLElement);
	private readonly error = getElement('tile-list-error', HTMLElement);
	private readonly page = getElement('tile-page', HTMLElement);
	private readonly previousButton = getElement('tile-previous', HTMLButtonElement);
	private readonly nextButton = getElement('tile-next', HTMLButtonElement);
	private readonly dialog: TileDialog;
	private readonly sorter: TableSorter<TileSortColumn>;

	/**
	 * The changes made to the tiles since they were last saved
	 */
	private readonly staged = new StagedChanges<TileSettings>();

	/**
	 * Tilesets chosen in the upload dialog, uploaded when the tab is saved. Until then tiles refer to
	 * them by their staged IDs
	 */
	private readonly uploadsToAdd = new StagedAdditions<StagedUpload>('new-upload-');

	/**
	 * Uploaded tilesets to delete when the tab is saved
	 */
	private readonly uploadsToDelete = new StagedDeletions();

	readonly changes = combineChanges(this.staged, this.uploadsToAdd, this.uploadsToDelete);

	/**
	 * The ID each staged upload got once it was uploaded, by its staged ID, for tiles that still refer to
	 * it when saving them fails after the upload
	 */
	private readonly uploadedIds = new Map<string, string>();

	/**
	 * The tile to paint the maps with in place of each tile marked to delete that maps use, by the
	 * deleted tile's ID
	 */
	private readonly replacements = new Map<number, number>();

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
	 * The tile graphics the universe's editors have uploaded, as last loaded
	 */
	private savedUploads: UploadedTileGraphic[] = [];

	/**
	 * @param api The editor's API
	 */
	constructor(private readonly api: EditorApi)
	{
		this.dialog = new TileDialog(api, {
			list: () => this.shownUploads(),
			stage: (upload) =>
			{
				const id = this.uploadsToAdd.add(upload);

				this.render();

				return(id);
			},
			toggleDelete: (id) =>
			{
				if (this.uploadsToAdd.has(id))
				{
					this.uploadsToAdd.remove(id);
				}
				else
				{
					this.uploadsToDelete.toggle(id);
				}

				this.render();
			}
		}, {
			isRemoved: (tileId) => this.staged.isRemoved(tileId),
			setReplacement: (tileId, replacementId) =>
			{
				if (replacementId === undefined)
				{
					this.replacements.delete(tileId);
				}
				else
				{
					this.replacements.set(tileId, replacementId);
				}
			}
		});

		this.sorter = new TableSorter(getElement('tile-table', HTMLTableElement), TILE_SORT_COLUMNS, {
			column: 'name',
			direction: 'ascending'
		}, () =>
		{
			this.offset = 0;
			void this.refresh();
		});

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

		for (const filter of [this.passableFilter, this.usedInFilter, this.enabledFilter, this.customFilter, this.editedFilter])
		{
			filter.addEventListener('change', () =>
			{
				this.offset = 0;
				void this.refresh();
			});
		}

		for (const filter of [this.passableFilter, this.enabledFilter, this.customFilter, this.editedFilter])
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
	 * Lists a universe's tiles from the first page by name, with no filters
	 *
	 * @param universe The universe
	 */
	open(universe: EditableUniverse): void
	{
		this.universe = universe;
		this.offset = 0;
		this.tiles = [];
		this.known.clear();
		this.staged.clear();
		this.uploadsToAdd.clear();
		this.uploadsToDelete.clear();
		this.uploadedIds.clear();
		this.replacements.clear();
		showMessage(this.error, undefined);
		this.nameFilter.value = '';
		this.passableFilter.value = '';
		this.usedInFilter.value = '';
		this.enabledFilter.value = '';
		this.customFilter.value = '';
		this.editedFilter.value = '';
		this.sorter.reset();
		this.addButton.hidden = !canEditWorld(universe.role);
		this.savedUploads = [];
		void this.refresh();
		void this.loadUploads(universe);
	}

	/**
	 * The uploaded tilesets with the changes waiting for the tab to be saved: those marked to delete, then
	 * those to upload
	 *
	 * @return The tilesets, for the tile editor and the tiles' pictures
	 */
	private shownUploads(): ShownUpload[]
	{
		return([
			...this.savedUploads.map((upload) => ({
				...upload,
				state: (this.uploadsToDelete.has(upload.id) ? 'deleted' as const : 'saved' as const)
			})),
			...this.uploadsToAdd.list().map(({ id, item }) => ({
				id,
				name: item.request.name,
				format: item.request.format,
				drawOrder: item.request.drawOrder,
				state: 'new' as const,
				previewUrl: item.previewUrl
			}))
		]);
	}

	/**
	 * A tile's settings as the server takes them: a staged upload's ID becomes the ID it was uploaded
	 * under, and one discarded since becomes none
	 *
	 * @param settings The tile's staged settings
	 * @return The settings to send
	 */
	private resolveUpload(settings: TileSettings): TileSettings
	{
		const { uploadedGraphicId } = settings;

		if ((uploadedGraphicId === null) || !uploadedGraphicId.startsWith('new-upload-'))
		{
			return(settings);
		}

		return({
			...settings,
			uploadedGraphicId: (this.uploadedIds.get(uploadedGraphicId) ?? null)
		});
	}

	/**
	 * Loads the tile graphics the universe's editors uploaded, then shows the tiles drawn with them
	 *
	 * @param universe The universe
	 */
	private async loadUploads(universe: EditableUniverse): Promise<void>
	{
		let uploads: UploadedTileGraphic[];

		try
		{
			uploads = await this.api.listTileGraphics(universe.id);
		}
		catch (error)
		{
			if (this.universe === universe)
			{
				showMessage(this.error, describeEditorError(error, {
					id: 'editor.tiles.uploadsFailed',
					defaultMessage: 'Could not list the uploaded tilesets.',
					description: 'Shown on the Tilesets tab when the tilesets the universe\'s editors uploaded couldn\'t be loaded'
				}));
			}

			return;
		}

		if (this.universe === universe)
		{
			this.savedUploads = uploads;
			this.render();
		}
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
	 * Saves the changes: uploads the new tilesets, then saves the tiles' changes in the order they were
	 * made, then deletes the tilesets marked to delete, stopping at the first the server refuses
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

		const saved = (await this.saveUploads(universe) && await this.saveTiles(universe) && await this.deleteUploads(universe));

		await this.refresh();
		await this.loadUploads(universe);

		return(saved);
	}

	/**
	 * Uploads the tilesets staged to upload, stopping at the first the server refuses
	 *
	 * @param universe The universe
	 * @return True when they were all uploaded
	 */
	private async saveUploads(universe: EditableUniverse): Promise<boolean>
	{
		for (const { id, item } of this.uploadsToAdd.list())
		{
			try
			{
				this.uploadedIds.set(id, await this.api.uploadTileGraphic(universe.id, item.request));
			}
			catch (error)
			{
				showMessage(this.error, describeEditorError(error, {
					id: 'editor.tiles.uploadFailed',
					defaultMessage: 'Could not upload the tileset "{name}".',
					description: 'Shown on the Tilesets tab when saving couldn\'t upload a tileset; {name} is the name it was given'
				}, {
					name: item.request.name
				}));

				return(false);
			}

			this.uploadsToAdd.remove(id);
		}

		return(true);
	}

	/**
	 * Saves the tiles' changes in the order they were made, stopping at the first the server refuses
	 *
	 * @param universe The universe
	 * @return True when they were all saved
	 */
	private async saveTiles(universe: EditableUniverse): Promise<boolean>
	{
		const failure = await this.staged.commit({
			create: (settings) => this.api.createTile(universe.id, this.resolveUpload(settings)),
			save: (tileId, settings) => this.api.saveTile(universe.id, tileId, this.resolveUpload(settings)),
			remove: (tileId) => this.api.deleteTile(universe.id, tileId, this.replacements.get(tileId))
		});

		if (failure)
		{
			const tile = this.tileWithChanges(failure.change.id);

			showMessage(this.error, describeCommitFailure(failure, (tile ? tileName(tile, universe.ruleset) : ''), !tile?.custom));

			return(false);
		}

		return(true);
	}

	/**
	 * Deletes the tilesets marked to delete, stopping at the first the server refuses. One already gone,
	 * perhaps deleted by another editor, counts as deleted
	 *
	 * @param universe The universe
	 * @return True when they were all deleted
	 */
	private async deleteUploads(universe: EditableUniverse): Promise<boolean>
	{
		for (const id of this.uploadsToDelete.list())
		{
			try
			{
				await this.api.deleteTileGraphic(universe.id, id);
			}
			catch (error)
			{
				if (!(error instanceof EditorApiError) || (error.status !== 404))
				{
					showMessage(this.error, describeEditorError(error, {
						id: 'editor.tiles.deleteUploadFailed',
						defaultMessage: 'Could not delete the tileset "{name}".',
						description: 'Shown on the Tilesets tab when saving couldn\'t delete an uploaded tileset; {name} is the name it was given'
					}, {
						name: (this.savedUploads.find((upload) => (upload.id === id))?.name ?? '')
					}));

					return(false);
				}
			}

			this.uploadsToDelete.done(id);
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
			enabled: filterValue(this.enabledFilter),
			custom: filterValue(this.customFilter),
			edited: filterValue(this.editedFilter),
			sort: this.sorter.order.column,
			direction: this.sorter.order.direction,
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

		const shown = stagedPage(this.tiles, this.staged, (this.offset === 0), (id, settings) => ({
			id,
			key: null,
			...settings,
			custom: true,
			edited: false,
			uploadedGraphic: this.uploadNamed(settings.uploadedGraphicId)
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
		const settings = this.staged.settingsOf(tileId);

		if (!known)
		{
			return((settings === undefined) ? undefined : { id: tileId, key: null, ...settings, custom: true, edited: false, uploadedGraphic: this.uploadNamed(settings.uploadedGraphicId) });
		}

		return({ ...known, ...settings });
	}

	/**
	 * One of the universe's uploaded tile graphics, or one staged to upload
	 *
	 * @param graphicId The graphic's ID, or null
	 * @return The graphic, or null when there is none with that ID
	 */
	private uploadNamed(graphicId: string | null): UploadedTileGraphic | null
	{
		const upload = this.shownUploads().find((candidate) => (candidate.id === graphicId));

		return((upload ? { id: upload.id, name: upload.name, format: upload.format, drawOrder: upload.drawOrder } : null));
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
			(tile.enabled
				? undefined
				: t(editorMessages.disabledTag)),
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

		showTileSwatch(swatch, tile, this.shownUploads());
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

		// A disabled tile is struck through like one being deleted; its notes say it is disabled
		if (!tile.enabled)
		{
			row.classList.add('staged-deleted');
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
			this.dialog.open(this.universe, tile, this.staged.edit(tile?.id), () =>
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
