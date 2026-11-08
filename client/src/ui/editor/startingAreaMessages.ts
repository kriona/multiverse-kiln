import { defineMessages } from '@multiverse-kiln/shared';

/**
 * Text the Characters tab and the race and class editors show about where characters start (see src/localization.ts)
 */
export const startingAreaMessages = defineMessages({
	universes: {
		id: 'editor.startingArea.universes',
		defaultMessage: '{area} (the universe\'s)',
		description: 'Shown as a race\'s or class\'s starting area when it has none of its own, so its characters start in the universe\'s; {area} is that area\'s name'
	},
	races: {
		id: 'editor.startingArea.races',
		defaultMessage: '{area} (the race\'s)',
		description: 'Shown in the class editor as where the class\'s characters of one race start when the class has no area for that race, so they start in the race\'s; {area} is that area\'s name'
	},
	at: {
		id: 'editor.startingArea.at',
		defaultMessage: '{area} at ({column}, {row})',
		description: 'Shown as a starting area chosen on the Characters tab or in the race or class editor, or as the lobby\'s area on the Lobby tab: the area and the square characters start on; {area} is the area\'s name, {column} and {row} the square\'s coordinates'
	},
	loadFailed: {
		id: 'editor.startingArea.loadFailed',
		defaultMessage: 'Could not load the areas\' names.',
		description: 'Shown in the race or class editor when the names of the areas characters start in couldn\'t be loaded, and on the Lobby tab when the name of the lobby\'s area couldn\'t be'
	}
});
