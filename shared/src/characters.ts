/**
 * Characters: the routes for a player's characters in a universe, and what they send and receive (see
 * STRUCTURE-OVERVIEW.md, Create Character)
 *
 * Every route needs a logged-in browser and a universe the player may play:
 * - GET charactersPath(universeId): the player's characters there (CharacterListPayload)
 * - GET charactersPath(universeId)/new: what Create Character offers (NewCharacterOptions), with the
 *   player's saved progress. A universe that rolls ability scores rolls them here, once: the player gets
 *   the same scores until they make a character with them
 * - PUT charactersPath(universeId)/draft: saves the player's progress in Create Character (CharacterDraft)
 * - DELETE charactersPath(universeId)/draft: throws the progress away, to start over. Rolled scores are kept
 * - POST charactersPath(universeId): makes a character (NewCharacterRequest), answering CreatedPayload,
 *   and throws the progress away
 * - GET characterPath(universeId, characterId): one of the player's characters, as their character
 *   sheet shows them (CharacterSheet)
 * - DELETE characterPath(universeId, characterId): deletes the character immediately, or answers 409
 *   while they are in a group
 * - PUT characterPath(universeId, characterId)/deletion: gives the character their last rites, so they
 *   are deleted the site's characterDeletionDays later (see shared/src/siteSettings.ts), answering
 *   CharacterDeletionPayload, or 409 while the site sets it to 0 or they are in a group. Until then they
 *   can be restored but not played
 * - DELETE characterPath(universeId, characterId)/deletion: restores a character given their last rites
 * - POST characterPath(universeId, characterId)/items/discard: discards items the character carries
 *   (CharacterItemsRequest), all of an item when asked for as many as they carry or more, or answers
 *   409 when they don't carry one of them. Discarding more than are unequipped unequips the rest
 *   (unequippedByRemoval())
 * - POST characterPath(universeId, characterId)/items/equip: equips an item the character carries
 *   (EquipRequest), unequipping what was in its slots (planEquip()), or answers 409 when they don't carry
 *   it or it can't be equipped as asked
 * - POST characterPath(universeId, characterId)/items/unequip: unequips an item (UnequipRequest)
 * - POST characterPath(universeId, characterId)/items/give: gives an item the character carries to
 *   another character in their group (GiveItemsRequest), unequipping those given that were equipped, or
 *   answers 409 when the character isn't in a group with them or doesn't carry the item, and 429 when the
 *   player's characters give items in, join or leave the group faster than allowed (each writes a line
 *   in its chat; see shared/src/groups.ts)
 * - POST characterPath(universeId, characterId)/social: wears an item the character carries in a social
 *   slot, or empties it (SocialSlotRequest), or answers 409 when they don't carry it or it doesn't fit
 *   (fitsSocialSlot())
 * - POST characterPath(universeId, characterId)/hidden-slots: hides a slot from the character's avatar, or
 *   shows it again (HiddenSlotRequest)
 * - PUT characterPath(universeId, characterId)/appearance: changes the character's art type and background
 *   (AppearanceRequest), or answers 403 when it changes their body type, which only the universe's
 *   creators can, from the editor's Character List
 *
 * Each change to a character's items, equipment or look is sent to their player's windows
 * (SessionServerMessageType.CharacterItems), and a character given items tells their player's windows
 * who gave them what (SessionServerMessageType.ItemsReceived)
 */
import { AVATAR_PREVIEWS_PATH, AVATARS_PATH } from './avatars/manifest.js';
import { UNIVERSES_PATH } from './constants.js';
import type { EquipHand, EquippedItem, EquipRing } from './equipment.js';
import type { Money, UniverseCoinAbbreviations, UniverseCoinNames } from './money.js';
import { rulesetHasThemes, type Ability, type AbilityScores, type ClassRules, type RaceRules, type Size } from './racesAndClasses.js';
import { isRulebookBarred, type RulebookSettings } from './rulebooks.js';
import type { Pf1eRollMethod, Pf1eStatMethod } from './rulesets/pf1e/statMethods.js';
import type { Sf1eThemeRules } from './rulesets/sf1e/themes.js';
import type { Ruleset } from './universes.js';
import type { Darkvision } from './vision.js';

/**
 * Longest character name, after trimming
 */
export const MAX_CHARACTER_NAME_LENGTH = 40;

/**
 * The path of a universe's character routes
 *
 * @param universeId The universe's ID
 * @return The path
 */
