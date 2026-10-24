import type { GroupCharacter, Membership } from '../db/groupRepo.js';

/**
 * A change to who is in a group
 *
 * - joined: a character joined the group
 * - left: a character left the group, or was deleted
 * - disbanded: the anchor being left or was deleted, so the group is no more; members lists every
 *   character who was in it
 */
export type GroupChange =
	| { kind: 'joined'; groupId: string; universeId: string; character: GroupCharacter }
	| { kind: 'left'; groupId: string; universeId: string; character: GroupCharacter }
	| { kind: 'disbanded'; groupId: string; universeId: string; members: GroupCharacter[] };

/**
 * The change a character's deletion makes to their group
 *
 * @param membership The group the character was in
 * @param characterId The character's ID
 * @param members The group's members before the character was deleted, the character included
 * @return The group disbanding when the character was its anchor being, otherwise the character
 * leaving it; undefined when members doesn't list them
 */
export function deletionChange(membership: Membership, characterId: string, members: readonly GroupCharacter[]): GroupChange | undefined
{
	const { groupId, universeId } = membership;
	const member = members.find((each) => (each.characterId === characterId));

	if (!member)
	{
		return(undefined);
	}

	if (membership.isAnchor)
	{
		return({
			kind: 'disbanded',
			groupId,
			universeId,
			members: members.map(({ characterId: id, playerId, name, raceId, playable }) => ({
				characterId: id,
				playerId,
				name,
				raceId,
				playable: (playable && (id !== characterId))
			}))
		});
	}

	return({
		kind: 'left',
		groupId,
		universeId,
		character: {
			characterId,
			playerId: member.playerId,
			name: member.name,
			raceId: member.raceId,
			playable: false
		}
	});
}

/**
 * Called after every change
 */
export type GroupChangeListener = (change: GroupChange) => void;

/**
 * Tells the rooms about changes to groups as they are made: a group's room lets in characters who
 * joined and lets go of those who left, and a lobby stops or starts letting players play them there
 *
 * Changes are published after they are saved. It lives in memory, so it only reaches rooms in the same
 * server process, like OnlinePlayers
 */
export class GroupChanges
{
	private readonly listeners = new Set<GroupChangeListener>();

	/**
	 * Tells every listener about a change that has been saved
	 *
	 * @param change The change
	 */
	publish(change: GroupChange): void
	{
		for (const listener of [...this.listeners])
		{
			listener(change);
		}
	}

	/**
	 * Listens for changes
	 *
	 * @param listener Called after each change
	 * @return Stops listening
	 */
	onChange(listener: GroupChangeListener): () => void
	{
		this.listeners.add(listener);

		return(() =>
		{
			this.listeners.delete(listener);
		});
	}
}

/**
 * The server's group changes, published by the group and character routes and the character sweep,
 * and followed by the lobbies and game rooms
 */
export const groupChanges = new GroupChanges();
