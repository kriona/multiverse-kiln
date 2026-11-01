import assert from 'assert';
import type { EditableUniverse, EditorChange, PlayerSearchPayload, UniverseEditorListPayload } from '@multiverse-kiln/shared';

import { createPlayer, findPlayerByUsername } from '../src/db/playerRepo.js';
import { findUniverseAccess, setUniverseRole } from '../src/db/universeEditorRepo.js';
import { universeAccessChanges, type AccessLost } from '../src/players/universeAccess.js';
import { createUniverse, logIn, saveAll, saveChanges, send, type Editor } from './editorRequests.js';
import { addPlayer, usernameFor } from './players.js';
import { getTestServer } from './testServer.js';

/**
 * A change to the world, which only creators and builders may make: deleting an uploaded tileset that
 * doesn't exist, so it is refused for that once the role allows it
 */
const worldChange: EditorChange = { kind: 'deleteTileGraphic', graphicId: '00000000-0000-4000-8000-000000000009' };

/**
 * The editors of a universe, as the Editors tab lists them
 *
 * @param editor The browser asking
 * @param universeId The universe's ID
 * @return Each editor's username and role, with languages for a translator
 */
async function listEditors(editor: Editor, universeId: string): Promise<string[]>
{
	const { editors } = (await send<UniverseEditorListPayload>(editor, 'GET', `/${universeId}/editors`)).body;

	return(editors.map((each) => [each.username, each.role, ...each.languages].join(' ')));
}

