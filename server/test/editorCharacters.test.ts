import assert from 'assert';
import { randomUUID } from 'crypto';
import type { CharacterDeletionPayload, CharacterSheet, EditorCharacterListPayload, RaceListPayload } from '@multiverse-kiln/shared';

import { adminDb } from '../src/db/adminClient.js';
import { findCharacterPlayerId } from '../src/db/characterRepo.js';
import { findMembership } from '../src/db/groupRepo.js';
import { findDefaultRaceIds } from '../src/db/raceRepo.js';
import { setUniverseRole } from '../src/db/universeEditorRepo.js';
import { setUniverseDisabled } from '../src/db/universeRepo.js';
import { addCharacter, addGroup } from './db/fixtures.js';
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

describe('A character\'s sheet in the editor', () =>
{
	let ada: Editor;
	let grace: Editor;
	let universeId: string;
	let characterId: string;

	before(async () =>
	{
		await getTestServer();
	});

	beforeEach(async () =>
	{
		ada = await logIn('Ada');
		grace = await logIn('Grace');
		universeId = await createUniverse(ada);
		characterId = await addCharacter(grace.playerId, universeId, 'Dain');
	});

	it('shows any player\'s character to creators and builders', async () =>
	{
		const response = await send<CharacterSheet>(ada, 'GET', `/${universeId}/characters/${characterId}`);

		assert.strictEqual(response.status, 200, JSON.stringify(response.body));
		assert.strictEqual(response.body.name, 'Dain');
		assert.deepStrictEqual(response.body.race, { key: 'dwarf', name: null });
		assert.strictEqual(response.body.group, null);

		const linus = await logIn('Linus');

		for (const [role, status] of [['beta_tester', 403], ['translator', 403], ['builder', 200]] as const)
		{
			await setUniverseRole(universeId, linus.playerId, role);
			assert.strictEqual((await send(linus, 'GET', `/${universeId}/characters/${characterId}`)).status, status, role);
		}

		assert.strictEqual((await send(ada, 'GET', `/${universeId}/characters/${randomUUID()}`)).status, 404);
		assert.strictEqual((await send(ada, 'GET', `/${universeId}/characters/not-an-id`)).status, 404);
	});

	it('lets creators delete a player\'s character, but not builders', async () =>
	{
		const linus = await logIn('Linus');

		await setUniverseRole(universeId, linus.playerId, 'builder');
		assert.strictEqual((await send(linus, 'DELETE', `/${universeId}/characters/${characterId}`)).status, 403);
		assert.strictEqual((await send(linus, 'PUT', `/${universeId}/characters/${characterId}/deletion`)).status, 403);

		const deleted = await send(ada, 'DELETE', `/${universeId}/characters/${characterId}`);

		assert.strictEqual(deleted.status, 204, JSON.stringify(deleted.body));
		assert.strictEqual(await findCharacterPlayerId(universeId, characterId), undefined);
		assert.strictEqual((await send(ada, 'DELETE', `/${universeId}/characters/${characterId}`)).status, 404);
	});

	it('lets creators give a character their last rites and restore them', async () =>
	{
		const scheduled = await send<CharacterDeletionPayload>(ada, 'PUT', `/${universeId}/characters/${characterId}/deletion`);

		assert.strictEqual(scheduled.status, 200, JSON.stringify(scheduled.body));
		assert.ok(Date.parse(scheduled.body.deleteAt) > Date.now());
		assert.strictEqual((await send<CharacterSheet>(ada, 'GET', `/${universeId}/characters/${characterId}`)).body.deleteAt, scheduled.body.deleteAt);

		assert.strictEqual((await send(ada, 'DELETE', `/${universeId}/characters/${characterId}/deletion`)).status, 204);
		assert.strictEqual((await send<CharacterSheet>(ada, 'GET', `/${universeId}/characters/${characterId}`)).body.deleteAt, null);
	});

	it('takes a character out of their group before they can be deleted', async () =>
	{
		const groupId = await addGroup(universeId, characterId, null);
		const sheet = await send<CharacterSheet>(ada, 'GET', `/${universeId}/characters/${characterId}`);

		assert.deepStrictEqual(sheet.body.group, { groupId, isAnchor: true });
		assert.strictEqual((await send(ada, 'DELETE', `/${universeId}/characters/${characterId}`)).status, 409);

		const left = await send(ada, 'POST', `/${universeId}/groups/${groupId}/leave`, { body: { characterId } });

		assert.strictEqual(left.status, 204, JSON.stringify(left.body));
		assert.strictEqual(await findMembership(characterId), undefined);
		assert.strictEqual((await send(ada, 'POST', `/${universeId}/groups/${groupId}/leave`, { body: { characterId } })).status, 404);
		assert.strictEqual((await send(ada, 'DELETE', `/${universeId}/characters/${characterId}`)).status, 204);
	});

	it('doesn\'t change characters while the universe is disabled', async () =>
	{
		await setUniverseDisabled(universeId, {
			reason: 'Spam',
			preventDeletion: false
		}, adminDb);

		assert.strictEqual((await send(ada, 'DELETE', `/${universeId}/characters/${characterId}`)).status, 403);
		assert.notStrictEqual(await findCharacterPlayerId(universeId, characterId), undefined);
	});
});
