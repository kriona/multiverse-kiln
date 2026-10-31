/**
 * Keyboard shortcuts: the keys that press the pages' buttons, and the list of them the player can open
 *
 * A control marks its shortcut in the page with data-shortcut, written the way aria-keyshortcuts writes
 * keys, e.g. <button data-shortcut="Alt+S">. Pressing it clicks the control (a button, checkbox or
 * radio button) or moves focus to it (anything else, such as a text field or the map). Code adds
 * shortcuts that aren't a control with addShortcut(), and describes keys it handles itself, such as
 * the movement keys, with addKeyHelp(), so the list has them
 *
 * A shortcut works while its control can be seen and used. While a dialog is open only the dialog's
 * shortcuts work, and otherwise only those outside dialogs, so screens and dialogs can reuse a key:
 * Alt+S submits whichever form is showing whose button has an S, such as Save. The keys are the same
 * in every language. Letters taken by
 * the browsers (Alt+D, Alt+E and Alt+F) aren't used
 */
import { defineMessages } from '@multiverse-kiln/shared';

import { t } from '../localization';
import { getElement, isTextEntry, underlineShortcut } from './dom';

/**
 * The name of each modifier key, as shortcuts are shown
 */
const KEY_NAMES = defineMessages({
	alt: {
		id: 'keys.alt',
		defaultMessage: 'Alt',
		description: 'Name of the Alt key, as keyboard shortcuts such as Alt+S show it'
	},
	option: {
		id: 'keys.option',
		defaultMessage: 'Option',
		description: 'Name of the Option key on a Mac keyboard (the Alt key on others), as keyboard shortcuts such as Option+S show it'
	},
	control: {
		id: 'keys.control',
		defaultMessage: 'Ctrl',
		description: 'Name of the Control key, as keyboard shortcuts such as Ctrl+Z show it'
	},
	shift: {
		id: 'keys.shift',
		defaultMessage: 'Shift',
		description: 'Name of the Shift key, as keyboard shortcuts such as Ctrl+Shift+Z show it'
	}
});

/**
 * Modifier keys as aria-keyshortcuts writes them, in the order shortcuts write them
 */
const MODIFIERS = ['Control', 'Alt', 'Shift'] as const;

/**
 * The key that opens the list of shortcuts. It works in dialogs too, unlike the footer's button
 */
const LIST_KEYS = '?';

type Modifier = (typeof MODIFIERS)[number];

/**
 * A shortcut code adds, which isn't a control in the page
 */
interface ShortcutAction
{
	/**
	 * The keys, as aria-keyshortcuts writes them, e.g. Alt+P
	 */
	keys: string;

	/**
	 * The shortcut works while this element can be seen
	 */
	scope: HTMLElement;

	/**
	 * What the shortcut does, in the player's language
	 */
	description: () => string;

	run: () => void;
}

/**
 * A line in the list of shortcuts for keys code handles itself
 */
interface KeyHelp
{
	/**
	 * The keys, in the player's language, e.g. "Arrow keys"
	 */
	keys: () => string;

	/**
	 * The line is listed while this element can be seen
	 */
	scope: HTMLElement;

	description: () => string;
}

const actions: ShortcutAction[] = [];

const keyHelp: KeyHelp[] = [];

/**
 * Whether the player is on a Mac, whose keyboards call the Alt key Option
 */
const isMac = /Mac|iPhone|iPad/.test(navigator.userAgent);

/**
 * Gives the page's controls their shortcuts, listens for them, and opens the list of shortcuts from
 * the footer's button or the ? key. Runs once the page has been translated
 */
export function startShortcuts(): void
{
	const dialog = getElement('shortcuts-dialog', HTMLDialogElement);

	for (const element of document.querySelectorAll<HTMLElement>('[data-shortcut]'))
	{
		setShortcut(element, (element.dataset.shortcut ?? ''));
	}

	// Keys the page's text mentions, shown with the player's names for the modifier keys
	for (const element of document.querySelectorAll<HTMLElement>('[data-keys]'))
	{
		element.textContent = formatKeys(element.dataset.keys ?? '');
	}

	const openButton = getElement('shortcuts-open', HTMLButtonElement);

	setShortcut(openButton, LIST_KEYS);
	openButton.addEventListener('click', () =>
	{
		openList();
	});

	getElement('shortcuts-close', HTMLButtonElement).addEventListener('click', () =>
	{
		dialog.close();
	});

	// In the capture phase, so a shortcut is taken before the game's keyboard sees its letter
	window.addEventListener('keydown', onKeyDown, true);
}

