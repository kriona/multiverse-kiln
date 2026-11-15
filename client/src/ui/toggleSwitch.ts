import { defineMessages } from '@multiverse-kiln/shared';

import { t } from '../localization';

/**
 * The words inside an on/off switch (see src/localization.ts)
 */
const messages = defineMessages({
	on: {
		id: 'switch.on',
		defaultMessage: 'On',
		description: 'Inside an on/off switch while it is on, such as a book of game rules the universe uses, or a race, class, theme or item that can be used, in the editor\'s tables. The switch has room for only about 4 letters'
	},
	off: {
		id: 'switch.off',
		defaultMessage: 'Off',
		description: 'Inside an on/off switch while it is off, such as a book of game rules the universe doesn\'t use, or a disabled race, class, theme or item, in the editor\'s tables. The switch has room for only about 4 letters'
	}
});

/**
 * How long a switch's knob takes to slide, which $toggle-slide in _shared.scss sets
 */
const SLIDE_MS = 150;

/**
 * How a switch is named for screen readers: by text of its own, or by the element that names it
 */
export type ToggleSwitchName = { label: string } | { labelledBy: string };

/**
 * What a switch shows and does
 */
export interface ToggleSwitchOptions
{
	name: ToggleSwitchName;
	checked: boolean;

	/**
	 * Whether the player can't change it, such as when their role doesn't allow it
	 */
	disabled?: boolean;

	/**
	 * Called when the player turns it on or off
	 *
	 * @param checked Whether it is now on
	 */
	onChange(checked: boolean): void;
}

/**
 * An on/off switch: a checkbox drawn as a switch (.toggle-switch in _shared.scss), with On and Off
 * inside it in the player's language. It is still a checkbox, so Space toggles it and a screen reader
 * announces it as one
 *
 * @param options What it shows and does
 * @return The switch
 */
export function createToggleSwitch(options: ToggleSwitchOptions): HTMLInputElement
{
	const toggle = document.createElement('input');

	toggle.type = 'checkbox';
	toggle.className = 'toggle-switch';
	toggle.checked = options.checked;
	toggle.disabled = (options.disabled ?? false);
	toggle.dataset.on = t(messages.on);
	toggle.dataset.off = t(messages.off);

	if ('label' in options.name)
	{
		toggle.setAttribute('aria-label', options.name.label);
	}
	else
	{
		toggle.setAttribute('aria-labelledby', options.name.labelledBy);
	}

	toggle.addEventListener('change', () =>
	{
		options.onChange(toggle.checked);
	});

	return(toggle);
}

/**
 * Does something once a switch that was just turned on or off has finished sliding, such as drawing
 * its list again, which would cut the slide short
 *
 * @param work What to do
 */
export function afterSwitchSlides(work: () => void): void
{
	window.setTimeout(work, SLIDE_MS);
}
