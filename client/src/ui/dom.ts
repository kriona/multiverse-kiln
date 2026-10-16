import type { MessageSource } from '@multiverse-kiln/shared';

import { t } from '../localization';

/**
 * The screens the pages have, each an element with the ID "<name>-screen" and the class "screen". Every
 * page has status and login; index.html has home, lobby and group, and edit.html has editor. Exactly one
 * is shown at a time
 */
export type ScreenName = 'status' | 'login' | 'home' | 'editor' | 'lobby' | 'group';

/**
 * Finds an element in the page by ID
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
		throw new Error(`The page has no ${type.name} with the ID "${id}"`);
	}

	return(element);
}

/**
 * Shows one of the page's screens and hides the others
 *
 * @param name The screen to show
 */
export function showScreen(name: ScreenName): void
{
	getElement(`${name}-screen`, HTMLElement);

	for (const screen of document.querySelectorAll<HTMLElement>('.screen'))
	{
		screen.hidden = (screen.id !== `${name}-screen`);
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
 * The choices for a setting, each labeled with its name in the player's language
 *
 * @param values The setting's values, e.g. UNIVERSE_STAGES
 * @param names Each value's name, e.g. UNIVERSE_STAGE_NAMES
 * @return A choice for each value
 */
export function namedOptions<V extends string>(values: readonly V[], names: Record<V, MessageSource>): SelectOption[]
{
	return(values.map((value) => ({ value, label: t(names[value]) })));
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
