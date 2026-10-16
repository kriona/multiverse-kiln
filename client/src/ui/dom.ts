/**
 * The screens in index.html; exactly one is shown at a time
 */
export type ScreenName = 'status' | 'login' | 'home' | 'lobby' | 'group';

const screenNames: ScreenName[] = ['status', 'login', 'home', 'lobby', 'group'];

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
 * Shows a full-page message, e.g. while connecting or after the connection is lost
 *
 * @param message Text to show
 */
export function showStatus(message: string): void
{
	getElement('status-message', HTMLElement).textContent = message;
	showScreen('status');
}
