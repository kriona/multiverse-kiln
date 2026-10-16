import { ancestorZones, canEditWorld, childZones, defineMessages, descendantZoneIds, DISALLOWED_TEXT_CHARACTERS, FAERIE_MORNING_NAMES, FAERIE_MORNINGS, MAX_ZONE_NAME_LENGTH, PASSAGE_OF_TIME_NAMES, ZONE_PASSAGES_OF_TIME, zonesTabListing, type EditableUniverse, type EditorTile, type EditorZone, type EditorZoneSummary, type FaerieMorning, type ZoneListPayload, type ZonePassageOfTime, type ZoneSettings } from '@multiverse-kiln/shared';

import { formatList, t } from '../../localization';
import { describeEditorError, type EditorApi } from '../../network/editorApi';
import { getElement, namedOptions, setOptions, showMessage } from '../dom';
import { clearFieldErrors, reportFieldError, setFieldError } from '../fieldErrors';
import { formMessages } from '../formMessages';
import { tileName } from '../tileNames';
import { MapEditor } from './MapEditor';

/**
 * Text the zone editor shows in more than one place (see src/localization.ts)
 */
const messages = defineMessages({
	indoorTiles: {
		id: 'editor.zone.indoorTiles',
		defaultMessage: 'Indoor tiles',
		description: 'Heading of a group of choices of default tile'
	},
	outdoorTiles: {
		id: 'editor.zone.outdoorTiles',
		defaultMessage: 'Outdoor tiles',
		description: 'Heading of a group of choices of default tile'
	}
});

/**
 * The Zones tab: the universe's zones, opening the zone editor, and adding zones
 *
 * The zone editor is a view in the tab rather than a dialog, since it holds the zone's map
 */
export class ZonesTab
{
	private readonly listView = getElement('zone-list-view', HTMLElement);
	private readonly list = getElement('zone-list', HTMLUListElement);
	private readonly empty = getElement('zone-empty', HTMLElement);
	private readonly addButton = getElement('zone-add', HTMLButtonElement);
	private readonly editorView = getElement('zone-editor-view', HTMLElement);
	private readonly editorTitle = getElement('zone-editor-title', HTMLElement);
	private readonly form = getElement('zone-form', HTMLFormElement);
	private readonly fields = getElement('zone-fields', HTMLFieldSetElement);
	private readonly name = getElement('zone-name', HTMLInputElement);
	private readonly enabled = getElement('zone-enabled', HTMLInputElement);
	private readonly parentDisabled = getElement('zone-parent-disabled', HTMLElement);
	private readonly parent = getElement('zone-parent', HTMLSelectElement);
	private readonly outdoors = getElement('zone-outdoors', HTMLInputElement);
	private readonly indoors = getElement('zone-indoors', HTMLInputElement);
	private readonly defaultTile = getElement('zone-default-tile', HTMLSelectElement);
	private readonly time = getElement('zone-time', HTMLSelectElement);
	private readonly faerieField = getElement('zone-faerie-field', HTMLElement);
	private readonly faerie = getElement('zone-faerie', HTMLSelectElement);
	private readonly loopsEastWest = getElement('zone-loops-east-west', HTMLInputElement);
	private readonly loopsNorthSouth = getElement('zone-loops-north-south', HTMLInputElement);
	private readonly loopsHint = getElement('zone-loops-hint', HTMLElement);
	private readonly size = getElement('zone-size', HTMLElement);
	private readonly error = getElement('zone-error', HTMLElement);
	private readonly saved = getElement('zone-saved', HTMLElement);
	private readonly deleteButton = getElement('zone-delete', HTMLButtonElement);
	private readonly saveButton = getElement('zone-save', HTMLButtonElement);
	private readonly children = getElement('zone-children', HTMLElement);
	private readonly childList = getElement('zone-child-list', HTMLUListElement);
	private readonly addDialog = getElement('zone-add-dialog', HTMLDialogElement);
	private readonly addForm = getElement('zone-add-form', HTMLFormElement);
	private readonly addName = getElement('zone-add-name', HTMLInputElement);
	private readonly addIndoors = getElement('zone-add-indoors', HTMLInputElement);
	private readonly addError = getElement('zone-add-error', HTMLElement);
	private readonly addSubmit = getElement('zone-add-submit', HTMLButtonElement);
	private readonly mapEditor: MapEditor;

	private universe: EditableUniverse | undefined;

