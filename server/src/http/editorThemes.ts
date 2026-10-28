/**
 * The world editor's route for a universe's themes (listed in shared/src/editor.ts), in a ruleset with
 * themes, and saving changes to them (see editorChanges.ts). A universe whose ruleset has none answers 404
 */
import type express from 'express';
import type { NextFunction, Request, Response } from 'express';
import { defineMessages, MAX_CUSTOM_THEMES, rulesetHasThemes, type NewRef, type NumberRef, type ThemeListPayload, type ThemeSettings } from '@multiverse-kiln/shared';

import { hasCharactersOfTheme } from '../db/characterRepo.js';
import { countCustomThemes, createCustomTheme, deleteCustomTheme, findThemeKind, loadEditorThemes, restoreDefaultTheme, saveEditedDefaultTheme, updateCustomTheme } from '../db/themeRepo.js';
import { universeContextOf } from './editorAccess.js';
import { recordRef, refuse, resolveNumberRef, type ChangeContext } from './editorChangeContext.js';
import { sendError } from './errors.js';

/**
 * Reasons themes are refused in more than one place (see shared/src/localization.ts)
 */
const messages = defineMessages({
	noThemes: {
		id: 'error.noThemes',
		defaultMessage: 'This universe\'s ruleset has no themes.',
		description: 'Why a request about themes (character backgrounds, such as ace pilot or scholar) failed: the universe\'s game rules don\'t use them'
	},
	noSuchTheme: {
		id: 'error.noSuchTheme',
		defaultMessage: 'The theme doesn\'t exist.',
		description: 'Why a request about a theme (a character background, such as ace pilot or scholar) failed: it was deleted, perhaps by another editor'
	},
	themeNeedsName: {
		id: 'error.themeNeedsName',
		defaultMessage: 'A theme needs a name.',
		description: 'Why a theme the universe added couldn\'t be saved: its name was left out'
	},
	noEnabledTheme: {
		id: 'error.noEnabledTheme',
		defaultMessage: 'A universe needs at least one enabled theme, so new characters have one to choose.',
		description: 'Why a theme couldn\'t be disabled or deleted: it is the last theme new characters can choose'
	},
	themeInUse: {
		id: 'error.themeInUse',
		defaultMessage: 'Characters have this theme, so it can\'t be deleted. Disable it instead.',
		description: 'Why a theme the universe added couldn\'t be deleted: players have made characters with it; disabling it only stops new characters choosing it'
	}
});

/**
 * Adds the theme route to a universe's router
 *
 * @param router The router for routes under /:universeId
 */
export function addThemeRoutes(router: express.Router): void
{
	router.use('/themes', requireThemes);
	router.get('/themes', listThemes);
}

/**
 * Middleware that answers 404 unless the universe's ruleset has themes
 *
 * @param request The request
 * @param response The response
 * @param next Continues to the next handler
 */
function requireThemes(request: Request, response: Response, next: NextFunction): void
{
	if (!rulesetHasThemes(universeContextOf(request).universe.ruleset))
	{
		sendError(response, 404, messages.noThemes);
		return;
	}

	next();
}

/**
 * GET /:universeId/themes: every theme the universe can use
 *
 * @param request The request
 * @param response The response
 */
async function listThemes(request: Request, response: Response): Promise<void>
{
	const { universe } = universeContextOf(request);
	const payload: ThemeListPayload = { themes: await loadEditorThemes(universe.id, universe.ruleset) };

	response.json(payload);
}

/**
 * Refuses a change to themes in a universe whose ruleset has none
 *
 * @param context The save
 */
function requireThemesFor(context: ChangeContext): void
{
	if (!rulesetHasThemes(context.universe.ruleset))
	{
		refuse(404, messages.noThemes);
	}
}

/**
 * Adds a theme to the universe
 *
 * @param context The save
 * @param ref The theme's ref
 * @param settings Its settings
 */
export async function createThemeChange(context: ChangeContext, ref: NewRef, settings: ThemeSettings): Promise<void>
{
	const { universe, transaction } = context;
	const { name } = settings;

	requireThemesFor(context);

	if (name === null)
	{
		refuse(400, messages.themeNeedsName);
	}

	if (await countCustomThemes(universe.id, transaction) >= MAX_CUSTOM_THEMES)
	{
		refuse(409, {
			id: 'error.themeLimit',
			defaultMessage: 'A universe can have at most {max, plural, one {# theme} other {# themes}} of its own.',
			description: 'Why a new theme (character background) wasn\'t made: the universe has as many themes of its own as allowed'
		}, {
			max: MAX_CUSTOM_THEMES
		});
	}

	await checkTheme(context, undefined, settings);
	recordRef(context, ref, await createCustomTheme(universe.id, universe.ruleset, { ...settings, name }, transaction));
}

/**
 * Changes one of the universe's themes, or stores its edited copy of a default theme
 *
 * @param context The save
 * @param id The theme
 * @param settings Its new settings
 */
export async function saveThemeChange(context: ChangeContext, id: NumberRef, settings: ThemeSettings): Promise<void>
{
	const { universe, transaction } = context;

	requireThemesFor(context);

	const themeId = resolveNumberRef(context, id);
	const kind = await findThemeKind(universe.id, universe.ruleset, themeId, transaction);
	const { name } = settings;

	if (kind === undefined)
	{
		refuse(404, messages.noSuchTheme);
	}

	if ((kind === 'custom') && (name === null))
	{
		refuse(400, messages.themeNeedsName);
	}

	await checkTheme(context, themeId, settings);

	if (kind === 'default')
	{
		await saveEditedDefaultTheme(universe.id, universe.ruleset, themeId, settings, transaction);
	}
	else if (name !== null)
	{
		await updateCustomTheme(universe.id, themeId, { ...settings, name }, transaction);
	}
}

/**
 * Deletes one of the universe's own themes, or restores a default theme the universe has edited
 *
 * @param context The save
 * @param id The theme
 */
export async function removeThemeChange(context: ChangeContext, id: NumberRef): Promise<void>
{
	const { universe, transaction } = context;

	requireThemesFor(context);

	const themeId = resolveNumberRef(context, id);
	const kind = await findThemeKind(universe.id, universe.ruleset, themeId, transaction);

	if (kind === undefined)
	{
		refuse(404, messages.noSuchTheme);
	}

	// Default themes are enabled, so restoring one never leaves the universe without an enabled theme
	if (kind === 'default')
	{
		await restoreDefaultTheme(universe.id, themeId, transaction);
		return;
	}

	// Making a character waits for the universe's lock too, so nobody takes the theme as it is deleted
	if (await hasCharactersOfTheme(themeId, transaction))
	{
		refuse(409, messages.themeInUse);
	}

	const others = (await loadEditorThemes(universe.id, universe.ruleset, transaction)).filter((theme) => (theme.id !== themeId));

	if (!others.some((theme) => theme.enabled))
	{
		refuse(409, messages.noEnabledTheme);
	}

	await deleteCustomTheme(universe.id, themeId, transaction);
}

/**
 * Refuses a theme's settings that leave the universe without an enabled theme
 *
 * @param context The save
 * @param themeId The theme being changed, or undefined for a new one
 * @param settings The theme's new settings
 */
async function checkTheme(context: ChangeContext, themeId: number | undefined, settings: ThemeSettings): Promise<void>
{
	const { universe, transaction } = context;

	if (!settings.enabled && !(await loadEditorThemes(universe.id, universe.ruleset, transaction)).some((theme) => ((theme.id !== themeId) && theme.enabled)))
	{
		refuse(409, messages.noEnabledTheme);
	}
}
