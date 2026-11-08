import assert from 'assert';
import type { EditorCharacterListPayload, RaceListPayload } from '@multiverse-kiln/shared';

import { findDefaultRaceIds } from '../src/db/raceRepo.js';
import { setUniverseRole } from '../src/db/universeEditorRepo.js';
import { addCharacter } from './db/fixtures.js';
import { createUniverse, logIn, saveChanges, send, type Editor } from './editorRequests.js';
import { getTestServer } from './testServer.js';

describe('The editor\'s list of a universe\'s characters', () =>
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

	it('lists every player\'s characters with their race, class and player', async () =>
	{
		const grace = await logIn('Grace');

		await addCharacter(ada.playerId, universeId, 'Brokk');
		await addCharacter(grace.playerId, universeId, 'Dain');

		const response = await send<EditorCharacterListPayload>(ada, 'GET', `/${universeId}/characters?sort=player&direction=descending`);
		const dwarfId = (await findDefaultRaceIds('pf1e')).get('dwarf');

		assert.strictEqual(response.status, 200, JSON.stringify(response.body));
		assert.strictEqual(response.body.total, 2);
		assert.deepStrictEqual(response.body.characters.map(({ name, race, characterClass, player, inGroup, deleteAt }) => ({ name, race, characterClass, player, inGroup, deleteAt })), [
			{
				name: 'Dain',
				race: { key: 'dwarf', name: null },
				characterClass: { key: 'fighter', name: null },
				player: { username: 'Grace', displayName: 'Grace' },
				inGroup: false,
				deleteAt: null
			},
			{
				name: 'Brokk',
				race: { key: 'dwarf', name: null },
				characterClass: { key: 'fighter', name: null },
				player: { username: 'Ada', displayName: 'Ada' },
				inGroup: false,
				deleteAt: null
			}
		]);
		assert.ok(!Number.isNaN(Date.parse(response.body.characters[0].createdAt)));

		const searched = await send<EditorCharacterListPayload>(ada, 'GET', `/${universeId}/characters?search=${encodeURIComponent('@gra')}&raceId=${dwarfId}`);

		assert.deepStrictEqual(searched.body.characters.map(({ name }) => name), ['Dain']);
	});

	it('names a race the universe renamed by its new name, alongside its key', async () =>
	{
		await addCharacter(ada.playerId, universeId, 'Brokk');

		const dwarf = (await send<RaceListPayload>(ada, 'GET', `/${universeId}/races`)).body.races.find((race) => (race.key === 'dwarf'))!;
		const saved = await saveChanges(ada, universeId, [{ kind: 'saveRace', id: dwarf.id, settings: { ...dwarf, name: 'Stout' } }]);

		assert.strictEqual(saved.status, 200, JSON.stringify(saved.body));

		const response = await send<EditorCharacterListPayload>(ada, 'GET', `/${universeId}/characters`);

		assert.deepStrictEqual(response.body.characters.map(({ race, characterClass }) => [race, characterClass]), [[{ key: 'dwarf', name: 'Stout' }, { key: 'fighter', name: null }]]);
	});

	it('is only for roles that may change the world', async () =>
	{
		const grace = await logIn('Grace');

		for (const [role, status] of [['beta_tester', 403], ['translator', 403], ['builder', 200]] as const)
		{
			await setUniverseRole(universeId, grace.playerId, role);
			assert.strictEqual((await send(grace, 'GET', `/${universeId}/characters`)).status, status, role);
		}
	});

	it('refuses a query it can\'t read', async () =>
	{
		assert.strictEqual((await send(ada, 'GET', `/${universeId}/characters?sort=race`)).status, 400);
		assert.strictEqual((await send(ada, 'GET', `/${universeId}/characters?raceId=elf`)).status, 400);
		assert.strictEqual((await send(ada, 'GET', `/${universeId}/characters?limit=100000`)).status, 400);
	});
});
