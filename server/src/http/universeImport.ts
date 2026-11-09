/**
 * Importing a universe's export into its draft (see Importing a universe in STRUCTURE-OVERVIEW.md):
 * POST EDITOR_UNIVERSES_PATH/:universeId/import/preview says what importing a file would change, and
 * POST EDITOR_UNIVERSES_PATH/:universeId/import imports it, as one save (shared/src/universeImport.ts)
 *
 * The file is read, checked and planned (universeImportFile.ts, universeImportPlan.ts) before the save
 * starts, so the universe isn't locked while it is, and the save checks every change as one from the
 * editor would be, in one transaction: all of it is imported, or none of it
 */
import express, { type Request, type Response, type Router } from 'express';
import { canImportUniverse, defineMessages, localize, MAX_LOCALE_LENGTH, MAX_UNIVERSE_IMPORT_BYTES, SOURCE_LOCALE, UNIVERSE_IMPORT_PATH, UNIVERSE_IMPORT_PREVIEW_PATH, UNIVERSE_IMPORT_RIGHTS_PARAM, type ErrorPayload, type UniverseImportPreview } from '@multiverse-kiln/shared';
import { z } from 'zod';

import { findSiteSettings } from '../db/siteSettingsRepo.js';
import { emailTranslator } from '../email/emailLocales.js';
import { requireRole, universeContextOf, type UniverseContext } from './editorAccess.js';
import { saveChanges } from './editorChanges.js';
import { errorMessages, sendError } from './errors.js';
import { ImportProblem, readImportFile } from './universeImportFile.js';
import { loadImportTarget, mayKeepAreas, planImport, type ImportPlan } from './universeImportPlan.js';

/**
 * Why an import wasn't made (see shared/src/localization.ts)
 */
const messages = defineMessages({
	draftOnly: {
		id: 'error.importDraftOnly',
		defaultMessage: 'A file can only be imported into the universe\'s draft. Open the draft to import into it.',
		description: 'Why a file wasn\'t imported into a universe: the editor has its live version open, and imports go into its draft (a copy players don\'t see until it is applied)'
	},
	notAZipFile: {
		id: 'error.importNotZip',
		defaultMessage: 'Choose the zip file Export Universe made.',
		description: 'Why a file wasn\'t imported into a universe\'s draft: what was sent isn\'t a zip file'
	},
	rightsNeeded: {
		id: 'error.importRightsNeeded',
		defaultMessage: 'Confirm you have the rights to use the tilesets\' images in the file.',
		description: 'Why a file wasn\'t imported into a universe\'s draft: it uploads tilesets\' images, and the player didn\'t check that they have the rights to use them'
	},
	alreadyImporting: {
		id: 'error.alreadyImporting',
		defaultMessage: 'You\'re already importing a file. Try again once it has finished.',
		description: 'Why a file wasn\'t imported into a universe\'s draft: the player is already importing one, in this window or another, and each player imports one at a time'
	},
	serverBusy: {
		id: 'error.importServerBusy',
		defaultMessage: 'The server is busy importing other files. Try again in a minute.',
		description: 'Why a file wasn\'t imported into a universe\'s draft, or previewed: other players are importing as many files as the server reads at once'
	}
});

/**
 * Most imports the server reads, plans and saves at once. Each holds its file's contents in memory, many
 * times their size once read, so this bounds the memory imports take across players
 */
const MAX_IMPORTS_AT_ONCE = 2;

/**
 * The players an import is being made for, each of whom makes one at a time, so one player can't have
 * the server read and plan many files at once
 */
const importing = new Set<string>();

/**
 * Reads the request's body as the export's zip archive, once the player has been let in
 */
const readArchive = express.raw({
	type: 'application/zip',
	limit: MAX_UNIVERSE_IMPORT_BYTES
});

/**
 * The query parameters of the import route
 */
const importQuery = z.object({
	[UNIVERSE_IMPORT_RIGHTS_PARAM]: z.enum(['true', 'false']).optional(),
	windowId: z.string().min(1).max(64).optional()
});

/**
 * The language a copy's name is written in, for both routes (?locale=, the page's language)
 */
const importLocale = z.string().max(MAX_LOCALE_LENGTH).regex(/^[A-Za-z0-9-]+$/);

/**
 * Adds the routes that import a file into a universe's draft, for the roles that may change something in it
 *
 * @param router The router for routes under /:universeId
 */
