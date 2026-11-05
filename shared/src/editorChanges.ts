/**
 * Saving the world editor: every change made on its tabs, sent together and saved all or nothing
 *
 * POST EDITOR_UNIVERSES_PATH/:universeId/changes takes a SaveChangesRequest and answers 200 with a
 * SaveChangesPayload once every change is saved. When the server refuses one change it saves none of
 * them, and answers with the refused change's status and a SaveRefusedPayload naming it
 *
 * POST EDITOR_UNIVERSES_PATH/:universeId/changes/impact takes the same SaveChangesRequest and saves
 * nothing: it answers a SaveImpactPayload, what the changes would do to players, so the editor can ask
 * what should happen before it saves (see Disabling things players are using in STRUCTURE-OVERVIEW.md)
 */
import type { OptionName } from './characters.js';
import type { DifficultyLevelSettings } from './difficulty.js';
import type { AreaSettingsUpdate, AreaLinkTarget, CellChange, ClassSettings, ErrorPayload, ItemSettings, NewAreaRequest, RaceSettings, ResizeConflict, RulesetSettings, ThemeSettings, TileGraphicUploadRequest, TileSettings, UniverseSettingsUpdate } from './editor.js';
import type { MapBounds } from './maps.js';
import { canEditAtEndOfTime, canEditUniverseSettings, canEditWorld, canManageEditors, canManageVersions, canMarkNoTranslation, canTranslate, type EditorAccess, type UniverseRole, type UniverseStage } from './universes.js';
import type { UniverseTextRef } from './universeText.js';

/**
 * Most changes one save can hold
 */
export const MAX_CHANGES_PER_SAVE = 5000;

/**
 * How a change refers to something an earlier change in the same save makes: the ref its create change
 * gave it. The server puts the ID it was saved with in its place
 */
export type NewRef = `new:${string}`;

/**
 * Something saved before, by its ID, or something made earlier in the same save, by its ref
 */
export type NumberRef = number | NewRef;

/**
 * An area or uploaded tile graphic saved before, by its ID, or one made earlier in the same save, by its ref
 */
export type StringRef = string;

/**
 * A tile's settings in a save, whose uploaded graphic may be one uploaded earlier in the same save
 */
export type TileChangeSettings = Omit<TileSettings, 'uploadedGraphicId'> & { uploadedGraphicId: StringRef | null };

/**
 * A new area's settings in a save, whose default tile and parent may be made earlier in the same save
 */
export type NewAreaChange = Omit<NewAreaRequest, 'defaultTileId'> & { defaultTileId?: NumberRef };

/**
 * Changed area settings in a save, whose default tile and parent may be made earlier in the same save
 */
export type AreaChangeUpdate = Omit<AreaSettingsUpdate, 'defaultTileId'> & { defaultTileId?: NumberRef };

/**
 * One cell to change in a save, whose tile may be made earlier in the same save
 */
export type CellChangeRef = [column: CellChange[0], row: CellChange[1], value: NumberRef];

/**
 * One change to a list of things the universe can use: adds one, changes one's settings, or deletes one
 * the universe added or restores one of the ruleset's defaults. A save change may carry more, SaveExtra
 */
type ListChanges<Name extends string, Settings, SaveExtra = unknown> =
	| { kind: `create${Name}`; ref: NewRef; settings: Settings }
	| ({ kind: `save${Name}`; id: NumberRef; settings: Settings } & SaveExtra)
	| { kind: `remove${Name}`; id: NumberRef };

/**
 * What disabling an item does to the characters carrying it
 *
 * - keep: they keep using it, and no new copies are made (new characters aren't given a disabled item)
 * - remove: it is taken from them, hidden rather than deleted, so enabling the item again gives it back
 */
export const ITEM_DISABLINGS = ['keep', 'remove'] as const;

export type ItemDisabling = typeof ITEM_DISABLINGS[number];

/**
 * Where disabling an area sends the characters in it, playing or saved there by a group no one is playing
 *
 * - parent: to its parent area, or the nearest enabled area it is inside, onto the cell of a link there
 *   leading back in when there is one and its center otherwise; to the start area when it is inside no
 *   enabled area
 * - start: to where they start: the lobby area in the lobby, and the group's starting area in a group
 */
