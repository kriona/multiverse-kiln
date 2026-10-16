import { ancestorZones, canEditWorld, childZones, descendantZoneIds, DISALLOWED_TEXT_CHARACTERS, FAERIE_MORNINGS, MAX_TILES_PER_PAGE, MAX_ZONE_NAME_LENGTH, ZONE_PASSAGES_OF_TIME, zonesTabListing, type EditableUniverse, type EditorTile, type EditorZone, type EditorZoneSummary, type FaerieMorning, type ZoneListPayload, type ZonePassageOfTime, type ZoneSettings } from '@multiverse-kiln/shared';

import { describeEditorError, type EditorApi } from '../../network/editorApi';
import { getElement, setOptions, settingOptions, showMessage } from '../dom';

/**
 * The Zones tab: the universe's zones, opening the zone editor, and adding zones
 *
 * The zone editor is a view in the tab rather than a dialog, since it will hold the zone's map
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
	 */
	constructor(private readonly api: EditorApi)
	{
		this.name.maxLength = MAX_ZONE_NAME_LENGTH;
		this.addName.maxLength = MAX_ZONE_NAME_LENGTH;
		setOptions(this.time, settingOptions(ZONE_PASSAGES_OF_TIME).map((option) => ((option.value === 'inherit') ? { ...option, label: 'inherit from the parent zone' } : option)));
		setOptions(this.faerie, settingOptions(FAERIE_MORNINGS));

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
			this.name.setCustomValidity('');
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
			this.addName.setCustomValidity('');
		});

		this.addForm.addEventListener('submit', (event) =>
		{
			event.preventDefault();
			void this.addZone();
		});
	}

	/**
	 * Lists a universe's zones
	 *
	 * @param universe The universe
	 */
	open(universe: EditableUniverse): void
	{
		this.universe = universe;
		this.addButton.hidden = !canEditWorld(universe.role);
		void this.showList();
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

		this.listView.hidden = true;
		this.editorView.hidden = false;
		this.editorTitle.textContent = 'Loading...';
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
				showMessage(this.error, describeEditorError(error, 'open the zone'));
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
				showMessage(this.empty, describeEditorError(error, 'list the zones'));
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
		showMessage(this.empty, ((listing.zones.length === 0) ? 'There are no zones besides the lobby.' : undefined));
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
		const tiles: EditorTile[] = [];
		let total = 1;

		while (tiles.length < total)
		{
			const page = await this.api.listTiles(universe.id, { offset: tiles.length, limit: MAX_TILES_PER_PAGE });

			if (page.tiles.length === 0)
			{
				break;
			}

			tiles.push(...page.tiles);
			total = page.total;
		}

		this.tiles = tiles;
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
			(zone.indoors ? 'indoors' : 'outdoors'),
			((zone.id === this.zones.startingZoneId) ? 'starting zone' : undefined),
			(zone.enabled ? undefined : 'disabled')
		].filter((tag) => (tag !== undefined));

		item.style.paddingLeft = `${depth * 20}px`;
		button.type = 'button';
		button.className = 'universe-item';
		name.textContent = zone.name;
		details.className = 'universe-ruleset';
		details.textContent = tags.join(' - ');
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
		const width = zone.bounds.maxColumn - zone.bounds.minColumn + 1;
		const height = zone.bounds.maxRow - zone.bounds.minRow + 1;

		this.zone = zone;
		this.editorTitle.textContent = (isLobby ? `${zone.name} (the lobby)` : zone.name);
		this.name.value = zone.name;
		this.enabled.checked = zone.enabled;
		setOptions(this.parent, [
			{ value: '', label: 'None (a top-level zone)' },
			...this.zones.zones
				.filter((other) => !excluded.has(other.id))
				.map((other) => ({ value: other.id, label: other.name }))
		]);
		this.parent.value = (zone.parentZoneId ?? '');
		this.outdoors.checked = !zone.indoors;
		this.indoors.checked = zone.indoors;
		this.fillDefaultTiles(zone.indoors, zone.defaultTileId);
		this.time.value = zone.passageOfTime;
		this.faerie.value = (zone.faerieMorning ?? FAERIE_MORNINGS[0]);
		this.loopsEastWest.checked = zone.loopsEastWest;
		this.loopsNorthSouth.checked = zone.loopsNorthSouth;
		this.size.textContent = `The map is ${height} tall x ${width} wide.`;
		this.updateTimeFields();
		this.updateParentMessage();
		this.fields.disabled = !editable;
		this.saveButton.hidden = !editable;
		this.deleteButton.hidden = (!editable || isLobby || isStart);
		this.saved.textContent = '';
		showMessage(this.error, undefined);

		const children = childZones(this.zones.zones, zone.id);

		this.childList.replaceChildren(...children.map((child) => this.createItem(child, 0)));
		this.children.hidden = (children.length === 0);
	}

	/**
	 * Lists the tiles a zone can use by default: outdoor tiles first for an outdoor zone, indoor tiles first for an indoor one
	 *
	 * @param indoors Whether the zone is indoors
	 * @param selectedTileId The tile to select
	 */
	private fillDefaultTiles(indoors: boolean, selectedTileId: number): void
	{
		const groups = [
			{ label: (indoors ? 'Indoor tiles' : 'Outdoor tiles'), tiles: this.tiles.filter((tile) => (tile.indoors === indoors)) },
			{ label: (indoors ? 'Outdoor tiles' : 'Indoor tiles'), tiles: this.tiles.filter((tile) => (tile.indoors !== indoors)) }
		];

		this.defaultTile.replaceChildren(...groups
			.filter((group) => (group.tiles.length > 0))
			.map((group) =>
			{
				const element = document.createElement('optgroup');

				element.label = group.label;
				element.append(...group.tiles.map((tile) => new Option(tile.name, String(tile.id))));

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

		showMessage(this.parentDisabled, ((disabled.length === 0) ? undefined : `This zone is inside ${disabled.map((ancestor) => ancestor.name).join(', ')}, which ${(disabled.length === 1) ? 'is' : 'are'} disabled.`));
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
			this.name.setCustomValidity('Use letters, numbers, spaces or punctuation.');
			this.name.reportValidity();
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
				this.saved.textContent = 'Saved';
			}
		}
		catch (error)
		{
			showMessage(this.error, describeEditorError(error, 'save the zone'));
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

		if (!universe || !zone || !window.confirm(`Delete ${zone.name}, its map and every link into it? Zones inside it become top-level zones. This can't be undone.`))
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
			showMessage(this.error, describeEditorError(error, 'delete the zone'));
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
			this.addName.setCustomValidity('Use letters, numbers, spaces or punctuation.');
			this.addName.reportValidity();
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
			showMessage(this.addError, describeEditorError(error, 'add the zone'));
			this.addSubmit.disabled = false;
		}
	}
}
