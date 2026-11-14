import { SITE_NAME, type MessageSource } from '@multiverse-kiln/shared';

import { t } from '../localization';

/**
 * The screens the pages have, each an element with the ID "<name>-screen" and the class "screen". Every
 * page has status; index.html has home, universe.html has universe and notice, game.html has notice,
 * lobby, group and invite, edit.html has editor, character.html has character, and login.html has login,
 * email, code, register and reset. Exactly one is shown at a time
 */
export type ScreenName = 'status' | 'home' | 'universe' | 'notice' | 'editor' | 'editor-two-factor' | 'lobby' | 'group' | 'invite' | 'character' | 'login' | 'email' | 'code' | 'register' | 'reset' | 'provider-register' | 'provider-link' | 'two-factor' | 'registered' | 'profile' | 'player';

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
 * A link for a page's toolbar that reads as the text around it, such as a universe's name linking to its page
 *
 * @param text The link's text
 * @param url Where it goes
 * @return The link
 */
export function titleLink(text: string, url: string): HTMLAnchorElement
{
	const link = document.createElement('a');

	link.className = 'title-link';
	link.href = url;
	link.textContent = text;

	return(link);
}

/**
 * Shows one of the page's screens and hides the others
 *
 * Focus left in a screen that is hidden is lost to keyboards and screen readers, so unless it is
 * already in the screen shown, it moves to the screen's heading (or its message, on the status
 * screen), which screen readers then read out
 *
 * @param name The screen to show
 */
export function showScreen(name: ScreenName): void
{
	const shown = getElement(`${name}-screen`, HTMLElement);

	for (const screen of document.querySelectorAll<HTMLElement>('.screen'))
	{
		screen.hidden = (screen !== shown);
	}

	const start = shown.querySelector<HTMLElement>('h1, p');

	if (start && !shown.contains(document.activeElement))
	{
		start.tabIndex = -1;
		start.focus();
	}
}

/**
 * Whether an element takes typed text
 *
 * @param element The element
 * @return True for text inputs, text areas and editable content
 */
export function isTextEntry(element: Element | null): boolean
{
	if (element instanceof HTMLInputElement)
	{
		return(!['button', 'checkbox', 'radio', 'submit', 'reset', 'range', 'color', 'file'].includes(element.type));
	}

	return((element instanceof HTMLTextAreaElement) || ((element instanceof HTMLElement) && element.isContentEditable));
}

/**
 * One choice in a select
 */
export interface SelectOption
{
	value: string;
	label: string;

	/**
	 * Whether the choice is listed but can't be chosen, its label saying why
	 */
	disabled?: boolean;
}

/**
 * Replaces a select's choices
 *
 * @param select The select
 * @param options The choices, in order
 */
export function setOptions(select: HTMLSelectElement, options: readonly SelectOption[]): void
{
	select.replaceChildren(...options.map((option) =>
	{
		const element = new Option(option.label, option.value);

		element.disabled = (option.disabled ?? false);

		return(element);
	}));
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
 * Shows an icon and text in a button, replacing what it showed, with its shortcut's letter underlined
 *
 * @param button The button
 * @param icon The icon's SVG markup, imported from virtual:icon/<name> (see vite.config.ts)
 * @param text The button's text
 */
export function setButtonLabel(button: HTMLButtonElement, icon: string, text: string): void
{
	const template = document.createElement('template');

	template.innerHTML = icon;
	button.replaceChildren(template.content, text);
	underlineShortcut(button);
}

/**
 * Shows text in a button, replacing what it showed, with its shortcut's letter underlined
 *
 * @param button The button
 * @param text The button's text
 */
export function setButtonText(button: HTMLButtonElement, text: string): void
{
	button.replaceChildren(text);
	underlineShortcut(button);
}

/**
 * Underlines the letter of a control's Alt shortcut (its data-shortcut, see shortcuts.ts) in the text
 * of the button, or of the label around the field. The letter at the start of a word is preferred, e.g.
 * the S of Save. When the text has no such letter, which can happen in a translation, "(S)" is added
 * after it with the letter underlined; screen readers skip that, since they announce the shortcut from
 * aria-keyshortcuts. Nothing changes for other shortcuts, or a control without a button or label
 *
 * @param control The control
 */
export function underlineShortcut(control: HTMLElement): void
{
	const letter = /^Alt\+([A-Z0-9])$/.exec(control.dataset.shortcut ?? '')?.[1];
	const container = ((control instanceof HTMLButtonElement) ? control : control.closest('label'));

	if ((letter === undefined) || !container)
	{
		return;
	}

	for (const added of container.querySelectorAll('.shortcut-added'))
	{
		added.remove();
	}

	for (const underlined of container.querySelectorAll('.shortcut-letter'))
	{
		underlined.replaceWith(underlined.textContent ?? '');
	}

	for (const wrapper of container.querySelectorAll('.shortcut-text'))
	{
		wrapper.replaceWith(...wrapper.childNodes);
	}

	container.normalize();

	const texts = labelTexts(container);
	const found = (findLetter(texts, new RegExp(`(?:^|[^\\p{L}\\p{N}])(${letter})`, 'iu')) ?? findLetter(texts, new RegExp(`(${letter})`, 'i')));
	const underline = document.createElement('u');

	underline.className = 'shortcut-letter';

	if (found)
	{
		// The pieces the text splits into stay in one box, so a flex label or button doesn't put its gap between them
		const wrapper = document.createElement('span');

		wrapper.className = 'shortcut-text';
		found.text.replaceWith(wrapper);
		wrapper.append(found.text);

		const rest = found.text.splitText(found.index);

		rest.splitText(1);
		underline.textContent = rest.data;
		rest.replaceWith(underline);
		return;
	}

	const added = document.createElement('span');

	underline.textContent = letter;
	added.className = 'shortcut-added';
	added.setAttribute('aria-hidden', 'true');
	added.append(' (', underline, ')');
	container.append(added);
}

/**
 * The text a button or label shows itself, leaving out the fields and icons inside it
 *
 * @param container The button or label
 * @return Its text nodes, in order
 */
function labelTexts(container: HTMLElement): Text[]
{
	const texts: Text[] = [];
	const walker = document.createTreeWalker(container, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
		acceptNode: (node) =>
		{
			if ((node instanceof Element) && node.matches('input, select, textarea, svg'))
			{
				return(NodeFilter.FILTER_REJECT);
			}

			return(((node instanceof Text) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP));
		}
	});

	for (let node = walker.nextNode(); node; node = walker.nextNode())
	{
		texts.push(node as Text);
	}

	return(texts);
}

