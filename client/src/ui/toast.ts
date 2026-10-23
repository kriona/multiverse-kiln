import { announce } from './announcer';
import { getElement } from './dom';

/**
 * How long a toast shows before it goes, in milliseconds, unless the caller chooses otherwise
 */
const DEFAULT_TOAST_MS = 6000;

/**
 * Most toasts shown at once; a new one past this closes the oldest
 */
const MAX_TOASTS = 3;

/**
 * What closes each toast on the page
 */
const closers = new WeakMap<Element, () => void>();

/**
 * How a toast shows and is read out
 */
export interface ToastOptions
{
	/**
	 * What it tells of: info (the default) for news, success for something done, such as changes saved,
	 * which shows green. Its text says the same, so it isn't told by color alone
	 */
	kind?: 'info' | 'success';

	/**
	 * How long it shows, in milliseconds
	 */
	durationMs?: number;

	/**
	 * How screen readers read it out: polite waits for what they are reading, urgent interrupts it (see
	 * announce()), and false leaves it to the caller, for text read out already
	 */
	announce?: 'polite' | 'urgent' | false;
}

/**
 * Shows a short message at the top of the page for a few seconds, over whatever is there, and has
 * screen readers read it out. Its time stops while the pointer is on it, and clicking it closes it early. The toasts are hidden from screen readers,
 * which hear the text through the announcer instead, so it isn't read twice
 *
 * @param text The message, in the player's language
 * @param options How it shows and is read out
 */
export function showToast(text: string, options: ToastOptions = {}): void
{
	const container = getElement('toasts', HTMLElement);
	const toast = document.createElement('div');
	const urgency = (options.announce ?? 'polite');
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
	 * Counts down the time the toast has left
	 */
	const resume = (): void =>
	{
		startedAt = performance.now();
		timer = window.setTimeout(close, remainingMs);
	};

	toast.className = `toast ${options.kind ?? 'info'}`;
	toast.textContent = text;
	toast.addEventListener('click', close);

	// The pointer resting on a toast holds it, so it can be read to the end
	toast.addEventListener('pointerenter', () =>
	{
		window.clearTimeout(timer);
		remainingMs = Math.max(remainingMs - (performance.now() - startedAt), 0);
	});
	toast.addEventListener('pointerleave', resume);
	closers.set(toast, close);
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
		announce(text, (urgency === 'urgent'));
	}
}