/**
 * Gives a control a shortcut: tells screen readers about it, underlines its letter in the control's
 * text (see underlineShortcut), and makes the keys use it
 *
 * @param element The control
 * @param keys The keys, as aria-keyshortcuts writes them, e.g. Alt+S
 */
export function setShortcut(element: HTMLElement, keys: string): void
{
	element.dataset.shortcut = keys;
	element.setAttribute('aria-keyshortcuts', keys);
	underlineShortcut(element);
}

/**
 * Adds a shortcut that isn't a control in the page
 *
 * @param action The keys, when they work, what they do and its description for the list
 * @return Removes the shortcut
 */
export function addShortcut(action: ShortcutAction): () => void
{
	actions.push(action);

	return(() =>
	{
		actions.splice(actions.indexOf(action), 1);
	});
}

/**
 * Lists keys that code handles itself, such as the movement keys, in the list of shortcuts
 *
 * @param help The keys, when they are listed and what they do
 * @return Takes the line out of the list
 */
export function addKeyHelp(help: KeyHelp): () => void
{
	keyHelp.push(help);

	return(() =>
	{
		keyHelp.splice(keyHelp.indexOf(help), 1);
	});
}

/**
 * Keys as the player reads them, with each modifier named in their language, e.g. Alt+S or Option+S
 *
 * @param keys The keys, as aria-keyshortcuts writes them
 * @return The keys to show
 */
export function formatKeys(keys: string): string
{
	const names: Record<Modifier, string> = {
		Control: t(KEY_NAMES.control),
		Alt: t((isMac ? KEY_NAMES.option : KEY_NAMES.alt)),
		Shift: t(KEY_NAMES.shift)
	};

	return(keys
		.split(' ')
		.map((combination) => combination
			.split('+')
			.map((part) => (isModifier(part) ? names[part] : part))
			.join('+'))
		.join(' / '));
}

/**
 * Presses the control or runs the action whose shortcut was pressed
 *
 * @param event The key press
 */
function onKeyDown(event: KeyboardEvent): void
{
	if (event.repeat || event.isComposing)
	{
		return;
	}

	if (matches(event, LIST_KEYS) && !getElement('shortcuts-dialog', HTMLDialogElement).open)
	{
		event.preventDefault();
		event.stopPropagation();
		openList();
		return;
	}

	const control = [...document.querySelectorAll<HTMLElement>('[data-shortcut]')]
		.find((element) => (matches(event, (element.dataset.shortcut ?? '')) && isAvailable(element)));
	const action = (control ? undefined : actions.find((candidate) => (matches(event, candidate.keys) && isAvailable(candidate.scope))));

	if (!control && !action)
	{
		return;
	}

	event.preventDefault();
	event.stopPropagation();

	if (action)
	{
		action.run();
	}
	else if (control)
	{
		pressControl(control);
	}
}

/**
 * Whether a key press is one of a shortcut's combinations
 *
 * @param event The key press
 * @param keys The shortcut, as aria-keyshortcuts writes it: combinations separated by spaces
 * @return True when the press matches one of them
 */
function matches(event: KeyboardEvent, keys: string): boolean
{
	const pressed = pressedKey(event);

	return(keys.split(' ').some((combination) =>
	{
		const parts = combination.split('+');
		const key = parts[parts.length - 1];
		const modifiers = parts.slice(0, -1);
		const isLetter = /^[A-Z0-9]$/.test(key);

		if ((key !== pressed) || event.metaKey || (event.ctrlKey !== modifiers.includes('Control')) || (event.altKey !== modifiers.includes('Alt')))
		{
			return(false);
		}

		// A symbol such as ? is typed with Shift on some keyboards, so Shift only counts with letters and digits
		if (isLetter && (event.shiftKey !== modifiers.includes('Shift')))
		{
			return(false);
		}

		// A shortcut without a modifier is a key that types, so it only works while nothing is being typed
		return((modifiers.length > 0) || !isTextEntry(((event.target instanceof Element) ? event.target : null)));
	}));
}

/**
 * The key pressed, as shortcuts write it: a letter or digit in capitals, or the character typed
 *
 * The letter comes from the keyboard's layout when it types one, and otherwise from the key's place
 * on the keyboard, since Option on a Mac turns letters into other characters (Option+S types ß)
 *
 * @param event The key press
 * @return The key
 */
