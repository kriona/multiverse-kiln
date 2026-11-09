/**
 * Importing a universe's export into its draft (see Importing a universe in STRUCTURE-OVERVIEW.md):
 * POST EDITOR_UNIVERSES_PATH/:universeId/import/preview says what importing a file would change, and
 * POST EDITOR_UNIVERSES_PATH/:universeId/import imports it, as one save (shared/src/universeImport.ts)
 *
 * The file is read, checked and planned (universeImportFile.ts, universeImportPlan.ts) before the save
 * starts, so the universe isn't locked while it is, and the save checks every change as one from the
 * editor would be, in one transaction: all of it is imported, or none of it
 */
import express, { type NextFunction, type Request, type Response, type Router } from 'express';
import { canImportUniverse, defineMessages, localize, MAX_LOCALE_LENGTH, MAX_UNIVERSE_IMPORT_BYTES, SOURCE_LOCALE, UNIVERSE_IMPORT_PATH, UNIVERSE_IMPORT_PREVIEW_PATH, UNIVERSE_IMPORT_RIGHTS_PARAM, type ErrorPayload, type MessageDescriptor, type UniverseImportPreview } from '@multiverse-kiln/shared';
import { z } from 'zod';

import { findSiteSettings } from '../db/siteSettingsRepo.js';
import { emailTranslator } from '../email/emailLocales.js';
import { requireRole, universeContextOf } from './editorAccess.js';
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
 * A player's place among the imports being made. It is taken before the request's file is read and held
 * until its response has closed and the work on the file has finished, so neither a file still arriving
 * nor one still being saved lets the player, or more than MAX_IMPORTS_AT_ONCE players, send another
 */
class ImportPlace
{
	/**
	 * What still holds the place: the response until it closes, and the work while it runs
	 */
	private holds = 1;

	/**
	 * Takes a place for a player
	 *
	 * @param playerId The player's ID
	 */
	constructor(private readonly playerId: string)
	{
		importing.add(playerId);
	}

	/**
	 * Runs work on the import, holding the place until it has finished. Does nothing once the place has
	 * been given up, since the response it would answer has closed
	 *
	 * @param work The work
	 */
	async whileHeld(work: () => Promise<void>): Promise<void>
	{
		if (this.holds === 0)
		{
			return;
		}

		this.holds++;

		try
		{
			await work();
		}
		finally
		{
			this.release();
		}
	}

	/**
	 * Lets go of one hold on the place, giving it up once nothing holds it
	 */
	release(): void
	{
		this.holds--;

		if (this.holds === 0)
		{
			importing.delete(this.playerId);
		}
	}
}

/**
 * Whether an import holds a player's place, for tests that wait for a file still arriving to take it
 *
 * @param playerId The player's ID
 * @return Whether one does
 */
export function isImporting(playerId: string): boolean
{
	return(importing.has(playerId));
}

/**
 * Each import request's place, taken by takeImportPlace
 */
const importPlaces = new WeakMap<Response, ImportPlace>();

/**
 * Reads the request's body as the export's zip archive, once the player has been let in and has taken an
 * import's place
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
	router.post(UNIVERSE_IMPORT_PREVIEW_PATH, requireRole(canImportUniverse), takeImportPlace, readArchive, previewRoute);
	router.post(UNIVERSE_IMPORT_PATH, requireRole(canImportUniverse), takeImportPlace, readArchive, importRoute);
}

/**
 * Takes the player's place among the imports being made before their file is read, answering 429 while
 * another of theirs is being read or made and 503 while the server has as many as it runs. The place is
 * held until the response closes, and while the route works on the file
 *
 * @param request The request
 * @param response The response, answered when the import can't run now
 * @param next Reads the file
 */
function takeImportPlace(request: Request, response: Response, next: NextFunction): void
{
	const { playerId } = universeContextOf(request);

	if (importing.has(playerId))
	{
		refuseImport(request, response, 429, messages.alreadyImporting);
		return;
	}

	if (importing.size >= MAX_IMPORTS_AT_ONCE)
	{
		refuseImport(request, response, 503, messages.serverBusy);
		return;
	}

	const place = new ImportPlace(playerId);

	importPlaces.set(response, place);
	response.once('close', () => place.release());
	next();
}

/**
 * Answers why an import can't run now once its file has arrived, reading the file without keeping any of
 * it. Node resets a connection whose request is still arriving when its response ends, which the browser
 * would show as a failed request rather than this answer. A file past MAX_UNIVERSE_IMPORT_BYTES is
 * answered as soon as it passes it
 *
 * @param request The request
 * @param response The response
 * @param status The status to answer
 * @param message Why the import can't run now
 */
function refuseImport(request: Request, response: Response, status: number, message: MessageDescriptor): void
{
	let read = 0;
	let answered = false;

	/**
	 * Answers, once
	 */
	const answer = (): void =>
	{
		if (!answered)
		{
			answered = true;
			sendError(response, status, message);
		}
	};

	request.on('data', (chunk: Buffer) =>
	{
		read += chunk.length;

		if (read > MAX_UNIVERSE_IMPORT_BYTES)
		{
			answer();
		}
	});
	request.once('end', answer);
}

/**
 * POST EDITOR_UNIVERSES_PATH/:universeId/import/preview: what importing a file into the draft would change
 *
 * @param request The request
 * @param response The response: a UniverseImportPreview
 */
async function previewRoute(request: Request, response: Response): Promise<void>
{
	await whileImporting(response, async () =>
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
	await whileImporting(response, async () =>
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
 * Runs work for a player's import, holding the place takeImportPlace took for it until the work has
 * finished
 *
 * @param response The request's response
 * @param work The work
 */
async function whileImporting(response: Response, work: () => Promise<void>): Promise<void>
{
	const place = importPlaces.get(response);

	if (!place)
	{
		throw new Error('An import route was reached without takeImportPlace');
	}

	await place.whileHeld(work);
}
