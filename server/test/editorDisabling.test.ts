import assert from 'assert';
import { charactersPath, type ChangeImpact, type CharacterListPayload, type EditorChange, type EditorItem, type EditorRace, type ItemListPayload, type RaceListPayload, type RaceSettings, type SaveImpactPayload } from '@multiverse-kiln/shared';

import { loadBarredOptions } from '../src/db/barredOptions.js';
import { createCharacter, findCharacterDetails, findLastPlayedCharacterId } from '../src/db/characterRepo.js';
import { setAreaParents } from '../src/db/areaRepo.js';
import { addGroupMember, findGroup, listGroupMembers, listMembersInAreas, moveMembers } from '../src/db/groupRepo.js';
import { inTransaction } from '../src/db/transactions.js';
import { setUniverseRole } from '../src/db/universeEditorRepo.js';
import { groupChanges, type GroupChange } from '../src/players/groupChanges.js';
import { universeAccessChanges, type BarredChange } from '../src/players/universeAccess.js';
import { areaChanges, type AreaChange } from '../src/world/areaChanges.js';
import { addCharacter, addGroup, addPlayableUniverse, defaultRaceId, dwarfFighter, testRegionId, type PlayableUniverse } from './db/fixtures.js';
import { logIn, saveAll, send, type Editor } from './editorRequests.js';
import { addPlayer, logInBrowser } from './players.js';
import { getTestServer, testServerUrl } from './testServer.js';

/**
 * A race's settings as the race editor sends them, with some changed
 *
 * @param race The race, as listed
 * @param changes The settings to change
 * @return The settings
 */
function raceSettings(race: EditorRace, changes: Partial<RaceSettings>): RaceSettings
{
	const { name, enabled, keepPlaying, startingMoney, startingItems, startingAreaId, startingColumn, startingRow, rules } = race;

	return({ name, enabled, keepPlaying, startingMoney, startingItems, startingAreaId, startingColumn, startingRow, rules, ...changes });
}

