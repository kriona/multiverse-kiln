/**
 * Links that require the whole group (see STRUCTURE-OVERVIEW.md, Editor: Map)
 *
 * Such a link can be taken only while every member of the group, the anchor being included, is
 * present and together, and then the whole group goes through it at once
 */

/**
 * Where a member of the group is, as far as taking a link goes
 */
export interface MemberWhereabouts
{
	/**
	 * The area the member is in, or undefined when they aren't in the room: their player isn't playing
	 */
	areaId: string | undefined;

	/**
	 * Whether the member is on their way to another area through a link
	 */
	travelling: boolean;
}

/**
 * Whether a group can take a link that requires the whole group
 *
 * @param memberIds Every member of the group, the anchor being included
 * @param takerId The member taking the link
 * @param whereabouts Where a member is
 * @return True when every member is in the taker's area and none is travelling
 */
export function isGroupTogether(memberIds: readonly string[], takerId: string, whereabouts: (memberId: string) => MemberWhereabouts): boolean
{
	const taker = whereabouts(takerId);

	if (!memberIds.includes(takerId) || (taker.areaId === undefined))
	{
		return(false);
	}

	return(memberIds.every((memberId) =>
	{
		const member = whereabouts(memberId);

		return((member.areaId === taker.areaId) && !member.travelling);
	}));
}