describe('Editing a universe\'s editors', () =>
{
	let ada: Editor;
	let universeId: string;

	before(async () =>
	{
		await getTestServer();
	});

	beforeEach(async () =>
	{
		ada = await logIn('Ada');
		universeId = await createUniverse(ada);
	});

	describe('searching for players to add', () =>
	{
		/**
		 * The usernames a search finds
		 *
		 * @param query What was typed
		 * @return The usernames, in the order found
		 */
		async function search(query: string): Promise<string[]>
		{
			const found = await send<PlayerSearchPayload>(ada, 'GET', `/${universeId}/editors/search?query=${encodeURIComponent(query)}`);

			assert.strictEqual(found.status, 200);

			return(found.body.players.map((player) => player.username));
		}

		beforeEach(async () =>
		{
			for (const [username, displayName] of [['grace_h', 'Grace Hopper'], ['gracie', 'Amazing Gracie'], ['hopper', 'Captain Ace'], ['ace', 'Ada Two'], ['ab_c', 'Underscore'], ['abxc', 'Not Underscore']])
			{
				await createPlayer({ username, displayName, email: null, passwordHash: null });
			}
		});

		it('matches usernames and names, ignoring capitals, the exact username first, then those it starts', async () =>
		{
			assert.deepStrictEqual(await search('GRAC'), ['grace_h', 'gracie']);
			assert.deepStrictEqual(await search('hopper'), ['hopper', 'grace_h']);
			assert.deepStrictEqual(await search('ace'), ['ace', 'grace_h', 'hopper']);
		});

		it('matches only usernames after an @', async () =>
		{
			assert.deepStrictEqual(await search('@hopper'), ['hopper']);
			assert.deepStrictEqual(await search('@ captain'), []);
		});

		it('takes % and _ as themselves', async () =>
		{
			assert.deepStrictEqual(await search('@b_c'), ['ab_c']);
			assert.deepStrictEqual(await search('%%%'), []);
		});

		it('refuses a search shorter than the fewest characters, not counting the @', async () =>
		{
			for (const query of ['', 'ac', '@ac', '@  ac', '@'])
			{
				const refused = await send(ada, 'GET', `/${universeId}/editors/search?query=${encodeURIComponent(query)}`);

				assert.strictEqual(refused.status, 400, query);
			}

			assert.deepStrictEqual(await search('@ace'), ['ace', 'grace_h']);
		});

		it('leaves out the universe\'s editors, and is for creators only', async () =>
		{
			const builder = await logIn('Bob');
			const gracie = await findPlayerByUsername('gracie');

			assert.ok(gracie);
			await setUniverseRole(universeId, gracie.id, 'beta_tester');
			await setUniverseRole(universeId, builder.playerId, 'builder');
			assert.deepStrictEqual(await search('grac'), ['grace_h']);
			assert.deepStrictEqual(await search('ada'), ['ace']);
			assert.strictEqual((await send(builder, 'GET', `/${universeId}/editors/search?query=grace`)).status, 403);
		});
	});

	it('adds players by username with a role, changes roles and removes editors', async () =>
	{
		const grace = await addPlayer('Grace');
		const alan = await addPlayer('Alan');

		await saveAll(ada, universeId, [
			{ kind: 'addEditor', username: grace.username, settings: { role: 'translator', languages: ['de', 'pt-br', 'de'] } },
			{ kind: 'addEditor', username: alan.username, settings: { role: 'beta_tester', languages: [] } }
		]);
		assert.deepStrictEqual(await listEditors(ada, universeId), ['Ada creator', 'Alan beta_tester', 'Grace translator de pt-BR']);

		await saveAll(ada, universeId, [
			{ kind: 'saveEditor', playerId: grace.id, settings: { role: 'builder', languages: [] } },
			{ kind: 'removeEditor', playerId: alan.id }
		]);
		assert.deepStrictEqual(await listEditors(ada, universeId), ['Ada creator', 'Grace builder']);
	});

	it('refuses a username no player has, a player who is an editor already, and languages for the wrong role', async () =>
	{
		const grace = await addPlayer('Grace');
		const unknown = await saveChanges(ada, universeId, [{ kind: 'addEditor', username: 'nobody_here', settings: { role: 'builder', languages: [] } }]);
		const already = await saveChanges(ada, universeId, [
			{ kind: 'addEditor', username: grace.username, settings: { role: 'builder', languages: [] } },
			{ kind: 'addEditor', username: grace.username, settings: { role: 'beta_tester', languages: [] } }
		]);
		const noLanguages = await saveChanges(ada, universeId, [{ kind: 'addEditor', username: grace.username, settings: { role: 'translator', languages: [] } }]);
		const builderLanguages = await saveChanges(ada, universeId, [{ kind: 'addEditor', username: grace.username, settings: { role: 'builder', languages: ['de'] } }]);

		assert.deepStrictEqual([unknown.status, unknown.body.error.id], [404, 'error.noSuchPlayerToAdd']);
		assert.deepStrictEqual([already.status, already.body.changeIndex], [409, 1]);
		assert.strictEqual(noLanguages.status, 400);
		assert.strictEqual(builderLanguages.status, 400);
		assert.deepStrictEqual(await listEditors(ada, universeId), ['Ada creator']);
	});

	it('always keeps a creator, but lets one hand the role on and leave in the same save', async () =>
	{
		const grace = await addPlayer('Grace');

		await saveAll(ada, universeId, [{ kind: 'addEditor', username: grace.username, settings: { role: 'builder', languages: [] } }]);

		const demoted = await saveChanges(ada, universeId, [{ kind: 'saveEditor', playerId: ada.playerId, settings: { role: 'builder', languages: [] } }]);
		const left = await saveChanges(ada, universeId, [{ kind: 'removeEditor', playerId: ada.playerId }]);

		assert.deepStrictEqual([demoted.status, demoted.body.error.id, demoted.body.changeIndex], [409, 'error.lastCreator', 0]);
		assert.deepStrictEqual([left.status, left.body.error.id], [409, 'error.lastCreator']);

		await saveAll(ada, universeId, [
			{ kind: 'removeEditor', playerId: ada.playerId },
			{ kind: 'saveEditor', playerId: grace.id, settings: { role: 'creator', languages: [] } }
		]);
		assert.strictEqual(await findUniverseAccess(universeId, ada.playerId), undefined);
		assert.strictEqual((await send(ada, 'GET', `/${universeId}`)).status, 404);
	});

	it('lets any editor leave, but only creators change other editors', async () =>
	{
		const bob = await logIn('Bob');
		const grace = await logIn('Grace');

		await setUniverseRole(universeId, bob.playerId, 'builder');
		await setUniverseRole(universeId, grace.playerId, 'beta_tester');

		const changes: EditorChange[] = [
			{ kind: 'removeEditor', playerId: grace.playerId },
			{ kind: 'saveEditor', playerId: grace.playerId, settings: { role: 'builder', languages: [] } },
			{ kind: 'addEditor', username: usernameFor('Alan'), settings: { role: 'builder', languages: [] } }
		];

		for (const change of changes)
		{
			assert.strictEqual((await saveChanges(bob, universeId, [change])).status, 403);
		}

		await saveAll(grace, universeId, [{ kind: 'removeEditor', playerId: grace.playerId }]);
		assert.deepStrictEqual(await listEditors(ada, universeId), ['Ada creator', 'Bob builder']);
	});

	it('lets a translator change nothing but translations', async () =>
	{
		const grace = await logIn('Grace');

		await saveAll(ada, universeId, [{ kind: 'addEditor', username: usernameFor('Grace'), settings: { role: 'translator', languages: ['de'] } }]);

		const universe = (await send<EditableUniverse>(grace, 'GET', `/${universeId}`)).body;

		assert.deepStrictEqual([universe.role, universe.languages, universe.playerId], ['translator', ['de'], grace.playerId]);
		assert.strictEqual((await saveChanges(grace, universeId, [{ kind: 'universe', update: { name: 'Mine Now' } }])).status, 403);
		assert.strictEqual((await saveChanges(grace, universeId, [worldChange])).status, 403);
	});

	it('refuses the next save of an editor whose role was taken away', async () =>
	{
		const bob = await logIn('Bob');

		await setUniverseRole(universeId, bob.playerId, 'builder');
		assert.strictEqual((await saveChanges(bob, universeId, [worldChange])).status, 404);

		await saveAll(ada, universeId, [{ kind: 'saveEditor', playerId: bob.playerId, settings: { role: 'beta_tester', languages: [] } }]);
		assert.strictEqual((await saveChanges(bob, universeId, [worldChange])).status, 403);
	});

	it('tells the rooms who may no longer play, once the save commits', async () =>
	{
		const bob = await logIn('Bob');
		const grace = await logIn('Grace');
		const heard: AccessLost[] = [];
		const stop = universeAccessChanges.onLost((change) =>
		{
			heard.push(change);
		});

		try
		{
			await setUniverseRole(universeId, bob.playerId, 'builder');
			await setUniverseRole(universeId, grace.playerId, 'builder');

			// A universe still being built can be played by creators and builders only
			await saveAll(ada, universeId, [
				{ kind: 'saveEditor', playerId: bob.playerId, settings: { role: 'beta_tester', languages: [] } },
				{ kind: 'saveEditor', playerId: grace.playerId, settings: { role: 'creator', languages: [] } }
			]);
			await saveChanges(ada, universeId, [{ kind: 'removeEditor', playerId: grace.playerId }, { kind: 'universe', update: { name: '' } }]);
		}
		finally
		{
			stop();
		}

		assert.deepStrictEqual(heard.map((change) => [change.universeId, [...change.playerIds]]), [[universeId, [bob.playerId]]]);
	});
});