describe('Disabling things players are using', () =>
{
	let ada: Editor;
	let universe: PlayableUniverse;
	let playerId: string;
	let brokkId: string;

	before(async () =>
	{
		await getTestServer();
	});

	beforeEach(async () =>
	{
		ada = await logIn('Ada');
		universe = await addPlayableUniverse();
		await setUniverseRole(universe.universeId, ada.playerId, 'creator');
		playerId = (await addPlayer('Bob')).id;
		brokkId = await addCharacter(playerId, universe.universeId, 'Brokk');
	});

	/**
	 * What saving changes would do to players
	 *
	 * @param changes The changes
	 * @return The impacts the server answers
	 */
	async function impactsOf(changes: EditorChange[]): Promise<ChangeImpact[]>
	{
		const answer = await send<SaveImpactPayload>(ada, 'POST', `/${universe.universeId}/changes/impact`, { body: { changes } });

		assert.strictEqual(answer.status, 200);

		return(answer.body.impacts);
	}

	/**
	 * Saving one of the universe's races with some settings changed
	 *
	 * @param raceId The race's ID
	 * @param changes The settings to change
	 * @return The change
	 */
	async function saveRace(raceId: number, changes: Partial<RaceSettings>): Promise<EditorChange>
	{
		const races = (await send<RaceListPayload>(ada, 'GET', `/${universe.universeId}/races`)).body.races;
		const race = races.find((each) => (each.id === raceId));

		assert.ok(race);

		return({ kind: 'saveRace', id: raceId, settings: raceSettings(race, changes) });
	}

	/**
	 * One of the universe's items, as the Items tab lists it
	 *
	 * @param key A default item's key
	 * @return The item
	 */
	async function defaultItem(key: string): Promise<EditorItem>
	{
		const items = (await send<ItemListPayload>(ada, 'GET', `/${universe.universeId}/items?custom=false`)).body.items;
		const item = items.find((each) => (each.key === key));

		assert.ok(item);

		return(item);
	}

	/**
	 * The items Brokk carries
	 *
	 * @return The items and how many of each
	 */
	async function brokkItems(): Promise<{ itemId: number; quantity: number }[]>
	{
		return((await findCharacterDetails(playerId, universe.universeId, 'pf1e', brokkId))?.items ?? []);
	}

	it('nothing saves when asked what changes would do', async () =>
	{
		const dwarfId = await defaultRaceId('dwarf');

		await impactsOf([await saveRace(dwarfId, { enabled: false })]);

		const after = await saveRace(dwarfId, {});

		assert.ok((after.kind === 'saveRace') && after.settings.enabled);
	});

	it('counts the characters of a race being disabled, and bars them only when told to', async () =>
	{
		const dwarfId = await defaultRaceId('dwarf');
		const keep = await saveRace(dwarfId, { enabled: false, keepPlaying: true });

		assert.deepStrictEqual(await impactsOf([keep]), [{ changeIndex: 0, kind: 'race', id: dwarfId, name: { key: 'dwarf', name: null }, characters: 1 }]);

		await saveAll(ada, universe.universeId, [keep]);
		assert.strictEqual((await loadBarredOptions(universe.universeId)).raceIds.size, 0);

		// The race is disabled already, so making its characters stop playing warns no more
		const prevent = await saveRace(dwarfId, { enabled: false, keepPlaying: false });
		const published = new Promise<BarredChange>((resolve) =>
		{
			const stop = universeAccessChanges.onBarredChanged((change) =>
			{
				stop();
				resolve(change);
			});
		});

		assert.deepStrictEqual(await impactsOf([prevent]), []);
		await saveAll(ada, universe.universeId, [prevent]);

		const barred = await loadBarredOptions(universe.universeId);

		assert.deepStrictEqual([...(await published).barred.raceIds], [dwarfId]);
		assert.deepStrictEqual([...barred.raceIds], [dwarfId]);
		assert.strictEqual(await findLastPlayedCharacterId(playerId, universe.universeId, barred), undefined);

		const bob = await logInBrowser(playerId);
		const listed = (await (await fetch(`${testServerUrl}${charactersPath(universe.universeId)}`, { headers: { Cookie: bob.cookie } })).json()) as CharacterListPayload;

		assert.deepStrictEqual(listed.characters.map((character) => character.barredBy), ['race']);
		assert.strictEqual(listed.lastPlayedId, null);

		// Enabling the race lets them play again
		await saveAll(ada, universe.universeId, [await saveRace(dwarfId, { enabled: true })]);
		assert.strictEqual((await loadBarredOptions(universe.universeId)).raceIds.size, 0);
	});

	it('takes a carried item from characters when disabled with remove, and gives it back', async () =>
	{
		const dagger = await defaultItem('dagger');
		const disable: EditorChange = { kind: 'saveItem', id: dagger.id, settings: { name: null, type: dagger.type, enabled: false }, whenDisabled: 'remove' };
		const carried = await brokkItems();

		assert.ok(carried.some((item) => (item.itemId === dagger.id)));
		assert.deepStrictEqual(await impactsOf([disable]), [{ changeIndex: 0, kind: 'item', id: dagger.id, name: { key: 'dagger', name: null }, characters: 1 }]);

		await saveAll(ada, universe.universeId, [disable]);
		assert.ok(!(await brokkItems()).some((item) => (item.itemId === dagger.id)));

		await saveAll(ada, universe.universeId, [{ kind: 'saveItem', id: dagger.id, settings: { name: null, type: dagger.type, enabled: true } }]);
		assert.deepStrictEqual(await brokkItems(), carried);

		// Restoring the default item enables it, which gives it back too
		await saveAll(ada, universe.universeId, [disable]);
		await saveAll(ada, universe.universeId, [{ kind: 'removeItem', id: dagger.id }]);
		assert.deepStrictEqual(await brokkItems(), carried);
	});

	it('takes several carried items in one save, and gives some back while taking another', async () =>
	{
		const dagger = await defaultItem('dagger');
		const created = await saveAll(ada, universe.universeId, [
			{ kind: 'createItem', ref: 'new:torch', settings: { name: 'Torch', type: 'torch', enabled: true } },
			{ kind: 'createItem', ref: 'new:rope', settings: { name: 'Rope', type: 'rope', enabled: true } }
		]);
		const torch = { id: Number(created['new:torch']), name: 'Torch', type: 'torch' };
		const rope = { id: Number(created['new:rope']), name: 'Rope', type: 'rope' };
		const character = await dwarfFighter(playerId, universe.universeId, 'Thora');

		character.items = [dagger, torch, rope].map((item) => ({ itemId: item.id, quantity: 1 }));

		const thoraId = await inTransaction((transaction) => createCharacter(character, transaction));
		const carriedIds = async (): Promise<number[]> => ((await findCharacterDetails(playerId, universe.universeId, 'pf1e', thoraId))?.items ?? [])
			.map((item) => item.itemId)
			.sort((a, b) => (a - b));
		const idsOf = (...carried: { id: number }[]): number[] => carried
			.map((item) => item.id)
			.sort((a, b) => (a - b));
		const saveItem = (item: { id: number; name: string | null; type: string }, enabled: boolean): EditorChange => ({ kind: 'saveItem', id: item.id, settings: { name: item.name, type: item.type, enabled }, whenDisabled: (enabled ? undefined : 'remove') });

		assert.deepStrictEqual(await carriedIds(), idsOf(dagger, torch, rope));

		await saveAll(ada, universe.universeId, [saveItem({ ...dagger, name: null }, false), saveItem(torch, false)]);
		assert.deepStrictEqual(await carriedIds(), idsOf(rope));

		await saveAll(ada, universe.universeId, [saveItem({ ...dagger, name: null }, true), saveItem(torch, true), saveItem(rope, false)]);
		assert.deepStrictEqual(await carriedIds(), idsOf(dagger, torch));
	});

	it('lets characters keep a disabled item when told to', async () =>
	{
		const dagger = await defaultItem('dagger');
		const carried = await brokkItems();

		await saveAll(ada, universe.universeId, [{ kind: 'saveItem', id: dagger.id, settings: { name: null, type: dagger.type, enabled: false }, whenDisabled: 'keep' }]);

		assert.deepStrictEqual(await brokkItems(), carried);
	});

	it('moves the characters saved in a disabled area to its parent, onto the link leading back in', async () =>
	{
		const { squareAreaId, houseAreaId } = universe;
		const published: AreaChange[] = [];
		const stop = areaChanges.onChange((change) =>
		{
			published.push(change);
		});

		await setAreaParents(houseAreaId, [{ kind: 'region', id: await testRegionId(universe.universeId) }, { kind: 'area', id: squareAreaId }]);
		await addGroup(universe.universeId, brokkId, null);
		await moveMembers([{ characterId: brokkId, areaId: houseAreaId, column: 3, row: 3 }]);

		const disable: EditorChange = { kind: 'updateArea', areaId: houseAreaId, update: { enabled: false }, moveTo: { [houseAreaId]: 'parent' } };

		assert.deepStrictEqual(await impactsOf([disable]), [{ changeIndex: 0, kind: 'area', id: houseAreaId, name: 'House', characters: 1, hasParent: true }]);

		try
		{
			await saveAll(ada, universe.universeId, [disable]);
		}
		finally
		{
			stop();
		}

		const square = { areaId: squareAreaId, column: 5, row: 5 };

		assert.deepStrictEqual((await listMembersInAreas([houseAreaId, squareAreaId])).map(({ characterId, areaId }) => ({ characterId, areaId })), [{ characterId: brokkId, areaId: squareAreaId }]);
		assert.ok(published.some((change) => ((change.kind === 'evacuated') && (change.areaId === houseAreaId) && (JSON.stringify(change.destination) === JSON.stringify(square)))));

		// The square's link into the house is no longer shown, so the square is read again
		assert.ok(published.some((change) => ((change.kind === 'area') && (change.areaId === squareAreaId))));
	});

	it('moves the characters saved in a disabled area to their group\'s starting area', async () =>
	{
		const { houseAreaId, fieldAreaId } = universe;

		await addGroup(universe.universeId, brokkId, fieldAreaId);
		await moveMembers([{ characterId: brokkId, areaId: houseAreaId, column: 3, row: 3 }]);

		// The house is inside no other area, so the only way out is back to the start
		assert.deepStrictEqual(await impactsOf([{ kind: 'updateArea', areaId: houseAreaId, update: { enabled: false } }]), [{ changeIndex: 0, kind: 'area', id: houseAreaId, name: 'House', characters: 1, hasParent: false }]);

		await saveAll(ada, universe.universeId, [{ kind: 'updateArea', areaId: houseAreaId, update: { enabled: false }, moveTo: { [houseAreaId]: 'start' } }]);

		const [member] = await listGroupMembers((await listMembersInAreas([fieldAreaId]))[0]?.groupId ?? '');

		assert.deepStrictEqual(member?.position, { areaId: fieldAreaId, column: 0, row: 0 });
	});

	it('takes the newest members out of groups larger than a lowered group size, never the anchor being', async () =>
	{
		const groupId = await addGroup(universe.universeId, brokkId, null);
		const firstId = await addCharacter(playerId, universe.universeId, 'First');
		const secondId = await addCharacter(playerId, universe.universeId, 'Second');
		const otherAnchorId = await addCharacter(playerId, universe.universeId, 'Other anchor');
		const otherGroupId = await addGroup(universe.universeId, otherAnchorId, null);
		const thirdId = await addCharacter(playerId, universe.universeId, 'Third');
		const fourthId = await addCharacter(playerId, universe.universeId, 'Fourth');
		const left: GroupChange[] = [];

		await inTransaction((transaction) => addGroupMember(groupId, firstId, transaction));
		await inTransaction((transaction) => addGroupMember(groupId, secondId, transaction));
		await inTransaction((transaction) => addGroupMember(otherGroupId, thirdId, transaction));
		await inTransaction((transaction) => addGroupMember(otherGroupId, fourthId, transaction));

		const lower: EditorChange = { kind: 'universe', update: { groupSize: 2 }, largerGroups: 'removeMembers' };

		assert.deepStrictEqual(await impactsOf([lower]), [{ changeIndex: 0, kind: 'groupSize', groupSize: 2, groups: 2 }]);

		const stop = groupChanges.onChange((change) =>
		{
			left.push(change);
		});

		try
		{
			await saveAll(ada, universe.universeId, [lower]);
		}
		finally
		{
			stop();
		}

		assert.deepStrictEqual((await listGroupMembers(groupId)).map((member) => member.characterId), [brokkId, firstId]);
		assert.deepStrictEqual((await listGroupMembers(otherGroupId)).map((member) => member.characterId), [otherAnchorId, thirdId]);
		assert.deepStrictEqual(left.map((change) => ((change.kind === 'left') ? [change.groupId, change.character.characterId, change.groupSizeLowered] : change.kind)).sort(), [[groupId, secondId, true], [otherGroupId, fourthId, true]].sort());
	});

	it('disbands groups larger than a lowered group size when told to, and keeps them when told to', async () =>
	{
		const groupId = await addGroup(universe.universeId, brokkId, null);
		const otherId = await addCharacter(playerId, universe.universeId, 'Other');

		await inTransaction((transaction) => addGroupMember(groupId, otherId, transaction));

		await saveAll(ada, universe.universeId, [{ kind: 'universe', update: { groupSize: 1 }, largerGroups: 'keep' }]);
		assert.strictEqual((await listGroupMembers(groupId)).length, 2);

		// The group size is 1 already, so the group stays larger than it until disbanded another way
		await saveAll(ada, universe.universeId, [{ kind: 'universe', update: { groupSize: 2 } }]);
		await saveAll(ada, universe.universeId, [{ kind: 'universe', update: { groupSize: 1 }, largerGroups: 'disband' }]);
		assert.strictEqual(await findGroup(groupId), undefined);
	});

	it('warns once about something disabled more than once in a save, at its last change, and not about something enabled again', async () =>
	{
		const dwarfId = await defaultRaceId('dwarf');
		const off = await saveRace(dwarfId, { enabled: false });
		const on = await saveRace(dwarfId, { enabled: true });
		const { houseAreaId } = universe;
		const areaOff: EditorChange = { kind: 'updateArea', areaId: houseAreaId, update: { enabled: false } };

		await addGroup(universe.universeId, brokkId, null);
		await moveMembers([{ characterId: brokkId, areaId: houseAreaId, column: 3, row: 3 }]);

		assert.deepStrictEqual((await impactsOf([off, on, off, areaOff, on, off, areaOff])).map(({ changeIndex, kind }) => [changeIndex, kind]), [[5, 'race'], [6, 'area']]);
		assert.deepStrictEqual(await impactsOf([off, on, areaOff, { kind: 'updateArea', areaId: houseAreaId, update: { enabled: true } }]), []);
		assert.deepStrictEqual(await impactsOf([
			{ kind: 'universe', update: { groupSize: 1 } },
			{ kind: 'universe', update: { groupSize: 4 } }
		]), []);
	});

	it('moves nobody out of an area disabled and enabled again in the same save, and does what the last disabling chose', async () =>
	{
		const { squareAreaId, houseAreaId } = universe;
		const published: AreaChange[] = [];
		const stop = areaChanges.onChange((change) =>
		{
			published.push(change);
		});
		const enable: EditorChange = { kind: 'updateArea', areaId: houseAreaId, update: { enabled: true } };
		const placeOfBrokk = async (): Promise<string | undefined> => (await listMembersInAreas([houseAreaId, squareAreaId])).find((member) => (member.characterId === brokkId))?.areaId;

		await setAreaParents(houseAreaId, [{ kind: 'region', id: await testRegionId(universe.universeId) }, { kind: 'area', id: squareAreaId }]);
		await addGroup(universe.universeId, brokkId, null);
		await moveMembers([{ characterId: brokkId, areaId: houseAreaId, column: 3, row: 3 }]);

		try
		{
			await saveAll(ada, universe.universeId, [{ kind: 'updateArea', areaId: houseAreaId, update: { enabled: false }, moveTo: { [houseAreaId]: 'start' } }, enable]);
			assert.strictEqual(await placeOfBrokk(), houseAreaId);
			assert.ok(!published.some((change) => (change.kind === 'evacuated')));

			await saveAll(ada, universe.universeId, [
				{ kind: 'updateArea', areaId: houseAreaId, update: { enabled: false }, moveTo: { [houseAreaId]: 'start' } },
				enable,
				{ kind: 'updateArea', areaId: houseAreaId, update: { enabled: false }, moveTo: { [houseAreaId]: 'parent' } }
			]);
		}
		finally
		{
			stop();
		}

		assert.strictEqual(await placeOfBrokk(), squareAreaId);
		assert.strictEqual(published.filter((change) => (change.kind === 'evacuated')).length, 1);
	});

	it('takes or gives back a carried item only by how a save leaves it', async () =>
	{
		const dagger = await defaultItem('dagger');
		const carried = await brokkItems();
		const saveDagger = (enabled: boolean, whenDisabled?: 'keep' | 'remove'): EditorChange => ({ kind: 'saveItem', id: dagger.id, settings: { name: null, type: dagger.type, enabled }, whenDisabled });
		const hasDagger = async (): Promise<boolean> => (await brokkItems()).some((item) => (item.itemId === dagger.id));

		// Disabled with remove, then enabled again: nothing is taken
		await saveAll(ada, universe.universeId, [saveDagger(false, 'remove'), saveDagger(true)]);
		assert.deepStrictEqual(await brokkItems(), carried);

		await saveAll(ada, universe.universeId, [saveDagger(false, 'remove')]);
		assert.ok(!await hasDagger());

		// Enabled, then disabled again keeping it: still disabled, so nothing is given back
		await saveAll(ada, universe.universeId, [saveDagger(true), saveDagger(false, 'keep')]);
		assert.ok(!await hasDagger());
	});

	it('refuses to say what changes would do to a player whose role couldn\'t save them', async () =>
	{
		const tester = await logIn('Tess');

		await setUniverseRole(universe.universeId, tester.playerId, 'beta_tester');

		const answer = await send(tester, 'POST', `/${universe.universeId}/changes/impact`, { body: { changes: [await saveRace(await defaultRaceId('dwarf'), { enabled: false })] } });

		assert.strictEqual(answer.status, 403);
	});

	it('warns about nothing that players aren\'t using', async () =>
	{
		const elfId = await defaultRaceId('elf');

		assert.deepStrictEqual(await impactsOf([
			await saveRace(elfId, { enabled: false }),
			{ kind: 'updateArea', areaId: universe.houseAreaId, update: { enabled: false } },
			{ kind: 'universe', update: { groupSize: 2 } }
		]), []);
	});
});
