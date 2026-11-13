import { ABILITY_NAMES, AREA_LIGHT_LEVEL_NAMES, DARKVISION_NAMES, defineMessages, DISPLAY_TIME_NAMES, FAERIE_MORNING_NAMES, languageName, PASSAGE_OF_TIME_NAMES, PF1E_CASTING_STYLE_NAMES, PF1E_MAGIC_TRADITION_NAMES, PF1E_STAT_METHOD_NAMES, REAL_TIME_NAME, RULESET_ABILITIES, RULESET_COINS, SIZE_NAMES, UNIVERSE_ROLE_NAMES, UNIVERSE_STAGE_NAMES, type AuditField, type AuditFieldChange, type AuditFieldValues, type AuditPassageOfTime, type AuditPlace, type AuditSubject, type Coin, type MessageDescriptor, type OptionName, type Ruleset, type UniverseEditDetail } from '@multiverse-kiln/shared';

import { capitalized, currentLocale, formatList, signedNumber, t } from '../../localization';
import { difficultyName } from '../difficultyNames';
import { itemName, itemTypeName } from '../itemNames';
import { engineCoinName, formatMoney } from '../moneyField';
import { className, raceName, themeName } from '../raceAndClassNames';
import { tileName } from '../tileNames';
import { colorToHex } from './colors';
import { tileGraphicName } from './tileSwatches';

/**
 * Each setting's name in the Audit tab's list of what a save changed: the name its field has in the editor
 */
