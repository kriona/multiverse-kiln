/**
 * How far from each end of the strip a tab is kept when it is scrolled into view, so the arrow over
 * that end doesn't cover it: the arrows' width (.tab-scroll in edit.scss)
 */
const ARROW_CLEARANCE = 40;

/**
 * How many pixels one line of a mouse wheel that scrolls by lines moves the tabs
 */
const WHEEL_LINE_HEIGHT = 16;

/**
 * A row of tabs that scrolls sideways when it is wider than the space it has, rather than wrapping, so
 * the tab showing still opens onto its panel. The arrow keys and Tab already scroll the focused tab into
 * view; a mouse wheel scrolls the row while it can move further that way, and an arrow over each end with
 * tabs hidden past it fades the tabs out there and scrolls the row when clicked. The arrows are for the
 * mouse only: they aren't in the Tab key's order, and screen readers don't hear them
 */
export class ScrollingTabs
{
	/**
	 * Follows a row of tabs
	 *
	 * @param tabs The tab list, which scrolls
	 * @param back The arrow over its left end
	 * @param forward The arrow over its right end
	 */
	constructor(private readonly tabs: HTMLElement, private readonly back: HTMLButtonElement, private readonly forward: HTMLButtonElement)
	{
		let laidOut = false;
		const observer = new ResizeObserver(() =>
		{
			// The tab chosen while the list was hidden, before it had a width, is scrolled to once it shows
			if (!laidOut && (tabs.clientWidth > 0))
			{
				const selected = tabs.querySelector<HTMLElement>('[aria-selected="true"]');

				if (selected)
				{
					this.reveal(selected);
				}
			}

			laidOut = (tabs.clientWidth > 0);
			this.update();
		});

		// The tabs change width without the list changing size when one is hidden or marked unsaved
		observer.observe(tabs);

		for (const tab of tabs.children)
		{
			observer.observe(tab);
		}

		tabs.addEventListener('scroll', () =>
		{
			this.update();
		});

		tabs.addEventListener('wheel', (event) =>
		{
			this.scrollByWheel(event);
		}, { passive: false });

		back.addEventListener('click', () =>
		{
			this.scrollByPage(-1);
		});

		forward.addEventListener('click', () =>
		{
			this.scrollByPage(1);
		});

		this.update();
	}

	/**
	 * Scrolls a tab into view, clear of the arrows, without scrolling the page
	 *
	 * @param tab The tab
	 */
	reveal(tab: HTMLElement): void
	{
		const view = this.tabs.getBoundingClientRect();
		const shown = tab.getBoundingClientRect();

		if (shown.left < (view.left + ARROW_CLEARANCE))
		{
			this.tabs.scrollLeft -= ((view.left + ARROW_CLEARANCE) - shown.left);
		}
		else if (shown.right > (view.right - ARROW_CLEARANCE))
		{
			this.tabs.scrollLeft += (shown.right - (view.right - ARROW_CLEARANCE));
		}
	}

	/**
	 * Shows the arrow over each end that has tabs hidden past it
	 */
	private update(): void
	{
		const hiddenRight = (this.tabs.scrollWidth - this.tabs.clientWidth - this.tabs.scrollLeft);

		this.back.hidden = (this.tabs.scrollLeft < 1);
		this.forward.hidden = (hiddenRight < 1);
	}

	/**
	 * Scrolls the tabs with a mouse wheel turned up or down, while they can move further that way. At
	 * either end, or when every tab fits, the page scrolls instead. A wheel that scrolls sideways, and
	 * Ctrl with the wheel (zooming), are left to the browser
	 *
	 * @param event The wheel turning over the tabs
	 */
	private scrollByWheel(event: WheelEvent): void
	{
		if (event.ctrlKey || (Math.abs(event.deltaX) >= Math.abs(event.deltaY)))
		{
			return;
		}

		const distance = ((event.deltaMode === WheelEvent.DOM_DELTA_LINE) ? (event.deltaY * WHEEL_LINE_HEIGHT) : event.deltaY);
		const canMove = ((distance < 0) ? !this.back.hidden : !this.forward.hidden);

		if (!canMove)
		{
			return;
		}

		event.preventDefault();
		this.tabs.scrollLeft += distance;
	}

	/**
	 * Scrolls the tabs most of the width they show, keeping a little of what was shown in view
	 *
	 * @param direction -1 for left, 1 for right
	 */
	private scrollByPage(direction: number): void
	{
		const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

		this.tabs.scrollBy({
			left: (direction * this.tabs.clientWidth * 0.8),
			behavior: (reduceMotion ? 'auto' : 'smooth')
		});
	}
}