export function charactersPath(universeId: string): string
{
	return(`${UNIVERSES_PATH}/${encodeURIComponent(universeId)}/characters`);
}

/**
 * The path of one of the player's characters
 *
 * @param universeId The universe's ID
 * @param characterId The character's ID
 * @return The path
 */
export function characterPath(universeId: string, characterId: string): string
{
	return(`${charactersPath(universeId)}/${encodeURIComponent(characterId)}`);
}

/**
 * A race's, class's, theme's or item's name: the universe's own, or a default's key that finds its name
 * in DEFAULT_RACE_NAMES, DEFAULT_CLASS_NAMES, DEFAULT_THEME_NAMES or DEFAULT_ITEM_NAMES
 */
export interface OptionName
{
	key: string | null;
	name: string | null;
}

/**
 * Why a character can't play: their race, or their class, is disabled for characters already of it
 * (RaceSettings.keepPlaying and ClassSettings.keepPlaying)
 */
export type CharacterBar = 'race' | 'class';

/**
 * The races and classes whose characters can't play, by the IDs characters hold
 */
export interface BarredOptions
{
	raceIds: ReadonlySet<number>;
	classIds: ReadonlySet<number>;
}

/**
 * Barred options that bar nobody
 */
export const NOTHING_BARRED: BarredOptions = {
	raceIds: new Set(),
	classIds: new Set()
};

/**
 * The races and classes whose characters can't play, from a universe's races and classes
 *
 * @param races The races the universe can use
 * @param classes The classes it can use
 * @param rulebooks The books the universe uses
 * @return Those disabled, or whose book is turned off, without letting the characters already of them
 * keep playing
 */
export function barredOptionsOf(races: readonly BarringOption[], classes: readonly BarringOption[], rulebooks: RulebookSettings): BarredOptions
{
	const barredIds = (options: readonly BarringOption[]): Set<number> => new Set(options
		.filter((option) => ((!option.enabled && !option.keepPlaying) || isRulebookBarred(rulebooks, option.rulebook)))
		.map((option) => option.id));

	return({
		raceIds: barredIds(races),
		classIds: barredIds(classes)
	});
}

/**
 * A race or class, as far as whether it bars its characters goes
 */
export interface BarringOption
{
	id: number;
	enabled: boolean;
	keepPlaying: boolean;

	/**
	 * Its book, or null for one the universe added
	 */
	rulebook: string | null;
}

/**
 * Why a character can't play, if anything stops them
 *
 * @param character The character's race and class
 * @param barred The races and classes whose characters can't play
 * @return Their race when it bars them (even when their class does too), then their class; null when
 * neither does
 */
export function characterBar(character: { raceId: number; classId: number }, barred: BarredOptions): CharacterBar | null
{
	if (barred.raceIds.has(character.raceId))
	{
		return('race');
	}

	return((barred.classIds.has(character.classId) ? 'class' : null));
}

/**
 * The path of a character's avatar, drawn as their look is now
 *
 * @param characterId The character's ID
 * @param avatarHash The hash of their look now, which the server sends with the character (and the rooms
 * with each member), so browsers keep it for good; null when it isn't known, for an address browsers
 * check with the server each time they load it
 * @return The path, on the server
 */
export function avatarPath(characterId: string, avatarHash: string | null): string
{
	const path = `${AVATARS_PATH}/${encodeURIComponent(characterId)}.png`;

	return(((avatarHash === null) ? path : `${path}?look=${encodeURIComponent(avatarHash)}`));
}

/**
 * The path of Create Character's preview of a base over a background
 *
 * @param artType The art type
 * @param ruleset The ruleset
 * @param raceKey The key of the default race the race is drawn as
 * @param bodyType The body type
 * @param background The background
 * @return The path, on the server
 */
export function avatarPreviewPath(artType: string, ruleset: Ruleset, raceKey: string, bodyType: string, background: string): string
{
	return(`${AVATAR_PREVIEWS_PATH}/${encodeURIComponent(artType)}/${ruleset}/${encodeURIComponent(`${raceKey}-${bodyType}-${background}`)}.png`);
}

/**
 * One of the player's characters, as the lobby lists them
 */
export interface CharacterSummary
{
	id: string;
	name: string;
	race: OptionName;
	characterClass: OptionName;

	/**
	 * The hash of the character's avatar now, to load it with (avatarPath()); null when they have none
	 */
	avatarHash: string | null;