const AUDIT_FIELD_NAMES: Readonly<Record<AuditField, MessageDescriptor>> = defineMessages({
	name: {
		id: 'form.name',
		defaultMessage: 'Name',
		description: 'Label of the field for the name of something being made or edited, such as a universe, area, tile, item, race, class, theme or difficulty level, and the heading of the column of names in the editor\'s lists of them; also names the setting in the list of what a save changed, on the editor\'s Audit tab'
	},
	shortDescription: {
		id: 'universe.shortDescription',
		defaultMessage: '1-sentence description',
		description: 'Label of the field for a universe\'s description in one sentence; also names the setting in the list of what a save changed, on the editor\'s Audit tab'
	},
	longDescription: {
		id: 'editor.universe.longDescription',
		defaultMessage: 'Long description (Markdown)',
		description: 'Label of the field for a universe\'s full description, which is written in Markdown; also names the setting in the list of what a save changed, on the editor\'s Audit tab'
	},
	sourceLanguage: {
		id: 'editor.translations.sourceLanguage',
		defaultMessage: 'Source language',
		description: 'Label of the field on the editor\'s Translations tab for the language the universe\'s text is written in; also names the setting in the list of what a save changed, on the editor\'s Audit tab'
	},
	translationLanguages: {
		id: 'editor.translations.languages',
		defaultMessage: 'Translated into',
		description: 'Label of the field on the editor\'s Translations tab for the languages the universe\'s text is translated into; also names the setting in the list of what a save changed, on the editor\'s Audit tab'
	},
	stage: {
		id: 'editor.universe.stage',
		defaultMessage: 'Stage',
		description: 'Heading of the choice of how far along a universe is, from being built to being retired; also names the setting in the list of what a save changed, on the editor\'s Audit tab'
	},
	requireBuilderDraft: {
		id: 'editor.universe.requireBuilderDraft',
		defaultMessage: 'Builders make their changes in a draft',
		description: 'Checkbox on the editor\'s Universe tab, under the stage while "let there be light" (open to everyone) is chosen, for whether builders must make their changes in the universe\'s draft, a copy players don\'t see until a creator applies it, rather than in the live version; also names the setting in the list of what a save changed, on the editor\'s Audit tab'
	},
	requireTwoFactor: {
		id: 'editor.editors.requireTwoFactor',
		defaultMessage: 'Editors need two-factor authentication',
		description: 'Checkbox on the editor\'s Editors tab for whether the universe\'s editors need two-factor authentication on to save changes to it; also names the setting in the list of what a save changed, on the editor\'s Audit tab'
	},
	passageOfTime: {
		id: 'editor.passageOfTime',
		defaultMessage: 'Passage of time',
		description: 'Label of the field for how the time of day changes in a universe or area; also names the setting in the list of what a save changed, on the editor\'s Audit tab'
	},
	displayTime: {
		id: 'editor.displayTime',
		defaultMessage: 'Display time',
		description: 'Label of the field for how players are shown the time of day in a universe; also names the setting in the list of what a save changed, on the editor\'s Audit tab'
	},
	lobbyPassageOfTime: {
		id: 'editor.audit.field.lobbyPassageOfTime',
		defaultMessage: 'Lobby\'s passage of time',
		description: 'Names the setting for how the time of day changes in the lobby (the Lobby tab\'s passage of time), in the list of what a save changed on the editor\'s Audit tab'
	},
	lobbyDayHours: {
		id: 'editor.audit.field.lobbyDayHours',
		defaultMessage: 'Length of a lobby day',
		description: 'Names the setting for how many real hours a day in the lobby lasts, in the list of what a save changed on the editor\'s Audit tab'
	},
	lobbyNoVisionCost: {
		id: 'editor.lobby.noVisionCost',
		defaultMessage: 'No vision cost in the lobby',
		description: 'Checkbox for whether characters in the lobby see as far as in full daylight at any time of day, past every tile as if none had a vision cost; also names the setting in the list of what a save changed, on the editor\'s Audit tab'
	},
	groupSize: {
		id: 'editor.characters.groupSize',
		defaultMessage: 'Group size',
		description: 'Label of the field for the most characters that can play together in one group; also names the setting in the list of what a save changed, on the editor\'s Audit tab'
	},
	startingMoney: {
		id: 'editor.characters.startingMoney',
		defaultMessage: 'Starting money',
		description: 'Label of the field for the money every character starts with; also names the setting in the list of what a save changed, on the editor\'s Audit tab'
	},
	coinNames: {
		id: 'editor.audit.field.coinNames',
		defaultMessage: 'Coin names',
		description: 'Names the setting for the names the universe gives its coins, such as Bronze kits for copper pieces, in the list of what a save changed on the editor\'s Audit tab'
	},
	coinAbbreviations: {
		id: 'editor.audit.field.coinAbbreviations',
		defaultMessage: 'Coin abbreviations',
		description: 'Names the setting for the abbreviations the universe writes its coins with after an amount, such as bk in 2bk for bronze kits, in the list of what a save changed on the editor\'s Audit tab'
	},
	startingItems: {
		id: 'editor.characters.startingEquipment',
		defaultMessage: 'Starting equipment',
		description: 'Heading of the list of items every character starts with, on the editor\'s Characters tab; also names the setting in the list of what a save changed, on the editor\'s Audit tab'
	},
	lobbyArea: {
		id: 'editor.lobby.area',
		defaultMessage: 'Lobby area',
		description: 'Label of the Lobby tab\'s choice of the area players walk around in the lobby, and the square of it they start on; also names the setting in the list of what a save changed, on the editor\'s Audit tab'
	},
	startingArea: {
		id: 'editor.audit.field.startingArea',
		defaultMessage: 'Starting area',
		description: 'Names the setting for where characters start (of the universe, or of a race or class), in the list of what a save changed on the editor\'s Audit tab'
	},
	statMethod: {
		id: 'editor.ruleset.statMethod',
		defaultMessage: 'Rolling for stats',
		description: 'Label of the field for how characters\' ability scores are made: rolled with dice, or bought with points; also names the setting in the list of what a save changed, on the editor\'s Audit tab'
	},
	customPointBuyBudget: {
		id: 'editor.ruleset.budget',
		defaultMessage: 'Points to spend',
		description: 'Label of the field for how many points players spend on ability scores, shown when the universe chooses the number; also names the setting in the list of what a save changed, on the editor\'s Audit tab'
	},
	abilityPoints: {
		id: 'editor.ruleset.abilityPoints',
		defaultMessage: 'Ability points',
		description: 'Label of the field for how many ability points players spend raising their characters\' ability scores, in Starfinder; also names the setting in the list of what a save changed, on the editor\'s Audit tab'
	},
	needsSleep: {
		id: 'editor.ruleset.needsSleep',
		defaultMessage: 'Characters get tired and need sleep',
		description: 'Checkbox for whether characters in the universe get tired and need to sleep; also names the setting in the list of what a save changed, on the editor\'s Audit tab'
	},
	coinsHaveWeight: {
		id: 'editor.ruleset.coinsHaveWeight',
		defaultMessage: 'Coins count towards carrying capacity',
		description: 'Checkbox for whether the coins characters carry add to the weight they carry; also names the setting in the list of what a save changed, on the editor\'s Audit tab'
	},
	tracksAmmo: {
		id: 'editor.ruleset.tracksAmmo',
		defaultMessage: 'Track ammunition',
		description: 'Checkbox for whether arrows and other ammunition are used up when fired; also names the setting in the list of what a save changed, on the editor\'s Audit tab'
	},
	role: {
		id: 'editor.editors.role',
		defaultMessage: 'Role',
		description: 'Heading of the column of roles (such as creator or builder) on the editor\'s Editors tab, and the label of the role field in its dialog; also names the setting in the list of what a save changed, on the editor\'s Audit tab'
	},
	languages: {
		id: 'editor.editors.languages',
		defaultMessage: 'Languages',
		description: 'Heading of the column on the editor\'s Editors tab listing the languages each translator may translate the universe into, and the label of that field in its dialog; also names the setting in the list of what a save changed, on the editor\'s Audit tab'
	},
	indoors: {
		id: 'form.indoors',
		defaultMessage: 'Indoors',
		description: 'Choice for an area or tile that is indoors; also names the setting in the list of what a save changed, on the editor\'s Audit tab'
	},
	outdoors: {
		id: 'form.outdoors',
		defaultMessage: 'Outdoors',
		description: 'Choice for an area or tile that is outdoors; also names the setting in the list of what a save changed, on the editor\'s Audit tab'
	},
	color: {
		id: 'editor.tile.color',
		defaultMessage: 'Color',
		description: 'The color a tile is drawn in: the label of its field in the tile editor, and the heading of the Tilesets table\'s column of colors; also names the setting in the list of what a save changed, on the editor\'s Audit tab'
	},
	graphic: {
		id: 'editor.tile.graphic',
		defaultMessage: 'Graphic',
		description: 'Label of the tile editor\'s list of the graphics a tile can be drawn with; also names the setting in the list of what a save changed, on the editor\'s Audit tab'
	},
	visionCost: {
		id: 'editor.tile.visionCost',
		defaultMessage: 'Vision cost (%)',
		description: 'Label of the field for how much of a character\'s vision crossing the tile uses, in percent; also names the setting in the list of what a save changed, on the editor\'s Audit tab'
	},
	walkSeconds: {
		id: 'editor.tile.walkSeconds',
		defaultMessage: 'Walk time (seconds)',
		description: 'Label of the field for how many seconds of game time walking a square of the tile takes; also names the setting in the list of what a save changed, on the editor\'s Audit tab'
	},
	enabled: {
		id: 'form.enabled',
		defaultMessage: 'Enabled',
		description: 'Checkbox for whether something can be used: players going into an area, characters being given an item, new characters choosing a race, class or theme, or areas being painted with a tile. Also the label of the Items and Tilesets tabs\' filters for it; also names the setting in the list of what a save changed, on the editor\'s Audit tab'
	},
	keepPlaying: {
		id: 'editor.option.keepPlaying',
		defaultMessage: 'Existing characters keep playing while disabled',
		description: 'Names a race\'s or class\'s setting in the list of what a save changed, on the editor\'s Audit tab: whether characters already of it can keep playing while it is disabled (yes), or can\'t play until it is enabled again (no). Chosen in the dialog the editor\'s Save opens when disabling a race or class characters are'
	},
	type: {
		id: 'editor.item.type',
		defaultMessage: 'Type',
		description: 'An item\'s type, such as dagger or longsword: the label of its field in the item editor, and of the Items tab\'s filter; also names the setting in the list of what a save changed, on the editor\'s Audit tab'
	},
	abilityModifiers: {
		id: 'editor.race.abilityModifiers',
		defaultMessage: 'Ability modifiers',
		description: 'Heading of the race editor\'s fields for how much the race adds to or takes from each ability score; also names the setting in the list of what a save changed, on the editor\'s Audit tab'
	},
	floatingBonus: {
		id: 'editor.race.floatingBonus',
		defaultMessage: 'Floating ability bonus',
		description: 'Checkbox for whether the player chooses one ability score for the race to raise; also names the setting in the list of what a save changed, on the editor\'s Audit tab'
	},
	darkvision: {
		id: 'character.darkvision',
		defaultMessage: 'Darkvision',
		description: 'How far a character can see in the dark, if at all: the label on a character\'s sheet, and of the race editor\'s field for how far the race\'s characters can; also names the setting in the list of what a save changed, on the editor\'s Audit tab'
	},
	lightSensitivity: {
		id: 'character.lightSensitivity',
		defaultMessage: 'Light sensitivity',
		description: 'Whether bright light dazzles a character: the label on a character\'s sheet, and the race editor\'s checkbox for whether it dazzles the race\'s characters; also names the setting in the list of what a save changed, on the editor\'s Audit tab'
	},
	size: {
		id: 'editor.race.size',
		defaultMessage: 'Size',
		description: 'Label of the field for a race\'s size, such as small or medium; also names the setting in the list of what a save changed, on the editor\'s Audit tab'
	},
	hitPoints: {
		id: 'editor.race.hitPoints',
		defaultMessage: 'Hit points',
		description: 'Label of the field for the hit points a race gives its characters on top of their class\'s, in Starfinder; also names the setting in the list of what a save changed, on the editor\'s Audit tab'
	},
	raceAreas: {
		id: 'editor.class.raceAreas',
		defaultMessage: 'Starting area by race',
		description: 'Heading of the class editor\'s list of where the class\'s members of each race start; also names the setting in the list of what a save changed, on the editor\'s Audit tab'
	},
	primaryAbility: {
		id: 'editor.class.primaryAbility',
		defaultMessage: 'Primary ability',
		description: 'Label of the field for the ability score a character class relies on most; also names the setting in the list of what a save changed, on the editor\'s Audit tab'
	},
	tradition: {
		id: 'editor.class.tradition',
		defaultMessage: 'Magic tradition',
		description: 'Label of the field for where a character class\'s magic comes from: none, arcane or divine; also names the setting in the list of what a save changed, on the editor\'s Audit tab'
	},
	castingStyle: {
		id: 'editor.class.castingStyle',
		defaultMessage: 'Spellcasting style',
		description: 'Label of the field for how a character class casts spells: none, prepared or spontaneous; also names the setting in the list of what a save changed, on the editor\'s Audit tab'
	},
	keyAbility: {
		id: 'editor.class.keyAbility',
		defaultMessage: 'Key ability',
		description: 'Label of the field for the ability score a character class relies on most, its key ability score in Starfinder; also names the setting in the list of what a save changed, on the editor\'s Audit tab'
	},
	hitPointsPerLevel: {
		id: 'editor.class.hitPoints',
		defaultMessage: 'Hit points per level',
		description: 'Label of the field for the hit points a character class gives at each level, in Starfinder; also names the setting in the list of what a save changed, on the editor\'s Audit tab'
	},
	staminaPointsPerLevel: {
		id: 'editor.class.staminaPoints',
		defaultMessage: 'Stamina points per level',
		description: 'Label of the field for the stamina points a character class gives at each level, in Starfinder; stamina is lost before hit points and comes back with rest; also names the setting in the list of what a save changed, on the editor\'s Audit tab'
	},
	ability: {
		id: 'editor.theme.ability',
		defaultMessage: 'Ability raised',
		description: 'Label of the field for the ability score a theme raises; also names the setting in the list of what a save changed, on the editor\'s Audit tab'
	},
	isDefault: {
		id: 'editor.difficultyLevel.default',
		defaultMessage: 'Default',
		description: 'Checkbox for whether a difficulty level is the one a new group starts on; also names the setting in the list of what a save changed, on the editor\'s Audit tab'
	},
	mobScale: {
		id: 'editor.difficultyLevel.mobScale',
		defaultMessage: 'Mob scale (%)',
		description: 'Label of the field for how much harder or easier a difficulty level makes mobs (monsters and enemies), as a percentage; also names the setting in the list of what a save changed, on the editor\'s Audit tab'
	},
	permadeath: {
		id: 'editor.difficultyLevel.permadeath',
		defaultMessage: 'Permadeath',
		description: 'Checkbox for whether characters who die at this difficulty level are gone for good; also names the setting in the list of what a save changed, on the editor\'s Audit tab'
	},
	parentArea: {
		id: 'editor.area.parent',
		defaultMessage: 'Parent area',
		description: 'Names the area an area was inside, in the list of what a save changed, on the editor\'s Audit tab, for saves made before regions'
	},
	parents: {
		id: 'editor.place.parents',
		defaultMessage: 'Parents',
		description: 'Label of the list of regions (and the area) a region or area is inside, in its editor, and heading of the column of the Areas tab\'s table listing them; also names the setting in the list of what a save changed, on the editor\'s Audit tab'
	},
	assignments: {
		id: 'editor.region.assignments',
		defaultMessage: 'Assigned builders',
		description: 'Heading of the builders assigned to a region in the region editor, who can edit everything inside it; also names the setting in the list of what a save changed, on the editor\'s Audit tab'
	},
	permissions: {
		id: 'editor.editors.permissions',
		defaultMessage: 'Permissions',
		description: 'Heading of the checkboxes in the dialog on the editor\'s Editors tab for what a builder may edit besides the areas and regions they are assigned; also names the setting in the list of what a save changed, on the editor\'s Audit tab'
	},
	indoorsOrOutdoors: {
		id: 'form.indoorsOrOutdoors',
		defaultMessage: 'Indoors or outdoors',
		description: 'Heading of the choice between indoors and outdoors for an area or tile; also names the setting in the list of what a save changed, on the editor\'s Audit tab'
	},
	lightLevel: {
		id: 'editor.area.lightLevel',
		defaultMessage: 'Light level',
		description: 'Label of the field for how light an indoor area is at any time of day: lit or dark; also names the setting in the list of what a save changed, on the editor\'s Audit tab'
	},
	defaultTile: {
		id: 'editor.area.defaultTile',
		defaultMessage: 'Default tile',
		description: 'Label of the field for the tile an area is filled with where nothing else is painted; also names the setting in the list of what a save changed, on the editor\'s Audit tab'
	},
	loopsEastWest: {
		id: 'editor.area.loopsEastWest',
		defaultMessage: 'Loops east-west',
		description: 'Checkbox for an area that wraps around, so walking off the east edge comes back on the west; also names the setting in the list of what a save changed, on the editor\'s Audit tab'
	},
	loopsNorthSouth: {
		id: 'editor.area.loopsNorthSouth',
		defaultMessage: 'Loops north-south',
		description: 'Checkbox for an area that wraps around, so walking off the north edge comes back on the south; also names the setting in the list of what a save changed, on the editor\'s Audit tab'
	}
});