	/**
	 * Every zone of the universe, and which are the lobby and starting zones, as last loaded
	 */
	private zones: ZoneListPayload = { zones: [], lobbyZoneId: null, startingZoneId: null };

	/**
	 * Every tile the universe can use, for the default tile choice
	 */
	private tiles: EditorTile[] = [];

	/**
	 * The zone the editor is showing
	 */
	private zone: EditorZone | undefined;

	/**
	 * Changes every time the tab opens a universe or a zone, so data that arrives for an earlier one is ignored
	 */
	private openVersion = 0;

	/**
	 * @param api The editor's API
	 * @param onZoneChanged Called with the zone the zone editor opens, or undefined when the tab goes back to the list
	 */
	constructor(private readonly api: EditorApi, private readonly onZoneChanged: (zoneId: string | undefined) => void)
	{
		this.mapEditor = new MapEditor(api, (bounds) =>
		{
			if (this.zone)
			{
				this.zone = { ...this.zone, bounds };
				this.showSize(this.zone);
			}
		});
		this.name.maxLength = MAX_ZONE_NAME_LENGTH;
		this.addName.maxLength = MAX_ZONE_NAME_LENGTH;
		setOptions(this.time, namedOptions(ZONE_PASSAGES_OF_TIME, PASSAGE_OF_TIME_NAMES));
		setOptions(this.faerie, namedOptions(FAERIE_MORNINGS, FAERIE_MORNING_NAMES));

		this.time.addEventListener('change', () =>
		{
			this.updateTimeFields();
		});

		this.enabled.addEventListener('change', () =>
		{
			this.saved.textContent = '';
		});

		for (const choice of [this.outdoors, this.indoors])
		{
			choice.addEventListener('change', () =>
			{
				this.fillDefaultTiles(this.indoors.checked, Number(this.defaultTile.value));
				this.saved.textContent = '';
			});
		}

		this.name.addEventListener('input', () =>
		{
			setFieldError(this.name, undefined);
			this.saved.textContent = '';
		});

		this.form.addEventListener('submit', (event) =>
		{
			event.preventDefault();
			void this.save();
		});

		this.deleteButton.addEventListener('click', () =>
		{
			void this.deleteZone();
		});

		getElement('zone-back', HTMLButtonElement).addEventListener('click', () =>
		{
			void this.showList();
		});

		this.addButton.addEventListener('click', () =>
		{
			this.addForm.reset();
			showMessage(this.addError, undefined);
			clearFieldErrors(this.addForm);
			this.addSubmit.disabled = false;
			this.addDialog.showModal();
			this.addName.focus();
		});

		getElement('zone-add-cancel', HTMLButtonElement).addEventListener('click', () =>
		{
			this.addDialog.close();
		});

		this.addName.addEventListener('input', () =>
		{
			setFieldError(this.addName, undefined);
		});

		this.addForm.addEventListener('submit', (event) =>
		{
			event.preventDefault();
			void this.addZone();
		});
	}

	/**
	 * Lists a universe's zones, or opens one of them
	 *
	 * @param universe The universe
	 * @param zoneId The zone to open, or undefined for the list
	 */
	open(universe: EditableUniverse, zoneId?: string): void
	{
		this.universe = universe;
		this.addButton.hidden = !canEditWorld(universe.role);

		if (zoneId === undefined)
		{
			void this.showList();
		}
		else
		{
			void this.openZone(zoneId);
		}
	}

	/**
	 * Keeps up with changes to the universe made on other tabs
	 *
	 * @param universe The universe as it now is
	 */
	setUniverse(universe: EditableUniverse): void
	{
		if (this.universe?.id === universe.id)
		{
			this.universe = universe;
		}
	}

	/**
	 * Opens a zone in the zone editor
	 *
	 * @param zoneId The zone's ID
	 */
	async openZone(zoneId: string): Promise<void>
	{
		const universe = this.universe;
		const version = ++this.openVersion;

		if (!universe)
		{
			return;
		}

		this.onZoneChanged(zoneId);
		this.listView.hidden = true;
		this.editorView.hidden = false;
		this.editorTitle.textContent = t({
			id: 'editor.zone.loading',
			defaultMessage: 'Loading...',
			description: 'Heading of the zone editor while the zone loads'
		});
		this.fields.disabled = true;
		showMessage(this.error, undefined);

		let zone: EditorZone;

		try
		{
			[zone] = await Promise.all([
				this.api.getZone(universe.id, zoneId),
				this.loadZones(universe),
				this.loadTiles(universe)
			]);
		}
		catch (error)
		{
			if (version === this.openVersion)
			{
				this.editorTitle.textContent = '';
				showMessage(this.error, describeEditorError(error, {
					id: 'editor.zone.openFailed',
					defaultMessage: 'Could not open the zone.',
					description: 'Shown in the zone editor when the zone couldn\'t be loaded'
				}));
			}

			return;
		}

		if (version === this.openVersion)
		{
			this.showZone(universe, zone);
		}
	}

