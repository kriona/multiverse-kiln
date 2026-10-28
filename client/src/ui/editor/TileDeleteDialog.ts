import type { EditableUniverse, EditorTile } from '@multiverse-kiln/shared';

import { formatList, t } from '../../localization';
import { describeEditorError, type EditorApi } from '../../network/editorApi';
import { getElement, setOptions, showMessage } from '../dom';
import { tileName } from '../tileNames';
import { isNewId } from './stagedChanges';

/**
 * The dialog that asks before a tile is deleted. When maps use the tile, it lists their areas and asks
 * which tile to paint them with instead
 *
 * Like every change in the editor, the deletion waits for the Tilesets tab to be saved; saving paints
 * the maps with the replacement, then deletes the tile
 */
export class TileDeleteDialog
{
	private readonly dialog = getElement('tile-delete-dialog', HTMLDialogElement);
	private readonly form = getElement('tile-delete-form', HTMLFormElement);
	private readonly question = getElement('tile-delete-question', HTMLElement);
	private readonly status = getElement('tile-delete-status', HTMLElement);
	private readonly replacementField = getElement('tile-delete-replacement-field', HTMLElement);
	private readonly usage = getElement('tile-delete-usage', HTMLElement);
	private readonly replacement = getElement('tile-delete-replacement', HTMLSelectElement);
	private readonly error = getElement('tile-delete-error', HTMLElement);
	private readonly cancelButton = getElement('tile-delete-cancel', HTMLButtonElement);
	private readonly submitButton = getElement('tile-delete-submit', HTMLButtonElement);

	/**
	 * Called with the tile to paint the maps with, or undefined when no map uses the tile, once the
	 * player confirms
	 */
	private onConfirm: (replacementId: number | undefined) => void = () => undefined;

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
	 * Asks before deleting a tile: loads the areas whose maps use it, and when there are any, the tiles
	 * that can replace it
	 *
	 * @param universe The universe the tile belongs to
	 * @param tile The tile
	 * @param isRemoved Whether a tile is marked to delete already, so it can't replace this one
	 * @param onConfirm Called with the tile to paint the maps with, or undefined when no map uses the tile
	 */
	open(universe: EditableUniverse, tile: EditorTile, isRemoved: (tileId: number) => boolean, onConfirm: (replacementId: number | undefined) => void): void
	{
		const version = ++this.openVersion;
		const name = tileName(tile, universe.ruleset);

		this.onConfirm = onConfirm;
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

		// A tile that isn't saved yet can't be on any map
		if (isNewId(tile.id))
		{
			this.status.textContent = '';
			this.submitButton.disabled = false;
			return;
		}

		this.status.textContent = t({
			id: 'editor.tileDelete.checking',
			defaultMessage: 'Checking which maps use it...',
			description: 'Shown in the dialog before deleting a tile while it finds out which areas\' maps use the tile'
		});
		this.submitButton.disabled = true;
		void this.loadUsage(universe, tile, isRemoved, version);
	}

	/**
	 * Shows which areas use the tile, and if any do, the tiles that can replace it
	 *
	 * @param universe The universe the tile belongs to
	 * @param tile The tile
	 * @param isRemoved Whether a tile is marked to delete already
	 * @param version The opening it is for
	 */
	private async loadUsage(universe: EditableUniverse, tile: EditorTile, isRemoved: (tileId: number) => boolean, version: number): Promise<void>
	{
		let areas: { id: string; name: string }[];
		let tiles: EditorTile[];

		try
		{
			[areas, tiles] = await Promise.all([
				this.api.tileUsage(universe.id, tile.id),
				this.api.listAllTiles(universe.id)
			]);
		}
		catch (error)
		{
			if (version === this.openVersion)
			{
				this.status.textContent = '';
				showMessage(this.error, describeEditorError(error, {
					id: 'editor.tileDelete.checkFailed',
					defaultMessage: 'Could not find out which maps use the tile.',
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
			defaultMessage: '{count, plural, one {The map of {areas} uses it.} other {The maps of {areas} use it.}} Choose a tile to paint {count, plural, one {it} other {them}} with in its place.',
			description: 'Shown in the dialog before deleting a tile that maps use; {areas} lists the areas\' names, and {count} is how many there are'
		}, {
			count: areas.length,
			areas: formatList(areas.map((area) => area.name))
		});
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
		this.replacementField.hidden = false;
		this.replacement.focus();
	}

	/**
	 * Marks the tile to delete, with the tile chosen to replace it if maps use it
	 */
	private confirm(): void
	{
		const replacementId = ((this.replacementField.hidden || (this.replacement.value === '')) ? undefined : Number(this.replacement.value));

		this.dialog.close();
		this.onConfirm(replacementId);
	}
}
