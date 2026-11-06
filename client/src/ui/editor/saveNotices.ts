import type { EditorSavedPayload, Ruleset } from '@multiverse-kiln/shared';

import { formatList, t } from '../../localization';
import { showToast } from '../toast';
import { describeDetail } from './auditDetails';

/**
 * Most things a save notice names; it counts the rest
 */
const MAX_NAMED_DETAILS = 3;

/**
 * How long a save notice shows, in milliseconds: longer than most toasts, since it may name several things
 */
const SAVE_NOTICE_MS = 10000;

/**
 * Says in a toast, read out by screen readers, who saved what in another window, from the save's audit
 * details, e.g. "Bea saved: Changed race Dwarf, Painted 40 cells in Cave"
 *
 * @param saved The save
 * @param ruleset The universe's ruleset, which names its default tiles, items, races, classes and themes
 */
export function showSaveNotice(saved: EditorSavedPayload, ruleset: Ruleset): void
{
	const named = saved.details
		.slice(0, MAX_NAMED_DETAILS)
		.map((detail) => describeDetail(detail, ruleset));

	showToast(t({
		id: 'editor.saveNotice',
		defaultMessage: '{more, plural, =0 {{name} saved: {changes}} one {{name} saved: {changes}, and # more change} other {{name} saved: {changes}, and # more changes}}',
		description: 'In a toast, also read out by screen readers, when another editor (or the player in another window) saves changes to the universe open in the editor. {name} is their display name, {changes} a list of up to three things the save changed, as the Audit tab lists them (e.g. "Changed race Dwarf, Painted 40 cells in Cave"), and {more} how many more it changed'
	}, {
		name: saved.name,
		changes: formatList(named),
		more: (saved.details.length - named.length)
	}), {
		durationMs: SAVE_NOTICE_MS
	});
}
