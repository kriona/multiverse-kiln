import { canEditWorld, defineMessages, IMPASSABLE_WALK_SECONDS, MAX_TILES_PER_PAGE, TILE_SORT_COLUMNS, TILE_USED_IN, tileUsedIn, type EditableUniverse, type EditorChange, type EditorTile, type NewRef, type TileChangeSettings, type TileListPayload, type TileListQuery, type TileSettings, type TileSortColumn, type UploadedTileGraphic } from '@multiverse-kiln/shared';

import { formatDuration, t } from '../../localization';
import { describeEditorError, type EditorApi } from '../../network/editorApi';
import { showStagedTileGraphic } from '../../rendering/tileGraphics';
import { getElement, setOptions, showMessage } from '../dom';
import { TableSorter } from '../tableSorter';
import { tileName } from '../tileNames';
import { editorMessages } from './editorMessages';
import { newRef, numberRef, type EditorSave, type SavedIds } from './editorSave';
import { combineChanges, type SavableTab } from './SaveBar';
import { describeRefusedChange, joinTags, markStagedRow, StagedAdditions, StagedChanges, StagedDeletions, stagedPage, stagedTag, stagedView, type StagedChange, type StagedState } from './stagedChanges';
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
 * The ID the first tile added on the page gets, well clear of VOID_CELL and UNSEEN_CELL
 */
const FIRST_NEW_TILE_ID = -1000;

/**
 * How the ID a tileset staged to upload has on the page starts
 */
const STAGED_UPLOAD_PREFIX = 'new-upload-';

/**
 * The ref a save sends a tileset staged to upload with
 *
 * @param stagedId Its ID on the page
 * @return The ref
 */
function uploadRef(stagedId: string): NewRef
{
	return(newRef('', stagedId));
}

