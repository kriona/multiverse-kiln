import { placeUnder } from './popoverPlacement';

/**
 * Sets up a toggletip: an info button (popovertarget in the page's HTML) whose short explanation shows in
 * a popover under it. The popover is placed each time it opens and closes when what it is in scrolls,
 * since it stays where it opened. Escape or a click anywhere else closes it, as for any popover. The
 * button's aria-expanded says whether it is open
 *
 * @param button The info button
 * @param tip The explanation, a popover="auto" element
 */
export function setUpInfoTip(button: HTMLElement, tip: HTMLElement): void
{
	/**
	 * Closes the tip when something other than the tip scrolls
	 *
	 * @param event The scroll
	 */
	const onScroll = (event: Event): void =>
	{
		if (!tip.contains(event.target as Node) && tip.matches(':popover-open'))
		{
			tip.hidePopover();
		}
	};

	// The tip can only be measured once it shows, so it stays invisible until it is placed
	tip.addEventListener('beforetoggle', (event) =>
	{
		if (event.newState === 'open')
		{
			tip.style.visibility = 'hidden';
		}
	});

	button.setAttribute('aria-expanded', 'false');

	tip.addEventListener('toggle', (event) =>
	{
		button.setAttribute('aria-expanded', String(event.newState === 'open'));

		if (event.newState !== 'open')
		{
			window.removeEventListener('scroll', onScroll, true);
			return;
		}

		placeUnder(tip, button);
		tip.style.visibility = '';
		window.addEventListener('scroll', onScroll, true);
	});
}
