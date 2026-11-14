import { defineMessages } from '@multiverse-kiln/shared';

/**
 * Text about an area's cells that more than one part of the editor shows (see src/localization.ts)
 */
export const areaEditorMessages = defineMessages({
	arrowKeys: {
		id: 'editor.area.keys.cursor',
		defaultMessage: 'Arrow keys',
		description: 'In the list of keyboard shortcuts, the name of the arrow keys'
	},
	cursorDescription: {
		id: 'editor.area.keys.cursorDescription',
		defaultMessage: 'Move the cursor on the focused area, 10 cells at a time with Shift',
		description: 'In the list of keyboard shortcuts, what the arrow keys do on an area shown in the editor: the area editor\'s cells, the link dialog\'s preview, or the preview in the dialog for choosing a starting area'
	},
	spaceOrEnter: {
		id: 'editor.area.keys.paint',
		defaultMessage: 'Space / Enter',
		description: 'In the list of keyboard shortcuts, the names of the Space and Enter keys'
	},
	unexplored: {
		id: 'editor.area.unexplored',
		defaultMessage: '📜Unexplored',
		description: 'A cell with nothing in it, drawn as blank map paper like the parts of an area players haven\'t explored, which can\'t be walked into; also a choice of what to paint'
	},
	loadFailed: {
		id: 'editor.area.loadFailed',
		defaultMessage: 'Could not load the area\'s cells.',
		description: 'Shown in the area editor or an area preview when part of an area\'s cells couldn\'t be loaded'
	}
});
