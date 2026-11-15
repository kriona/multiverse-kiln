import type { EditableUniverse, EditorTile } from '@multiverse-kiln/shared';

import { formatList, t } from '../../localization';
import { describeEditorError, type EditorApi } from '../../network/editorApi';
import { getElement, setOptions, showMessage } from '../dom';
import { tileName } from '../tileNames';
import { isNewId } from './stagedChanges';
import type { TilePlaces } from './TileReplaceDialog';

/**
 * The dialog that asks before a tile is deleted. When areas use the tile, it lists them and asks
 * which tile to paint them with instead. When some are outside a builder's assignments, it says only a
 * creator can delete the tile
 *
 * Like every change in the editor, the deletion waits for the Tilesets tab to be saved; saving paints
 * the areas with the replacement, then deletes the tile
 */
export class TileDeleteDialog
{
	private readonly dialog = getElement('tile-delete-dialog', HTMLDialogElement);
	private readonly form = getElement('tile-delete-form', HTMLFormElement);
	private readonly question = getElement('tile-delete-question', HTMLElement);
	private readonly status = getElement('tile-delete-status', HTMLElement);
	private readonly replacementField = getElement('tile-delete-replacement-field', HTMLElement);
	private readonly usage = getElement('tile-delete-usage', HTMLElement);
	private readonly outside = getElement('tile-delete-outside', HTMLElement);
	private readonly outsideText = getElement('tile-delete-outside-text', HTMLElement);
	private readonly replacementLabel = getElement('tile-delete-replacement-label', HTMLElement);
	private readonly replacement = getElement('tile-delete-replacement', HTMLSelectElement);
	private readonly error = getElement('tile-delete-error', HTMLElement);
	private readonly cancelButton = getElement('tile-delete-cancel', HTMLButtonElement);
	private readonly submitButton = getElement('tile-delete-submit', HTMLButtonElement);

	/**
	 * Called with the tile to paint the areas with, or undefined when no area uses the tile, once the
	 * player confirms
	 */
	private onConfirm: (replacementId: number | undefined) => void = () => undefined;

	/**
	 * Whether areas outside the builder's assignments use the tile, so only a creator can delete it
	 */
	private usedOutside = false;

	/**
	 * Changes each time the dialog opens, so what a request for an earlier opening brings back is ignored
	 */
	private openVersion = 0;

	/**
	 * @param api The editor's API, for which areas use the tile and which tiles can replace it
	 */
	constructor(private readonly api: EditorApi)
	{
		this.cancelButton.addEventListener('click', () =>
		{
			this.dialog.close();
		});

		this.form.addEventListener('submit', (event) =>
		{
			event.preventDefault();
			this.confirm();
		});
	}

	/**
	 * Asks before deleting a tile: loads the areas that use it, and when there are any, the tiles
	 * that can replace it
	 *
	 * @param universe The universe the tile belongs to
	 * @param tile The tile
	 * @param isRemoved Whether a tile is marked to delete already, so it can't replace this one
	 * @param places The regions and areas, for which of the areas using the tile the player may paint
	 * @param onConfirm Called with the tile to paint the areas with, or undefined when no area uses the tile
	 */
	open(universe: EditableUniverse, tile: EditorTile, isRemoved: (tileId: number) => boolean, places: TilePlaces | undefined, onConfirm: (replacementId: number | undefined) => void): void
	{
		const version = ++this.openVersion;
		const name = tileName(tile, universe.ruleset);

		this.onConfirm = onConfirm;
		this.usedOutside = false;
		this.outside.hidden = true;
		this.outsideText.textContent = '';
		this.replacementLabel.hidden = false;
		this.question.textContent = t({
			id: 'editor.tileDelete.question',
			defaultMessage: 'Delete the tile "{name}" when the Tilesets tab is saved?',
			description: 'Asked in the dialog before deleting a tile; {name} is the tile\'s name. Nothing is deleted until the tab is saved'
		}, {
			name
		});
		this.replacementField.hidden = true;
		this.replacement.required = false;
		showMessage(this.error, undefined);
		this.dialog.showModal();
		this.cancelButton.focus();

		// A tile that isn't saved yet can't be in any area
		if (isNewId(tile.id))
		{
			this.status.textContent = '';
			this.submitButton.disabled = false;
			return;
		}

		this.status.textContent = t({
			id: 'editor.tileDelete.checking',
			defaultMessage: 'Checking which areas use it...',
			description: 'Shown in the dialog before deleting a tile while it finds out which areas use the tile'
		});
		this.submitButton.disabled = true;
		void this.loadUsage(universe, tile, isRemoved, places, version);
	}

