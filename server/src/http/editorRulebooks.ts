/**
 * Turning a universe's books on and off in a save of the world editor (see Rulebooks in
 * STRUCTURE-OVERVIEW.md). A book's races, classes, themes and items can be used only while it is on
 */
import { defineMessages, isUsable, rulesetHasThemes, type ItemDisabling, type RulebookSettings } from '@multiverse-kiln/shared';

import { loadEditorClasses } from '../db/classRepo.js';
import { loadEditorItems } from '../db/itemRepo.js';
import { loadEditorRaces } from '../db/raceRepo.js';
import { loadRulebookSettings } from '../db/rulesetRepo.js';
import { loadEditorThemes } from '../db/themeRepo.js';
import { refuse, type ChangeContext } from './editorChangeContext.js';

/**
 * Reasons turning a book off is refused
 */
const messages = defineMessages({
	noRaceLeft: {
		id: 'error.rulebookLeavesNoRace',
		defaultMessage: 'Turning off the book leaves no enabled race for new characters. Enable a race from another book first.',
		description: 'Why a book of game rules (such as the Advanced Race Guide) couldn\'t be turned off on the Ruleset tab: its races are the only ones new characters can choose'
	},
	noClassLeft: {
		id: 'error.rulebookLeavesNoClass',
		defaultMessage: 'Turning off the book leaves no enabled class for new characters. Enable a class from another book first.',
		description: 'Why a book of game rules (such as the Advanced Player\'s Guide) couldn\'t be turned off on the Ruleset tab: its classes are the only ones new characters can choose'
	},
	noThemeLeft: {
		id: 'error.rulebookLeavesNoTheme',
		defaultMessage: 'Turning off the book leaves no enabled theme for new characters. Enable a theme from another book first.',
		description: 'Why a book of game rules couldn\'t be turned off on the Ruleset tab: its themes are the only ones new characters can choose'
	}
});

/**
 * The optional books the version being saved has on, as the save's changes so far leave them
 *
 * @param context The save
 * @return The books' keys
 */
export async function savedRulebooks(context: ChangeContext): Promise<string[]>
{
	const { universe, version, transaction } = context;

	return((await loadRulebookSettings(version, universe.ruleset, transaction)).rulebooks);
}

/**
 * Notes what a ruleset change does to the books: refuses turning books off when that leaves new
 * characters no race, class or theme, and notes the items of the books turned off or on, so the
 * characters carrying them lose or get back what the change chose (see editorDisablings.ts)
 *
 * @param context The save
 * @param before The books before the change
 * @param after The books the change saves
 * @param whenOff What turning each book off does to the characters carrying its items, by book
 */
export async function noteRulebookChanges(context: ChangeContext, before: RulebookSettings, after: RulebookSettings, whenOff: Readonly<Record<string, ItemDisabling>>): Promise<void>
{
	const { universe, version, transaction } = context;
	const turnedOff = before.rulebooks.filter((rulebook) => !after.rulebooks.includes(rulebook));
	const turnedOn = after.rulebooks.filter((rulebook) => !before.rulebooks.includes(rulebook));

	if (turnedOff.length > 0)
	{
		await checkUsableOptions(context, after.rulebooks);
	}

	if ((turnedOff.length === 0) && (turnedOn.length === 0))
	{
		return;
	}

	for (const item of await loadEditorItems(version, universe.ruleset, transaction))
	{
		if (!item.enabled || (item.rulebook === null))
		{
			continue;
		}

		if (turnedOff.includes(item.rulebook))
		{
			context.disablings.item(item.id, true, (whenOff[item.rulebook] ?? 'keep'));
		}
		else if (turnedOn.includes(item.rulebook))
		{
			context.disablings.item(item.id, false);
		}
	}
}

/**
 * Refuses books that leave new characters no race or class to choose, or no theme in a ruleset with them
 *
 * @param context The save
 * @param rulebooks The optional books on
 */
async function checkUsableOptions(context: ChangeContext, rulebooks: readonly string[]): Promise<void>
{
	const { universe, version, transaction } = context;

	if (!(await loadEditorRaces(version, universe.ruleset, transaction)).some((race) => isUsable(race, rulebooks)))
	{
		refuse(409, messages.noRaceLeft);
	}

	if (!(await loadEditorClasses(version, universe.ruleset, transaction)).some((option) => isUsable(option, rulebooks)))
	{
		refuse(409, messages.noClassLeft);
	}

	if (rulesetHasThemes(universe.ruleset) && !(await loadEditorThemes(version, universe.ruleset, transaction)).some((theme) => isUsable(theme, rulebooks)))
	{
		refuse(409, messages.noThemeLeft);
	}
}
