/**
 * Disabling things players are using (see STRUCTURE-OVERVIEW.md): who moves when an area is disabled,
 * who leaves a group when the group size is lowered, and how many characters a change affects
 */

/**
 * A cell of an area
 */
export interface Place
{
	areaId: string;
	column: number;
	row: number;
}

/**
 * An area, as far as finding where to go from it goes
 */
export interface AreaInTree
{
	id: string;
	parentAreaId: string | null;
	enabled: boolean;
}

/**
 * A link on a cell, as far as finding where to arrive goes
 */
export interface LinkInto
{
	column: number;
	row: number;
	targetAreaId: string;
}

/**
 * The enabled area characters leaving a disabled area go to when they go to its parent: its parent, or
 * the nearest area above that is enabled
 *
 * @param areas Every area of the universe
 * @param areaId The disabled area
 * @return The area it is inside, and the areas passed on the way up (the disabled area first), whose
 * links from that area lead back toward where the characters were; undefined when no enabled area holds it
 */
export function enabledAncestor(areas: readonly AreaInTree[], areaId: string): { ancestorId: string; passed: string[] } | undefined
{
	const byId = new Map(areas.map((area) => [area.id, area]));
	const passed = [areaId];
	let parentId = (byId.get(areaId)?.parentAreaId ?? null);

	// The editor refuses an area inside itself, but a loop mustn't hang a save if one is ever stored
	while ((parentId !== null) && !passed.includes(parentId))
	{
		const parent = byId.get(parentId);

		if (!parent)
		{
			return(undefined);
		}

		if (parent.enabled)
		{
			return({
				ancestorId: parent.id,
				passed
			});
		}

		passed.push(parent.id);
		parentId = parent.parentAreaId;
	}

	return(undefined);
}

/**
 * Where in an area characters arrive when they are sent there from areas inside it: on the first link
 * (in the order given) leading to one of those areas, so they come out where they would have gone in,
 * or the area's center when none does
 *
 * @param links The area's links
 * @param from The areas the characters come from
 * @return The cell
 */
export function arrivalCell(links: readonly LinkInto[], from: readonly string[]): { column: number; row: number }
{
	const link = links.find((each) => from.includes(each.targetAreaId));

	return((link ? { column: link.column, row: link.row } : { column: 0, row: 0 }));
}

/**
 * A group member saved in an area that is being disabled
 */
export interface SavedMember
{
	characterId: string;

	/**
	 * Their group's starting area and cell; the area is null when it was deleted
	 */
	groupStart: { areaId: string | null; column: number; row: number };
}

/**
 * Where group members saved in a disabled area are saved instead
 *
 * @param members The members
 * @param destination Where everyone goes, or null to send each to their group's starting area
 * @param universeStart The universe's starting area and cell, for a group whose starting area was
 * deleted; null when it has none
 * @return Each member's new place; members with nowhere to go are left out, and placed when next played
 */
export function evacuatedPlaces(members: readonly SavedMember[], destination: Place | null, universeStart: Place | null): (Place & { characterId: string })[]
{
	return(members.flatMap(({ characterId, groupStart }) =>
	{
		const place = (destination
			?? ((groupStart.areaId === null) ? universeStart : { ...groupStart, areaId: groupStart.areaId }));

		return((place ? [{ characterId, ...place }] : []));
	}));
}

/**
 * A member of a group, in the order they joined
 */
export interface JoinedMember
{
	characterId: string;
	joinedAt: Date;
}

/**
 * The members taken out of a group to bring it down to a size: those who joined most recently first,
 * and never the anchor being
 *
 * @param members The group's members
 * @param anchorCharacterId The anchor being
 * @param size The size the group must fit
 * @return The characters to take out; none when the group already fits
 */
export function membersOverSize(members: readonly JoinedMember[], anchorCharacterId: string, size: number): string[]
{
	const excess = (members.length - size);

	if (excess <= 0)
	{
		return([]);
	}

	return(members
		.filter((member) => (member.characterId !== anchorCharacterId))
		.map((member, index) => ({ member, index }))
		// Members who joined at the same moment leave in reverse of the order given
		.sort((first, second) => ((second.member.joinedAt.getTime() - first.member.joinedAt.getTime()) || (second.index - first.index)))
		.slice(0, excess)
		.map(({ member }) => member.characterId));
}

/**
 * Where a character is
 */
export interface CharacterInArea
{
	characterId: string;
	areaId: string;
}

/**
 * How many characters are in each of some areas: playing there, or saved there by their group. Where a
 * room has a character in its area counts over where they were saved
 *
 * @param saved Where group members were saved
 * @param playing Where the characters in rooms' areas are
 * @param areaIds The areas to count
 * @return How many characters are in each area, by area ID; an area with none is left out
 */
export function countCharactersInAreas(saved: readonly CharacterInArea[], playing: readonly CharacterInArea[], areaIds: readonly string[]): Map<string, number>
{
	const where = new Map<string, string>();

	for (const { characterId, areaId } of saved)
	{
		where.set(characterId, areaId);
	}

	for (const { characterId, areaId } of playing)
	{
		where.set(characterId, areaId);
	}

	const counts = new Map<string, number>();

	for (const areaId of where.values())
	{
		if (areaIds.includes(areaId))
		{
			counts.set(areaId, ((counts.get(areaId) ?? 0) + 1));
		}
	}

	return(counts);
}