export function addUniverseImportRoutes(router: Router): void
{
	router.post(UNIVERSE_IMPORT_PREVIEW_PATH, requireRole(canImportUniverse), readArchive, previewRoute);
	router.post(UNIVERSE_IMPORT_PATH, requireRole(canImportUniverse), readArchive, importRoute);
}

/**
 * POST EDITOR_UNIVERSES_PATH/:universeId/import/preview: what importing a file into the draft would change
 *
 * @param request The request
 * @param response The response: a UniverseImportPreview
 */
async function previewRoute(request: Request, response: Response): Promise<void>
{
	await whileImporting(universeContextOf(request), response, async () =>
	{
		const plan = await planRequest(request, response);

		if (plan)
		{
			const payload: UniverseImportPreview = plan.preview;

			response.json(payload);
		}
	});
}

/**
 * POST EDITOR_UNIVERSES_PATH/:universeId/import: imports a file into the draft, as one save. Answers 204,
 * or why the save was refused
 *
 * @param request The request
 * @param response The response
 */
async function importRoute(request: Request, response: Response): Promise<void>
{
	const query = importQuery.safeParse(request.query);

	if (!query.success)
	{
		sendError(response, 400, errorMessages.invalidRequest, {
			problem: 'Unknown query parameters'
		});
		return;
	}

	const context = universeContextOf(request);

	// The plan holds the file's contents until it is saved, so the import holds its place until then
	await whileImporting(context, response, async () =>
	{
		const plan = await planRequest(request, response);

		if (!plan)
		{
			return;
		}

		if ((plan.preview.tilesetUploads > 0) && (query.data[UNIVERSE_IMPORT_RIGHTS_PARAM] !== 'true'))
		{
			sendError(response, 400, messages.rightsNeeded);
			return;
		}

		const outcome = await saveChanges(context, plan.changes, query.data.windowId);

		if (!outcome.saved)
		{
			const { status, message, values } = outcome.refusal.refusal;
			const payload: ErrorPayload = { error: localize(message, values) };

			response.status(status).json(payload);
			return;
		}

		response.status(204).end();
	});
}

/**
 * Reads, checks and plans the file a request sends, answering why it can't be imported when it can't
 *
 * @param request The request
 * @param response The response, answered when the file can't be imported
 * @return The plan, or undefined once the response is answered
 */
async function planRequest(request: Request, response: Response): Promise<ImportPlan | undefined>
{
	const context = universeContextOf(request);

	if (!context.version.draft)
	{
		sendError(response, 409, messages.draftOnly);
		return(undefined);
	}

	if (!Buffer.isBuffer(request.body) || (request.body.length === 0))
	{
		sendError(response, 400, messages.notAZipFile);
		return(undefined);
	}

	try
	{
		const { areasPerUniverse } = await findSiteSettings();
		const file = await readImportFile(request.body, context.universe.ruleset, areasPerUniverse);
		const access = {
			role: context.role,
			languages: context.languages
		};
		const locale = importLocale.safeParse(request.query.locale);
		const target = await loadImportTarget(context.version, file, mayKeepAreas(file, access), emailTranslator((locale.success ? locale.data : SOURCE_LOCALE)));

		if (!target)
		{
			sendError(response, 404, errorMessages.noSuchDraft);
			return(undefined);
		}

		return(planImport(file, target, access));
	}
	catch (error)
	{
		if (error instanceof ImportProblem)
		{
			sendError(response, 400, error.reason, error.values);
			return(undefined);
		}

		throw error;
	}
}

/**
 * Runs work for a player's import, one at a time for each player and at most MAX_IMPORTS_AT_ONCE on the
 * server, answering 429 while another of theirs is running and 503 while the server has as many as it runs
 *
 * @param context The request's universe and player
 * @param response The response, answered when the import can't run now
 * @param work The work
 */
async function whileImporting(context: UniverseContext, response: Response, work: () => Promise<void>): Promise<void>
{
	if (importing.has(context.playerId))
	{
		sendError(response, 429, messages.alreadyImporting);
		return;
	}

	if (importing.size >= MAX_IMPORTS_AT_ONCE)
	{
		sendError(response, 503, messages.serverBusy);
		return;
	}

	importing.add(context.playerId);

	try
	{
		await work();
	}
	finally
	{
		importing.delete(context.playerId);
	}
}
