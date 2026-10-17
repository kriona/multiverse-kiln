import { defineMessages } from '@multiverse-kiln/shared';

/**
 * Text the race and class editors show about where characters start (see src/localization.ts)
 */
export const startingZoneMessages = defineMessages({
	universes: {
		id: 'editor.startingZone.universes',
		defaultMessage: '{zone} (the universe\'s)',
		description: 'Shown as a race\'s or class\'s starting zone when it has none of its own, so its characters start in the universe\'s; {zone} is that zone\'s name'
	},
	races: {
		id: 'editor.startingZone.races',
		defaultMessage: '{zone} (the race\'s)',
		description: 'Shown in the class editor as where the class\'s characters of one race start when the class has no zone for that race, so they start in the race\'s; {zone} is that zone\'s name'
	},
	loadFailed: {
		id: 'editor.startingZone.loadFailed',
		defaultMessage: 'Could not load the zones\' names.',
		description: 'Shown in the race or class editor when the names of the zones characters start in couldn\'t be loaded'
	}
});
