import { t } from '../localization';
import { AuthApi } from '../network/authApi';
import { createClient } from '../network/serverConnection';
import { showToast } from './toast';

/**
 * Shows the logged-in player's name at the end of each of the page's toolbars (partials/account.html),
 * as a button that opens a menu: Edit profile, and Log out. The menus stay hidden while the browser
 * isn't logged in, or when the server can't be reached
 *
 * The name the server last gave is remembered in the browser, and public/remembered-account.js draws the
 * menus with it before the page's scripts run, so nothing in the toolbars moves once the server answers.
 * This takes over from it, and the server's answer then corrects the name, or hides the menus when the
 * browser is no longer logged in
 *
 * The menu follows the WAI-ARIA menu button pattern: Enter, Space or the down arrow opens it on its first
 * item and the up arrow on its last, the arrows, Home and End move between items, and Escape closes it
 * and goes back to the button
 */
export async function startAccountMenu(): Promise<void>
{
	const api = new AuthApi(createClient());

	menus = [...document.querySelectorAll<HTMLElement>('.account-menu')].map((menu, index) => new AccountMenu(menu, index, api));

	for (const menu of menus)
	{
		menu.showName(readRememberedName());
	}

	// The menus show the name themselves now, so the head script's stand-in stops
	document.documentElement.removeAttribute('data-account-name');
	document.documentElement.style.removeProperty('--account-name');

	// A name changed in another tab, such as on the profile there, shows here too. A name forgotten there
	// (logging in or out) is left to the session, which tells this window itself
	window.addEventListener('storage', (event) =>
	{
		if ((event.key === NAME_STORAGE_KEY) && (event.newValue !== null))
		{
			for (const menu of menus)
			{
				menu.showName(event.newValue);
			}
		}
	});

	let name: string | null;

	try
	{
		name = ((await api.getSession())?.name ?? null);
	}
	catch (error)
	{
		console.error('Could not find who is logged in:', error);
		return;
	}

	rememberName(name);

	for (const menu of menus)
	{
		menu.showName(name);
	}
}

/**
 * The page's account menus, once startAccountMenu() has run
 */
let menus: AccountMenu[] = [];

/**
 * Shows the player's new name in the page's account menus, and remembers it for the next page, such as
 * once they change it on their profile
 *
 * @param name The name
 */
export function showAccountName(name: string): void
{
	rememberName(name);

	for (const menu of menus)
	{
		menu.showName(name);
	}
}

/**
 * Where the browser keeps the logged-in player's name between pages, which public/remembered-account.js
 * reads too
 */
const NAME_STORAGE_KEY = 'kiln-account-name';

/**
 * The name the server last gave for the logged-in player
 *
 * @return The name, or null when there is none, or the browser won't keep it
 */
function readRememberedName(): string | null
{
	try
	{
		return(localStorage.getItem(NAME_STORAGE_KEY));
	}
	catch
	{
		return(null);
	}
}

/**
 * Forgets the remembered name, as logging in does, so the next page doesn't show another player's
 * while it waits for the server
 */
export function forgetAccountName(): void
{
	rememberName(null);
}

/**
 * Keeps the logged-in player's name for the next page, or forgets it
 *
 * @param name The name, or null when the browser isn't logged in
 */
function rememberName(name: string | null): void
{
	try
	{
		if (name === null)
		{
			localStorage.removeItem(NAME_STORAGE_KEY);
		}
		else
		{
			localStorage.setItem(NAME_STORAGE_KEY, name);
		}
	}
	catch
	{
		// Without storage, the menus show once the server answers
	}
}

/**
 * One toolbar's account menu
 */
class AccountMenu
{
	private readonly button: HTMLButtonElement;
	private readonly list: HTMLElement;
	private readonly items: HTMLElement[];

	private readonly name: HTMLElement;

