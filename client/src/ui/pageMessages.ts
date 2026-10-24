import { defineMessages } from '@multiverse-kiln/shared';

/**
 * Text the pages show about connecting, logging in and loading (see src/localization.ts)
 */
export const pageMessages = defineMessages({
	loading: {
		id: 'page.loading',
		defaultMessage: 'Loading...',
		description: 'Shown while a page or part of one loads, such as the site settings, the choices in Create Character, an area in the editor, or a universe\'s page'
	},
	connecting: {
		id: 'page.connecting',
		defaultMessage: 'Connecting...',
		description: 'Shown on the whole page while the game connects to the server'
	},
	connectFailed: {
		id: 'page.connectFailed',
		defaultMessage: 'Could not connect to the server. Reload the page to try again.',
		description: 'Shown on the whole page when the game couldn\'t connect to the server'
	},
	disconnected: {
		id: 'page.disconnected',
		defaultMessage: 'Disconnected from the server. Reload the page to reconnect.',
		description: 'Shown on the whole page when the connection to the server is lost'
	},
	nameInUse: {
		id: 'login.nameInUse',
		defaultMessage: 'That player is already logged in from another browser.',
		description: 'Shown on the login screen when someone using the name typed is logged in elsewhere'
	},
	loginFailed: {
		id: 'login.failed',
		defaultMessage: 'Could not log in. Try again in a moment.',
		description: 'Shown on the login screen when the server couldn\'t log the player in'
	}
});