/**
 * The Tilesets tab: every tile the universe can paint with, filtered, sorted by a column (by the server,
 * before paging) and a page at a time, opening the
 * tile editor. Changes wait on the page until the tab is saved: changed tiles show their changes on the
 * page they are on, and tiles added since show at the top of the first page, whatever the filters. The
 * Areas tab's maps draw and paint with the tiles as they will be once saved (withChanges)
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
	 * The changes made to the tiles since they were last saved. Maps can be painted with a tile added
	 * since, so its ID stays clear of the values cells hold for void and unseen cells
	 */
	private readonly staged = new StagedChanges<TileSettings>(FIRST_NEW_TILE_ID);

	/**
	 * Tilesets chosen in the upload dialog, uploaded when the tab is saved. Until then tiles refer to
	 * them by their staged IDs
	 */
	private readonly uploadsToAdd = new StagedAdditions<StagedUpload>(STAGED_UPLOAD_PREFIX);

	/**
	 * Uploaded tilesets to delete when the tab is saved
	 */
	private readonly uploadsToDelete = new StagedDeletions();

	readonly changes = combineChanges(this.staged, this.uploadsToAdd, this.uploadsToDelete);

	/**
	 * Whether the tiles maps are drawn with have changed since they were last saved; for the Areas tab
	 */
	readonly tileChanges = combineChanges(this.staged, this.uploadsToAdd);

	/**
	 * The ID each staged upload got once it was uploaded, by its staged ID, for tiles changed while the
	 * save uploading it was being sent
	 */
	private readonly uploadedIds = new Map<string, string>();

	/**
	 * What the save being sent holds: the tilesets uploaded, the tiles' changes, and the tilesets deleted
	 */
	private collected: { uploads: string[]; tiles: readonly StagedChange<TileSettings>[]; deletions: string[] } = { uploads: [], tiles: [], deletions: [] };

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

				showStagedTileGraphic(id, upload.previewUrl);
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
	 * A tile's settings as a save sends them: a tileset staged to upload is named by its ref, one uploaded
	 * by an earlier save by the ID it was uploaded under, and one discarded since becomes none
	 *
	 * @param settings The tile's staged settings
	 * @return The settings to send
	 */
	private resolveUpload(settings: TileSettings): TileChangeSettings
	{
		const { uploadedGraphicId } = settings;

		if ((uploadedGraphicId === null) || !this.isStagedUploadId(uploadedGraphicId))
		{
			return(settings);
		}

		return({
			...settings,
			uploadedGraphicId: (this.uploadsToAdd.has(uploadedGraphicId) ? uploadRef(uploadedGraphicId) : (this.uploadedIds.get(uploadedGraphicId) ?? null))
		});
	}

	/**
	 * Whether a tileset ID is one a tileset staged to upload had on the page
	 *
	 * @param graphicId The ID
	 * @return True when it is
	 */
	private isStagedUploadId(graphicId: string): boolean
	{
		return(graphicId.startsWith(STAGED_UPLOAD_PREFIX));
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
	 * Adds the changes to a save: the tilesets staged to upload first, so the tiles staged to use them can
	 * name them, then the tiles' changes in the order they were made, then the tilesets marked to delete
	 *
	 * @param save The save
	 * @return True
	 */
	collect(save: EditorSave): boolean
	{
		const universe = this.universe;

		showMessage(this.error, undefined);

		if (!universe)
		{
			return(true);
		}

		const uploads = this.uploadsToAdd.list();

		for (const { id, item } of uploads)
		{
			save.add({ kind: 'uploadTileGraphic', ref: uploadRef(id), upload: item.request }, (refusal) =>
			{
				showMessage(this.error, describeEditorError(refusal.error, {
					id: 'editor.tiles.uploadFailed',
					defaultMessage: 'Could not upload the tileset "{name}".',
					description: 'Shown on the Tilesets tab when the server refused a tileset staged to upload, followed by why; {name} is the name it was given. Nothing was saved'
				}, {
					name: item.request.name
				}));
			});
		}

		this.collected = {
			uploads: uploads.map(({ id }) => id),
			tiles: this.staged.collect(save, (change) => this.tileChange(change), (change, refusal) =>
			{
				const tile = this.tileWithChanges(change.id);

				showMessage(this.error, describeRefusedChange(change, refusal, (tile ? tileName(tile, universe.ruleset) : ''), !tile?.custom));
			}),
			deletions: this.uploadsToDelete.list()
		};

		for (const id of this.collected.deletions)
		{
			save.add({ kind: 'deleteTileGraphic', graphicId: id }, (refusal) =>
			{
				// One already gone, perhaps deleted by another editor, counts as deleted
				if (refusal.error.status === 404)
				{
					this.uploadsToDelete.done(id);
					refusal.retry();
					return;
				}

				showMessage(this.error, describeEditorError(refusal.error, {
					id: 'editor.tiles.deleteUploadFailed',
					defaultMessage: 'Could not delete the tileset "{name}".',
					description: 'Shown on the Tilesets tab when the server refused to delete an uploaded tileset, followed by why; {name} is the name it was given. Nothing was saved'
				}, {
					name: (this.savedUploads.find((upload) => (upload.id === id))?.name ?? '')
				}));
			});
		}

		return(true);
	}

	/**
	 * The change a save sends for a change to a tile, naming tiles and tilesets not saved yet by their refs
	 *
	 * @param change The change
	 * @return The change to send
	 */
	private tileChange(change: StagedChange<TileSettings>): EditorChange
	{
		switch (change.kind)
		{
			case 'create':
				return({ kind: 'createTile', ref: newRef('tile', change.id), settings: this.resolveUpload(change.settings) });
			case 'save':
				return({ kind: 'saveTile', id: numberRef('tile', change.id), settings: this.resolveUpload(change.settings) });
			case 'remove':
			{
				const replacement = this.replacements.get(change.id);

				return({ kind: 'removeTile', id: numberRef('tile', change.id), replaceWith: ((replacement === undefined) ? null : numberRef('tile', replacement)) });
			}
		}
	}

	/**
	 * Takes the changes as saved, and loads the tiles and tilesets afresh
	 *
	 * @param ids The IDs the save gave the tiles and tilesets it made
	 */
	async saved(ids: SavedIds): Promise<void>
	{
		const universe = this.universe;
		const { uploads, tiles, deletions } = this.collected;
		const savedTileId = (id: number): number | undefined => ids.number(newRef('tile', id));

		this.collected = { uploads: [], tiles: [], deletions: [] };

		for (const id of uploads)
		{
			const savedId = ids.string(uploadRef(id));

			if (savedId !== undefined)
			{
				this.uploadedIds.set(id, savedId);
			}

			this.uploadsToAdd.remove(id);
		}

		for (const change of tiles)
		{
			if (change.kind === 'remove')
			{
				this.replacements.delete(change.id);
			}
		}

		for (const [tileId, replacementId] of this.replacements)
		{
			this.replacements.set(tileId, (savedTileId(replacementId) ?? replacementId));
		}

		this.staged.markSaved(tiles, savedTileId);

		for (const id of deletions)
		{
			this.uploadsToDelete.done(id);
		}

		if (universe)
		{
			await Promise.all([this.refresh(), this.loadUploads(universe)]);
		}
	}

	/**
	 * Every tile as it will be once the tab is saved, for the maps: the saved tiles with their changes,
	 * then the tiles added since. A tile staged for deletion is drawn as the tile chosen to replace it
	 *
	 * @param saved Every tile the universe can use, as saved
	 * @return The tiles, and the tiles staged for deletion with their replacements
	 */
	withChanges(saved: readonly EditorTile[]): { tiles: EditorTile[]; deleted: Map<number, number | undefined> }
	{
		const view = stagedView(saved, this.staged, (tile, settings) => ({
			...tile,
			...settings,
			edited: (tile.custom ? tile.edited : true),
			uploadedGraphic: this.uploadNamed(settings.uploadedGraphicId)
		}), (id, settings) => this.createdTile(id, settings));
		const deleted = new Map(view
			.filter(({ item, state }) => ((state === 'removed') && item.custom))
			.map(({ item }) => [item.id, this.replacements.get(item.id)]));
		const tiles = view.map(({ item }) => item);
		const byId = new Map(tiles.map((tile) => [tile.id, tile]));

		return({
			tiles: tiles.map((tile) =>
			{
				const replacement = byId.get(deleted.get(tile.id) ?? NaN);

				return((replacement ? { ...tile, color: replacement.color, graphic: replacement.graphic, uploadedGraphic: replacement.uploadedGraphic } : tile));
			}),
			deleted
		});
	}

	/**
	 * A tile added since the tab was last saved, as the list shows it
	 *
	 * @param id Its negative ID
	 * @param settings Its settings
	 * @return The tile
	 */
	private createdTile(id: number, settings: TileSettings): EditorTile
	{
		return({
			id,
			key: null,
			...settings,
			custom: true,
			edited: false,
			uploadedGraphic: this.uploadNamed(settings.uploadedGraphicId)
		});
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

		const shown = stagedPage(this.tiles, this.staged, (this.offset === 0), (id, settings) => this.createdTile(id, settings));

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
			return((settings === undefined) ? undefined : this.createdTile(tileId, settings));
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
