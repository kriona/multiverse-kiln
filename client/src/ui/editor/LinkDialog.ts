import { isInBounds, type EditorTile, type EditorZone, type EditorZoneLink, type EditorZoneSummary, type MessageDescriptor, type Ruleset, type ZoneLinkMode, type ZoneLinkTarget } from '@multiverse-kiln/shared';

import { ChunkLoader } from '../../editor/ChunkLoader';
import { EditorMap } from '../../editor/EditorMap';
import { editorZonePayload, MapCanvas } from '../../editor/MapCanvas';
import { t } from '../../localization';
import { describeEditorError, type EditorApi } from '../../network/editorApi';
import type { BrushCell } from '../../editor/brush';
import type { MapEditorHost } from '../../scenes/MapEditorScene';
import { ChangeTracker } from '../changeTracker';
import { getElement, setOptions, showMessage } from '../dom';
import { addKeyHelp } from '../shortcuts';
import { describeCell } from './cellDescription';
import { mapMessages } from './mapMessages';

/**
 * Width of the target zone's preview, in pixels
 */
const PREVIEW_WIDTH = 600;

/**
 * Height of the target zone's preview, in pixels
 */
const PREVIEW_HEIGHT = 330;

const DESTINATION_COLOR = 0x4caf50;

const RETURN_COLOR = 0xe040fb;

/**
 * The cell a link is being added to or changed on, and what it can link to
 */
export interface LinkDialogTarget
{
	universeId: string;

	/**
	 * The zone the link is in
	 */
	zone: EditorZone;

	column: number;
	row: number;

	/**
	 * The link the cell has, or undefined to add one
	 */
	link: EditorZoneLink | undefined;

	/**
	 * Every zone of the universe
	 */
	zones: readonly EditorZoneSummary[];

	/**
	 * Every tile the universe can use, for drawing the preview
	 */
	tiles: readonly EditorTile[];

	/**
	 * The universe's ruleset, which names its default tiles
	 */
	ruleset: Ruleset;

	/**
	 * Called after the link is saved or deleted
	 */
	onChanged: () => void;
}

/**
 * The zone the preview shows
 */
interface PreviewZone
{
	zone: EditorZone;
	links: EditorZoneLink[];
	map: EditorMap;
	loader: ChunkLoader;
}

/**
 * Adds, changes or deletes a cell's zone link: how it is taken, whether it needs the whole group, and
 * where it goes, chosen by clicking a preview of the target zone's map. It can also place a return
 * link in the target zone that leads back to the cell
 */
export class LinkDialog
{
	private readonly dialog = getElement('link-dialog', HTMLDialogElement);
	private readonly form = getElement('link-form', HTMLFormElement);
	private readonly fields = getElement('link-fields', HTMLFieldSetElement);
	private readonly title = getElement('link-title', HTMLElement);
	private readonly automatic = getElement('link-automatic', HTMLInputElement);
	private readonly manual = getElement('link-manual', HTMLInputElement);
	private readonly wholeGroup = getElement('link-whole-group', HTMLInputElement);
	private readonly targetZone = getElement('link-target', HTMLSelectElement);
	private readonly addReturn = getElement('link-return', HTMLInputElement);
	private readonly pickChoice = getElement('link-pick-choice', HTMLElement);
	private readonly pickReturn = getElement('link-pick-return', HTMLInputElement);
	private readonly pickDestination = getElement('link-pick-destination', HTMLInputElement);
	private readonly destinationText = getElement('link-destination', HTMLElement);
	private readonly returnText = getElement('link-return-cell', HTMLElement);
	private readonly error = getElement('link-error', HTMLElement);
	private readonly deleteButton = getElement('link-delete', HTMLButtonElement);
	private readonly canvas = new MapCanvas(getElement('link-preview', HTMLElement), PREVIEW_WIDTH, PREVIEW_HEIGHT);

	private target: LinkDialogTarget | undefined;
	private preview: PreviewZone | undefined;
	private destination: BrushCell | undefined;
	private returnCell: BrushCell | undefined;

	/**
	 * Whether the link, or the cells chosen on the preview, have changes that haven't been saved
	 */
	private readonly changes = new ChangeTracker({
		root: this.form,
		state: () => [this.destination, this.returnCell]
	});