/**
 * How the Audit tab says what a save did to each kind of thing. {name} is the thing's name and {count}
 * how many cells or links. A change to settings is followed by a line for each setting it changed
 */
const AUDIT_DETAILS: Readonly<Record<AuditSubject, MessageDescriptor>> = defineMessages({
	editor: {
		id: 'editor.audit.detail.editor',
		defaultMessage: '{action, select, added {Added editor {name}} changed {Changed editor {name}} other {Removed editor {name}}}',
		description: 'In the editor\'s Audit tab\'s list of what a save changed: a player given a role in the universe, their role or languages changed, or their role taken away. {name} is their @username. A change is followed by a line for each setting it changed, such as Role'
	},
	settings: {
		id: 'editor.audit.detail.settings',
		defaultMessage: 'Changed settings',
		description: 'In the editor\'s Audit tab\'s list of what a save changed: the universe\'s settings (from the Universe, Lobby and Characters tabs) it changed, followed by a line for each, such as Group size (4)'
	},
	ruleset: {
		id: 'editor.audit.detail.ruleset',
		defaultMessage: 'Changed the ruleset',
		description: 'In the editor\'s Audit tab\'s list of what a save changed: the settings for how the universe plays under its ruleset (the game\'s rules, on the Ruleset tab) it changed, followed by a line for each, such as Track ammunition (yes)'
	},
	tileset: {
		id: 'editor.audit.detail.tileset',
		defaultMessage: '{action, select, added {Uploaded tileset {name}} other {Deleted tileset {name}}}',
		description: 'In the editor\'s Audit tab\'s list of what a save changed: a tileset (an uploaded image tiles are drawn with) uploaded or deleted. {name} is its name'
	},
	tile: {
		id: 'editor.audit.detail.tile',
		defaultMessage: '{action, select, added {Added tile {name}} changed {Changed tile {name}} restored {Restored tile {name} to its default} other {Deleted tile {name}}}',
		description: 'In the editor\'s Audit tab\'s list of what a save changed: a tile (what areas are painted with, such as grass) added, changed, given back the ruleset\'s settings for it, or deleted. {name} is its name. A change is followed by a line for each setting it changed'
	},
	item: {
		id: 'editor.audit.detail.item',
		defaultMessage: '{action, select, added {Added item {name}} changed {Changed item {name}} restored {Restored item {name} to its default} other {Deleted item {name}}}',
		description: 'In the editor\'s Audit tab\'s list of what a save changed: an item (such as a weapon or gear) added, changed, given back the ruleset\'s settings for it, or deleted. {name} is its name. A change is followed by a line for each setting it changed'
	},
	race: {
		id: 'editor.audit.detail.race',
		defaultMessage: '{action, select, added {Added race {name}} changed {Changed race {name}} restored {Restored race {name} to its default} other {Deleted race {name}}}',
		description: 'In the editor\'s Audit tab\'s list of what a save changed: a race (such as elf or dwarf) added, changed, given back the ruleset\'s settings for it, or deleted. {name} is its name. A change is followed by a line for each setting it changed'
	},
	class: {
		id: 'editor.audit.detail.class',
		defaultMessage: '{action, select, added {Added class {name}} changed {Changed class {name}} restored {Restored class {name} to its default} other {Deleted class {name}}}',
		description: 'In the editor\'s Audit tab\'s list of what a save changed: a class (such as fighter or wizard) added, changed, given back the ruleset\'s settings for it, or deleted. {name} is its name. A change is followed by a line for each setting it changed'
	},
	theme: {
		id: 'editor.audit.detail.theme',
		defaultMessage: '{action, select, added {Added theme {name}} changed {Changed theme {name}} restored {Restored theme {name} to its default} other {Deleted theme {name}}}',
		description: 'In the editor\'s Audit tab\'s list of what a save changed: a theme (a Starfinder character\'s background, such as ace pilot) added, changed, given back the ruleset\'s settings for it, or deleted. {name} is its name. A change is followed by a line for each setting it changed'
	},
	difficultyLevel: {
		id: 'editor.audit.detail.difficultyLevel',
		defaultMessage: '{action, select, added {Added difficulty level {name}} changed {Changed difficulty level {name}} other {Deleted difficulty level {name}}}',
		description: 'In the editor\'s Audit tab\'s list of what a save changed: a difficulty level added, changed or deleted. {name} is its name. A change is followed by a line for each setting it changed'
	},
	region: {
		id: 'editor.audit.detail.region',
		defaultMessage: '{action, select, added {Added region {name}} changed {Changed region {name}} other {Deleted region {name}}}',
		description: 'In the editor\'s Audit tab\'s list of what a save changed: a region (which groups areas and holds settings they inherit) added, changed or deleted. {name} is its name. An addition or change is followed by a line for each setting it set'
	},
	area: {
		id: 'editor.audit.detail.area',
		defaultMessage: '{action, select, added {Added area {name}} changed {Changed area {name}} resized {Resized area {name}} other {Deleted area {name}}}',
		description: 'In the editor\'s Audit tab\'s list of what a save changed: an area (a place with its own grid of cells) added, changed, made bigger or smaller, or deleted. {name} is its name. A change is followed by a line for each setting it changed'
	},
	cells: {
		id: 'editor.audit.detail.cells',
		defaultMessage: '{count, plural, one {Painted # cell in {name}} other {Painted # cells in {name}}}',
		description: 'In the editor\'s Audit tab\'s list of what a save changed: how many cells of an area it painted. {name} is the area\'s name'
	},
	links: {
		id: 'editor.audit.detail.links',
		defaultMessage: '{action, select, deleted {{count, plural, one {Deleted # link in {name}} other {Deleted # links in {name}}}} other {{count, plural, one {Added or changed # link in {name}} other {Added or changed # links in {name}}}}}',
		description: 'In the editor\'s Audit tab\'s list of what a save changed: how many links (cells of an area that take characters to another area) it added or changed, or deleted, in one area. {name} is the area\'s name'
	},
	translations: {
		id: 'editor.audit.detail.translations',
		defaultMessage: '{count, plural, one {Added, changed or deleted # translation into {name}} other {Added, changed or deleted # translations into {name}}}',
		description: 'In the editor\'s Audit tab\'s list of what a save changed: how many translations of the universe\'s text (names and descriptions) into one language it saved. {name} is the language\'s name'
	},
	translatorNotes: {
		id: 'editor.audit.detail.translatorNotes',
		defaultMessage: '{count, plural, one {Wrote or deleted # note for translators} other {Wrote or deleted # notes for translators}}',
		description: 'In the editor\'s Audit tab\'s list of what a save changed: how many notes for translators on the universe\'s text it wrote or deleted'
	},
	noTranslation: {
		id: 'editor.audit.detail.noTranslation',
		defaultMessage: '{action, select, added {{count, plural, one {Marked # piece of text as needing no translation} other {Marked # pieces of text as needing no translation}}} other {{count, plural, one {Marked # piece of text as needing translation again} other {Marked # pieces of text as needing translation again}}}}',
		description: 'In the editor\'s Audit tab\'s list of what a save changed: how many pieces of the universe\'s text (names and descriptions) it marked as staying the same in every language, such as proper names, or as needing translation again'
	},
	draft: {
		id: 'editor.audit.detail.draft',
		defaultMessage: '{action, select, added {Started a draft} applied {Applied the draft to the live version} other {Discarded the draft}}',
		description: 'In the editor\'s Audit tab\'s list of what a save changed: the universe\'s draft (a copy of the universe editors change without players seeing it) started, applied so players see it, or thrown away'
	}
});

