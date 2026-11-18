import type { ChatNotice, ChatNoticeDetails } from '@multiverse-kiln/shared';

import { groupChanges, type GroupChange } from '../players/groupChanges.js';
import { postNotice, type NoticeSubject } from './keptChat.js';
import { RateLimiter } from './rateLimiter.js';

/**
 * Most notices one player's characters may write in one group's chat in GROUP_NOTICE_RATE_WINDOW_MS by
 * giving items, joining and leaving: as many as the chat messages a player may send to it
 */
const GROUP_NOTICE_RATE_LIMIT = 5;

const GROUP_NOTICE_RATE_WINDOW_MS = 3000;

/**
 * How fast each player's characters write notices in each group's chat, shared by giving items, joining
 * and leaving so that together they stay within the limit
 */
export const groupNoticeRates = new RateLimiter(GROUP_NOTICE_RATE_LIMIT, GROUP_NOTICE_RATE_WINDOW_MS);

/**
 * Records a notice a player's request is about to write in a group's chat, if it is within the limit on
 * how fast a player's characters may write them there. Called before the request changes anything, so a
 * refused request changes nothing
 *
 * @param groupId The group
 * @param playerId The player whose character the notice is about
 * @param rates How fast each player's characters write notices in each group's chat
 * @return Whether the notice is allowed; a refused one doesn't count toward the limit
 */
export function tryTakeGroupNotice(groupId: string, playerId: string, rates: RateLimiter = groupNoticeRates): boolean
{
	return(rates.tryTake(`${groupId} ${playerId}`));
}

/**
 * Writes a notice in a group's chat each time a character creates the group, joins it or leaves it,
 * however they leave: from the group or their sheet, because the group size was lowered, or because
 * their account was deleted. A disbanded group's chat is deleted with it, so it gets none
 *
 * @return Stops writing them
 */
export function startGroupChatNotices(): () => void
{
	return(groupChanges.onChange((change) =>
	{
		const notice = noticeOf(change);

		if ((notice === undefined) || (change.kind === 'disbanded'))
		{
			return;
		}

		void postNotice({
			kind: 'group',
			universeId: change.universeId,
			groupId: change.groupId
		}, notice, {
			playerId: change.character.playerId,
			name: change.character.name
		});
	}));
}

/**
 * Writes a notice in a group's chat that a character gave another items, so a player who was offline
 * sees it there
 *
 * @param universeId The group's universe
 * @param groupId The group
 * @param giver The character who gave the items, and their player
 * @param details Who got what
 * @return Resolves once it is taken in or written, or has failed to be
 */
export function postGiftNotice(universeId: string, groupId: string, giver: NoticeSubject, details: ChatNoticeDetails): Promise<void>
{
	return(postNotice({
		kind: 'group',
		universeId,
		groupId
	}, 'gave', giver, details));
}

/**
 * What the group's chat says about a change
 *
 * @param change The change
 * @return The notice, or undefined for a group disbanded
 */
function noticeOf(change: GroupChange): ChatNotice | undefined
{
	if (change.kind === 'joined')
	{
		return((change.created ? 'created' : 'joined'));
	}

	return(((change.kind === 'left') ? 'left' : undefined));
}