	/**
	 * Shows the list of zones, loading them afresh
	 */
	private async showList(): Promise<void>
	{
		const universe = this.universe;
		const version = ++this.openVersion;

		this.zone = undefined;
		this.onZoneChanged(undefined);
		this.mapEditor.hide();
		this.listView.hidden = false;
		this.editorView.hidden = true;

		if (!universe)
		{
			return;
		}

		try
		{
			await this.loadZones(universe);
		}
		catch (error)
		{
			if (version === this.openVersion)
			{
				this.list.replaceChildren();
				showMessage(this.empty, describeEditorError(error, {
					id: 'editor.zones.listFailed',
					defaultMessage: 'Could not list the zones.',
					description: 'Shown on the Zones tab when the zones couldn\'t be loaded'
				}));
			}

			return;
		}

		if (version !== this.openVersion)
		{
			return;
		}

		const listing = zonesTabListing(this.zones.zones, this.zones.lobbyZoneId);

		// A zone the listing passed through is shown above the zones inside it, indented by how deep each is
		this.list.replaceChildren(
			...listing.path.map((zone, depth) => this.createItem(zone, depth)),
			...listing.zones.map((zone) => this.createItem(zone, listing.path.length))
		);
		showMessage(this.empty, ((listing.zones.length === 0)
			? t({
				id: 'editor.zones.none',
				defaultMessage: 'There are no zones besides the lobby.',
				description: 'Shown instead of the list of zones when the universe only has its lobby'
			})
			: undefined));
	}

	/**
	 * Loads every zone of the universe
	 *
	 * @param universe The universe
	 */
	private async loadZones(universe: EditableUniverse): Promise<void>
	{
		this.zones = await this.api.listZones(universe.id);
	}

	/**
	 * Loads every tile the universe can use, a page at a time
	 *
	 * @param universe The universe
	 */
	private async loadTiles(universe: EditableUniverse): Promise<void>
	{
		this.tiles = await this.api.listAllTiles(universe.id);
	}

	/**
	 * A zone's entry in a list, opening it in the zone editor
	 *
	 * @param zone The zone
	 * @param depth How far to indent it
	 * @return The list item
	 */
	private createItem(zone: EditorZoneSummary, depth: number): HTMLLIElement
	{
		const item = document.createElement('li');
		const button = document.createElement('button');
		const name = document.createElement('strong');
		const details = document.createElement('span');
		const tags = [
			(zone.indoors
				? t({
					id: 'editor.zones.indoorsTag',
					defaultMessage: 'indoors',
					description: 'Under a zone in the list of zones, for a zone that is indoors'
				})
				: t({
					id: 'editor.zones.outdoorsTag',
					defaultMessage: 'outdoors',
					description: 'Under a zone in the list of zones, for a zone that is outdoors'
				})),
			((zone.id === this.zones.startingZoneId)
				? t({
					id: 'editor.zones.startingZoneTag',
					defaultMessage: 'starting zone',
					description: 'Under a zone in the list of zones, for the zone new characters start in'
				})
				: undefined),
			(zone.enabled
				? undefined
				: t({
					id: 'editor.zones.disabledTag',
					defaultMessage: 'disabled',
					description: 'Under a zone in the list of zones, for a zone players can\'t go into'
				}))
		].filter((tag) => (tag !== undefined));

		item.style.paddingLeft = `${depth * 20}px`;
		button.type = 'button';
		button.className = 'universe-item';
		name.textContent = zone.name;
		details.className = 'universe-ruleset';
		details.textContent = formatList(tags);
		button.append(name, details);
		button.addEventListener('click', () =>
		{
			void this.openZone(zone.id);
		});

		item.append(button);

		return(item);
	}