/**
 * The words the Audit tab shows settings' values with
 */
const VALUE_MESSAGES = defineMessages({
	fieldValue: {
		id: 'editor.audit.fieldValue',
		defaultMessage: '{field}: {value}',
		description: 'In the editor\'s Audit tab\'s list of what a save changed: one setting it changed and the value it changed it to, on its own line under the thing changed, e.g. "Characters get tired and need sleep: yes" or "Group size: 4". {field} is the setting\'s name and {value} its new value'
	},
	yes: {
		id: 'editor.audit.value.yes',
		defaultMessage: 'yes',
		description: 'The value of a checkbox setting a save turned on, in the editor\'s Audit tab\'s list of what a save changed, e.g. "Track ammunition (yes)"'
	},
	no: {
		id: 'editor.audit.value.no',
		defaultMessage: 'no',
		description: 'The value of a checkbox setting a save turned off, in the editor\'s Audit tab\'s list of what a save changed, e.g. "Track ammunition (no)"'
	},
	inherit: {
		id: 'editor.audit.value.inherit',
		defaultMessage: 'inherit',
		description: 'The value of a region\'s or area\'s setting a save left to the regions and areas above it, in the editor\'s Audit tab\'s list of what a save changed, e.g. "Default tile: inherit"'
	},
	tiles: {
		id: 'editor.audit.value.tiles',
		defaultMessage: 'tiles',
		description: 'One of the things a builder may edit, in the value of their permissions in the editor\'s Audit tab\'s list of what a save changed, e.g. "Permissions: tiles and items"'
	},
	items: {
		id: 'editor.audit.value.items',
		defaultMessage: 'items',
		description: 'One of the things a builder may edit, in the value of their permissions in the editor\'s Audit tab\'s list of what a save changed, e.g. "Permissions: tiles and items"'
	},
	mobs: {
		id: 'editor.audit.value.mobs',
		defaultMessage: 'mobs',
		description: 'One of the things a builder may edit, in the value of their permissions in the editor\'s Audit tab\'s list of what a save changed, e.g. "Permissions: tiles and items"'
	},
	none: {
		id: 'editor.audit.value.none',
		defaultMessage: 'none',
		description: 'The value of a setting a save left empty, in the editor\'s Audit tab\'s list of what a save changed: no starting equipment, no starting area of its own, no parent area, no graphic, no languages, no ability modifiers, or no coin names or abbreviations of the universe\'s own'
	},
	characters: {
		id: 'editor.audit.value.characters',
		defaultMessage: '{count, plural, one {# character} other {# characters}}',
		description: 'The value of a universe\'s long description in the editor\'s Audit tab\'s list of what a save changed: how many characters (letters, spaces and so on) the description has, rather than its text, e.g. "Long description (Markdown) (1,204 characters)"'
	},
	faerieTime: {
		id: 'editor.audit.value.faerieTime',
		defaultMessage: '{time}, morning: {morning}',
		description: 'The value of a passage of time setting in the editor\'s Audit tab\'s list of what a save changed, when it is faerie time: {time} is the passage of time (faerie) and {morning} the side of the area that has morning, such as north'
	},
	place: {
		id: 'editor.audit.value.place',
		defaultMessage: '{area} at {column}, {row}',
		description: 'The value of a starting area setting in the editor\'s Audit tab\'s list of what a save changed: where characters start, as the area\'s name and the column and row of the square in it, e.g. "Meadow at 3, 4"'
	},
	itemQuantity: {
		id: 'editor.audit.value.itemQuantity',
		defaultMessage: '{quantity, plural, =1 {{item}} other {{item} x#}}',
		description: 'One item in the value of a starting equipment setting, in the editor\'s Audit tab\'s list of what a save changed: the item\'s name, with how many when there is more than one, e.g. "Arrow x20"'
	},
	raceArea: {
		id: 'editor.audit.value.raceArea',
		defaultMessage: '{race}: {place}',
		description: 'One race in the value of a class\'s Starting area by race setting, in the editor\'s Audit tab\'s list of what a save changed: {race} is the race\'s name and {place} where the class\'s members of that race start, e.g. "Elf: Meadow at 3, 4"'
	},
	abilityModifier: {
		id: 'editor.audit.value.abilityModifier',
		defaultMessage: '{ability} {modifier}',
		description: 'One ability in the value of a race\'s Ability modifiers setting, in the editor\'s Audit tab\'s list of what a save changed: the ability\'s name and how much the race adds to it or takes from it, e.g. "Constitution +2"'
	},
	coin: {
		id: 'editor.audit.value.coin',
		defaultMessage: '{coin}: {text}',
		description: 'One coin in the value of the universe\'s Coin names or Coin abbreviations setting, in the editor\'s Audit tab\'s list of what a save changed: {coin} is the coin\'s name in the rules, as a label, and {text} the name or abbreviation the universe gives it, e.g. "Copper pieces: bronze kits" or "Copper pieces: bk"'
	}
});

