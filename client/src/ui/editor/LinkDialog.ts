import { isInBounds, type EditorTile, type EditorArea, type EditorAreaLink, type EditorAreaSummary, type Ruleset, type AreaLinkMode, type AreaLinkTarget } from '@multiverse-kiln/shared';

import { ChunkLoader } from '../../editor/ChunkLoader';
import { EditorMap } from '../../editor/EditorMap';
import { editorAreaPayload, MapCanvas } from '../../editor/MapCanvas';
import { t } from '../../localization';
import { describeEditorError } from '../../network/editorApi';
import type { BrushCell } from '../../editor/brush';
import type { MapEditorHost } from '../../scenes/MapEditorScene';
import { ChangeTracker } from '../changeTracker';
import { getElement, setOptions, showMessage } from '../dom';
import { addKeyHelp } from '../shortcuts';
import type { AreaSource, LinkChange } from './areaSource';
import { describeCell } from './cellDescription';
import { mapMessages } from './mapMessages';

/**
 * Width of the target area's preview, in pixels
 */
const PREVIEW_WIDTH = 600;

/**
 * Height of the target area's preview, in pixels
 */
const PREVIEW_HEIGHT = 330;

const DESTINATION_COLOR = 0x4caf50;

const RETURN_COLOR = 0xe040fb;

/**
 * The cell a link is being added to or changed on, and what it can link to
 */
export interface LinkDialogTarget
{
	/**
	 * Where the preview gets the areas it shows, with the link changes not yet saved
	 */
	source: AreaSource;

	/**
	 * The area the link is in
	 */
	area: EditorArea;

	column: number;
	row: number;

	/**
	 * The link the cell has, or undefined to add one
	 */
	link: EditorAreaLink | undefined;

	/**
	 * Every area of the universe
	 */
	areas: readonly EditorAreaSummary[];

	/**
	 * Every tile the universe can use, for drawing the preview
	 */
	tiles: readonly EditorTile[];

	/**
	 * The universe's ruleset, which names its default tiles
	 */
	ruleset: Ruleset;

	/**
	 * Keeps the changes the dialog made until the Areas tab is saved: the link, or its deletion, and any
	 * return link
	 */
	onChanged: (changes: LinkChange[]) => void;
}

/**
 * The area the preview shows
 */
interface PreviewArea
{
	area: EditorArea;
	links: EditorAreaLink[];
	map: EditorMap;
	loader: ChunkLoader;
}

