import menuIcon from 'virtual:icon/ph:dots-three-vertical';

import { setButtonLabel } from './dom';
import { placeUnder } from './popoverPlacement';

/**
 * A command in an action menu
 */
export interface MenuAction
{
	label: string;

	/**
	 * The item's icon, as SVG markup from a virtual:icon import
	 */
	icon: string;

	/**
	 * Whether the command loses something, which the menu shows in the error color
	 */
	danger?: boolean;

	/**
	 * Runs the command, after the menu has closed and given focus back to its button
	 */
	run: () => void;
}

/**
 * Gives each menu's list an ID of its own
 */
let menuCount = 0;

/**
 * A button of three vertical dots that opens a menu of commands about one thing, such as an item on a
 * character's sheet
 *
 * The menu follows the WAI-ARIA menu button pattern, as the account menu does: Enter, Space or the down
 * arrow opens it on its first item and the up arrow on its last, the arrows, Home and End move between
 * items, and Escape closes it and goes back to the button. A click opens it without moving focus. It is a
 * popover, so it shows over a dialog's edges rather than being cut off by them, and a click anywhere else
 * closes it
 *
 * @param name What the menu is about, the button's name for screen readers and its tooltip, e.g. "Actions for Arrow"
 * @param actions The commands, in order
 * @return The button followed by its menu, in a wrapper to place where the button goes
 */
export function createActionMenu(name: string, actions: readonly MenuAction[]): HTMLElement
{
	const wrapper = document.createElement('div');
	const button = document.createElement('button');
	const list = document.createElement('div');
	const items = actions.map((action) => createItem(action, () =>
	{
		close(true);
		action.run();
	}));

	/**
	 * Whether the menu is opening from the keyboard, which puts focus on an item
	 */
	let focusOnOpen: 'first' | 'last' | undefined;

	/**
	 * Closes the menu
	 *
	 * @param returnFocus Whether to put focus back on the menu's button
	 */
	function close(returnFocus: boolean): void
	{
		if (list.matches(':popover-open'))
		{
			list.hidePopover();
		}

		if (returnFocus)
		{
			button.focus();
		}
	}

	/**
	 * Opens the menu from the keyboard, putting focus on its first or last item
	 *
	 * @param item Which item
	 */
	function openOn(item: 'first' | 'last'): void
	{
		if (list.matches(':popover-open'))
		{
			items[(item === 'first') ? 0 : (items.length - 1)]?.focus();
			return;
		}

		// Shown, placed and focused at once, so a key pressed right after reaches the item
		list.showPopover();
		placeUnder(list, button);
		list.style.visibility = '';
		items[(item === 'first') ? 0 : (items.length - 1)]?.focus();
	}

	menuCount++;
	wrapper.className = 'action-menu';
	list.id = `action-menu-${menuCount}`;
	list.className = 'action-menu-list';
	list.popover = 'auto';
	list.setAttribute('role', 'menu');
	list.setAttribute('aria-label', name);
	list.append(...items);
	button.type = 'button';
	button.className = 'action-menu-button';
	button.title = name;
	button.setAttribute('aria-label', name);
	button.setAttribute('aria-haspopup', 'menu');
	button.setAttribute('aria-expanded', 'false');
	button.setAttribute('aria-controls', list.id);
	setButtonLabel(button, menuIcon, '');

	// The button toggles the menu itself, and a click on it while open isn't taken as a click outside
	button.popoverTargetElement = list;

	button.addEventListener('keydown', (event) =>
	{
		if ((event.key === 'Enter') || (event.key === ' ') || (event.key === 'ArrowDown'))
		{
			if (event.key === 'ArrowDown')
			{
				event.preventDefault();
				openOn('first');
			}
			else
			{
				focusOnOpen = 'first';
			}
		}
		else if (event.key === 'ArrowUp')
		{
			event.preventDefault();
			openOn('last');
		}
	});

	button.addEventListener('pointerdown', () =>
	{
		focusOnOpen = undefined;
	});

	// The menu can only be measured once it shows, so it stays invisible until it is placed
	list.addEventListener('beforetoggle', (event) =>
	{
		if (event.newState === 'open')
		{
			list.style.visibility = 'hidden';
		}
	});

	list.addEventListener('toggle', (event) =>
	{
		const open = (event.newState === 'open');

		button.setAttribute('aria-expanded', String(open));

		if (!open)
		{
			focusOnOpen = undefined;
			window.removeEventListener('scroll', onScroll, true);
			return;
		}

		placeUnder(list, button);
		list.style.visibility = '';
		window.addEventListener('scroll', onScroll, true);

		if (focusOnOpen)
		{
			items[(focusOnOpen === 'first') ? 0 : (items.length - 1)]?.focus();
			focusOnOpen = undefined;
		}
	});

	list.addEventListener('keydown', (event) =>
	{
		const current = items.indexOf(document.activeElement as HTMLButtonElement);
		const last = (items.length - 1);
		let next: number | undefined;

		switch (event.key)
		{
			case 'ArrowDown':
				next = ((current >= last) ? 0 : (current + 1));
				break;

			case 'ArrowUp':
				next = ((current <= 0) ? last : (current - 1));
				break;

			case 'Home':
				next = 0;
				break;

			case 'End':
				next = last;
				break;

			case 'Escape':
				// Only the menu closes, not a dialog it is in
				event.preventDefault();
				event.stopPropagation();
				close(true);
				return;

			case 'Tab':
				close(false);
				return;

			default:
				return;
		}

		event.preventDefault();
		items[next]?.focus();
	});

	/**
	 * Closes the menu when what it is in scrolls, since it stays where it opened
	 *
	 * @param event The scroll
	 */
	function onScroll(event: Event): void
	{
		if (!list.contains(event.target as Node))
		{
			close(false);
		}
	}

	wrapper.append(button, list);

	return(wrapper);
}

/**
 * One of a menu's items
 *
 * @param action The command
 * @param choose Closes the menu and runs the command
 * @return The item
 */
function createItem(action: MenuAction, choose: () => void): HTMLButtonElement
{
	const item = document.createElement('button');

	item.type = 'button';
	item.className = (action.danger ? 'action-menu-item danger-item' : 'action-menu-item');
	item.tabIndex = -1;
	item.setAttribute('role', 'menuitem');
	setButtonLabel(item, action.icon, action.label);
	item.addEventListener('click', choose);

	// The item pointed at is the one focused, so the arrow keys go on from it
	item.addEventListener('pointermove', () =>
	{
		if (document.activeElement !== item)
		{
			item.focus({ focusVisible: false } as FocusOptions);
		}
	});

	return(item);
}
