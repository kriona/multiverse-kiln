/**
 * Saving the world editor: every change made on its tabs, sent together and saved all or nothing
 *
 * POST EDITOR_UNIVERSES_PATH/:universeId/changes takes a SaveChangesRequest and answers 200 with a
 * SaveChangesPayload once every change is saved. When the server refuses one change it saves none of
 * them, and answers with the refused change's status and a SaveRefusedPayload naming it
 */
import type { DifficultyLevelSettings } from './difficulty.js';
import type { AreaSettingsUpdate, AreaLinkTarget, CellChange, ClassSettings, ErrorPayload, ItemSettings, NewAreaRequest, RaceSettings, ResizeConflict, RulesetSettings, ThemeSettings, TileGraphicUploadRequest, TileSettings, UniverseSettingsUpdate } from './editor.js';
import type { MapBounds } from './maps.js';
import { canEditUniverseSettings, canEditWorld, canManageEditors, type UniverseAccess, type UniverseRole } from './universes.js';

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
 * the universe added or restores one of the ruleset's defaults
 */
type ListChanges<Name extends string, Settings> =
	| { kind: `create${Name}`; ref: NewRef; settings: Settings }
	| { kind: `save${Name}`; id: NumberRef; settings: Settings }
	| { kind: `remove${Name}`; id: NumberRef };

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
 * - universe, ruleset: change the universe's settings, or how it plays under its ruleset
 * - uploadTileGraphic, deleteTileGraphic: upload a tileset, or delete one and its image
 * - tiles: removeTile with replaceWith paints the maps using the tile with that one first
 * - items, races, classes, themes and difficulty levels
 * - createArea, updateArea, deleteArea: an area's settings; the lobby and starting areas can't be deleted
 * - resizeArea: gives an area's map new bounds. Without discard, a resize that would discard painted cells
 *   or links is refused with 409 and a SaveRefusedPayload holding resizeConflict
 * - editCells: up to MAX_CELL_CHANGES cells inside the area's bounds; a cell listed twice takes the later value
 * - saveLink, deleteLink: add or replace a cell's link, or delete it
 */
export type EditorChange =
	| { kind: 'addEditor'; username: string; settings: EditorRoleSettings }
	| { kind: 'saveEditor'; playerId: string; settings: EditorRoleSettings }
	| { kind: 'removeEditor'; playerId: string }
	| { kind: 'universe'; update: UniverseSettingsUpdate }
	| { kind: 'ruleset'; settings: RulesetSettings }
	| { kind: 'uploadTileGraphic'; ref: NewRef; upload: TileGraphicUploadRequest }
	| { kind: 'deleteTileGraphic'; graphicId: string }
	| { kind: 'createTile'; ref: NewRef; settings: TileChangeSettings }
	| { kind: 'saveTile'; id: NumberRef; settings: TileChangeSettings }
	| { kind: 'removeTile'; id: NumberRef; replaceWith: NumberRef | null }
	| ListChanges<'Item', ItemSettings>
	| ListChanges<'Race', RaceSettings>
	| ListChanges<'Class', ClassSettings>
	| ListChanges<'Theme', ThemeSettings>
	| ListChanges<'DifficultyLevel', DifficultyLevelSettings>
	| { kind: 'createArea'; ref: NewRef; area: NewAreaChange }
	| { kind: 'updateArea'; areaId: StringRef; update: AreaChangeUpdate }
	| { kind: 'deleteArea'; areaId: StringRef }
	| { kind: 'resizeArea'; areaId: StringRef; bounds: MapBounds; discard: boolean }
	| { kind: 'editCells'; areaId: StringRef; changes: CellChangeRef[] }
	| { kind: 'saveLink'; areaId: StringRef; column: number; row: number; target: AreaLinkTarget }
	| { kind: 'deleteLink'; areaId: StringRef; column: number; row: number };

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
 */
export type EditorChangeCheck = 'manageEditors' | 'editSettings' | 'editWorld';

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
	deleteLink: 'editWorld'
};

/**
 * Whether a player's role lets them make a change
 *
 * @param change The change
 * @param access The player's role in the universe, and their languages
 * @param playerId The player's ID, since anyone may remove themself
 * @return True when it does
 */
export function mayMakeChange(change: EditorChange, access: UniverseAccess, playerId: string): boolean
{
	switch (EDITOR_CHANGE_CHECKS[change.kind])
	{
		case 'manageEditors':
			return(canManageEditors(access.role) || ((change.kind === 'removeEditor') && (change.playerId === playerId)));

		case 'editSettings':
			return(canEditUniverseSettings(access.role));

		case 'editWorld':
			return(canEditWorld(access.role));
	}
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
 * Whether a reference is to something made earlier in the same save
 *
 * @param ref The reference
 * @return True for a NewRef
 */
export function isNewRef(ref: unknown): ref is NewRef
{
	return((typeof ref === 'string') && ref.startsWith('new:'));
}
