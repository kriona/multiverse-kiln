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
	wholeNumber: {
		id: 'form.wholeNumber',
		defaultMessage: 'Enter a whole number from {min, number} to {max, number}.',
		description: 'Shown under a number field when what was typed isn\'t a whole number in the range it allows; {min} and {max} are the smallest and largest allowed'
	},
	saved: {
		id: 'form.saved',
		defaultMessage: 'Saved',
		description: 'Shown next to a form\'s Save button once its changes are stored'
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
