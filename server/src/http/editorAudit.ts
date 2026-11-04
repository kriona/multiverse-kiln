/**
 * The world editor's route for the record of saves made in a universe's editor (listed in
 * shared/src/editor.ts), for the Audit tab. Each save records itself as it commits (editorChanges.ts),
 * so the tab only lists them
 */
import type express from 'express';
import type { Request, Response } from 'express';
import { canManageEditors, type UniverseEditListPayload } from '@multiverse-kiln/shared';

import { listUniverseEdits } from '../db/universeEditRepo.js';
import { requireRole, universeContextOf } from './editorAccess.js';
import { universeEditListQuery } from './editorPayloads.js';
import { sendInvalidRequest } from './errors.js';

/**
 * Adds the audit route to a universe's router
 *
 * @param router The router for routes under /:universeId
 */
export function addAuditRoutes(router: express.Router): void
{
	router.get('/audit', requireRole(canManageEditors), listEdits);
}

/**
 * GET /:universeId/audit: a page of the saves made in the universe's editor, newest first
 *
 * @param request The request, with a UniverseEditListQuery
 * @param response The response
 */
async function listEdits(request: Request, response: Response): Promise<void>
{
	const query = universeEditListQuery.safeParse(request.query);

	if (!query.success)
	{
		sendInvalidRequest(response, query.error);
		return;
	}

	const { universe } = universeContextOf(request);
	const page = await listUniverseEdits(universe.id, query.data);
	const payload: UniverseEditListPayload = {
		edits: page.edits.map((edit) => ({
			id: edit.id,
			player: edit.player,
			role: edit.role,
			details: edit.changeDetails,
			savedAt: edit.savedAt.toISOString()
		})),
		total: page.total
	};

	response.json(payload);
}
