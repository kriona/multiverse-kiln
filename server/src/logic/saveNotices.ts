/**
 * What a save tells the other editor windows (see Save notices under Editing together in
 * STRUCTURE-OVERVIEW.md)
 */
import type { AuditSubject, UniverseEditDetail, UniverseVersionName } from '@multiverse-kiln/shared';

/**
 * The parts of a save that change what the universe holds once, its editors and its draft, whichever
 * version is open. Its stage is one of its settings, kept apart in noticeDetails()
 */
const UNIVERSE_WIDE_SUBJECTS: ReadonlySet<AuditSubject> = new Set(['editor', 'draft']);

/**
 * What a window hears of a save: everything, when it has the version saved open, and otherwise only
 * what the universe holds once, the same in both versions: its editors, its stage and its draft
 *
 * @param details What the save changed, as the Audit tab lists it
 * @param savedVersion The version the save changed
 * @param windowVersion The version the window has open
 * @return What the window hears of, in the save's order; empty when it hears of nothing
 */
export function noticeDetails<Detail extends UniverseEditDetail>(details: readonly Detail[], savedVersion: UniverseVersionName, windowVersion: UniverseVersionName): Detail[]
{
	if (savedVersion === windowVersion)
	{
		return([...details]);
	}

	const heard: Detail[] = [];

	for (const detail of details)
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
