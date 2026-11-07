import type { EditorSavedPayload, Ruleset } from '@multiverse-kiln/shared';

import { formatList, t } from '../../localization';
import { announce } from '../announcer';
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
 * details, e.g. "Bea saved: Changed race Dwarf, Painted 40 cells in Cave". When the save changed
 * something the player has unsaved changes to, the toast names the tabs it is on and shows until it is
 * clicked away
 *
 * @param saved The save
 * @param ruleset The universe's ruleset, which names its default tiles, items, races, classes and themes
 * @param keptTabs The names of the tabs where the player has unsaved changes to something the save changed
 */
export function showSaveNotice(saved: EditorSavedPayload, ruleset: Ruleset, keptTabs: readonly string[]): void
{
	const named = saved.details
		.slice(0, MAX_NAMED_DETAILS)
		.map((detail) => describeDetail(detail, ruleset));
	const notice = t({
		id: 'editor.saveNotice',
		defaultMessage: '{more, plural, =0 {{name} saved: {changes}} one {{name} saved: {changes}, and # more change} other {{name} saved: {changes}, and # more changes}}',
		description: 'In a toast, also read out by screen readers, when another editor (or the player in another window) saves changes to the universe open in the editor. {name} is their display name, {changes} a list of up to three things the save changed, as the Audit tab lists them (e.g. "Changed race Dwarf, Painted 40 cells in Cave"), and {more} how many more it changed'
	}, {
		name: saved.name,
		changes: formatList(named),
		more: (saved.details.length - named.length)
	});

	if (keptTabs.length === 0)
	{
		showToast(notice, {
			durationMs: SAVE_NOTICE_MS
		});
		return;
	}

	const kept = t({
		id: 'editor.saveNoticeKept',
		defaultMessage: '{count, plural, one {This conflicts with your unsaved changes on the {tabs} tab.} other {This conflicts with your unsaved changes on the {tabs} tabs.}}',
		description: 'A second sentence in the toast saying another editor saved changes, when they changed something the player also has unsaved changes to; the toast stays until clicked away. {tabs} names the editor\'s tabs those things are on, e.g. "Characters and Items", and {count} how many tabs'
	}, {
		tabs: formatList(keptTabs, 'conjunction'),
		count: keptTabs.length
	});
	const lines = [notice, kept].map((text) =>
	{
		const line = document.createElement('p');

		line.textContent = text;

		return(line);
	});

	showToast(lines, {
		kind: 'warning',
		durationMs: null,
		announce: false
	});
	announce(`${notice} ${kept}`);
}