/**
 * What one part of a save changed, as the Audit tab lists it, e.g. "Changed item Dagger"
 *
 * @param detail What it changed
 * @param ruleset The universe's ruleset, which names its default tiles, items, races, classes and themes
 * @return The description
 */
export function describeDetail(detail: UniverseEditDetail, ruleset: Ruleset): string
{
	return(t(AUDIT_DETAILS[detail.subject], {
		action: detail.action,
		name: targetName(detail.subject, detail.target, ruleset),
		count: detail.count
	}));
}

/**
 * A setting's name, as the Audit tab and the editor's fields name it
 *
 * @param field The setting
 * @return Its name in the player's language
 */
export function auditFieldName(field: AuditField): string
{
	return(t(AUDIT_FIELD_NAMES[field]));
}

/**
 * One setting a part of a save changed, with the value it changed it to, e.g. "Track ammunition (yes)"
 *
 * @param change The setting and its value
 * @param detail The part of the save that changed it
 * @param ruleset The universe's ruleset
 * @return The description
 */
export function describeFieldChange(change: AuditFieldChange, detail: UniverseEditDetail, ruleset: Ruleset): string
{
	return(t(VALUE_MESSAGES.fieldValue, {
		field: t(AUDIT_FIELD_NAMES[change.field]),
		value: describeValue(change, detail, ruleset)
	}));
}