	/**
	 * Changes every time the preview switches zone, so a zone that arrives for an earlier choice is ignored
	 */
	private previewVersion = 0;

	/**
	 * @param api The editor's API
	 */
	constructor(private readonly api: EditorApi)
	{
		const previewElement = getElement('link-preview', HTMLElement);

		addKeyHelp({
			scope: previewElement,
			keys: () => t(mapMessages.arrowKeys),
			description: () => t({
				id: 'editor.link.keys.cursorDescription',
				defaultMessage: 'Move the cursor on the focused map, 10 cells at a time with Shift',
				description: 'In the list of keyboard shortcuts, what the arrow keys do on the link dialog\'s map'
			})
		});

		addKeyHelp({
			scope: previewElement,
			keys: () => t(mapMessages.spaceOrEnter),
			description: () => t({
				id: 'editor.link.keys.pickDescription',
				defaultMessage: 'Choose the cursor\'s cell',
				description: 'In the list of keyboard shortcuts, what Space and Enter do on the link dialog\'s map: choose the destination or the return link\'s cell'
			})
		});

		this.targetZone.addEventListener('change', () =>
		{
			this.destination = undefined;
			this.returnCell = undefined;
			void this.showPreview(this.targetZone.value);
		});

		this.addReturn.addEventListener('change', () =>
		{
			this.pickChoice.hidden = !this.addReturn.checked;
			this.returnText.hidden = !this.addReturn.checked;
			this.pickReturn.checked = this.addReturn.checked;
			this.pickDestination.checked = !this.addReturn.checked;
			this.updateCells();
		});

		this.changes.guardDialog(this.dialog);

		getElement('link-cancel', HTMLButtonElement).addEventListener('click', () =>
		{
			if (this.changes.confirmDiscard())
			{
				this.dialog.close();
			}
		});

		this.dialog.addEventListener('close', () =>
		{
			this.closePreview();
		});

		this.deleteButton.addEventListener('click', () =>
		{
			void this.deleteLink();
		});

		this.form.addEventListener('submit', (event) =>
		{
			event.preventDefault();
			void this.save();
		});
	}

	/**
	 * Opens the dialog for a cell
	 *
	 * @param target The cell, its link if it has one, and what it can link to
	 */
	open(target: LinkDialogTarget): void
	{
		const { link } = target;
		const others = target.zones.filter((zone) => (zone.id !== target.zone.id));

		this.target = target;
		this.destination = (link ? { column: link.targetColumn, row: link.targetRow } : undefined);
		this.returnCell = undefined;
		this.title.textContent = (link
			? t({
				id: 'editor.link.title',
				defaultMessage: 'Link at {column}, {row}',
				description: 'Title of the dialog for a cell\'s zone link; {column} and {row} are the cell\'s coordinates'
			}, {
				column: target.column,
				row: target.row
			})
			: t({
				id: 'editor.link.addTitle',
				defaultMessage: 'Add a link at {column}, {row}',
				description: 'Title of the dialog for adding a zone link to a cell; {column} and {row} are the cell\'s coordinates'
			}, {
				column: target.column,
				row: target.row
			}));
		this.automatic.checked = ((link?.mode ?? 'automatic') === 'automatic');
		this.manual.checked = !this.automatic.checked;
		this.wholeGroup.checked = (link?.requiresWholeGroup ?? false);
		this.addReturn.checked = false;
		this.pickChoice.hidden = true;
		this.returnText.hidden = true;
		this.pickDestination.checked = true;
		this.deleteButton.hidden = !link;
		this.fields.disabled = false;
		setOptions(this.targetZone, others.map((zone) => ({
			value: zone.id,
			label: zone.name
		})));
		this.targetZone.value = (link?.targetZoneId ?? others[0]?.id ?? '');
		showMessage(this.error, ((others.length === 0)
			? t({
				id: 'editor.link.noOtherZones',
				defaultMessage: 'Add another zone to link to first.',
				description: 'Shown in the link dialog when the universe has only the zone being edited'
			})
			: undefined));
		this.updateCells();
		this.dialog.showModal();
		this.changes.markSaved();

		if (this.targetZone.value !== '')
		{
			void this.showPreview(this.targetZone.value);
		}
	}