export const AREA_EVACUATIONS = ['parent', 'start'] as const;

export type AreaEvacuation = typeof AREA_EVACUATIONS[number];

/**
 * What lowering the universe's group size does to groups larger than the new size
 *
 * - keep: they keep playing; only new members are refused until they are small enough
 * - disband: they are disbanded, as if their anchor being had left
 * - removeMembers: members are taken out, those who joined most recently first and never the anchor
 *   being, until the group fits
 */
export const GROUP_SIZE_LOWERINGS = ['keep', 'disband', 'removeMembers'] as const;

export type GroupSizeLowering = typeof GROUP_SIZE_LOWERINGS[number];

/**
 * What applying a universe's draft does to the players using what it disables or deletes (see Universe
 * versions in STRUCTURE-OVERVIEW.md), each by the live ID of what it is about, written as text, as the
 * editor's impact dialog chose. Something left out takes the gentlest choice, as a change sent without a
 * choice does: keep playing, keep the item, keep the groups, and back to the start area
 */
export interface DraftApplyChoices
{
	/**
	 * Whether each race's characters keep playing while it is disabled
	 */
	races: Record<string, boolean>;

	/**
	 * Whether each class's characters keep playing while it is disabled
	 */
	classes: Record<string, boolean>;

	items: Record<string, ItemDisabling>;
	areas: Record<string, AreaEvacuation>;
	largerGroups?: GroupSizeLowering;
}

/**
 * An editor's role and languages in a save. languages is for translators only, and empty for other roles
 */
export interface EditorRoleSettings
{
	role: UniverseRole;
	languages: string[];
}

/**
 * One change in a save. Each kind needs the check EDITOR_CHANGE_CHECKS names for it (see
 * mayMakeChange()). Themes are only for rulesets with them (rulesetHasThemes())
 *
 * - addEditor, saveEditor, removeEditor: give a player a role, by username, change an editor's role, or
 *   take it away. Anyone may remove themself, leaving the universe; a save that would leave the universe
 *   without a creator is refused
 * - universe, ruleset: change the universe's settings, or how it plays under its ruleset. A universe
 *   change lowering the group size says what happens to larger groups with largerGroups, keep when left out
 * - uploadTileGraphic, deleteTileGraphic: upload a tileset, or delete one and its image
 * - tiles: removeTile with replaceWith paints the maps using the tile with that one first
 * - items, races, classes, themes and difficulty levels. A saveItem disabling an item says what happens to
 *   the characters carrying it with whenDisabled, keep when left out. Enabling an item again, or restoring
 *   a default item, gives back the copies taken. A race or class says in its settings (keepPlaying)
 *   whether its characters may play while it is disabled
 * - createArea, updateArea, deleteArea: an area's settings; the lobby and starting areas can't be deleted.
 *   An updateArea disabling an area says where the characters in it go with moveTo, start when left out
 * - resizeArea: gives an area's map new bounds. Without discard, a resize that would discard painted cells
 *   or links is refused with 409 and a SaveRefusedPayload holding resizeConflict
 * - editCells: up to MAX_CELL_CHANGES cells inside the area's bounds; a cell listed twice takes the later value
 * - saveLink, deleteLink: add or replace a cell's link, or delete it
 * - saveTranslation: translate a piece of universe text into one of the universe's translation
 *   languages, keeping the hash of the source text the translator saw (sourceTextHash()), or with null
 *   delete the translation. Saving the translation it has with the current hash confirms it is still
 *   correct
 * - saveTranslatorNote: write the note for translators on a piece of universe text, or with null delete it
 * - saveNoTranslation: mark a piece of universe text as needing no translation in any language, such as
 *   a proper name, so players see it as written, or as needing one again. Its translations are kept
 * - startDraft, applyDraft, discardDraft: start the universe's draft as a copy of its live version, apply
 *   it to the live version for good, or delete it (see Universe versions in STRUCTURE-OVERVIEW.md).
 *   startDraft comes after every other change in a save, and applyDraft and discardDraft are the only
 *   change in theirs; the server refuses a save that puts them anywhere else. applyDraft carries what
 *   happens to the players using what the draft disables or deletes
 */
