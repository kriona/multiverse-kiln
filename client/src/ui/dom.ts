/**
 * The screens in index.html; exactly one is shown at a time
 */
export type ScreenName = 'status' | 'login' | 'home' | 'editor' | 'lobby' | 'group';

const screenNames: ScreenName[] = [
	'status',
	'login',
	'home',
	'editor',
	'lobby',
	'group'
];

/**
 * Finds an element in index.html by ID
 *
 * @param id The element's ID
 * @param type The element's expected class, e.g. HTMLInputElement
 * @return The element
 */
export function getElement<T extends HTMLElement>(id: string, type: new () => T): T
{
	const element = document.getElementById(id);

	if (!(element instanceof type))
	{
		throw new Error(`index.html has no ${type.name} with the ID "${id}"`);
	}

	return(element);
}

/**
 * Shows one screen and hides the others
 *
 * @param name The screen to show
 */
export function showScreen(name: ScreenName): void
{
	for (const screen of screenNames)
	{
		getElement(`${screen}-screen`, HTMLElement).hidden = (screen !== name);
	}
}

/**
 * One choice in a select
 */
export interface SelectOption
{
	value: string;
	label: string;
}

/**
 * Replaces a select's choices
 *
 * @param select The select
 * @param options The choices, in order
 */
export function setOptions(select: HTMLSelectElement, options: readonly SelectOption[]): void
{
	select.replaceChildren(...options.map((option) => new Option(option.label, option.value)));
}

/**
 * The choices for a setting stored as words joined by underscores, as players read them
 *
 * @param values The setting's values, e.g. UNIVERSE_STAGES
 * @return A choice for each value, e.g. "in the beginning" for in_the_beginning
 */
export function settingOptions(values: readonly string[]): SelectOption[]
{
	return(values.map((value) => ({ value, label: value.replaceAll('_', ' ') })));
}

/**
 * Shows a message in an element, or hides the element when there is no message
 *
 * @param element The element
 * @param message The message, or undefined to hide it
 */
export function showMessage(element: HTMLElement, message: string | undefined): void
{
	element.textContent = (message ?? '');
	element.hidden = (message === undefined);
}

/**
 * Shows a full-page message, e.g. while connecting or after the connection is lost
 *
 * @param message Text to show
 */
export function showStatus(message: string): void
{
	getElement('status-message', HTMLElement).textContent = message;
	showScreen('status');
}