	/**
	 * Shows a zone's map in the preview, centered on the destination if it has one
	 *
	 * @param zoneId The zone's ID
	 */
	private async showPreview(zoneId: string): Promise<void>
	{
		const target = this.target;
		const version = ++this.previewVersion;

		this.closePreview();

		if (!target)
		{
			return;
		}

		let zone: EditorZone;
		let links: EditorZoneLink[];

		try
		{
			[zone, links] = await Promise.all([
				this.api.getZone(target.universeId, zoneId),
				this.api.listLinks(target.universeId, zoneId)
			]);
		}
		catch (error)
		{
			if (version === this.previewVersion)
			{
				showMessage(this.error, describeEditorError(error, {
					id: 'editor.link.showZoneFailed',
					defaultMessage: 'Could not show that zone.',
					description: 'Shown in the link dialog when the map of the zone the link goes to couldn\'t be loaded'
				}));
			}

			return;
		}

		if ((version !== this.previewVersion) || !this.dialog.open)
		{
			return;
		}

		const map = new EditorMap(zone.bounds);
		const loader = new ChunkLoader(this.api, target.universeId, zone.id, map, (chunkKeys) =>
		{
			this.canvas.scene?.refreshChunks(chunkKeys);
		}, (error) =>
		{
			showMessage(this.error, describeEditorError(error, mapMessages.loadFailed));
		});

		this.preview = { zone, links, map, loader };

		const scene = await this.canvas.show(editorZonePayload(zone, target.tiles, target.ruleset), map.chunks, this.previewHost(loader));

		scene.setLinks(links);
		this.updateCells();

		if (this.destination)
		{
			scene.centerOnCell(this.destination.column, this.destination.row);
		}
	}

	/**
	 * What clicks on the preview do: choose the destination or the return link's cell
	 *
	 * @param loader Loads the preview zone's chunks
	 * @return The host
	 */
	private previewHost(loader: ChunkLoader): MapEditorHost
	{
		return({
			pointerMode: () => 'pick',
			brush: () => ({ size: 1, shape: 'square' }),
			paintStart: () => undefined,
			paint: () => undefined,
			paintEnd: () => undefined,
			hover: () => undefined,
			describe: (cell) =>
			{
				const preview = this.preview;
				const target = this.target;

				if (!preview || !target)
				{
					return('');
				}

				return(describeCell({
					map: preview.map,
					defaultTileId: preview.zone.defaultTileId,
					tiles: target.tiles,
					links: preview.links,
					ruleset: target.ruleset
				}, cell));
			},
			viewChanged: (range) =>
			{
				loader.request(range);
			},
			pick: (column, row) =>
			{
				if (!this.preview || !isInBounds(this.preview.zone.bounds, column, row))
				{
					return;
				}

				if (this.addReturn.checked && this.pickReturn.checked)
				{
					this.returnCell = { column, row };
				}
				else
				{
					this.destination = { column, row };
				}

				this.updateCells();
			}
		});
	}

	/**
	 * Shows the chosen cells, in words and highlighted on the preview
	 */
	private updateCells(): void
	{
		const returnLink = (this.returnCell && this.preview?.links.find((link) => ((link.column === this.returnCell?.column) && (link.row === this.returnCell.row))));

		this.destinationText.textContent = (this.destination
			? t({
				id: 'editor.link.destination',
				defaultMessage: 'Destination: {column}, {row}',
				description: 'The cell the link leads to; {column} and {row} are its coordinates'
			}, {
				column: this.destination.column,
				row: this.destination.row
			})
			: t({
				id: 'editor.link.chooseDestination',
				defaultMessage: 'Click the map to choose the destination.',
				description: 'Shown in the link dialog until the cell the link leads to is chosen'
			}));

		if (!this.returnCell)
		{
			this.returnText.textContent = t({
				id: 'editor.link.placeReturn',
				defaultMessage: 'Choose the return link\'s cell above, then click the map to place it.',
				description: 'Shown in the link dialog until the cell for the link leading back is chosen'
			});
		}
		else if (returnLink)
		{
			this.returnText.textContent = t({
				id: 'editor.link.returnCellReplacing',
				defaultMessage: 'Return link at {column}, {row}, replacing the link there',
				description: 'The cell where the link leading back will be placed, which already has a link; {column} and {row} are its coordinates'
			}, {
				column: this.returnCell.column,
				row: this.returnCell.row
			});
		}
		else
		{
			this.returnText.textContent = t({
				id: 'editor.link.returnCell',
				defaultMessage: 'Return link at {column}, {row}',
				description: 'The cell where the link leading back will be placed; {column} and {row} are its coordinates'
			}, {
				column: this.returnCell.column,
				row: this.returnCell.row
			});
		}

		this.canvas.scene?.setHighlights([
			...(this.destination ? [{ ...this.destination, color: DESTINATION_COLOR }] : []),
			...((this.returnCell && this.addReturn.checked) ? [{ ...this.returnCell, color: RETURN_COLOR }] : [])
		]);
		this.changes.check();
	}

