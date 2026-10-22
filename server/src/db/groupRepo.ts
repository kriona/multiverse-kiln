/**
 * Groups: the only module that reads or writes the groups, group_members and group_invites tables
 */
import { and, asc, count, eq, gt, inArray, isNull, lte, or, sql } from 'drizzle-orm';

import { db, type Executor } from './client.js';
import { characters, groupInvites, groupMembers, groups } from './schema.js';

/**
 * A group
 */
export interface GroupRecord
{
	id: string;
	universeId: string;

	/**
	 * The anchor being's character ID
	 */
	anchorCharacterId: string;

	/**
	 * Empty when it has none
	 */
	name: string;

	/**
	 * Where members with nowhere else to be go, or null when the area was deleted
	 */
	startingAreaId: string | null;

	/**
	 * The group's game clock, in seconds of game time
	 */
	clockSeconds: number;
}

/**
 * What a new group needs
 */
export interface NewGroup
{
	universeId: string;

	/**
	 * The anchor being, who becomes the group's first member
	 */
	anchorCharacterId: string;

	name: string;

	/**
	 * The anchor being's starting area, or null when they have none
	 */
	startingAreaId: string | null;
}

/**
 * Where a member was when their player last left the group's room
 */
export interface MemberPosition
{
	characterId: string;
	areaId: string;
	column: number;
	row: number;
}

/**
 * A character in a group, and their player
 */
export interface GroupCharacter
{
	characterId: string;
	playerId: string;
	name: string;

	/**
	 * False while the character has been given their last rites, so they can't be played
	 */
	playable: boolean;
}

/**
 * A member of a group as the group's room needs them
 */
export interface GroupMemberRecord extends GroupCharacter
{
	/**
	 * Where they were last, or null when they haven't been played in the group or their area was deleted
	 */
	position: Omit<MemberPosition, 'characterId'> | null;
}

/**
 * The group a character is in
 */
export interface Membership
{
	groupId: string;
	universeId: string;

	/**
	 * Whether the character is the group's anchor being
	 */
	isAnchor: boolean;
}

/**
 * A character leaving a group, from leaveGroup()
 *
 * - left: the character was taken out
 * - disbanded: the character was the anchor being, so the group was deleted; members lists every
 *   character who was in it, the anchor being included
 */
export type LeftGroup =
	| { kind: 'left'; character: GroupCharacter }
	| { kind: 'disbanded'; members: GroupCharacter[] };

/**
 * An invite link that still works
 */
export interface InviteRecord
{
	id: string;
	groupId: string;
	multiUse: boolean;
}

/**
 * What a new invite link needs
 */
export interface NewInvite
{
	groupId: string;

	/**
	 * SHA-256 of the link's token, as hex
	 */
	tokenHash: string;

	multiUse: boolean;

	/**
	 * When the link stops working, or null when it never does
	 */
	expiresAt: Date | null;
}

/**
 * Matches the characters that still exist: those whose last rites' time hasn't come. Characters past
 * it are hidden until the sweep deletes them, as in characterRepo
 */
const notExpired = or(isNull(characters.deleteAt), gt(characters.deleteAt, sql`now()`));

/**
 * The columns of a group's row that GroupRecord holds
 */
const groupColumns = {
	id: groups.id,
	universeId: groups.universeId,
	anchorCharacterId: groups.anchorCharacterId,
	name: groups.name,
	startingAreaId: groups.startingAreaId,
	clockSeconds: groups.clockSeconds
};

/**
 * Makes a group with its anchor being as its first member. Call it inside a transaction, after
 * checking that the anchor being isn't in a group
 *
 * @param group The group
 * @param executor A transaction
 * @return The new group's ID
 */
export async function createGroup(group: NewGroup, executor: Executor): Promise<string>
{
	const [created] = await executor
		.insert(groups)
		.values({
			universeId: group.universeId,
			anchorCharacterId: group.anchorCharacterId,
			name: group.name,
			startingAreaId: group.startingAreaId
		})
		.returning({ id: groups.id });

	await executor
		.insert(groupMembers)
		.values({
			characterId: group.anchorCharacterId,
			groupId: created.id
		});

	return(created.id);
}

/**
 * A group
 *
 * @param groupId The group's ID
 * @param executor The database, or a transaction
 * @return The group, or undefined when there is no such group
 */
export async function findGroup(groupId: string, executor: Executor = db): Promise<GroupRecord | undefined>
{
	const [row] = await executor
		.select(groupColumns)
		.from(groups)
		.where(eq(groups.id, groupId))
		.limit(1);

	return(row);
}

/**
 * Locks a group's row until the transaction ends, so characters join it one at a time
 *
 * @param groupId The group's ID
 * @param executor A transaction
 * @return The group, or undefined when there is no such group
 */
export async function lockGroup(groupId: string, executor: Executor): Promise<GroupRecord | undefined>
{
	const [row] = await executor
		.select(groupColumns)
		.from(groups)
		.where(eq(groups.id, groupId))
		.for('update');

	return(row);
}

