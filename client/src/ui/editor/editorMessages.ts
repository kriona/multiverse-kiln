import { defineMessages } from '@multiverse-kiln/shared';

/**
 * Text the editor's tabs and dialogs share (see src/localization.ts)
 */
export const editorMessages = defineMessages({
	filterAny: {
		id: 'filter.any',
		defaultMessage: 'Any',
		description: 'Choice of a filter on the Items or Tilesets tab that shows everything, such as items of every type, or tiles whether passable or not'
	},
	filterYes: {
		id: 'filter.yes',
		defaultMessage: 'Yes',
		description: 'Choice of a yes-or-no filter on the Items or Tilesets tab, e.g. Passable: Yes'
	},
	filterNo: {
		id: 'filter.no',
		defaultMessage: 'No',
		description: 'Choice of a yes-or-no filter on the Items or Tilesets tab, e.g. Passable: No'
	},
	customTag: {
		id: 'editor.tag.custom',
		defaultMessage: 'custom',
		description: 'In the last column of the editor\'s tables of tiles, items, races and classes, for one made for this universe'
	},
	editedTag: {
		id: 'editor.tag.edited',
		defaultMessage: 'edited',
		description: 'In the last column of the editor\'s tables of tiles, items, races and classes, for one of the ruleset\'s that this universe changed'
	},
	disabledTag: {
		id: 'editor.tag.disabled',
		defaultMessage: 'disabled',
		description: 'Under an area in the list of areas, or in the last column of the editor\'s tables of items, races and classes, for one players can\'t use: an area they can\'t go into, an item characters can\'t be given, or a race or class new characters can\'t choose'
	},
	disabled: {
		id: 'editor.select.disabled',
		defaultMessage: 'Disabled',
		description: 'In the dialogs for choosing areas or items, under the name of one players can\'t use: an area they can\'t go into, or an item characters can\'t be given'
	},
	restore: {
		id: 'editor.restore',
		defaultMessage: 'Restore Default',
		description: 'Button in the editor of a tile, item, race, class or theme that undoes this universe\'s changes to one of the ruleset\'s'
	}
});
