import { formatList, t } from '../../localization';
import { createToggleSwitch } from '../toggleSwitch';
import { editorMessages } from './editorMessages';

/**
 * What the lists of races and classes on the Characters tab say about where a race or class comes from and whether it can be chosen
 */
interface OptionState
{
	custom: boolean;

	/**
	 * Whether a default was changed in more than whether it is enabled
	 */
	editedSettings: boolean;

	enabled: boolean;
}

/**
 * Words for a race, class, theme or item that was made for the universe, changed from the ruleset's, or
 * can't be chosen. A list with an Enabled switch on each row leaves out disabled, which the switch shows
 *
 * @param option The race, class, theme or item
 * @param tagDisabled Whether to say when it is disabled
 * @return The words, e.g. "custom, disabled", or an empty string for none
 */
export function optionTags(option: OptionState, tagDisabled: boolean): string
{
	const tags = [
		(option.custom
			? t(editorMessages.customTag)
			: undefined),
		(option.editedSettings
			? t(editorMessages.editedTag)
			: undefined),
		((option.enabled || !tagDisabled)
			? undefined
			: t(editorMessages.disabledTag))
	].filter((tag) => (tag !== undefined));

	return(formatList(tags));
}

/**
 * A race's or class's row in its tab's table: its name (opening its editor), its Enabled switch, a
 * summary and its tags
 *
 * @param name The race's or class's name
 * @param summary Its rules in a few words
 * @param tags Words from optionTags()
 * @param onOpen Opens its editor
 * @param enabledSwitch Its Enabled switch (createEnabledSwitch()), or undefined for a list without one
 * @return The row
 */
export function createOptionRow(name: string, summary: string, tags: string, onOpen: () => void, enabledSwitch?: HTMLInputElement): HTMLTableRowElement
{
	const row = document.createElement('tr');
	const nameButton = document.createElement('button');

	nameButton.type = 'button';
	nameButton.className = 'link-button';
	nameButton.textContent = name;
	nameButton.addEventListener('click', onOpen);

	for (const content of [nameButton, enabledSwitch, summary, tags])
	{
		if (content !== undefined)
		{
			const cell = document.createElement('td');

			if (content === enabledSwitch)
			{
				cell.className = 'switch-cell';
			}

			cell.append(content);
			row.append(cell);
		}
	}

	return(row);
}

/**
 * The switch in a row of an editor list that enables or disables what the row is, as the Enabled
 * checkbox in its editor does
 *
 * @param name The name of what the row is, e.g. Dwarf
 * @param enabled Whether it is enabled
 * @param editable Whether the player may change it
 * @param onChange Called with whether it is now enabled
 * @return The switch
 */
export function createEnabledSwitch(name: string, enabled: boolean, editable: boolean, onChange: (enabled: boolean) => void): HTMLInputElement
{
	return(createToggleSwitch({
		name: {
			label: t({
				id: 'editor.enabledSwitch',
				defaultMessage: '{name} enabled',
				description: 'Read by screen readers for the on/off switch in a row of the editor\'s tables of races, classes, themes and items, which does what the Enabled checkbox in its editor does; {name} is the race\'s, class\'s, theme\'s or item\'s name'
			}, {
				name
			})
		},
		checked: enabled,
		disabled: !editable,
		onChange
	}));
}