/**
 * The group a character is in
 *
 * @param characterId The character's ID
 * @param executor The database, or a transaction
 * @return The group, or undefined when the character isn't in one
 */
export async function findMembership(characterId: string, executor: Executor = db): Promise<Membership | undefined>
{
	const [row] = await executor
		.select({
			groupId: groups.id,
			universeId: groups.universeId,
			anchorCharacterId: groups.anchorCharacterId
		})
		.from(groupMembers)
		.innerJoin(groups, eq(groups.id, groupMembers.groupId))
		.where(eq(groupMembers.characterId, characterId))
		.limit(1);

	if (!row)
	{
		return(undefined);
	}

	return({
		groupId: row.groupId,
		universeId: row.universeId,
		isAnchor: (row.anchorCharacterId === characterId)
	});
}

/**
 * The groups a player's characters in a universe are in
 *
 * @param playerId The player's ID
 * @param universeId The universe's ID
 * @param executor The database, or a transaction
 * @return Each group's ID, by the ID of the character in it; characters in no group are left out
 */
export async function listPlayerGroupIds(playerId: string, universeId: string, executor: Executor = db): Promise<Map<string, string>>
{
	const rows = await executor
		.select({
			characterId: groupMembers.characterId,
			groupId: groupMembers.groupId
		})
		.from(groupMembers)
		.innerJoin(characters, eq(characters.id, groupMembers.characterId))
		.where(and(
			eq(characters.playerId, playerId),
			eq(characters.universeId, universeId)
		));

	return(new Map(rows.map(({ characterId, groupId }) => [characterId, groupId])));
}

/**
 * Every character in a group, leaving out those past their last rites
 *
 * @param groupId The group's ID
 * @param executor The database, or a transaction
 * @return The members, in the order they joined
 */
export async function listGroupMembers(groupId: string, executor: Executor = db): Promise<GroupMemberRecord[]>
{
	const rows = await executor
		.select({
			characterId: groupMembers.characterId,
			playerId: characters.playerId,
			name: characters.name,
			deleteAt: characters.deleteAt,
			areaId: groupMembers.areaId,
			column: groupMembers.column,
			row: groupMembers.row
		})
		.from(groupMembers)
		.innerJoin(characters, eq(characters.id, groupMembers.characterId))
		.where(and(
			eq(groupMembers.groupId, groupId),
			notExpired
		))
		.orderBy(asc(groupMembers.joinedAt), asc(groupMembers.characterId));

	return(rows.map(({ characterId, playerId, name, deleteAt, areaId, column, row }) => ({
		characterId,
		playerId,
		name,
		playable: (deleteAt === null),
		position: (((areaId !== null) && (column !== null) && (row !== null)) ? { areaId, column, row } : null)
	})));
}

/**
 * How many characters are in a group, counting those given their last rites until their time comes
 *
 * @param groupId The group's ID
 * @param executor The database, or a transaction
 * @return The number of members
 */
export async function countGroupMembers(groupId: string, executor: Executor = db): Promise<number>
{
	const [row] = await executor
		.select({
			total: count()
		})
		.from(groupMembers)
		.innerJoin(characters, eq(characters.id, groupMembers.characterId))
		.where(and(
			eq(groupMembers.groupId, groupId),
			notExpired
		));

	return(row.total);
}

/**
 * Puts a character in a group. Call it inside a transaction, after locking the group (lockGroup) and
 * checking that the character isn't in a group and the group has room
 *
 * @param groupId The group's ID
 * @param characterId The character's ID
 * @param executor A transaction
 */
export async function addGroupMember(groupId: string, characterId: string, executor: Executor): Promise<void>
{
	await executor
		.insert(groupMembers)
		.values({
			characterId,
			groupId
		});
}

/**
 * Takes a character out of their group. The anchor being leaving deletes the group, with its members
 * and invites
 *
 * @param groupId The group's ID
 * @param characterId The character's ID
 * @param executor The database, or a transaction
 * @return What happened, or undefined when the character isn't in the group
 */
export async function leaveGroup(groupId: string, characterId: string, executor: Executor = db): Promise<LeftGroup | undefined>
{
	const group = await findGroup(groupId, executor);
	const members = await listGroupMembers(groupId, executor);
	const member = members.find((each) => (each.characterId === characterId));

	if (!group || !member)
	{
		return(undefined);
	}

	if (group.anchorCharacterId === characterId)
	{
		await executor
			.delete(groups)
			.where(eq(groups.id, groupId));

		return({
			kind: 'disbanded',
			members: members.map(toGroupCharacter)
		});
	}

	await executor
		.delete(groupMembers)
		.where(and(
			eq(groupMembers.groupId, groupId),
			eq(groupMembers.characterId, characterId)
		));

	return({
		kind: 'left',
		character: toGroupCharacter(member)
	});
}

/**
 * Records where members of a group were when their player left its room. Members who have since left
 * the group are skipped
 *
 * @param groupId The group's ID
 * @param positions Where each one was
 * @param executor The database, or a transaction
 */