/**
 * A setting's value in the player's language, without its name, e.g. "yes" or "Meadow at 3, 4"
 *
 * @param change The setting and its value
 * @param detail The part of the save that changed it, whose target names one of the ruleset's defaults given its default name back
 * @param ruleset The universe's ruleset
 * @return The value
 */
export function describeValue(change: AuditFieldChange, detail: UniverseEditDetail, ruleset: Ruleset): string
{
	switch (change.field)
	{
		case 'name':
			return(((change.value === null) ? targetName(detail.subject, { key: (detail.target?.key ?? null), name: null }, ruleset) : change.value));
		case 'shortDescription':
			return(change.value);
		case 'longDescription':
			return(t(VALUE_MESSAGES.characters, { count: change.value }));
		case 'sourceLanguage':
			return(languageName(change.value));
		case 'translationLanguages':
			return(listOrNone(change.value.map((language) => languageName(language))));
		case 'stage':
			return(t(UNIVERSE_STAGE_NAMES[change.value]));
		case 'passageOfTime':
		case 'lobbyPassageOfTime':
			return(((change.value === null) ? t(VALUE_MESSAGES.inherit) : describePassageOfTime(change.value)));
		case 'displayTime':
			return(t(DISPLAY_TIME_NAMES[change.value]));
		case 'startingMoney':
			// The engine's abbreviations, which name the coins whatever the universe has called them since
			return(formatMoney(change.value, ruleset, {}));
		case 'coinNames':
		case 'coinAbbreviations':
		{
			const texts: Partial<Record<Coin, string>> = change.value;

			return(listOrNone(RULESET_COINS[ruleset].flatMap((coin) =>
			{
				const text = texts[coin];

				return(((text === undefined)
					? []
					: [t(VALUE_MESSAGES.coin, {
						coin: capitalized(engineCoinName(coin)),
						text
					})]));
			})));
		}
		case 'startingItems':
			return(listOrNone(change.value.map((entry) => t(VALUE_MESSAGES.itemQuantity, {
				item: itemName(entry.item, ruleset),
				quantity: entry.quantity
			}))));
		case 'startingArea':
		case 'lobbyArea':
			return(((change.value === null) ? t(VALUE_MESSAGES.none) : describePlace(change.value)));
		case 'statMethod':
			return(t(PF1E_STAT_METHOD_NAMES[change.value]));
		case 'role':
			return(t(UNIVERSE_ROLE_NAMES[change.value]));
		case 'languages':
			return(listOrNone(change.value.map((language) => languageName(language))));
		case 'color':
			return(colorToHex(change.value));
		case 'graphic':
			return(describeGraphic(change.value));
		case 'type':
			return(itemTypeName(change.value, ruleset));
		case 'abilityModifiers':
		{
			const modifiers = change.value;

			return(listOrNone(RULESET_ABILITIES[ruleset]
				.filter((ability) => ((modifiers[ability] ?? 0) !== 0))
				.map((ability) => t(VALUE_MESSAGES.abilityModifier, {
					ability: t(ABILITY_NAMES[ruleset][ability]),
					modifier: signedNumber(modifiers[ability] ?? 0)
				}))));
		}
		case 'darkvision':
			return(t(DARKVISION_NAMES[change.value]));
		case 'size':
			return(t(SIZE_NAMES[ruleset][change.value]));
		case 'raceAreas':
			return(listOrNone(change.value.map((entry) => t(VALUE_MESSAGES.raceArea, {
				race: raceName(entry.race, ruleset),
				place: describePlace(entry.place)
			}))));
		case 'primaryAbility':
		case 'keyAbility':
		case 'ability':
			return(t(ABILITY_NAMES[ruleset][change.value]));
		case 'tradition':
			return(t(PF1E_MAGIC_TRADITION_NAMES[change.value]));
		case 'castingStyle':
			return(t(PF1E_CASTING_STYLE_NAMES[change.value]));
		case 'parentArea':
			return((change.value ?? t(VALUE_MESSAGES.none)));
		case 'parents':
		case 'assignments':
			return(listOrNone(change.value));
		case 'permissions':
			return(listOrNone([
				...(change.value.canEditTiles ? [t(VALUE_MESSAGES.tiles)] : []),
				...(change.value.canEditItems ? [t(VALUE_MESSAGES.items)] : []),
				...(change.value.canEditMobs ? [t(VALUE_MESSAGES.mobs)] : [])
			]));
		case 'indoorsOrOutdoors':
			return(((change.value === null) ? t(VALUE_MESSAGES.inherit) : t(AUDIT_FIELD_NAMES[(change.value ? 'indoors' : 'outdoors')])));
		case 'lightLevel':
			return(((change.value === null) ? t(VALUE_MESSAGES.inherit) : t(AREA_LIGHT_LEVEL_NAMES[change.value])));
		case 'defaultTile':
			return(((change.value === null) ? t(VALUE_MESSAGES.inherit) : tileName(change.value, ruleset)));
		case 'enabled':
			return(((change.value === null) ? t(VALUE_MESSAGES.inherit) : t((change.value ? VALUE_MESSAGES.yes : VALUE_MESSAGES.no))));
		case 'lobbyDayHours':
		case 'groupSize':
		case 'customPointBuyBudget':
		case 'abilityPoints':
		case 'visionCost':
		case 'walkSeconds':
		case 'hitPoints':
		case 'hitPointsPerLevel':
		case 'staminaPointsPerLevel':
		case 'mobScale':
			return(new Intl.NumberFormat(currentLocale()).format(change.value));
		case 'requireBuilderDraft':
		case 'requireTwoFactor':
		case 'lobbyNoVisionCost':
		case 'needsSleep':
		case 'coinsHaveWeight':
		case 'tracksAmmo':
		case 'indoors':
		case 'outdoors':
		case 'keepPlaying':
		case 'floatingBonus':
		case 'lightSensitivity':
		case 'isDefault':
		case 'permadeath':
		case 'loopsEastWest':
		case 'loopsNorthSouth':
			return(t((change.value ? VALUE_MESSAGES.yes : VALUE_MESSAGES.no)));
	}
}

