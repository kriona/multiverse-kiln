/**
 * The world editor's routes for a universe's themes (listed in shared/src/editor.ts), in a ruleset with
 * themes. A universe whose ruleset has none answers 404
 */
import type express from 'express';
import type { NextFunction, Request, Response } from 'express';
import { canEditUniverseSettings, defineMessages, MAX_CUSTOM_THEMES, rulesetHasThemes, type CreatedPayload, type ThemeListPayload, type ThemeSettings } from '@multiverse-kiln/shared';

import { hasCharactersOfTheme } from '../db/characterRepo.js';
import type { Executor } from '../db/client.js';
import { countCustomThemes, createCustomTheme, deleteCustomTheme, findThemeKind, loadEditorThemes, restoreDefaultTheme, saveEditedDefaultTheme, updateCustomTheme } from '../db/themeRepo.js';
import { inTransaction } from '../db/transactions.js';
import { lockUniverse } from '../db/universeRepo.js';
import { requireRole, universeContextOf, type UniverseContext } from './editorAccess.js';
import { themeIdParameter, themeSettings } from './editorPayloads.js';
import { sendError, sendInvalidRequest, type Refusal } from './errors.js';

/**
 * Reasons the theme routes give in more than one place (see shared/src/localization.ts)
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
 * Adds the theme routes to a universe's router
 *
 * @param router The router for routes under /:universeId
 */
export function addThemeRoutes(router: express.Router): void
{
	router.use('/themes', requireThemes);
	router.get('/themes', listThemes);
	router.post('/themes', requireRole(canEditUniverseSettings), createThemeRoute);
	router.put('/themes/:themeId', requireRole(canEditUniverseSettings), saveTheme);
	router.delete('/themes/:themeId', requireRole(canEditUniverseSettings), deleteTheme);
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
 * POST /:universeId/themes: adds a theme to the universe
 *
 * @param request The request
 * @param response The response
 */
async function createThemeRoute(request: Request, response: Response): Promise<void>
{
	const body = themeSettings.safeParse(request.body);

	if (!body.success)
	{
		sendInvalidRequest(response, body.error);
		return;
	}

	const { universe } = universeContextOf(request);
	const { name } = body.data;

	if (name === null)
	{
		sendError(response, 400, messages.themeNeedsName);
		return;
	}

	const result = await inTransaction(async (transaction): Promise<Refusal | number> =>
	{
		await lockUniverse(universe.id, transaction);

		if (await countCustomThemes(universe.id, transaction) >= MAX_CUSTOM_THEMES)
		{
			return({
				status: 409,
				message: {
					id: 'error.themeLimit',
					defaultMessage: 'A universe can have at most {max, plural, one {# theme} other {# themes}} of its own.',
					description: 'Why a new theme (character background) wasn\'t made: the universe has as many themes of its own as allowed'
				},
				values: { max: MAX_CUSTOM_THEMES }
			});
		}

		const problem = await findThemeProblem(universe, undefined, body.data, transaction);

		if (problem !== undefined)
		{
			return(problem);
		}

		return(createCustomTheme(universe.id, universe.ruleset, { ...body.data, name }, transaction));
	});

	if (typeof result !== 'number')
	{
		sendError(response, result.status, result.message, result.values);
		return;
	}

	const payload: CreatedPayload<number> = { id: result };

	response.status(201).json(payload);
}

/**
 * PUT /:universeId/themes/:themeId: changes one of the universe's themes, or stores its edited copy of a
 * default theme
 *
 * @param request The request
 * @param response The response
 */
async function saveTheme(request: Request, response: Response): Promise<void>
{
	const themeId = themeIdParameter.safeParse(request.params.themeId);
	const body = themeSettings.safeParse(request.body);

	if (!body.success)
	{
		sendInvalidRequest(response, body.error);
		return;
	}

	const { universe } = universeContextOf(request);
	const kind = (themeId.success ? await findThemeKind(universe.id, universe.ruleset, themeId.data) : undefined);

	if (!themeId.success || (kind === undefined))
	{
		sendError(response, 404, messages.noSuchTheme);
		return;
	}

	const { name } = body.data;

	if ((kind === 'custom') && (name === null))
	{
		sendError(response, 400, messages.themeNeedsName);
		return;
	}

	const refusal = await inTransaction(async (transaction) =>
	{
		await lockUniverse(universe.id, transaction);

		const problem = await findThemeProblem(universe, themeId.data, body.data, transaction);

		if (problem !== undefined)
		{
			return(problem);
		}

		if (kind === 'default')
		{
			await saveEditedDefaultTheme(universe.id, universe.ruleset, themeId.data, body.data, transaction);
		}
		else if (name !== null)
		{
			await updateCustomTheme(universe.id, themeId.data, { ...body.data, name }, transaction);
		}

		return(undefined);
	});

	if (refusal !== undefined)
	{
		sendError(response, refusal.status, refusal.message, refusal.values);
		return;
	}

	response.sendStatus(204);
}

/**
 * DELETE /:universeId/themes/:themeId: deletes one of the universe's own themes, or restores a default
 * theme the universe has edited
 *
 * @param request The request
 * @param response The response
 */
async function deleteTheme(request: Request, response: Response): Promise<void>
{
	const themeId = themeIdParameter.safeParse(request.params.themeId);
	const { universe } = universeContextOf(request);
	const kind = (themeId.success ? await findThemeKind(universe.id, universe.ruleset, themeId.data) : undefined);

	if (!themeId.success || (kind === undefined))
	{
		sendError(response, 404, messages.noSuchTheme);
		return;
	}

	// Default themes are enabled, so restoring one never leaves the universe without an enabled theme
	if (kind === 'default')
	{
		await restoreDefaultTheme(universe.id, themeId.data);
		response.sendStatus(204);
		return;
	}

	const refusal = await inTransaction(async (transaction) =>
	{
		// Making a character waits for the universe's lock too, so nobody takes the theme as it is deleted
		await lockUniverse(universe.id, transaction);

		if (await hasCharactersOfTheme(themeId.data, transaction))
		{
			return(messages.themeInUse);
		}

		const others = (await loadEditorThemes(universe.id, universe.ruleset, transaction)).filter((theme) => (theme.id !== themeId.data));

		if (!others.some((theme) => theme.enabled))
		{
			return(messages.noEnabledTheme);
		}

		await deleteCustomTheme(universe.id, themeId.data, transaction);

		return(undefined);
	});

	if (refusal !== undefined)
	{
		sendError(response, 409, refusal);
		return;
	}

	response.sendStatus(204);
}

/**
 * Why a theme's settings can't be saved: leaving the universe without an enabled theme
 *
 * @param universe The universe
 * @param themeId The theme being changed, or undefined for a new one
 * @param settings The theme's new settings
 * @param executor A transaction holding the universe's lock
 * @return Why, or undefined when they can be saved
 */
async function findThemeProblem(universe: UniverseContext['universe'], themeId: number | undefined, settings: ThemeSettings, executor: Executor): Promise<Refusal | undefined>
{
	if (!settings.enabled && !(await loadEditorThemes(universe.id, universe.ruleset, executor)).some((theme) => ((theme.id !== themeId) && theme.enabled)))
	{
		return({
			status: 409,
			message: messages.noEnabledTheme
		});
	}

	return(undefined);
}
