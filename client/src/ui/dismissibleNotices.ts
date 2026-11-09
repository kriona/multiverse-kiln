import { defineMessages, type DismissibleNotice, type MessageDescriptor } from '@multiverse-kiln/shared';

/**
 * The text of each notice a player can dismiss for good (DISMISSIBLE_NOTICES), as the notice shows it and
 * as the player's own profile lists it among the notices they dismissed
 */
export const DISMISSIBLE_NOTICE_TEXT: Readonly<Record<DismissibleNotice, MessageDescriptor>> = defineMessages({
	editorDraft: {
		id: 'editor.version.draftNotice',
		defaultMessage: 'You are editing the draft version of this universe. Players will not see changes until they are applied.',
		description: 'Shown above the editor\'s tabs while the universe\'s draft (a copy players don\'t see) is open, until the player dismisses it; also listed on the player\'s own profile page among the notices they dismissed, which they can show again'
	},
	editorLiveWithDraft: {
		id: 'editor.version.liveWithDraftNotice',
		defaultMessage: 'You are editing the live version of this universe. The universe has a draft: changes saved here are replaced when the draft is applied unless they are also made in the draft.',
		description: 'Shown above the editor\'s tabs while the live version of a universe with a draft is open, until the player dismisses it; also listed on the player\'s own profile page among the notices they dismissed, which they can show again'
	}
});