	/**
	 * Fills the zone editor with a zone's settings
	 *
	 * @param universe The zone's universe
	 * @param zone The zone
	 */
	private showZone(universe: EditableUniverse, zone: EditorZone): void
	{
		const editable = canEditWorld(universe.role);
		const excluded = descendantZoneIds(this.zones.zones, zone.id).add(zone.id);
		const isLobby = (zone.id === this.zones.lobbyZoneId);
		const isStart = (zone.id === this.zones.startingZoneId);

		this.zone = zone;
		this.editorTitle.textContent = (isLobby
			? t({
				id: 'editor.zone.lobbyTitle',
				defaultMessage: '{zone} (the lobby)',
				description: 'Heading of the zone editor for the universe\'s lobby; {zone} is its name'
			}, { zone: zone.name })
			: zone.name);
		this.name.value = zone.name;
		this.enabled.checked = zone.enabled;
		setOptions(this.parent, [
			{
				value: '',
				label: t({
					id: 'editor.zone.noParent',
					defaultMessage: 'None (a top-level zone)',
					description: 'Choice of parent zone for a zone that isn\'t inside another'
				})
			},
			...this.zones.zones
				.filter((other) => !excluded.has(other.id))
				.map((other) => ({
					value: other.id,
					label: other.name
				}))
		]);
		this.parent.value = (zone.parentZoneId ?? '');
		this.outdoors.checked = !zone.indoors;
		this.indoors.checked = zone.indoors;
		this.fillDefaultTiles(zone.indoors, zone.defaultTileId);
		this.time.value = zone.passageOfTime;
		this.faerie.value = (zone.faerieMorning ?? FAERIE_MORNINGS[0]);
		this.loopsEastWest.checked = zone.loopsEastWest;
		this.loopsNorthSouth.checked = zone.loopsNorthSouth;
		this.showSize(zone);
		this.updateTimeFields();
		this.updateParentMessage();
		this.fields.disabled = !editable;
		this.saveButton.hidden = !editable;
		this.deleteButton.hidden = (!editable || isLobby || isStart);
		this.saved.textContent = '';
		showMessage(this.error, undefined);
		clearFieldErrors(this.form);

		const children = childZones(this.zones.zones, zone.id);

		this.childList.replaceChildren(...children.map((child) => this.createItem(child, 0)));
		this.children.hidden = (children.length === 0);
		void this.mapEditor.show(universe, zone, this.tiles, this.zones.zones);
	}

	/**
	 * Shows how large a zone's map is
	 *
	 * @param zone The zone
	 */
	private showSize(zone: EditorZone): void
	{
		const width = (zone.bounds.maxColumn - zone.bounds.minColumn) + 1;
		const height = (zone.bounds.maxRow - zone.bounds.minRow) + 1;

		this.size.textContent = t({
			id: 'editor.zone.size',
			defaultMessage: 'The map is {height, number} tall x {width, number} wide.',
			description: 'The size of the zone\'s map, in cells'
		}, {
			height,
			width
		});
	}

	/**
	 * Lists the tiles a zone can use by default: outdoor tiles first for an outdoor zone, indoor tiles first for an indoor one
	 *
	 * @param indoors Whether the zone is indoors
	 * @param selectedTileId The tile to select
	 */
	private fillDefaultTiles(indoors: boolean, selectedTileId: number): void
	{
		const ruleset = this.universe?.ruleset;
		const groups = [
			{
				label: t(indoors ? messages.indoorTiles : messages.outdoorTiles),
				tiles: this.tiles.filter((tile) => (tile.indoors === indoors))
			},
			{
				label: t(indoors ? messages.outdoorTiles : messages.indoorTiles),
				tiles: this.tiles.filter((tile) => (tile.indoors !== indoors))
			}
		];

		this.defaultTile.replaceChildren(...groups
			.filter((group) => (group.tiles.length > 0))
			.map((group) =>
			{
				const element = document.createElement('optgroup');

				element.label = group.label;
				element.append(...group.tiles.map((tile) => new Option(((ruleset === undefined) ? (tile.name ?? '') : tileName(tile, ruleset)), String(tile.id))));

				return(element);
			}));
		this.defaultTile.value = String(selectedTileId);
	}

	/**
	 * Shows "where is morning?" for faerie time, which also can't loop
	 */
	private updateTimeFields(): void
	{
		const faerie = (this.time.value === 'faerie');

		this.faerieField.hidden = !faerie;
		this.loopsHint.hidden = !faerie;
		this.loopsEastWest.disabled = faerie;
		this.loopsNorthSouth.disabled = faerie;

		if (faerie)
		{
			this.loopsEastWest.checked = false;
			this.loopsNorthSouth.checked = false;
		}

		this.saved.textContent = '';
	}