	/**
	 * Shows which areas use the tile, and if any do, the tiles that can replace it, or that only a
	 * creator can delete it when some are outside the builder's assignments
	 *
	 * @param universe The universe the tile belongs to
	 * @param tile The tile
	 * @param isRemoved Whether a tile is marked to delete already
	 * @param places The regions and areas, for which areas the player may paint
	 * @param version The opening it is for
	 */
	private async loadUsage(universe: EditableUniverse, tile: EditorTile, isRemoved: (tileId: number) => boolean, places: TilePlaces | undefined, version: number): Promise<void>
	{
		let areas: { id: string; name: string }[];
		let tiles: EditorTile[];

		try
		{
			[areas, tiles] = await Promise.all([
				this.api.tileUsage(universe.id, tile.id),
				this.api.listAllTiles(universe.id),
				places?.loadPlaces()
			]);
		}
		catch (error)
		{
			if (version === this.openVersion)
			{
				this.status.textContent = '';
				showMessage(this.error, describeEditorError(error, {
					id: 'editor.tileDelete.checkFailed',
					defaultMessage: 'Could not find out which areas use the tile.',
					description: 'Shown in the dialog before deleting a tile when the areas using it couldn\'t be loaded'
				}));
			}

			return;
		}

		if (version !== this.openVersion)
		{
			return;
		}

		this.status.textContent = '';
		this.submitButton.disabled = false;

		if (areas.length === 0)
		{
			return;
		}

		const replacements = tiles
			.filter((candidate) => ((candidate.id !== tile.id) && !isRemoved(candidate.id)))
			.map((candidate) => ({
				value: String(candidate.id),
				label: tileName(candidate, universe.ruleset)
			}))
			.sort((a, b) => a.label.localeCompare(b.label));

		this.usage.textContent = t({
			id: 'editor.tileDelete.usage',
			defaultMessage: '{count, plural, one {{areas} uses it.} other {{areas} use it.}} Choose a tile to paint {count, plural, one {it} other {them}} with in its place.',
			description: 'Shown in the dialog before deleting a tile that areas use; {areas} lists the areas\' names, and {count} is how many there are'
		}, {
			count: areas.length,
			areas: formatList(areas.map((area) => area.name))
		});
		this.replacementField.hidden = false;

		const outside = areas.filter((area) => ((places !== undefined) && !places.canEditPlace({ kind: 'area', id: area.id })));

		// Deleting it paints every area using it, which a builder may do only within their assignments
		if (outside.length > 0)
		{
			this.usedOutside = true;
			this.outsideText.textContent = t({
				id: 'editor.tileDelete.outside',
				defaultMessage: '{count, plural, one {{areas} is} other {{areas} are}} outside the regions you\'re assigned. Only a creator can paint {count, plural, one {it} other {them}} with another tile.',
				description: 'Shown in the dialog before deleting a tile, when areas a builder can\'t edit use the tile, so only a creator can delete it; {areas} lists those areas\' names, and {count} is how many there are'
			}, {
				count: outside.length,
				areas: formatList(outside.map((area) => area.name))
			});
			this.outside.hidden = false;
			this.replacementLabel.hidden = true;
			return;
		}

		setOptions(this.replacement, [
			{
				value: '',
				label: t({
					id: 'editor.tileDelete.chooseReplacement',
					defaultMessage: 'Choose a tile',
					description: 'First choice in the list of tiles to replace a tile being deleted, before one is chosen'
				})
			},
			...replacements
		]);
		this.replacement.required = true;
		this.replacement.focus();
	}

	/**
	 * Marks the tile to delete, with the tile chosen to replace it if areas use it, unless areas outside
	 * the builder's assignments use it
	 */
	private confirm(): void
	{
		if (this.usedOutside)
		{
			showMessage(this.error, t({
				id: 'editor.tileDelete.creatorOnly',
				defaultMessage: 'Only a creator can delete this tile.',
				description: 'Shown in the dialog before deleting a tile when Delete is pressed while areas outside the builder\'s assignments use the tile'
			}));
			return;
		}

		const replacementId = ((this.replacementField.hidden || (this.replacement.value === '')) ? undefined : Number(this.replacement.value));

		this.dialog.close();
		this.onConfirm(replacementId);
	}
}