export async function saveMemberPositions(groupId: string, positions: readonly MemberPosition[], executor: Executor = db): Promise<void>
{
	for (const { characterId, areaId, column, row } of positions)
	{
		await executor
			.update(groupMembers)
			.set({
				areaId,
				column,
				row
			})
			.where(and(
				eq(groupMembers.groupId, groupId),
				eq(groupMembers.characterId, characterId)
			));
	}
}

/**
 * Records a group's game clock
 *
 * @param groupId The group's ID
 * @param clockSeconds The clock, in seconds of game time
 * @param executor The database, or a transaction
 */
export async function saveGroupClock(groupId: string, clockSeconds: number, executor: Executor = db): Promise<void>
{
	await executor
		.update(groups)
		.set({ clockSeconds })
		.where(eq(groups.id, groupId));
}

/**
 * The memberships of the characters whose last rites' time has come, for the sweep to tell the
 * groups' rooms about before deleting them
 *
 * @param executor The database, or a transaction
 * @return Each membership, with the character
 */
export async function listExpiredMemberships(executor: Executor = db): Promise<(Membership & { character: GroupCharacter })[]>
{
	const rows = await executor
		.select({
			groupId: groups.id,
			universeId: groups.universeId,
			anchorCharacterId: groups.anchorCharacterId,
			characterId: groupMembers.characterId,
			playerId: characters.playerId,
			name: characters.name
		})
		.from(groupMembers)
		.innerJoin(groups, eq(groups.id, groupMembers.groupId))
		.innerJoin(characters, eq(characters.id, groupMembers.characterId))
		.where(lte(characters.deleteAt, sql`now()`));

	return(rows.map(({ groupId, universeId, anchorCharacterId, characterId, playerId, name }) => ({
		groupId,
		universeId,
		isAnchor: (anchorCharacterId === characterId),
		character: {
			characterId,
			playerId,
			name,
			playable: false
		}
	})));
}

/**
 * The members of several groups
 *
 * @param groupIds The groups' IDs
 * @param executor The database, or a transaction
 * @return Each group's members, by group ID
 */
export async function listMembersOfGroups(groupIds: readonly string[], executor: Executor = db): Promise<Map<string, GroupCharacter[]>>
{
	const members = new Map<string, GroupCharacter[]>();

	if (groupIds.length === 0)
	{
		return(members);
	}

	const rows = await executor
		.select({
			groupId: groupMembers.groupId,
			characterId: groupMembers.characterId,
			playerId: characters.playerId,
			name: characters.name,
			deleteAt: characters.deleteAt
		})
		.from(groupMembers)
		.innerJoin(characters, eq(characters.id, groupMembers.characterId))
		.where(inArray(groupMembers.groupId, [...groupIds]));

	for (const { groupId, characterId, playerId, name, deleteAt } of rows)
	{
		const character: GroupCharacter = {
			characterId,
			playerId,
			name,
			playable: (deleteAt === null)
		};

		members.set(groupId, [...(members.get(groupId) ?? []), character]);
	}

	return(members);
}

/**
 * Adds an invite link to a group
 *
 * @param invite The link
 * @param executor The database, or a transaction
 */
export async function createInvite(invite: NewInvite, executor: Executor = db): Promise<void>
{
	await executor
		.insert(groupInvites)
		.values({
			groupId: invite.groupId,
			tokenHash: invite.tokenHash,
			multiUse: invite.multiUse,
			expiresAt: invite.expiresAt
		});
}

/**
 * The invite link with a token, unless it has expired
 *
 * @param tokenHash SHA-256 of the token, as hex
 * @param executor The database, or a transaction
 * @return The link, or undefined when there is no such link or it has expired
 */
export async function findInvite(tokenHash: string, executor: Executor = db): Promise<InviteRecord | undefined>
{
	const [row] = await executor
		.select({
			id: groupInvites.id,
			groupId: groupInvites.groupId,
			multiUse: groupInvites.multiUse
		})
		.from(groupInvites)
		.where(and(
			eq(groupInvites.tokenHash, tokenHash),
			or(isNull(groupInvites.expiresAt), gt(groupInvites.expiresAt, sql`now()`))
		))
		.limit(1);

	return(row);
}

/**
 * Deletes an invite link, once a single-use link has been used
 *
 * @param inviteId The link's ID
 * @param executor The database, or a transaction
 */
export async function deleteInvite(inviteId: string, executor: Executor = db): Promise<void>
{
	await executor
		.delete(groupInvites)
		.where(eq(groupInvites.id, inviteId));
}

/**
 * Deletes the invite links that have expired
 *
 * @param executor The database, or a transaction
 * @return How many were deleted
 */
export async function purgeExpiredInvites(executor: Executor = db): Promise<number>
{
	const deleted = await executor
		.delete(groupInvites)
		.where(lte(groupInvites.expiresAt, sql`now()`))
		.returning({ id: groupInvites.id });

	return(deleted.length);
}

/**
 * A member as a GroupCharacter, without what only the room needs
 *
 * @param member The member
 * @return The character and their player
 */
function toGroupCharacter({ characterId, playerId, name, playable }: GroupMemberRecord): GroupCharacter
{
	return({ characterId, playerId, name, playable });
}