/**
 * Where a pattern's first group first matches in some text
 *
 * @param texts The text nodes, in order
 * @param pattern The pattern; its first group is the letter
 * @return The text node and the letter's offset in it, or undefined when nothing matches
 */
function findLetter(texts: readonly Text[], pattern: RegExp): { text: Text; index: number } | undefined
{
	for (const text of texts)
	{
		const match = pattern.exec(text.data);

		if (match)
		{
			return({ text, index: match.index + match[0].length - 1 });
		}
	}

	return(undefined);
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

/**
 * The browser tab's title as setPageTitle() was last given it, without the engine's name or the count of
 * unread chat messages
 */
let pageTitle: string | undefined;

/**
 * How many chat messages the player hasn't read in each of the page's chats that has any, shown added up
 * before the title
 */
const unreadChatCounts = new Map<object, number>();

/**
 * Sets the browser tab's title, followed by the game engine's name, which messages leave out, and led
 * by the count of unread chat messages while there are any (setUnreadChatCount())
 *
 * @param title The title in the player's language, or undefined for the engine's name alone
 */
export function setPageTitle(title?: string): void
{
	pageTitle = title;
	showPageTitle();
}

/**
 * Shows how many chat messages the player hasn't read before the browser tab's title, as "(3) Edit
 * Kilnhaven", so they can be seen from other tabs. Each of the page's chats sets its own count as messages
 * arrive and are read, and the title shows them added up
 *
 * @param chat The chat whose messages these are
 * @param count How many, or 0 once they are read
 */
export function setUnreadChatCount(chat: object, count: number): void
{
	if (count === 0)
	{
		unreadChatCounts.delete(chat);
	}
	else
	{
		unreadChatCounts.set(chat, count);
	}

	showPageTitle();
}

/**
 * Puts the title, the engine's name and the count of unread chat messages in the browser tab
 */
function showPageTitle(): void
{
	const title = ((pageTitle === undefined) ? SITE_NAME : `${pageTitle} - ${SITE_NAME}`);
	const unreadChatCount = [...unreadChatCounts.values()].reduce((total, count) => (total + count), 0);

	document.title = ((unreadChatCount === 0) ? title : t({
		id: 'page.titleUnread',
		defaultMessage: '({count, number}) {title}',
		description: 'The browser tab\'s title on a page with a chat while it has messages the player hasn\'t read; {count} is how many and {title} the page\'s usual title'
	}, {
		count: unreadChatCount,
		title
	}));
}

/**
 * Scrolls to the element the address's fragment names, such as #artwork
 *
 * Pages that scroll inside an element rather than the document need this on a reload: the browser
 * restores the document's scroll position there instead of going to the fragment
 */
export function scrollToFragment(): void
{
	if (location.hash.length <= 1)
	{
		return;
	}

	document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView();
}

/**
 * Scrolls whatever scrolls an element, the page or an element around it, so the element's top is back
 * where it was in the window
 *
 * @param element The element
 * @param top Where its top was, in pixels from the window's top
 */
export function scrollBackTo(element: HTMLElement, top: number): void
{
	const change = element.getBoundingClientRect().top - top;
	let scroller = element.parentElement;

	if (change === 0)
	{
		return;
	}

	while (scroller && ((scroller.scrollHeight <= scroller.clientHeight) || !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)))
	{
		scroller = scroller.parentElement;
	}

	(scroller ?? document.scrollingElement)?.scrollBy({ top: change, behavior: 'instant' });
}

/**
 * Closes every open dialog, the latest first, as Escape would: a dialog's cancel listeners run first,
 * so one with unsaved changes asks before it closes
 *
 * @return False when a dialog stayed open, such as one whose changes the player kept
 */
export function closeOpenDialogs(): boolean
{
	const dialogs = [...document.querySelectorAll<HTMLDialogElement>('dialog[open]')].reverse();

	for (const dialog of dialogs)
	{
		if (!dialog.dispatchEvent(new Event('cancel', { cancelable: true })))
		{
			return(false);
		}

		dialog.close();
	}

	return(true);
}

/**
 * Shows a full-page message with a link to Home (partials/notice.html), e.g. when a universe can't be found
 *
 * @param message Text to show
 * @param title The browser tab's title (see setPageTitle), or undefined for the engine's name alone
 */
export function showNoticeScreen(message: string, title?: string): void
{
	getElement('notice-message', HTMLElement).textContent = message;
	setPageTitle(title);
	showScreen('notice');
}
