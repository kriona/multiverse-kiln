import type { EditableUniverse } from '@multiverse-kiln/shared';

import type { AreaSelectDialog } from './AreaSelectDialog';

/**
 * The page's parts of an area choice
 */
export interface AreaChoiceElements
{
	/**
	 * Shows the area's name, or what happens without one
	 */
	name: HTMLElement;

	/**
	 * Opens the dialog for choosing the area
	 */
	choose: HTMLButtonElement;

	/**
	 * Takes the area away, leaving it to whatever comes next; hidden while there is none
	 */
	clear: HTMLButtonElement;
}

/**
 * An area in a form that may be left unchosen, such as a race's starting area, with buttons that choose
 * one and take it away
 */
export class AreaChoice
{
	private areaId: string | null = null;
	private universe: EditableUniverse | undefined;

	/**
	 * Whether the player may change the area; when not, its buttons are hidden
	 */
	private editable = true;

	/**
	 * Every area's name, by ID, for the area chosen
	 */
	private areaNames: ReadonlyMap<string, string> = new Map();

	/**
	 * @param areaSelect The dialog for choosing an area
	 * @param elements The choice's parts of the page
	 * @param describeNone What happens without an area, e.g. "Town (the universe's)", for when none is chosen
	 * @param onChange Called after the player chooses or clears the area
	 */
	constructor(private readonly areaSelect: AreaSelectDialog, private readonly elements: AreaChoiceElements, private readonly describeNone: () => string, private readonly onChange: () => void)
	{
		elements.choose.addEventListener('click', () =>
		{
			void this.choose();
		});

		elements.clear.addEventListener('click', () =>
		{
			this.areaId = null;
			this.render();
			elements.choose.focus();
			this.onChange();
		});
	}

	/**
	 * The area chosen
	 *
	 * @return Its ID, or null for none
	 */
	get value(): string | null
	{
		return(this.areaId);
	}

	/**
	 * Shows an area
	 *
	 * @param universe The universe whose areas can be chosen
	 * @param areaId The area, or null for none
	 * @param editable Whether the player may change it
	 */
	show(universe: EditableUniverse, areaId: string | null, editable: boolean): void
	{
		this.universe = universe;
		this.areaId = areaId;
		this.editable = editable;
		this.elements.choose.hidden = !editable;
		this.render();
	}

	/**
	 * Shows the areas' names, once they have loaded
	 *
	 * @param areaNames Every area's name, by ID
	 */
	setAreaNames(areaNames: ReadonlyMap<string, string>): void
	{
		this.areaNames = areaNames;
		this.render();
	}

	/**
	 * Lets the area be chosen and cleared, or not
	 *
	 * @param enabled Whether it can be
	 */
	setEnabled(enabled: boolean): void
	{
		this.elements.choose.disabled = !enabled;
		this.elements.clear.disabled = !enabled;
	}

	/**
	 * Shows the area's name, or what happens without one, and offers to clear an area that is chosen
	 */
	render(): void
	{
		this.elements.name.textContent = ((this.areaId === null) ? this.describeNone() : (this.areaNames.get(this.areaId) ?? ''));
		this.elements.clear.hidden = (!this.editable || (this.areaId === null));
	}

	/**
	 * Lets the player choose another area
	 */
	private async choose(): Promise<void>
	{
		if (!this.universe)
		{
			return;
		}

		const area = await this.areaSelect.open(this.universe, this.areaId);

		this.elements.choose.focus();

		if (area && (area.id !== this.areaId))
		{
			this.areaId = area.id;
			this.areaNames = new Map([...this.areaNames, [area.id, area.name]]);
			this.render();
			this.onChange();
		}
	}
}
