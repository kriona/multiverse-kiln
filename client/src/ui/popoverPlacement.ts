/**
 * Places an open popover under its button, its end edge lined up with the button's, or above the button
 * when there isn't room below, kept inside the window
 *
 * @param popover The popover
 * @param button Its button
 */
export function placeUnder(popover: HTMLElement, button: HTMLElement): void
{
	const margin = 8;
	const gap = 4;
	const anchor = button.getBoundingClientRect();
	const rtl = (getComputedStyle(button).direction === 'rtl');
	const width = popover.offsetWidth;
	const height = popover.offsetHeight;
	const below = (anchor.bottom + gap);
	const top = (((below + height) > (window.innerHeight - margin)) && ((anchor.top - gap - height) >= margin))
		? (anchor.top - gap - height)
		: below;
	const left = (rtl ? anchor.left : (anchor.right - width));

	popover.style.top = `${top}px`;
	popover.style.left = `${Math.min(Math.max(left, margin), (window.innerWidth - width - margin))}px`;
}
