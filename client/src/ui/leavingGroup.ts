import { defineMessages } from '@multiverse-kiln/shared';
import signOutIcon from 'virtual:icon/ph:sign-out';

import { t } from '../localization';
import { describeEditorError } from '../network/editorApi';
import type { GroupApi } from '../network/groupApi';
import { setButtonLabel } from './dom';
import { setShortcut } from './shortcuts';

/**
 * Text about leaving a group that the group screen and the character sheet both show (see src/localization.ts)
 */
export const leavingMessages = defineMessages({
	leaveFailed: {
		id: 'group.leaveFailed',
		defaultMessage: 'Could not leave the group.',
		description: 'Shown when the character couldn\'t be taken out of their group: in a group, or from a character\'s sheet'
	}
});

/**
 * Takes a character out of their group, disbanding it when they are its anchor being
 *
 * @param groupApi The routes that take characters out of groups
 * @param universeId The universe the group is in
 * @param groupId The group's ID
 * @param characterId The character's ID
 * @return Resolves once they have left; rejects with an Error whose message says why they couldn't
 */
export async function takeOutOfGroup(groupApi: GroupApi, universeId: string, groupId: string, characterId: string): Promise<void>
{
	try
	{
		await groupApi.leaveGroup(universeId, groupId, characterId);
	}
	catch (error)
	{
		throw new Error(describeEditorError(error, leavingMessages.leaveFailed), { cause: error });
	}
}

/**
 * Shows the button that asks whether to leave a group as Leave group (Alt+L), or as Disband Group
 * (Alt+B) for the anchor being: in a group, for the character the window plays, and on the sheet of a
 * character who can't play because their race or class is disabled
 *
 * @param button The button
 * @param isAnchor Whether the character is the group's anchor being, whose leaving disbands it
 */
export function showLeaveButton(button: HTMLButtonElement, isAnchor: boolean): void
{
	setShortcut(button, (isAnchor ? 'Alt+B' : 'Alt+L'));
	setButtonLabel(button, signOutIcon, leaveButtonLabel(isAnchor));
}

/**
 * The label of the button that asks whether to leave a group
 *
 * @param isAnchor Whether the character is the group's anchor being, whose leaving disbands it
 * @return The label
 */
function leaveButtonLabel(isAnchor: boolean): string
{
	return((isAnchor
		? t({
			id: 'group.disband',
			defaultMessage: 'Disband Group',
			description: 'Button, in place of Leave group for the anchor being, that takes them out of the group, which ends the group for everyone (it asks first): in a group, while the window plays them, and on their sheet when they can\'t play because their race or class is disabled'
		})
		: t({
			id: 'group.leave',
			defaultMessage: 'Leave group',
			description: 'Button that takes a character out of their group, back to the lobby: in a group, for the character the window plays, and on the sheet of a character who can\'t play because their race or class is disabled'
		})));
}

/**
 * What the dialog asking whether to leave a group says: the anchor being leaving disbands it for everyone
 *
 * @param name The character's name
 * @param isAnchor Whether the character is the group's anchor being
 * @return The dialog's title, its question and the label of the button that leaves
 */
export function describeLeaving(name: string, isAnchor: boolean): { title: string; question: string; confirm: string }
{
	if (isAnchor)
	{
		return({
			title: t({
				id: 'leaveGroup.disbandTitle',
				defaultMessage: 'Disband the Group?',
				description: 'Title of the dialog that asks the anchor being\'s player whether to leave the group, which ends it: from the group, or from their sheet (its Delete button, since a character in a group can\'t be deleted, or its Disband Group button when they can\'t play because their race or class is disabled)'
			}),
			question: t({
				id: 'leaveGroup.disbandQuestion',
				defaultMessage: '{name} is the anchor being, so if they leave, the group is disbanded for everyone. Every character keeps their items and money.',
				description: 'Asked before the anchor being leaves their group, from the group or from their sheet; {name} is the anchor being\'s name'
			}, {
				name
			}),
			confirm: t({
				id: 'leaveGroup.disband',
				defaultMessage: 'Disband',
				description: 'Button that takes the anchor being out of the group, which ends the group for everyone'
			})
		});
	}

	return({
		title: t({
			id: 'leaveGroup.title',
			defaultMessage: 'Leave the Group?',
			description: 'Title of the dialog that asks whether to take a character out of their group: from the group, or from their sheet (its Delete button, since a character in a group can\'t be deleted, or its Leave group button when they can\'t play because their race or class is disabled)'
		}),
		question: t({
			id: 'leaveGroup.question',
			defaultMessage: 'If you leave this group, {name} will return to the lobby. To rejoin this group, you will need to be reinvited.',
			description: 'Asked before a character leaves their group, from the group or from their sheet; {name} is the character\'s name'
		}, {
			name
		}),
		confirm: t({
			id: 'leaveGroup.confirm',
			defaultMessage: 'Leave Group',
			description: 'Button that takes the character out of their group'
		})
	});
}
