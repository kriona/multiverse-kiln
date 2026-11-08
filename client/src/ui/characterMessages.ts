import { defineMessages } from '@multiverse-kiln/shared';

/**
 * Text about the player's characters that more than one screen shows (see src/localization.ts)
 */
export const characterMessages = defineMessages({
	leaving: {
		id: 'characters.leaving',
		defaultMessage: 'To be deleted on {deleteAt, date, medium}',
		description: 'Beside a character given their last rites, who can\'t be played until restored from their sheet: in the list of the player\'s characters in a universe\'s lobby and on its page, and in the world editor\'s list of every character in the universe; {deleteAt} is the day they will be deleted'
	},
	barred: {
		id: 'characters.barred',
		defaultMessage: '{bar, select, race {Can\'t play: your race is disabled} other {Can\'t play: your class is disabled}}',
		description: 'Beside a character who can\'t play because the universe\'s creators disabled their race (bar is race) or class (bar is class) for characters already of it, until it is enabled again: in the list of the player\'s characters in a universe\'s lobby and on its page, and on the screen an invite link opens'
	},
	inGroup: {
		id: 'characters.inGroup',
		defaultMessage: 'In a group',
		description: 'Beside a character who is in a group (characters playing together): in the list of the player\'s characters, where choosing them goes to that group, and in the world editor\'s list of every character in the universe'
	},
	loadFailed: {
		id: 'characters.loadFailed',
		defaultMessage: 'Could not list your characters.',
		description: 'Shown in a universe\'s lobby or on its page when the list of the player\'s characters in the universe couldn\'t be loaded'
	},
	sheetShortcut: {
		id: 'play.keys.characterSheet',
		defaultMessage: 'Open the character sheet of the character you\'re playing',
		description: 'In the list of keyboard shortcuts in the lobby or a group, what the shortcut that shows the character this window plays does'
	},
	nowPlaying: {
		id: 'play.nowPlaying',
		defaultMessage: 'You are now playing {name}.',
		description: 'Read out by screen readers in the lobby or a group when the window switches to another of the player\'s characters; {name} is the character\'s name'
	}
});
