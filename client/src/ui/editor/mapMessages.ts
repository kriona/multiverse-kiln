import { defineMessages } from '@multiverse-kiln/shared';

/**
 * Text about maps that more than one part of the editor shows (see src/localization.ts)
 */
export const mapMessages = defineMessages({
	arrowKeys: {
		id: 'editor.map.keys.cursor',
		defaultMessage: 'Arrow keys',
		description: 'In the list of keyboard shortcuts, the name of the arrow keys'
	},
	spaceOrEnter: {
		id: 'editor.map.keys.paint',
		defaultMessage: 'Space / Enter',
		description: 'In the list of keyboard shortcuts, the names of the Space and Enter keys'
	},
	void: {
		id: 'editor.map.void',
		defaultMessage: 'Void',
		description: 'A cell with nothing in it, drawn black, which can\'t be walked into; also a choice of what to paint'
	},
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
