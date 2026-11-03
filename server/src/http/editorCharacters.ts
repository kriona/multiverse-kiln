/**
 * The world editor's route for the characters made in a universe (listed in shared/src/editor.ts), for
 * the Character List tab. Characters are made and changed by their players, so the editor only lists them
 */
import type express from 'express';
import type { Request, Response } from 'express';
import { canEditWorld, parsePlayerSearch, type EditorCharacterListPayload, type OptionName } from '@multiverse-kiln/shared';

import { listUniverseCharacters } from '../db/characterRepo.js';
import { loadEditorClasses } from '../db/classRepo.js';
import { loadEditorRaces } from '../db/raceRepo.js';
import { requireRole, universeContextOf } from './editorAccess.js';
import { editorCharacterListQuery } from './editorPayloads.js';
import { sendInvalidRequest } from './errors.js';

/**
 * Adds the character list route to a universe's router
 *
 * @param router The router for routes under /:universeId
 */
export function addCharacterListRoutes(router: express.Router): void
{
	router.get('/characters', requireRole(canEditWorld), listCharacters);
}

/**
 * GET /:universeId/characters: a page of the characters made in the universe, filtered
 *
 * @param request The request, with an EditorCharacterListQuery
 * @param response The response
 */
async function listCharacters(request: Request, response: Response): Promise<void>
{
	const query = editorCharacterListQuery.safeParse(request.query);

	if (!query.success)
	{
		sendInvalidRequest(response, query.error);
		return;
	}

	const { universe } = universeContextOf(request);
	const { search, raceId, classId, inGroup, sort, direction, offset, limit } = query.data;
	const parsedSearch = ((search === undefined) ? undefined : parsePlayerSearch(search));
	const [page, races, classes] = await Promise.all([
		listUniverseCharacters(universe.id, {
			search: ((parsedSearch && (parsedSearch.text !== '')) ? parsedSearch : undefined),
			raceId,
			classId,
			inGroup,
			sort: (sort ?? 'name'),
			direction: (direction ?? 'ascending'),
			offset,
			limit
		}),
		loadEditorRaces(universe.id, universe.ruleset),
		loadEditorClasses(universe.id, universe.ruleset)
	]);
	const raceNames = new Map(races.map(({ id, key, name }) => [id, { key, name }]));
	const classNames = new Map(classes.map(({ id, key, name }) => [id, { key, name }]));
	const unnamed: OptionName = { key: null, name: null };
	const payload: EditorCharacterListPayload = {
		characters: page.characters.map((character) => ({
			id: character.id,
			name: character.name,
			race: (raceNames.get(character.raceId) ?? unnamed),
			characterClass: (classNames.get(character.classId) ?? unnamed),
			player: {
				username: character.playerUsername,
				displayName: character.playerDisplayName
			},
			createdAt: character.createdAt.toISOString(),
			deleteAt: (character.deleteAt?.toISOString() ?? null),
			inGroup: character.inGroup
		})),
		total: page.total
	};

	response.json(payload);
}