function pressedKey(event: KeyboardEvent): string
{
	if (/^[a-z0-9]$/i.test(event.key))
	{
		return(event.key.toUpperCase());
	}

	const position = /^(?:Key|Digit)([A-Z0-9])$/.exec(event.code);

	return((position ? position[1] : event.key));
}

/**
 * Whether part of a shortcut is a modifier key
 *
 * @param part The part, e.g. Alt or S
 * @return True for Control, Alt and Shift
 */
function isModifier(part: string): part is Modifier
{
	return((MODIFIERS as readonly string[]).includes(part));
}

/**
 * Whether a shortcut's element can be used now: it can be seen, isn't disabled, and is in the dialog
 * on top, or outside every dialog while none is open
 *
 * @param element The control, or the element a shortcut works inside
 * @return True when the shortcut works
 */
function isAvailable(element: HTMLElement): boolean
{
	const dialogs = [...document.querySelectorAll<HTMLDialogElement>('dialog:modal')];
	const topDialog = (dialogs[dialogs.length - 1] ?? null);

	return((element.closest('dialog') === topDialog) && element.checkVisibility() && !element.matches(':disabled'));
}

/**
 * Does what a control's shortcut does: clicks a button, checkbox or radio button, and focuses anything else
 *
 * @param control The control
 */
function pressControl(control: HTMLElement): void
{
	const isClickable = ((control instanceof HTMLButtonElement) || ((control instanceof HTMLInputElement) && ['checkbox', 'radio'].includes(control.type)));

	if (isClickable)
	{
		control.click();
	}
	else
	{
		control.focus();
	}
}

/**
 * What a control is called, as the list of shortcuts names it: its label, without the letter added
 * for its shortcut or the fields inside the label
 *
 * @param control The control
 * @return Its name
 */
function controlName(control: HTMLElement): string
{
	const ariaLabel = control.getAttribute('aria-label');

	if (ariaLabel !== null)
	{
		return(ariaLabel);
	}

	const isField = ((control instanceof HTMLInputElement) || (control instanceof HTMLSelectElement) || (control instanceof HTMLTextAreaElement));
	const label = (isField ? control.labels?.[0] : undefined);
	const copy = (label ?? control).cloneNode(true) as HTMLElement;

	for (const extra of copy.querySelectorAll('.shortcut-added, input, select, textarea, svg'))
	{
		extra.remove();
	}

	return((copy.textContent ?? '').replace(/\s+/g, ' ').trim());
}

/**
 * Opens the list of the shortcuts that work on the screen now
 */
function openList(): void
{
	const dialog = getElement('shortcuts-dialog', HTMLDialogElement);
	const list = getElement('shortcuts-list', HTMLElement);
	const lines: Array<{ keys: string; description: string }> = [];

	for (const control of document.querySelectorAll<HTMLElement>('[data-shortcut]'))
	{
		if (isAvailable(control) && (control.id !== 'shortcuts-open'))
		{
			lines.push({ keys: formatKeys(control.dataset.shortcut ?? ''), description: controlName(control) });
		}
	}

	for (const action of actions.filter((candidate) => isAvailable(candidate.scope)))
	{
		lines.push({ keys: formatKeys(action.keys), description: action.description() });
	}

	for (const help of keyHelp.filter((candidate) => isAvailable(candidate.scope)))
	{
		lines.push({ keys: help.keys(), description: help.description() });
	}

	lines.push({
		keys: formatKeys(LIST_KEYS),
		description: t({
			id: 'shortcuts.listDescription',
			defaultMessage: 'List the keyboard shortcuts',
			description: 'In the list of keyboard shortcuts, what the ? key does'
		})
	});

	lines.push({
		keys: t({
			id: 'shortcuts.escape',
			defaultMessage: 'Esc',
			description: 'In the list of keyboard shortcuts, the name of the Escape key'
		}),
		description: t({
			id: 'shortcuts.escapeDescription',
			defaultMessage: 'Close a dialog',
			description: 'In the list of keyboard shortcuts, what the Escape key does'
		})
	});

	list.replaceChildren(...lines.flatMap((line) =>
	{
		const term = document.createElement('dt');
		const keys = document.createElement('kbd');
		const definition = document.createElement('dd');

		keys.textContent = line.keys;
		term.append(keys);
		definition.textContent = line.description;

		return([term, definition]);
	}));

	dialog.showModal();
}
