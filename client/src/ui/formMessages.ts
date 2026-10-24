import { defineMessages } from '@multiverse-kiln/shared';

/**
 * Text many forms show (see src/localization.ts)
 */
export const formMessages = defineMessages({
	invalidText: {
		id: 'form.invalidText',
		defaultMessage: 'Use letters, numbers, spaces or punctuation.',
		description: 'Shown by a text field when what was typed is empty or has characters that aren\'t allowed'
	},
	universeNameNoLetters: {
		id: 'form.universeNameNoLetters',
		defaultMessage: 'A universe\'s name needs at least one letter or number.',
		description: 'Shown by the field for a universe\'s name when it has only spaces and punctuation; the name is made into the universe\'s web address, which needs a letter or number'
	},
	wholeNumber: {
		id: 'form.wholeNumber',
		defaultMessage: 'Enter a whole number from {min, number} to {max, number}.',
		description: 'Shown under a number field when what was typed isn\'t a whole number in the range it allows; {min} and {max} are the smallest and largest allowed'
	},
	saving: {
		id: 'form.saving',
		defaultMessage: 'Saving...',
		description: 'Shown while work is being stored, such as painting under the map editor\'s map, or the player\'s progress in the toolbar of Create Character'
	},
	saved: {
		id: 'form.saved',
		defaultMessage: 'Saved',
		description: 'Shown next to a form\'s Save button once its changes are stored'
	},
	savedToast: {
		id: 'form.savedToast',
		defaultMessage: 'Changes saved',
		description: 'Shown for a few seconds in a green message at the top of the page once a form\'s changes are stored'
	},
	cancel: {
		id: 'dialog.cancel',
		defaultMessage: 'Cancel',
		description: 'Button that closes a dialog without making any changes'
	},
	close: {
		id: 'dialog.close',
		defaultMessage: 'Close',
		description: 'Button that closes a dialog that only shows something, with nothing to change'
	}
});