/**
 * A list of values, or none for an empty one
 *
 * @param values The values, in the player's language
 * @return The list
 */
function listOrNone(values: readonly string[]): string
{
	return(((values.length === 0) ? t(VALUE_MESSAGES.none) : formatList(values)));
}

/**
 * A passage of time, with where morning is in faerie time
 *
 * @param passage The passage of time
 * @return The description
 */
function describePassageOfTime(passage: AuditPassageOfTime): string
{
	const time = t(((passage.time === 'real_time') ? REAL_TIME_NAME : PASSAGE_OF_TIME_NAMES[passage.time]));

	if (passage.morning === null)
	{
		return(time);
	}

	return(t(VALUE_MESSAGES.faerieTime, {
		time,
		morning: t(FAERIE_MORNING_NAMES[passage.morning])
	}));
}

/**
 * Where characters start
 *
 * @param place The area, by name, and the square's column and row
 * @return The description
 */
function describePlace(place: AuditPlace): string
{
	return(t(VALUE_MESSAGES.place, {
		area: place.area,
		column: place.column,
		row: place.row
	}));
}

/**
 * A tile's graphic: one that ships with the engine, an uploaded tileset by name, or none
 *
 * @param graphic The graphic
 * @return The description
 */
function describeGraphic(graphic: AuditFieldValues['graphic']): string
{
	if (graphic.graphic !== null)
	{
		return(tileGraphicName(graphic.graphic));
	}

	return((graphic.uploaded ?? t(VALUE_MESSAGES.none)));
}

/**
 * The name of what a part of a save changed, in the player's language for one of the ruleset's defaults
 *
 * @param subject What kind of thing it is
 * @param target Its name, and its key for a default
 * @param ruleset The universe's ruleset
 * @return The name
 */
export function targetName(subject: AuditSubject, target: OptionName | null, ruleset: Ruleset): string
{
	if (target === null)
	{
		return('');
	}

	switch (subject)
	{
		case 'editor':
			return(`@${target.name ?? ''}`);
		case 'tile':
			return(tileName(target, ruleset));
		case 'item':
			return(itemName(target, ruleset));
		case 'race':
			return(raceName(target, ruleset));
		case 'class':
			return(className(target, ruleset));
		case 'theme':
			return(themeName(target, ruleset));
		case 'difficultyLevel':
			return(difficultyName(target));
		case 'translations':
			return(languageName(target.name ?? ''));
		default:
			return(target.name ?? '');
	}
}