export type EditorChange =
	| { kind: 'addEditor'; username: string; settings: EditorRoleSettings }
	| { kind: 'saveEditor'; playerId: string; settings: EditorRoleSettings }
	| { kind: 'removeEditor'; playerId: string }
	| { kind: 'universe'; update: UniverseSettingsUpdate; largerGroups?: GroupSizeLowering }
	| { kind: 'ruleset'; settings: RulesetSettings }
	| { kind: 'uploadTileGraphic'; ref: NewRef; upload: TileGraphicUploadRequest }
	| { kind: 'deleteTileGraphic'; graphicId: string }
	| { kind: 'createTile'; ref: NewRef; settings: TileChangeSettings }
	| { kind: 'saveTile'; id: NumberRef; settings: TileChangeSettings }
	| { kind: 'removeTile'; id: NumberRef; replaceWith: NumberRef | null }
	| ListChanges<'Item', ItemSettings, { whenDisabled?: ItemDisabling }>
	| ListChanges<'Race', RaceSettings>
	| ListChanges<'Class', ClassSettings>
	| ListChanges<'Theme', ThemeSettings>
	| ListChanges<'DifficultyLevel', DifficultyLevelSettings>
	| { kind: 'createArea'; ref: NewRef; area: NewAreaChange }
	| { kind: 'updateArea'; areaId: StringRef; update: AreaChangeUpdate; moveTo?: AreaEvacuation }
	| { kind: 'deleteArea'; areaId: StringRef }
	| { kind: 'resizeArea'; areaId: StringRef; bounds: MapBounds; discard: boolean }
	| { kind: 'editCells'; areaId: StringRef; changes: CellChangeRef[] }
	| { kind: 'saveLink'; areaId: StringRef; column: number; row: number; target: AreaLinkTarget }
	| { kind: 'deleteLink'; areaId: StringRef; column: number; row: number }
	| { kind: 'saveTranslation'; text: UniverseTextRef; language: string; translation: string | null; sourceHash: string }
	| { kind: 'saveTranslatorNote'; text: UniverseTextRef; note: string | null }
	| { kind: 'saveNoTranslation'; text: UniverseTextRef; noTranslation: boolean }
	| { kind: 'startDraft' }
	| { kind: 'applyDraft'; choices: DraftApplyChoices }
	| { kind: 'discardDraft' };

/**
 * Every kind of change
 */
export type EditorChangeKind = EditorChange['kind'];

/**
 * What a change needs the player's role to allow
 *
 * - manageEditors: canManageEditors(), except a player removing themself
 * - editSettings: canEditUniverseSettings()
 * - editWorld: canEditWorld()
 * - translate: canTranslate() into the change's language
 * - markNoTranslation: canMarkNoTranslation()
 * - manageVersions: canManageVersions()
 */
export type EditorChangeCheck = 'manageEditors' | 'editSettings' | 'editWorld' | 'translate' | 'markNoTranslation' | 'manageVersions';

/**
 * The check each kind of change needs
 */
export const EDITOR_CHANGE_CHECKS: Readonly<Record<EditorChangeKind, EditorChangeCheck>> = {
	addEditor: 'manageEditors',
	saveEditor: 'manageEditors',
	removeEditor: 'manageEditors',
	universe: 'editSettings',
	ruleset: 'editSettings',
	uploadTileGraphic: 'editWorld',
	deleteTileGraphic: 'editWorld',
	createTile: 'editWorld',
	saveTile: 'editWorld',
	removeTile: 'editWorld',
	createItem: 'editWorld',
	saveItem: 'editWorld',
	removeItem: 'editWorld',
	createRace: 'editSettings',
	saveRace: 'editSettings',
	removeRace: 'editSettings',
	createClass: 'editSettings',
	saveClass: 'editSettings',
	removeClass: 'editSettings',
	createTheme: 'editSettings',
	saveTheme: 'editSettings',
	removeTheme: 'editSettings',
	createDifficultyLevel: 'editSettings',
	saveDifficultyLevel: 'editSettings',
	removeDifficultyLevel: 'editSettings',
	createArea: 'editWorld',
	updateArea: 'editWorld',
	deleteArea: 'editWorld',
	resizeArea: 'editWorld',
	editCells: 'editWorld',
	saveLink: 'editWorld',
	deleteLink: 'editWorld',
	saveTranslation: 'translate',
	saveTranslatorNote: 'editWorld',
	saveNoTranslation: 'markNoTranslation',
	startDraft: 'manageVersions',
	applyDraft: 'manageVersions',
	discardDraft: 'manageVersions'
};

