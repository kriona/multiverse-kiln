import closeIcon from 'virtual:icon/ph:check';

import { t } from '../localization';
import { announce } from './announcer';
import { getElement, setButtonLabel } from './dom';
import { setShortcut } from './shortcuts';

/**
 * How long a toast shows before it goes, in milliseconds, unless the caller chooses otherwise
 */
const DEFAULT_TOAST_MS = 6000;

/**
 * Most toasts shown at once; a new one past this closes the oldest
 */
const MAX_TOASTS = 3;

/**
 * The shortcut of the Got It button that closes a toast showing until it is closed. With several, it
 * closes the oldest first
 */
const CLOSE_KEYS = 'Alt+G';

/**
 * What closes each toast on the page when newer ones take its place
 */
const closers = new WeakMap<Element, () => void>();

/**
 * How many toasts with a Got It button have shown, which numbers their text for the button to point at
 */
let toastCount = 0;

/**
 * How a toast shows and is read out
 */
export interface ToastOptions
{
	/**
	 * What it tells of: info (the default) for news, success for something done, such as changes saved,
	 * which shows green, and warning for something to look at, such as another editor's save meeting
	 * unsaved changes, which shows in the notice colors. Its text says the same, so it isn't told by
	 * color alone
	 */
	kind?: 'info' | 'success' | 'warning';

	/**
	 * How long it shows, in milliseconds, or null to show it until the player closes it, by clicking it
	 * or with its Got It button (Alt+G)
	 */
	durationMs?: number | null;

	/**
	 * How screen readers read it out: polite waits for what they are reading, urgent interrupts it (see
	 * announce()), and false leaves it to the caller, for text read out already
	 */
	announce?: 'polite' | 'urgent' | false;

	/**
	 * Called when the player closes the toast, by clicking it or with its Got It button, and when newer
	 * toasts take the place of one that shows until it is closed, but not when it closes by itself or is
	 * closed by the function showToast() returns
	 */
	onDismiss?: () => void;
}

/**
 * Shows a short message at the top of the page for a few seconds, over whatever is there, and has
 * screen readers read it out. Its time stops while the pointer is on it, and clicking it closes it
 * early. A toast that shows until it is closed has a Got It button, so a keyboard can close it too. The
 * toasts' text is hidden from screen readers, which hear it through the announcer instead, so it isn't
 * read twice; the Got It button is described by it
 *
 * @param content The message, in the player's language: text, or text and elements such as a name shown in color (see formatToNodes())
 * @param options How it shows and is read out
 * @return Closes the toast early, such as when a newer one takes its place; nothing once it has closed
 */
export function showToast(content: string | readonly (string | Node)[], options: ToastOptions = {}): () => void
{
	const container = getElement('toasts', HTMLElement);
	const toast = document.createElement('div');
	const message = document.createElement('div');
	const urgency = (options.announce ?? 'polite');
	const lasts = (options.durationMs !== null);
	const closeButton = (lasts ? undefined : document.createElement('button'));
	let remainingMs = (options.durationMs ?? DEFAULT_TOAST_MS);
	let startedAt = 0;
	let timer: number | undefined;

	/**
	 * Fades the toast out and takes it off the page, at once when the player prefers reduced motion
	 */
	const close = (): void =>
	{
		window.clearTimeout(timer);

		if (toast.classList.contains('closing'))
		{
			return;
		}

		toast.classList.add('closing');

		// Disabled, so its shortcut passes to the next toast's button while this one fades out
		if (closeButton)
		{
			closeButton.disabled = true;
		}

		if (toast.getAnimations().length === 0)
		{
			toast.remove();
			return;
		}

		toast.addEventListener('animationend', () =>
		{
			toast.remove();
		});
	};

	/**
	 * Closes the toast in the player's place, telling the caller (see onDismiss), unless it is closing already
	 */
	const dismiss = (): void =>
	{
		if (toast.classList.contains('closing'))
		{
			return;
		}

		options.onDismiss?.();
		close();
	};

	/**
	 * Counts down the time the toast has left, unless it shows until it is closed
	 */
	const resume = (): void =>
	{
		if (lasts)
		{
			startedAt = performance.now();
			timer = window.setTimeout(close, remainingMs);
		}
	};

	toast.className = `toast ${options.kind ?? 'info'}`;
	message.className = 'toast-message';
	message.setAttribute('aria-hidden', 'true');

	if (typeof content === 'string')
	{
		message.textContent = content;
	}
	else
	{
		message.append(...content);
	}

	toast.append(message);

	// The button's click, from the mouse or the keyboard, reaches the toast's listener, which closes it
	if (closeButton)
	{
		toast.classList.add('stays');
		message.id = `toast-${++toastCount}`;
		closeButton.type = 'button';
		closeButton.className = 'secondary toast-close';
		closeButton.setAttribute('aria-describedby', message.id);
		setButtonLabel(closeButton, closeIcon, t({
			id: 'toast.close',
			defaultMessage: 'Got It',
			description: 'Button in a toast that stays at the top of the page until it is closed, such as the editor\'s warning that another editor saved changes meeting the player\'s unsaved ones: closes the toast, as clicking it does'
		}));
		setShortcut(closeButton, CLOSE_KEYS);
		toast.append(closeButton);
	}

	toast.addEventListener('click', dismiss);

	// The pointer resting on a toast holds it, so it can be read to the end
	toast.addEventListener('pointerenter', () =>
	{
		window.clearTimeout(timer);
		remainingMs = Math.max(remainingMs - (performance.now() - startedAt), 0);
	});
	toast.addEventListener('pointerleave', resume);

	// One that shows until it is closed is closed for the player, as clicking it would, so what it held
	// up, such as a save's marks on the map, doesn't outlast it. One that shows for a while has only gone
	// early, as when its time runs out
	closers.set(toast, (lasts ? close : dismiss));
	container.append(toast);

	// Toasts already fading out don't count
	const shown = [...container.querySelectorAll('.toast:not(.closing)')];

	for (const oldest of shown.slice(0, Math.max(shown.length - MAX_TOASTS, 0)))
	{
		closers.get(oldest)?.();
	}

	resume();

	if (urgency !== false)
	{
		announce((message.textContent ?? ''), (urgency === 'urgent'));
	}

	return(close);
}
