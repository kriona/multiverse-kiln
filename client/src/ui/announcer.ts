import { getElement } from './dom';

/**
 * How long a live region stays empty before new text goes in, so screen readers notice the change
 * even when the text is the same as last time
 */
const ANNOUNCE_DELAY_MS = 50;

/**
 * The text waiting to go into each live region
 */
const pending = new Map<HTMLElement, number>();

/**
 * Has screen readers read out a short update, through one of the live regions in
 * partials/accessibility.html. Text announced before the last has been read replaces it
 *
 * @param text What to read out, in the player's language
 * @param urgent Whether to interrupt what the screen reader is reading, for something the player must hear now
 */
export function announce(text: string, urgent = false): void
{
	const region = getElement((urgent ? 'announcer-urgent' : 'announcer'), HTMLElement);

	window.clearTimeout(pending.get(region));
	region.textContent = '';
	pending.set(region, window.setTimeout(() =>
	{
		region.textContent = text;
	}, ANNOUNCE_DELAY_MS));
}
