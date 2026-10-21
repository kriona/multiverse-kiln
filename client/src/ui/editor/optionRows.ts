import { formatList, t } from '../../localization';

/**
 * What the Races and Classes tabs say about where a race or class comes from and whether it can be chosen
 */
interface OptionState
{
	custom: boolean;
	edited: boolean;
	enabled: boolean;
}

/**
 * Words for a race or class that was made for the universe, changed from the ruleset's, or can't be chosen
 *
 * @param option The race or class
 * @return The words, e.g. "custom, disabled", or an empty string for none
 */
export function optionTags(option: OptionState): string
{
	const tags = [
		(option.custom
			? t({
				id: 'editor.options.customTag',
				defaultMessage: 'custom',
				description: 'In the last column of the editor\'s race or class table, for a race or class made for this universe'
			})
			: undefined),
		(option.edited
			? t({
				id: 'editor.options.editedTag',
				defaultMessage: 'edited',
				description: 'In the last column of the editor\'s race or class table, for one of the ruleset\'s races or classes that this universe changed'
			})
			: undefined),
		(option.enabled
			? undefined
			: t({
				id: 'editor.options.disabledTag',
				defaultMessage: 'disabled',
				description: 'In the last column of the editor\'s race or class table, for a race or class new characters can\'t choose'
			}))
	].filter((tag) => (tag !== undefined));

	return(formatList(tags));
}

/**
 * A race's or class's row in its tab's table: its name (opening its editor), a summary and its tags
 *
 * @param name The race's or class's name
 * @param summary Its rules in a few words
 * @param tags Words from optionTags()
 * @param onOpen Opens its editor
 * @return The row
 */
export function createOptionRow(name: string, summary: string, tags: string, onOpen: () => void): HTMLTableRowElement
{
	const row = document.createElement('tr');
	const nameButton = document.createElement('button');

	nameButton.type = 'button';
	nameButton.className = 'link-button';
	nameButton.textContent = name;
	nameButton.addEventListener('click', onOpen);

	for (const content of [nameButton, summary, tags])
	{
		const cell = document.createElement('td');

		cell.append(content);
		row.append(cell);
	}

	return(row);
}