	/**
	 * Saves the link, and the return link if one was placed
	 */
	private async save(): Promise<void>
	{
		const target = this.target;
		const preview = this.preview;
		const destination = this.destination;

		if (!target || !preview)
		{
			return;
		}

		if (!destination)
		{
			showMessage(this.error, t({
				id: 'editor.link.needDestination',
				defaultMessage: 'Click the map to choose where the link goes.',
				description: 'Shown when Save is pressed before the cell the link leads to is chosen'
			}));
			return;
		}

		if (this.addReturn.checked && !this.returnCell)
		{
			showMessage(this.error, t({
				id: 'editor.link.needReturn',
				defaultMessage: 'Click the map to place the return link, or don\'t add one.',
				description: 'Shown when Save is pressed with a return link asked for but not placed'
			}));
			return;
		}

		const mode: ZoneLinkMode = (this.manual.checked ? 'manual' : 'automatic');
		const link: ZoneLinkTarget = {
			targetZoneId: preview.zone.id,
			targetColumn: destination.column,
			targetRow: destination.row,
			mode,
			requiresWholeGroup: this.wholeGroup.checked
		};
		const returnCell = (this.addReturn.checked ? this.returnCell : undefined);

		await this.run({
			id: 'editor.link.saveFailed',
			defaultMessage: 'Could not save the link.',
			description: 'Shown in the link dialog when the link couldn\'t be stored'
		}, async () =>
		{
			await this.api.saveLink(target.universeId, target.zone.id, target.column, target.row, link);

			if (returnCell)
			{
				await this.api.saveLink(target.universeId, preview.zone.id, returnCell.column, returnCell.row, {
					targetZoneId: target.zone.id,
					targetColumn: target.column,
					targetRow: target.row,
					mode,
					requiresWholeGroup: this.wholeGroup.checked
				});
			}
		});
	}

	/**
	 * Deletes the cell's link after asking
	 */
	private async deleteLink(): Promise<void>
	{
		const target = this.target;

		if (!target)
		{
			return;
		}

		const question = t({
			id: 'editor.link.confirmDelete',
			defaultMessage: 'Delete the link at {column}, {row}?',
			description: 'Asks before deleting a zone link; {column} and {row} are its cell\'s coordinates'
		}, {
			column: target.column,
			row: target.row
		});

		if (!window.confirm(question))
		{
			return;
		}

		await this.run({
			id: 'editor.link.deleteFailed',
			defaultMessage: 'Could not delete the link.',
			description: 'Shown in the link dialog when the link couldn\'t be deleted'
		}, () => this.api.deleteLink(target.universeId, target.zone.id, target.column, target.row));
	}

	/**
	 * Makes a change, closing the dialog when it succeeds and explaining in it when it doesn't
	 *
	 * @param failure What failed, as a sentence, for the error message
	 * @param change The change
	 */
	private async run(failure: MessageDescriptor, change: () => Promise<void>): Promise<void>
	{
		this.fields.disabled = true;
		showMessage(this.error, undefined);

		try
		{
			await change();
			this.dialog.close();
			this.target?.onChanged();
		}
		catch (error)
		{
			showMessage(this.error, describeEditorError(error, failure));
		}
		finally
		{
			this.fields.disabled = false;
		}
	}

	/**
	 * Stops showing and loading the preview's zone
	 */
	private closePreview(): void
	{
		this.preview?.loader.stop();
		this.preview = undefined;
		this.canvas.stop();
	}
}
