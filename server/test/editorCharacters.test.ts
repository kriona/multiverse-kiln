import assert from 'assert';
import { randomUUID } from 'crypto';
import { isRulebookOn, type CharacterDeletionPayload, type CharacterSheet, type EditorCharacterListPayload, type EditorItem, type ItemListPayload, type RaceListPayload } from '@multiverse-kiln/shared';

import { adminDb } from '../src/db/adminClient.js';
import { findCharacterPlayerId } from '../src/db/characterRepo.js';
import { findMembership } from '../src/db/groupRepo.js';
import { findDefaultRaceIds } from '../src/db/raceRepo.js';
import { setUniverseRole } from '../src/db/universeEditorRepo.js';
import { setUniverseDisabled } from '../src/db/universeRepo.js';
import { addCharacter, addGroup } from './db/fixtures.js';
import { createUniverse, logIn, saveChange, saveChanges, send, type Editor } from './editorRequests.js';
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

	/**
	 * The universe's enabled items whose books are on, which characters can be given
	 *
	 * @return The items, by ID
	 */
	async function usableItems(): Promise<EditorItem[]>
	{
		const { items } = (await send<ItemListPayload>(ada, 'GET', `/${universeId}/items?enabled=true`)).body;

		return(items.filter((item) => isRulebookOn([], item.rulebook)));
	}

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

	it('lets creators give a character enabled items, adding to what they carry', async () =>
	{
		const [first] = await usableItems();
		const torch = await saveChange<number>(ada, universeId, { kind: 'createItem', ref: 'new:torch', settings: { name: 'Torch', type: 'torch', enabled: true } });
		const second = { id: torch.body.id };
		const before = (await send<CharacterSheet>(ada, 'GET', `/${universeId}/characters/${characterId}`)).body.items;
		const carried = (itemId: number, sheet: CharacterSheet['items']): number => (sheet.find((item) => (item.id === itemId))?.quantity ?? 0);

		const given = await send(ada, 'POST', `/${universeId}/characters/${characterId}/items`, {
			body: {
				items: [
					{ itemId: first.id, quantity: 20 },
					{ itemId: second.id, quantity: 1 }
				]
			}
		});

		assert.strictEqual(given.status, 204, JSON.stringify(given.body));
		assert.strictEqual((await send(ada, 'POST', `/${universeId}/characters/${characterId}/items`, { body: { items: [{ itemId: first.id, quantity: 5 }] } })).status, 204);

		const after = (await send<CharacterSheet>(ada, 'GET', `/${universeId}/characters/${characterId}`)).body.items;

		assert.strictEqual(carried(first.id, after), carried(first.id, before) + 25);
		assert.strictEqual(carried(second.id, after), carried(second.id, before) + 1);
	});

	it('refuses to give disabled items, unknown items, or to builders', async () =>
	{
		const [item] = await usableItems();
		const saved = await saveChanges(ada, universeId, [{ kind: 'saveItem', id: item.id, settings: { name: item.name, type: item.type, enabled: false }, whenDisabled: 'keep' }]);
		const give = (editor: Editor, items: unknown) => send(editor, 'POST', `/${universeId}/characters/${characterId}/items`, { body: { items } });

		assert.strictEqual(saved.status, 200, JSON.stringify(saved.body));
		assert.strictEqual((await give(ada, [{ itemId: item.id, quantity: 1 }])).status, 409);
		assert.strictEqual((await give(ada, [{ itemId: 2147483647, quantity: 1 }])).status, 409);
		assert.strictEqual((await give(ada, [{ itemId: item.id, quantity: 0 }])).status, 400);
		assert.strictEqual((await give(ada, [])).status, 400);
		assert.strictEqual((await give(ada, [{ itemId: item.id, quantity: 1 }, { itemId: item.id, quantity: 1 }])).status, 400);

		const linus = await logIn('Linus');

		await setUniverseRole(universeId, linus.playerId, 'builder');
		assert.strictEqual((await give(linus, [{ itemId: item.id, quantity: 1 }])).status, 403);
	});

	it('lets creators discard a character\'s items, all of an item when asked for as many or more', async () =>
	{
		const [dagger] = await usableItems();
		const torch = await saveChange<number>(ada, universeId, { kind: 'createItem', ref: 'new:torch', settings: { name: 'Torch', type: 'torch', enabled: true } });
		const torchId = torch.body.id;
		const remove = (editor: Editor, items: unknown) => send(editor, 'POST', `/${universeId}/characters/${characterId}/items/discard`, { body: { items } });
		const carried = async (itemId: number): Promise<number> => ((await send<CharacterSheet>(ada, 'GET', `/${universeId}/characters/${characterId}`)).body.items.find((item) => (item.id === itemId))?.quantity ?? 0);

		assert.strictEqual((await send(ada, 'POST', `/${universeId}/characters/${characterId}/items`, { body: { items: [{ itemId: dagger.id, quantity: 10 }, { itemId: torchId, quantity: 3 }] } })).status, 204);

		const daggers = await carried(dagger.id);

		assert.strictEqual((await remove(ada, [{ itemId: dagger.id, quantity: 4 }])).status, 204);
		assert.strictEqual(await carried(dagger.id), daggers - 4);

		assert.strictEqual((await remove(ada, [{ itemId: torchId, quantity: 999 }])).status, 204);
		assert.strictEqual(await carried(torchId), 0);
		assert.strictEqual((await remove(ada, [{ itemId: torchId, quantity: 1 }])).status, 409);

		// Discarding an item the character doesn't carry discards nothing
		assert.strictEqual((await remove(ada, [{ itemId: dagger.id, quantity: 1 }, { itemId: torchId, quantity: 1 }])).status, 409);
		assert.strictEqual(await carried(dagger.id), daggers - 4);

		const linus = await logIn('Linus');

		await setUniverseRole(universeId, linus.playerId, 'builder');
		assert.strictEqual((await remove(linus, [{ itemId: dagger.id, quantity: 1 }])).status, 403);
		assert.strictEqual((await remove(ada, [])).status, 400);
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
