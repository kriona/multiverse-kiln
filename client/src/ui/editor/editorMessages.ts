import { defineMessages, type BuilderPermissions, type MessageDescriptor } from '@multiverse-kiln/shared';

/**
 * Text the editor's tabs and dialogs share (see src/localization.ts)
 */
export const editorMessages = defineMessages({
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
		description: 'Under an area in the list of areas, or in the last column of the editor\'s tables of items, races, classes, themes and tiles, for one that can\'t be used: an area players can\'t go into, an item characters can\'t be given, a race, class or theme new characters can\'t choose, or a tile areas can\'t be painted with'
	},
	disabled: {
		id: 'editor.select.disabled',
		defaultMessage: 'Disabled',
		description: 'In the dialogs for choosing areas or items, under the name of one players can\'t use: an area they can\'t go into, or an item characters can\'t be given'
	},
	looksLike: {
		id: 'editor.looksLike',
		defaultMessage: 'Looks like',
		description: 'Label of the field, in the race and item editors, for a race or item the universe added: one of the game rules\' own races or items whose art it uses on characters\' avatars (pictures of the characters), since only those have art. Also names the setting in the list of what a save changed, on the editor\'s Audit tab'
	},
	looksLikeNone: {
		id: 'editor.looksLike.none',
		defaultMessage: 'Nothing (no art)',
		description: 'In the race and item editors\' "Looks like" field, the choice for a race or item the universe added that uses no art on characters\' avatars: characters of such a race have no avatar, and such an item isn\'t drawn. Also the field\'s value on the editor\'s Audit tab once a save chose it'
	},
	restore: {
		id: 'editor.restore',
		defaultMessage: 'Restore Default',
		description: 'Button in the editor of a tile, item, race, class or theme that undoes this universe\'s changes to one of the ruleset\'s'
	},
	name: {
		id: 'form.name',
		defaultMessage: 'Name',
		description: 'Label of the field for the name of something being made or edited, such as a universe, region, area, tile, item, race, class, theme or difficulty level, and the heading of the column of names in the editor\'s lists of them; also names the setting in the list of what a save changed, on the editor\'s Audit tab'
	},
	description: {
		id: 'form.description',
		defaultMessage: 'Description',
		description: 'Label of the field for a sentence or two describing an item, race, class or theme, in the item, race, class and theme editors, and the heading of the column of descriptions in a rulebook\'s Contents dialog; also names the setting in the list of what a save changed, on the editor\'s Audit tab'
	}
});

/**
 * What a builder may edit besides their regions, as the Editors tab's notes and the Audit tab's value of a
 * builder's permissions list it
 */
export const BUILDER_PERMISSION_NAMES: Readonly<Record<keyof BuilderPermissions, MessageDescriptor>> = defineMessages({
	canEditTiles: {
		id: 'editor.editors.tiles',
		defaultMessage: 'tiles',
		description: 'One of the things a builder may edit besides their regions: the universe\'s tiles. Listed in the Notes column of a builder\'s row on the editor\'s Editors tab, e.g. "Also edits: tiles and items", and in the value of a builder\'s permissions in the editor\'s Audit tab\'s list of what a save changed, e.g. "Permissions: tiles and items"'
	},
	canEditItems: {
		id: 'editor.editors.items',
		defaultMessage: 'items',
		description: 'One of the things a builder may edit besides their regions: the universe\'s items. Listed in the Notes column of a builder\'s row on the editor\'s Editors tab, e.g. "Also edits: tiles and items", and in the value of a builder\'s permissions in the editor\'s Audit tab\'s list of what a save changed, e.g. "Permissions: tiles and items"'
	},
	canEditMobs: {
		id: 'editor.editors.mobs',
		defaultMessage: 'mobs',
		description: 'One of the things a builder may edit besides their regions: the universe\'s mobs (monsters and enemies). Listed in the Notes column of a builder\'s row on the editor\'s Editors tab, e.g. "Also edits: tiles and items", and in the value of a builder\'s permissions in the editor\'s Audit tab\'s list of what a save changed, e.g. "Permissions: tiles and items"'
	}
});