	/**
	 * When the character is deleted (an ISO 8601 time), once given their last rites; null otherwise.
	 * Until then they can be restored but not played
	 */
	deleteAt: string | null;

	/**
	 * What stops the character playing while the universe's creators have disabled their race or class
	 * for characters already of it, or null when nothing does
	 */
	barredBy: CharacterBar | null;

	/**
	 * The group the character is in, or null when they are in none. A character in a group plays there,
	 * not in the lobby
	 */
	groupId: string | null;
}

/**
 * Response of PUT characterPath(universeId, characterId)/deletion
 */
export interface CharacterDeletionPayload
{
	/**
	 * When the character is deleted, as an ISO 8601 time
	 */
	deleteAt: string;
}

/**
 * Response of GET charactersPath(universeId): the player's characters there, oldest first
 */
export interface CharacterListPayload
{
	ruleset: Ruleset;
	characters: CharacterSummary[];

	/**
	 * The character the player played or made most recently, leaving out those given their last rites
	 * and those barred from playing; null when they have none. Entering the universe plays them, in their
	 * group if they are in one
	 */
	lastPlayedId: string | null;
}

/**
 * A race new characters can be
 */
export interface CharacterRaceOption extends OptionName
{
	id: number;

	/**
	 * The universe's description of the race, or null for a default race's in DEFAULT_RACE_DESCRIPTIONS,
	 * found by its key, or none
	 */
	description: string | null;

	rules: RaceRules;

	/**
	 * The key of the default race its characters' avatars are drawn as: its own, or the one it "looks
	 * like"; null when it has no avatar. Its body types and art types are in the avatar manifest
	 * (raceBodyTypes(), artTypesFor())
	 */
	avatarKey: string | null;
}

/**
 * A class new characters can be
 */
export interface CharacterClassOption extends OptionName
{
	id: number;

	/**
	 * The universe's description of the class, or null for a default class's in
	 * DEFAULT_CLASS_DESCRIPTIONS, found by its key, or none
	 */
	description: string | null;

	rules: ClassRules;
}

/**
 * A theme new characters can have, in a ruleset with themes
 */
export interface CharacterThemeOption extends OptionName
{
	id: number;

	/**
	 * The universe's description of the theme, or null for a default theme's in
	 * DEFAULT_THEME_DESCRIPTIONS, found by its key, or none
	 */
	description: string | null;

	rules: Sf1eThemeRules;
}

/**
 * How a new character gets their ability scores
 *
 * - roll (PF1E): six rolled scores to arrange among the abilities
 * - pointBuy (PF1E): points to buy scores with, scores below 10 giving some back
 * - abilityPoints (SF1E): points that each raise a score of 10 by 1 (shared/src/rulesets/sf1e/abilityPoints.ts)
 */
export type AbilityOptions =
	| { kind: 'roll'; statMethod: Pf1eRollMethod; rolls: number[] }
	| { kind: 'pointBuy'; statMethod: Exclude<Pf1eStatMethod, Pf1eRollMethod>; budget: number }
	| { kind: 'abilityPoints'; points: number };

/**
 * The steps of Create Character, in order. Theme is only in rulesets with themes (characterSteps())
 */
export const CHARACTER_STEPS = [
	'name',
	'race',
	'appearance',
	'class',
	'theme',
	'abilities',
	'review'
] as const;

export type CharacterStep = typeof CHARACTER_STEPS[number];

/**
 * The steps of Create Character in a ruleset, in order
 *
 * @param ruleset The universe's ruleset
 * @return The steps
 */
export function characterSteps(ruleset: Ruleset): CharacterStep[]
{
	return(CHARACTER_STEPS.filter((step) => ((step !== 'theme') || rulesetHasThemes(ruleset))));
}

/**
 * A player's progress in Create Character, kept on the server until they make the character or start
 * over. Nothing in it is checked against the universe until the character is made: a race may since
 * have been disabled, or the scores rolled again
 */
export interface CharacterDraft
{
	/**
	 * The step the player was on
	 */
	step: CharacterStep;

	/**
	 * Up to MAX_CHARACTER_NAME_LENGTH characters; may be empty
	 */
	name: string;

	raceId: number | null;
	classId: number | null;

	/**
	 * The theme chosen, in a ruleset with themes
	 */
	themeId: number | null;

	/**
	 * Each ability's score before racial modifiers, as the player arranged or bought them, or null
	 * before they have changed any
	 */
	baseScores: AbilityScores | null;

	floatingAbility: Ability | null;

