import { defineMessages } from '@multiverse-kiln/shared';

/**
 * Text about a map's size that more than one part of the editor shows (see src/localization.ts)
 */
export const mapMessages = defineMessages({
	tooLarge: {
		id: 'editor.map.tooLarge',
		defaultMessage: 'A map can be at most {max, number} cells in each direction.',
		description: 'Shown when the size asked for a map is larger than allowed; {max} is the most cells on a side'
	},
	loadFailed: {
		id: 'editor.map.loadFailed',
		defaultMessage: 'Could not load the map.',
		description: 'Shown in the map editor or a map preview when part of a zone\'s map couldn\'t be loaded'
	}
});
