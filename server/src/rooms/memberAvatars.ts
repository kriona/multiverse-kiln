import { avatarHashesOf } from '../avatars/characterAvatars.js';

/**
 * Shows a character's avatar hash in a room's list of who's there
 *
 * @param characterId The character's ID
 * @param avatarHash The hash of their avatar now, or null when they have none
 */
export type ShowAvatarHash = (characterId: string, avatarHash: string | null) => void;

/**
 * The avatar hashes of the characters a room lists (LobbyMember's and GroupMember's avatarHash), which
 * pages ask for each avatar with, so it is cached for good and a changed look is a new address
 *
 * The room looks a character's hash up as they are listed, and again when their look changes
 * (characterItemChanges). Lookups run off the simulation tick, and when two for the same character
 * overlap, only the later one is shown, so an older look never replaces a newer one
 */
export class MemberAvatars
{
	/**
	 * The latest lookup of each character still being made, by character ID
	 */
	private readonly lookups = new Map<string, number>();

	private lookupCount = 0;

	/**
	 * @param show Shows a character's hash, when the room still lists them
	 * @param describeRoom Names the room, for the log when a lookup fails
	 */
	constructor(private readonly show: ShowAvatarHash, private readonly describeRoom: () => string)
	{
	}

	/**
	 * Looks up characters' avatar hashes, in a few queries however many there are, and shows each one no
	 * later lookup has started for. A lookup that fails is logged, and shows nothing
	 *
	 * @param characterIds The characters' IDs
	 * @return Resolves once they are shown; never rejects
	 */
	async refresh(characterIds: readonly string[]): Promise<void>
	{
		if (characterIds.length === 0)
		{
			return;
		}

		const lookup = ++this.lookupCount;

		for (const characterId of characterIds)
		{
			this.lookups.set(characterId, lookup);
		}

		let hashes: Map<string, string | null> | undefined;

		try
		{
			hashes = await avatarHashesOf(characterIds);
		}
		catch (error)
		{
			console.error('Could not look up the avatars of characters', characterIds, 'in', this.describeRoom(), error);
		}

		for (const characterId of characterIds)
		{
			if (this.lookups.get(characterId) !== lookup)
			{
				continue;
			}

			this.lookups.delete(characterId);

			if (hashes)
			{
				this.show(characterId, (hashes.get(characterId) ?? null));
			}
		}
	}
}
