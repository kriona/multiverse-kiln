import type { EditorPresence } from '@multiverse-kiln/shared';

import { currentLocale, formatList, t } from '../../localization';

/**
 * Who else is editing each area (see Area claims in STRUCTURE-OVERVIEW.md): the display names of the
 * other players with a window that has the area open in its area editor, by area ID. A claim is only a
 * warning; it keeps no one out
 */
export type AreaClaims = ReadonlyMap<string, readonly string[]>;

/**
 * The areas other players have open in the area editor of one version, from the editor room's state.
 * A window keeps its area open while it shows another tab, so it still counts
 *
 * @param editors The room's state.editors: each player with the editor open, by player ID
 * @param ownPlayerId The player whose page this is, whose own windows don't count
 * @param version The version this window has open, live or draft, since the draft's areas are its own
 * @return The claims, each area's names in alphabetical order
 */
export function areaClaims(editors: Iterable<[string, EditorPresence]>, ownPlayerId: string, version: string): AreaClaims
{
	const claims = new Map<string, Set<string>>();

	for (const [playerId, editor] of editors)
	{
		if (playerId === ownPlayerId)
		{
			continue;
		}

		for (const window of editor.windows.values())
		{
			if ((window.version !== version) || (window.areaId === ''))
			{
				continue;
			}

			const names = (claims.get(window.areaId) ?? new Set<string>());

			names.add(editor.name);
			claims.set(window.areaId, names);
		}
	}

	return(new Map([...claims].map(([areaId, names]) => [areaId, [...names].sort((a, b) => a.localeCompare(b, currentLocale()))])));
}

/**
 * Whether two sets of claims name the same players for the same areas
 *
 * @param first One set
 * @param second The other
 * @return True when they do
 */
export function sameClaims(first: AreaClaims, second: AreaClaims): boolean
{
	return((first.size === second.size) && [...first].every(([areaId, names]) =>
	{
		const others = second.get(areaId);

		return((others !== undefined) && (others.length === names.length) && names.every((name, index) => (name === others[index])));
	}));
}

/**
 * The tag an area being edited by others gets in the list of areas, e.g. "Bea is editing"
 *
 * @param names Their display names
 * @return The tag
 */
export function claimTag(names: readonly string[]): string
{
	return(t({
		id: 'editor.areas.claimedTag',
		defaultMessage: '{count, plural, one {{names} is editing} other {{names} are editing}}',
		description: 'Under an area in the list of areas, among its tags, when other editors have it open in the area editor right now; {names} is their display names as a list, e.g. "Bea and Cal", and {count} how many. It warns rather than locks: anyone may still open and change the area'
	}, {
		names: formatList(names, 'conjunction'),
		count: names.length
	}));
}
