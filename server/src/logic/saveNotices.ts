/**
 * What a save tells the other editor windows (see Save notices under Editing together in
 * STRUCTURE-OVERVIEW.md)
 */
import { canEditWorld, type AuditSubject, type EditorRole, type UniverseEditDetail, type UniverseVersionName } from '@multiverse-kiln/shared';

/**
 * The parts of a save that change what the universe holds once, its editors and its draft, whichever
 * version is open. Its stage is one of its settings, kept apart in noticeDetails()
 */
const UNIVERSE_WIDE_SUBJECTS: ReadonlySet<AuditSubject> = new Set(['editor', 'draft']);

/**
 * The parts of a save the Editors and Universe tabs show, which every role sees: the editors, the
 * universe's settings and its draft
 */
const SHARED_TAB_SUBJECTS: ReadonlySet<AuditSubject> = new Set(['editor', 'settings', 'draft']);

/**
 * The parts of a save only the Translations tab shows, of the tabs a translator sees
 */
const TRANSLATION_SUBJECTS: ReadonlySet<AuditSubject> = new Set(['translations', 'translatorNotes', 'noTranslation']);

/**
 * The things whose names the Translations tab lists, besides the universe's settings
 */
const NAMED_SUBJECTS: ReadonlySet<AuditSubject> = new Set(['tile', 'item', 'race', 'class', 'theme', 'difficultyLevel', 'area']);

/**
 * What a role's tabs show of a save: everything, for the roles that see every tab but the Audit tab
 * (creators, builders and site admins); the editors, the settings and the draft for beta testers, who
 * see only the Editors and Universe tabs; and for translators, those and what the Translations tab
 * lists: translations, notes for translators, text marked as needing none, and the things whose names
 * it lists, added, deleted, restored or renamed
 *
 * @param details What the save changed, as the Audit tab lists it
 * @param role The role of the window's player
 * @return What the role's tabs show, in the save's order
 */
function shownToRole<Detail extends UniverseEditDetail>(details: readonly Detail[], role: EditorRole): Detail[]
{
	if (canEditWorld(role))
	{
		return([...details]);
	}

	const shown: Detail[] = [];

	for (const detail of details)
	{
		if (SHARED_TAB_SUBJECTS.has(detail.subject) || ((role === 'translator') && TRANSLATION_SUBJECTS.has(detail.subject)))
		{
			shown.push(detail);
		}
		else if ((role === 'translator') && NAMED_SUBJECTS.has(detail.subject) && (detail.action !== 'resized'))
		{
			if (detail.action !== 'changed')
			{
				shown.push(detail);
				continue;
			}

			const fields = detail.fields.filter((change) => (change.field === 'name'));

			if (fields.length > 0)
			{
				shown.push({ ...detail, fields });
			}
		}
	}

	return(shown);
}

/**
 * What a window hears of a save, of what its player's role shows: everything, when it has the version
 * saved open, and otherwise only what the universe holds once, the same in both versions: its editors,
 * its stage and its draft
 *
 * @param details What the save changed, as the Audit tab lists it
 * @param savedVersion The version the save changed
 * @param windowVersion The version the window has open
 * @param role The role of the window's player
 * @return What the window hears of, in the save's order; empty when it hears of nothing
 */
export function noticeDetails<Detail extends UniverseEditDetail>(details: readonly Detail[], savedVersion: UniverseVersionName, windowVersion: UniverseVersionName, role: EditorRole): Detail[]
{
	const shown = shownToRole(details, role);

	if (savedVersion === windowVersion)
	{
		return(shown);
	}

	const heard: Detail[] = [];

	for (const detail of shown)
	{
		if (UNIVERSE_WIDE_SUBJECTS.has(detail.subject))
		{
			heard.push(detail);
		}
		else if (detail.subject === 'settings')
		{
			const fields = detail.fields.filter((change) => (change.field === 'stage'));

			if (fields.length > 0)
			{
				heard.push({ ...detail, fields });
			}
		}
	}

	return(heard);
}