	/**
	 * How the character's avatar is drawn, or null before the player has chosen
	 */
	appearance: CharacterAppearance | null;
}

/**
 * How a character's avatar is drawn: their body type (BODY_TYPES), art type (ART_TYPES) and background
 * (BACKGROUNDS)
 */
export interface CharacterAppearance
{
	bodyType: string;
	artType: string;
	background: string;
}

/**
 * Response of GET charactersPath(universeId)/new: what Create Character offers
 */
export interface NewCharacterOptions
{
	/**
	 * The universe's name, for the page's title
	 */
	universeName: string;

	ruleset: Ruleset;
	abilities: AbilityOptions;

	/**
	 * The enabled races, by ID
	 */
	races: CharacterRaceOption[];

	/**
	 * The enabled classes, by ID
	 */
	classes: CharacterClassOption[];

	/**
	 * The enabled themes, by ID; empty for a ruleset without themes
	 */
	themes: CharacterThemeOption[];

	/**
	 * How many characters the player already has in the universe
	 */
	characterCount: number;

	/**
	 * Most characters the player may have in the universe (the site's charactersPerUniverse)
	 */
	characterLimit: number;

	/**
	 * The player's saved progress, or null when they haven't started one
	 */
	draft: CharacterDraft | null;
}

/**
 * Body of POST charactersPath(universeId): the new character
 */
export interface NewCharacterRequest
{
	name: string;

	/**
	 * An enabled race's ID
	 */
	raceId: number;

	/**
	 * An enabled class's ID
	 */
	classId: number;

	/**
	 * An enabled theme's ID, in a ruleset with themes; null otherwise
	 */
	themeId: number | null;

	/**
	 * Each ability's score before racial modifiers: the rolled scores in the order the player chose, the
	 * scores the player bought, or 10 plus the ability points spent on each. The server checks them
	 * against its rolls or the points the player has
	 */
	baseScores: AbilityScores;

	/**
	 * The ability that gets the ruleset's FLOATING_ABILITY_BONUSES, for a race with a floating bonus;
	 * null otherwise
	 */
	floatingAbility: Ability | null;

	/**
	 * How their avatar is drawn. The body type must be one of the race's (raceBodyTypes()); the player
	 * can't change it once the character is made
	 */
	appearance: CharacterAppearance;
}

/**
 * An item a character carries, named the way the universe names it
 */
export interface CharacterSheetItem extends OptionName
{
	id: number;

	/**
	 * The universe's description of the item, or null for a default item's in DEFAULT_ITEM_DESCRIPTIONS,
	 * found by its key, or none
	 */
	description: string | null;

	/**
	 * The item's category, a key of the ruleset's ITEM_KINDS
	 */
	category: string;

	/**
	 * The item's types, keys of the ruleset's ITEM_KINDS, in the order the ruleset lists them
	 */
	types: string[];

	/**
	 * Where the item equips: one of itemEquipsChoices()
	 */
	equips: string;

	/**
	 * How many the character carries, the equipped ones included
	 */
	quantity: number;
}

/**
 * Another character in the group of a character on their sheet, who can be given items
 */
export interface CharacterSheetGroupMember
{
	characterId: string;
	name: string;
	race: OptionName;
	characterClass: OptionName;

	/**
	 * The hash of their avatar now (avatarPath()), or null when they have none
	 */
	avatarHash: string | null;
}

/**
 * The group a character on their sheet is in
 */
export interface CharacterSheetGroup
{
	groupId: string;

	/**
	 * Whether the character is the group's anchor being, whose leaving disbands it
	 */
	isAnchor: boolean;

	/**
	 * The group's other characters, by name
	 */
	members: CharacterSheetGroupMember[];
}

/**
 * Response of GET characterPath(universeId, characterId): one of the player's characters, as their
 * character sheet shows them
 */
export interface CharacterSheet
{
	ruleset: Ruleset;
	id: string;
	name: string;
	race: OptionName;
	characterClass: OptionName;

	/**
	 * When the character is deleted (an ISO 8601 time), once given their last rites; null otherwise
	 */
	deleteAt: string | null;

	/**
	 * How many days last rites wait before deleting a character (the site's characterDeletionDays);
	 * 0 when last rites are turned off
	 */
	deletionDays: number;

	/**
	 * The group the character is in, who can't be deleted until they leave it, or null when they are in none
	 */
	group: CharacterSheetGroup | null;

