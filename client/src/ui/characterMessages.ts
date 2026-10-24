import { defineMessages } from '@multiverse-kiln/shared';

/**
 * Text about the player's characters that more than one screen shows (see src/localization.ts)
 */
export const characterMessages = defineMessages({
	raceAndClass: {
		id: 'character.raceAndClass',
		defaultMessage: '{race} {class}',
		description: 'A character\'s race and class, e.g. "Dwarf Fighter": under the name at the top of their sheet, and after their name in the lists of the player\'s characters in the lobby, on a universe\'s page and on an invite. Reorder them as your language needs'
	},
	leaving: {
		id: 'characters.leaving',
		defaultMessage: 'To be deleted on {deleteAt, date, medium}',
		description: 'In the list of the player\'s characters, in a universe\'s lobby and on its page, beside one given their last rites, who can\'t be played until restored from their sheet; {deleteAt} is the day they will be deleted'
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
