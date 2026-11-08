import type { ChatNotice } from '@multiverse-kiln/shared';

import { groupChanges, type GroupChange } from '../players/groupChanges.js';
import { postNotice } from './keptChat.js';

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