	/**
	 * What stops the character playing while the universe's creators have disabled their race or class
	 * for characters already of it, or null when nothing does. Such a character in a group can leave it
	 * from their sheet, since they can't play there to leave it
	 */
	barredBy: CharacterBar | null;

	/**
	 * The race's size, darkvision and light sensitivity, as the universe sets them now
	 */
	size: Size;
	darkvision: Darkvision;
	lightSensitivity: boolean;

	/**
	 * The character's theme, in a ruleset with themes; null otherwise
	 */
	theme: OptionName | null;

	/**
	 * Hit points and stamina points, as the race and class set them now, in a ruleset that has them
	 * (SF1E); null otherwise
	 */
	hitPoints: number | null;
	staminaPoints: number | null;

	/**
	 * The ability scores, with the race's modifiers and theme's bonus added
	 */
	abilityScores: AbilityScores;

	money: Money;

	/**
	 * The names and abbreviations the universe gives its coins, in the player's language; the coins
	 * left out have the engine's
	 */
	coinNames: UniverseCoinNames;
	coinAbbreviations: UniverseCoinAbbreviations;

	/**
	 * The items the character carries, by ID
	 */
	items: CharacterSheetItem[];

	/**
	 * Whether the character's race has a tail, as the universe sets it now, which gives them the tail slot
	 * (characterSlots())
	 */
	hasTail: boolean;

	/**
	 * What the character has equipped, by slot in the order the sheet lists them. Each is one of the items
	 */
	equipment: EquippedItem[];

	/**
	 * What the character wears in their social slots, only for how it looks, by slot in the order the
	 * sheet lists them (socialSlots()). Each is one of the items
	 */
	socialEquipment: EquippedItem[];

	/**
	 * The slots their avatar draws empty
	 */
	hiddenSlots: string[];

	/**
	 * How their avatar is drawn, as chosen; it may fall back to another art type or body type
	 * (avatarPicture())
	 */
	appearance: CharacterAppearance;

	/**
	 * The key of the default race their avatar is drawn as (CharacterRaceOption.avatarKey), for the
	 * Appearance dialog's choices; null when their race has no avatar
	 */
	avatarKey: string | null;

	/**
	 * The hash of their avatar now, to load it with (avatarPath()); null when they have none
	 */
	avatarHash: string | null;
}

/**
 * Body of POST characterPath(universeId, characterId)/items/equip, and of the editor's .../items/equip
 */
export interface EquipRequest
{
	/**
	 * An item the character carries
	 */
	itemId: number;

	/**
	 * The hands to hold it in (handChoices()); null for an item that is worn, and allowed for one held
	 * in two hands
	 */
	hand: EquipHand | null;

	/**
	 * The ring slot to put a ring in (ringChoices()), needed when both are full; null for a free one, and
	 * for an item that isn't a ring
	 */
	ring: EquipRing | null;
}

/**
 * Body of POST characterPath(universeId, characterId)/items/unequip, and of the editor's .../items/unequip
 */
export interface UnequipRequest
{
	itemId: number;

	/**
	 * The slot to unequip it from, or null for everywhere it is equipped
	 */
	slot: string | null;
}

/**
 * Body of POST characterPath(universeId, characterId)/social, and of the editor's .../social
 */
export interface SocialSlotRequest
{
	/**
	 * One of the ruleset's social slots (socialSlots())
	 */
	slot: string;

	/**
	 * An item the character carries that fits the slot (fitsSocialSlot()), or null to empty it
	 */
	itemId: number | null;
}

/**
 * Body of POST characterPath(universeId, characterId)/hidden-slots, and of the editor's .../hidden-slots
 */
export interface HiddenSlotRequest
{
	/**
	 * One of the ruleset's slots (equipmentSlots())
	 */
	slot: string;

	/**
	 * Whether the avatar draws it empty
	 */
	hidden: boolean;
}

/**
 * Body of PUT characterPath(universeId, characterId)/appearance, and of the editor's .../appearance. The
 * player's route refuses a body type other than the character's own
 */
export type AppearanceRequest = CharacterAppearance;

/**
 * Body of POST characterPath(universeId, characterId)/items/give, and of the editor's .../items/give
 */
export interface GiveItemsRequest
{
	/**
	 * Another character in the same group, the player's own included
	 */
	characterId: string;

	/**
	 * An item the character carries (an EditorItem's ID)
	 */
	itemId: number;

	/**
	 * How many of it to give; all of it when asked for as many as the character carries or more
	 */
	quantity: number;
}