	/**
	 * Makes the menu work, still hidden until it has a name to show (showName())
	 *
	 * @param menu The menu (partials/account.html)
	 * @param index Which of the page's menus it is, to give its list an ID of its own
	 * @param api The auth routes, which log out
	 */
	constructor(private readonly menu: HTMLElement, index: number, private readonly api: AuthApi)
	{
		this.button = requireChild(menu, '.account-menu-button', HTMLButtonElement);
		this.list = requireChild(menu, '.account-menu-list', HTMLElement);
		this.name = requireChild(menu, '.account-menu-name', HTMLElement);
		this.items = [...this.list.querySelectorAll<HTMLElement>('[role="menuitem"]')];
		this.list.id = `account-menu-${index}`;
		this.button.setAttribute('aria-controls', this.list.id);

		this.button.addEventListener('click', () =>
		{
			if (this.list.hidden)
			{
				this.open(0);
			}
			else
			{
				this.close(false);
			}
		});

		this.button.addEventListener('keydown', (event) =>
		{
			if ((event.key === 'ArrowDown') || (event.key === 'ArrowUp'))
			{
				event.preventDefault();
				this.open((event.key === 'ArrowDown') ? 0 : (this.items.length - 1));
			}
		});

		this.list.addEventListener('keydown', (event) =>
		{
			this.onListKey(event);
		});

		// Clicking or moving focus anywhere else closes the menu
		document.addEventListener('pointerdown', (event) =>
		{
			if (!this.list.hidden && !menu.contains(event.target as Node))
			{
				this.close(false);
			}
		});

		menu.addEventListener('focusout', (event) =>
		{
			if (!this.list.hidden && !menu.contains(event.relatedTarget as Node | null))
			{
				this.close(false);
			}
		});

		requireChild(menu, '.account-menu-log-out', HTMLButtonElement).addEventListener('click', (event) =>
		{
			void this.logOut(event.currentTarget as HTMLButtonElement);
		});
	}

	/**
	 * Shows the player's name on the menu's button, or hides the menu
	 *
	 * @param name The player's name, or null when the browser isn't logged in
	 */
	showName(name: string | null): void
	{
		if (name === null)
		{
			this.close(false);
			this.menu.hidden = true;
			return;
		}

		const label = t({
			id: 'account.menu',
			defaultMessage: 'Your account: {name}',
			description: 'Name for screen readers, and tooltip, of the player\'s name at the end of every page\'s toolbar, which opens a menu with Edit profile and Log out; {name} is their name'
		}, {
			name
		});

		this.name.textContent = name;
		this.button.setAttribute('aria-label', label);
		this.button.title = label;
		this.menu.hidden = false;
	}

	/**
	 * Opens the menu, putting focus on one of its items
	 *
	 * @param itemIndex The item
	 */
	private open(itemIndex: number): void
	{
		this.list.hidden = false;
		this.button.setAttribute('aria-expanded', 'true');
		this.items[itemIndex]?.focus();
	}

	/**
	 * Closes the menu
	 *
	 * @param returnFocus Whether to put focus back on the menu's button
	 */
	private close(returnFocus: boolean): void
	{
		this.list.hidden = true;
		this.button.setAttribute('aria-expanded', 'false');

		if (returnFocus)
		{
			this.button.focus();
		}
	}

	/**
	 * Moves between the menu's items, or closes it
	 *
	 * @param event The key pressed in the menu
	 */
	private onListKey(event: KeyboardEvent): void
	{
		const current = this.items.indexOf(document.activeElement as HTMLElement);
		const last = (this.items.length - 1);
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
				event.preventDefault();
				event.stopPropagation();
				this.close(true);
				return;

			case 'Tab':
				this.close(false);
				return;

			default:
				return;
		}

		event.preventDefault();
		this.items[next]?.focus();
	}

	/**
	 * Logs the browser out, then loads the page again: pages that need a login go to the login page
	 *
	 * @param item The Log out item
	 */
	private async logOut(item: HTMLButtonElement): Promise<void>
	{
		item.disabled = true;

		try
		{
			await this.api.logOut();
		}
		catch (error)
		{
			console.error('Could not log out:', error);
			item.disabled = false;
			this.close(true);
			showToast(t({
				id: 'account.logOutFailed',
				defaultMessage: 'Could not log out. Try again in a moment.',
				description: 'Shown when Log out, in the menu that opens from the player\'s name in the toolbar, didn\'t work'
			}));
			return;
		}

		rememberName(null);
		window.location.reload();
	}
}

/**
 * Finds an element inside another by a selector
 *
 * @param parent Where to look
 * @param selector The element's selector
 * @param type The element's expected class
 * @return The element
 */
function requireChild<T extends HTMLElement>(parent: HTMLElement, selector: string, type: new () => T): T
{
	const element = parent.querySelector(selector);

	if (!(element instanceof type))
	{
		throw new Error(`The account menu has no ${selector}`);
	}

	return(element);
}