/**
 * Adds, changes or deletes a cell's area link: how it is taken, whether it needs the whole group, and
 * where it goes, chosen by clicking a preview of the target area's map. It can also place a return
 * link in the target area that leads back to the cell. The changes wait on the page until the Areas
 * tab is saved
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
	private readonly targetArea = getElement('link-target', HTMLSelectElement);
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
	private preview: PreviewArea | undefined;
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
	 * Changes every time the preview switches area, so an area that arrives for an earlier choice is ignored
	 */
	private previewVersion = 0;

	constructor()
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

		this.targetArea.addEventListener('change', () =>
		{
			this.destination = undefined;
			this.returnCell = undefined;
			void this.showPreview(this.targetArea.value);
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
			this.deleteLink();
		});

		this.form.addEventListener('submit', (event) =>
		{
			event.preventDefault();
			this.save();
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
		const others = target.areas.filter((area) => (area.id !== target.area.id));

		this.target = target;
		this.destination = (link ? { column: link.targetColumn, row: link.targetRow } : undefined);
		this.returnCell = undefined;
		this.title.textContent = (link
			? t({
				id: 'editor.link.title',
				defaultMessage: 'Link at {column}, {row}',
				description: 'Title of the dialog for a cell\'s area link; {column} and {row} are the cell\'s coordinates'
			}, {
				column: target.column,
				row: target.row
			})
			: t({
				id: 'editor.link.addTitle',
				defaultMessage: 'Add a link at {column}, {row}',
				description: 'Title of the dialog for adding an area link to a cell; {column} and {row} are the cell\'s coordinates'
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
		setOptions(this.targetArea, others.map((area) => ({
			value: area.id,
			label: area.name
		})));
		this.targetArea.value = (link?.targetAreaId ?? others[0]?.id ?? '');
		showMessage(this.error, ((others.length === 0)
			? t({
				id: 'editor.link.noOtherAreas',
				defaultMessage: 'Add another area to link to first.',
				description: 'Shown in the link dialog when the universe has only the area being edited'
			})
			: undefined));
		this.updateCells();
		this.dialog.showModal();
		this.changes.markSaved();

		if (this.targetArea.value !== '')
		{
			void this.showPreview(this.targetArea.value);
		}
	}

	/**
	 * Shows an area's map in the preview, centered on the destination if it has one
	 *
	 * @param areaId The area's ID
	 */
	private async showPreview(areaId: string): Promise<void>
	{
		const target = this.target;
		const version = ++this.previewVersion;

		this.closePreview();

		if (!target)
		{
			return;
		}

		let area: EditorArea;
		let links: EditorAreaLink[];

		try
		{
			[area, links] = await Promise.all([
				target.source.getArea(areaId),
				target.source.listLinks(areaId)
			]);
		}
		catch (error)
		{
			if (version === this.previewVersion)
			{
				showMessage(this.error, describeEditorError(error, {
					id: 'editor.link.showAreaFailed',
					defaultMessage: 'Could not show that area.',
					description: 'Shown in the link dialog when the map of the area the link goes to couldn\'t be loaded'
				}));
			}

			return;
		}

		if ((version !== this.previewVersion) || !this.dialog.open)
		{
			return;
		}

		const map = new EditorMap(area.bounds);
		const loader = new ChunkLoader((range) => target.source.loadChunks(area.id, range), map, (chunkKeys) =>
		{
			this.canvas.scene?.refreshChunks(chunkKeys);
		}, (error) =>
		{
			showMessage(this.error, describeEditorError(error, mapMessages.loadFailed));
		});

		this.preview = { area, links, map, loader };

		const scene = await this.canvas.show(editorAreaPayload(area, target.tiles, target.ruleset), map.chunks, this.previewHost(loader));

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
	 * @param loader Loads the preview area's chunks
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
					defaultTileId: preview.area.defaultTileId,
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
				if (!this.preview || !isInBounds(this.preview.area.bounds, column, row))
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
	 * Keeps the link, and the return link if one was placed, until the Areas tab is saved
	 */
	private save(): void
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
				description: 'Shown when Apply is pressed before the cell the link leads to is chosen'
			}));
			return;
		}

		if (this.addReturn.checked && !this.returnCell)
		{
			showMessage(this.error, t({
				id: 'editor.link.needReturn',
				defaultMessage: 'Click the map to place the return link, or don\'t add one.',
				description: 'Shown when Apply is pressed with a return link asked for but not placed'
			}));
			return;
		}

		const mode: AreaLinkMode = (this.manual.checked ? 'manual' : 'automatic');
		const link: AreaLinkTarget = {
			targetAreaId: preview.area.id,
			targetColumn: destination.column,
			targetRow: destination.row,
			mode,
			requiresWholeGroup: this.wholeGroup.checked
		};
		const returnCell = (this.addReturn.checked ? this.returnCell : undefined);
		const changes: LinkChange[] = [
			{
				areaId: target.area.id,
				column: target.column,
				row: target.row,
				target: link
			}
		];

		if (returnCell)
		{
			changes.push({
				areaId: preview.area.id,
				column: returnCell.column,
				row: returnCell.row,
				target: {
					targetAreaId: target.area.id,
					targetColumn: target.column,
					targetRow: target.row,
					mode,
					requiresWholeGroup: this.wholeGroup.checked
				}
			});
		}

		this.finish(changes);
	}

	/**
	 * Deletes the cell's link when the Areas tab is saved, after asking
	 */
	private deleteLink(): void
	{
		const target = this.target;

		if (!target)
		{
			return;
		}

		const question = t({
			id: 'editor.link.confirmDelete',
			defaultMessage: 'Delete the link at {column}, {row}?',
			description: 'Asks before deleting an area link; {column} and {row} are its cell\'s coordinates'
		}, {
			column: target.column,
			row: target.row
		});

		if (!window.confirm(question))
		{
			return;
		}

		this.finish([
			{
				areaId: target.area.id,
				column: target.column,
				row: target.row,
				target: null
			}
		]);
	}

	/**
	 * Hands the dialog's changes to the map editor and closes it
	 *
	 * @param changes The changes
	 */
	private finish(changes: LinkChange[]): void
	{
		const target = this.target;

		this.changes.markSaved();
		this.dialog.close();
		target?.onChanged(changes);
	}

	/**
	 * Stops showing and loading the preview's area
	 */
	private closePreview(): void
	{
		this.preview?.loader.stop();
		this.preview = undefined;
		this.canvas.stop();
	}
}
