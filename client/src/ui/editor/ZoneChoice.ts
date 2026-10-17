import type { EditableUniverse } from '@multiverse-kiln/shared';

import type { ZoneSelectDialog } from './ZoneSelectDialog';

/**
 * The page's parts of a zone choice
 */
export interface ZoneChoiceElements
{
	/**
	 * Shows the zone's name, or what happens without one
	 */
	name: HTMLElement;

	/**
	 * Opens the dialog for choosing the zone
	 */
	choose: HTMLButtonElement;

	/**
	 * Takes the zone away, leaving it to whatever comes next; hidden while there is none
	 */
	clear: HTMLButtonElement;
}

/**
 * A zone in a form that may be left unchosen, such as a race's starting zone, with buttons that choose
 * one and take it away
 */
export class ZoneChoice
{
	private zoneId: string | null = null;
	private universe: EditableUniverse | undefined;

	/**
	 * Whether the player may change the zone; when not, its buttons are hidden
	 */
	private editable = true;

	/**
	 * Every zone's name, by ID, for the zone chosen
	 */
	private zoneNames: ReadonlyMap<string, string> = new Map();

	/**
	 * @param zoneSelect The dialog for choosing a zone
	 * @param elements The choice's parts of the page
	 * @param describeNone What happens without a zone, e.g. "Town (the universe's)", for when none is chosen
	 * @param onChange Called after the player chooses or clears the zone
	 */
	constructor(private readonly zoneSelect: ZoneSelectDialog, private readonly elements: ZoneChoiceElements, private readonly describeNone: () => string, private readonly onChange: () => void)
	{
		elements.choose.addEventListener('click', () =>
		{
			void this.choose();
		});

		elements.clear.addEventListener('click', () =>
		{
			this.zoneId = null;
			this.render();
			elements.choose.focus();
			this.onChange();
		});
	}

	/**
	 * The zone chosen
	 *
	 * @return Its ID, or null for none
	 */
	get value(): string | null
	{
		return(this.zoneId);
	}

	/**
	 * Shows a zone
	 *
	 * @param universe The universe whose zones can be chosen
	 * @param zoneId The zone, or null for none
	 * @param editable Whether the player may change it
	 */
	show(universe: EditableUniverse, zoneId: string | null, editable: boolean): void
	{
		this.universe = universe;
		this.zoneId = zoneId;
		this.editable = editable;
		this.elements.choose.hidden = !editable;
		this.render();
	}

	/**
	 * Shows the zones' names, once they have loaded
	 *
	 * @param zoneNames Every zone's name, by ID
	 */
	setZoneNames(zoneNames: ReadonlyMap<string, string>): void
	{
		this.zoneNames = zoneNames;
		this.render();
	}

	/**
	 * Lets the zone be chosen and cleared, or not
	 *
	 * @param enabled Whether it can be
	 */
	setEnabled(enabled: boolean): void
	{
		this.elements.choose.disabled = !enabled;
		this.elements.clear.disabled = !enabled;
	}

	/**
	 * Shows the zone's name, or what happens without one, and offers to clear a zone that is chosen
	 */
	render(): void
	{
		this.elements.name.textContent = ((this.zoneId === null) ? this.describeNone() : (this.zoneNames.get(this.zoneId) ?? ''));
		this.elements.clear.hidden = (!this.editable || (this.zoneId === null));
	}

	/**
	 * Lets the player choose another zone
	 */
	private async choose(): Promise<void>
	{
		if (!this.universe)
		{
			return;
		}

		const zone = await this.zoneSelect.open(this.universe, this.zoneId);

		this.elements.choose.focus();

		if (zone && (zone.id !== this.zoneId))
		{
			this.zoneId = zone.id;
			this.zoneNames = new Map([...this.zoneNames, [zone.id, zone.name]]);
			this.render();
			this.onChange();
		}
	}
}