	/**
	 * Warns when a zone this one is inside is disabled
	 */
	private updateParentMessage(): void
	{
		const zone = this.zone;
		const disabled = ((zone === undefined) ? [] : ancestorZones(this.zones.zones, zone.id).filter((ancestor) => !ancestor.enabled));

		showMessage(this.parentDisabled, ((disabled.length === 0)
			? undefined
			: t({
				id: 'editor.zone.parentDisabled',
				defaultMessage: 'This zone is inside {zones}, which {count, plural, one {is} other {are}} disabled.',
				description: 'Warns that players can\'t reach the zone; {zones} lists the zones it is inside that are disabled, and {count} is how many'
			}, {
				zones: formatList(disabled.map((ancestor) => ancestor.name), 'conjunction'),
				count: disabled.length
			})));
	}

	/**
	 * Saves the zone's settings as the form shows them
	 */
	private async save(): Promise<void>
	{
		const universe = this.universe;
		const zone = this.zone;
		const name = this.name.value.trim();

		if (!universe || !zone)
		{
			return;
		}

		if ((name === '') || DISALLOWED_TEXT_CHARACTERS.test(name))
		{
			reportFieldError(this.name, t(formMessages.invalidText));
			return;
		}

		const passageOfTime = this.time.value as ZonePassageOfTime;
		const settings: ZoneSettings = {
			name,
			parentZoneId: ((this.parent.value === '') ? null : this.parent.value),
			enabled: this.enabled.checked,
			indoors: this.indoors.checked,
			defaultTileId: Number(this.defaultTile.value),
			passageOfTime,
			faerieMorning: ((passageOfTime === 'faerie') ? this.faerie.value as FaerieMorning : null),
			loopsEastWest: this.loopsEastWest.checked,
			loopsNorthSouth: this.loopsNorthSouth.checked
		};

		this.saveButton.disabled = true;
		showMessage(this.error, undefined);

		try
		{
			await this.api.updateZone(universe.id, zone.id, settings);
			await this.loadZones(universe);

			if (this.zone === zone)
			{
				this.showZone(universe, { ...zone, ...settings });
				this.saved.textContent = t(formMessages.saved);
			}
		}
		catch (error)
		{
			showMessage(this.error, describeEditorError(error, {
				id: 'editor.zone.saveFailed',
				defaultMessage: 'Could not save the zone.',
				description: 'Shown in the zone editor when the zone\'s settings couldn\'t be stored'
			}));
		}
		finally
		{
			this.saveButton.disabled = false;
		}
	}

	/**
	 * Deletes the zone after asking, and goes back to the list
	 */
	private async deleteZone(): Promise<void>
	{
		const universe = this.universe;
		const zone = this.zone;

		if (!universe || !zone)
		{
			return;
		}

		const question = t({
			id: 'editor.zone.confirmDelete',
			defaultMessage: 'Delete {zone}, its map and every link into it? Zones inside it become top-level zones. This can\'t be undone.',
			description: 'Asks before deleting a zone; {zone} is its name'
		}, { zone: zone.name });

		if (!window.confirm(question))
		{
			return;
		}

		this.deleteButton.disabled = true;

		try
		{
			await this.api.deleteZone(universe.id, zone.id);
			await this.showList();
		}
		catch (error)
		{
			showMessage(this.error, describeEditorError(error, {
				id: 'editor.zone.deleteFailed',
				defaultMessage: 'Could not delete the zone.',
				description: 'Shown in the zone editor when the zone couldn\'t be deleted'
			}));
		}
		finally
		{
			this.deleteButton.disabled = false;
		}
	}

	/**
	 * Adds the zone the Add Zone dialog describes, and opens it in the zone editor
	 */
	private async addZone(): Promise<void>
	{
		const universe = this.universe;
		const name = this.addName.value.trim();

		if (!universe)
		{
			return;
		}

		if ((name === '') || DISALLOWED_TEXT_CHARACTERS.test(name))
		{
			reportFieldError(this.addName, t(formMessages.invalidText));
			return;
		}

		this.addSubmit.disabled = true;

		try
		{
			const zoneId = await this.api.createZone(universe.id, { name, indoors: this.addIndoors.checked });

			this.addDialog.close();
			await this.openZone(zoneId);
		}
		catch (error)
		{
			showMessage(this.addError, describeEditorError(error, {
				id: 'editor.zoneAdd.failed',
				defaultMessage: 'Could not add the zone.',
				description: 'Shown in the Add Zone dialog when the zone couldn\'t be made'
			}));
			this.addSubmit.disabled = false;
		}
	}
}
