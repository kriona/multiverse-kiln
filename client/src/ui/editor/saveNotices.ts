import type { EditorSavedPayload, Ruleset } from '@multiverse-kiln/shared';

import { formatList, t } from '../../localization';
import { announce } from '../announcer';
import { showToast } from '../toast';
import { describeDetail } from './auditDetails';
import type { FollowedPainting } from './MapEditor';

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
 * something the player has unsaved changes to, or painted over cells the player painted, the toast says
 * so, in the warning style, and shows until it is closed, by clicking it or with its Got It button, or
 * newer toasts take its place. Closing it takes the marks the save's painting made off the area editor's map
 *
 * @param saved The save
 * @param ruleset The universe's ruleset, which names its default tiles, items, races, classes and themes
 * @param keptTabs The names of the tabs where the player has unsaved changes to something the save changed
 * @param painting What the save's painting did to the map open in the area editor, if anything
 */
export function showSaveNotice(saved: EditorSavedPayload, ruleset: Ruleset, keptTabs: readonly string[], painting?: FollowedPainting): void
{
	const paintedOver = (painting?.paintedOver ?? 0);
	const onDismiss = painting?.unmark;
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

	const warnings: string[] = [];

	if (keptTabs.length > 0)
	{
		warnings.push(t({
			id: 'editor.saveNoticeKept',
			defaultMessage: '{count, plural, one {This conflicts with your unsaved changes on the {tabs} tab.} other {This conflicts with your unsaved changes on the {tabs} tabs.}}',
			description: 'A second sentence in the toast saying another editor saved changes, when they changed something the player also has unsaved changes to; the toast stays until closed. {tabs} names the editor\'s tabs those things are on, e.g. "Characters and Items", and {count} how many tabs'
		}, {
			tabs: formatList(keptTabs, 'conjunction'),
			count: keptTabs.length
		}));
	}

	if (paintedOver > 0)
	{
		warnings.push(t({
			id: 'editor.saveNoticePaintedOver',
			defaultMessage: '{count, plural, one {They painted over # cell you painted, outlined in orange on the map.} other {They painted over # cells you painted, outlined in orange on the map.}}',
			description: 'A sentence in the toast saying another editor saved changes, when they painted cells of the open area\'s map that the player had also painted since opening it, saved or not; the toast stays until closed. {count} is how many cells. The map outlines those cells in orange, and the text under the map names who painted the cell under the pointer'
		}, {
			count: paintedOver
		}));
	}

	if (warnings.length === 0)
	{
		showToast(notice, {
			durationMs: SAVE_NOTICE_MS,
			onDismiss
		});
		return;
	}

	const lines = [notice, ...warnings].map((text) =>
	{
		const line = document.createElement('p');

		line.textContent = text;

		return(line);
	});

	showToast(lines, {
		kind: 'warning',
		durationMs: null,
		announce: false,
		onDismiss
	});
	announce([notice, ...warnings].join(' '));
}