/**
 * Whether a player's role lets them make a change
 *
 * @param change The change
 * @param access The player's role in the editor, and their languages
 * @param playerId The player's ID, since anyone may remove themself
 * @return True when it does
 */
export function mayMakeChange(change: EditorChange, access: EditorAccess, playerId: string): boolean
{
	switch (EDITOR_CHANGE_CHECKS[change.kind])
	{
		case 'manageEditors':
			return(canManageEditors(access.role) || ((change.kind === 'removeEditor') && (change.playerId === playerId)));

		case 'editSettings':
			return(canEditUniverseSettings(access.role));

		case 'editWorld':
			return(canEditWorld(access.role));

		case 'translate':
			return((change.kind === 'saveTranslation') && canTranslate(access, change.language));

		case 'markNoTranslation':
			return(canMarkNoTranslation(access));

		case 'manageVersions':
			return(canManageVersions(access.role));
	}
}

/**
 * Whether a save may be made in the universe's stage: at the end of time only its creators (and server
 * admins with ADMIN_ROLE) may change it, though anyone may still leave it
 *
 * @param changes The save's changes
 * @param stage The universe's stage
 * @param access The player's role in the editor, and their languages
 * @param playerId The player's ID
 * @return True when it may
 */
export function maySaveInStage(changes: readonly EditorChange[], stage: UniverseStage, access: EditorAccess, playerId: string): boolean
{
	if ((stage !== 'end_of_time') || canEditAtEndOfTime(access.role))
	{
		return(true);
	}

	return(changes.every((change) => ((change.kind === 'removeEditor') && (change.playerId === playerId))));
}

/**
 * Body of POST EDITOR_UNIVERSES_PATH/:universeId/changes: up to MAX_CHANGES_PER_SAVE changes, saved in
 * the order listed, so each one meets the universe as the ones before it left it
 */
export interface SaveChangesRequest
{
	changes: EditorChange[];
}

/**
 * Response of POST EDITOR_UNIVERSES_PATH/:universeId/changes: the ID each thing made was saved with, by its ref
 */
export interface SaveChangesPayload
{
	ids: Record<NewRef, number | string>;
}

/**
 * Body of the answer to a save the server refused, which saved nothing
 */
export interface SaveRefusedPayload extends ErrorPayload
{
	/**
	 * Which change was refused, by its place in the request's list, or null when the request as a whole was
	 */
	changeIndex: number | null;

	/**
	 * For a resizeArea refused because it would discard something: what it would discard
	 */
	resizeConflict?: ResizeConflict;
}

/**
 * What one change in a save would do to players, compared with the universe as it is saved now. An
 * applyDraft change has one for each thing the draft disables or deletes that players are using, each
 * naming that thing by its live ID
 *
 * - race, class: it disables a race or class that characters (not past their last rites) are; name is
 *   the race's or class's
 * - item: it disables an item characters carry
 * - area: it disables an area characters are in, playing there or saved there by their group, and
 *   hasParent says whether it is inside an enabled area they could go to
 * - groupSize: it lowers the group size below the size of some groups
 */
export type ChangeImpact =
	| { changeIndex: number; kind: 'race' | 'class' | 'item'; id: number; name: OptionName; characters: number }
	| { changeIndex: number; kind: 'area'; id: string; name: string; characters: number; hasParent: boolean }
	| { changeIndex: number; kind: 'groupSize'; groupSize: number; groups: number };

/**
 * Response of POST EDITOR_UNIVERSES_PATH/:universeId/changes/impact: each change that would affect
 * players, in the order of the save's changes; empty when none would
 */
export interface SaveImpactPayload
{
	impacts: ChangeImpact[];
}

/**
 * Whether a reference is to something made earlier in the same save
 *
 * @param ref The reference
 * @return True for a NewRef
 */
export function isNewRef(ref: unknown): ref is NewRef
{
	return((typeof ref === 'string') && ref.startsWith('new:'));
}
