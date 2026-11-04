import assert from 'assert';
import { DEFAULT_PF1E_SETTINGS, type ClassListPayload, type DifficultyLevelListPayload, type ItemListPayload, type RaceListPayload, type TileListPayload, type UniverseEditListPayload } from '@multiverse-kiln/shared';

import { setUniverseRole } from '../src/db/universeEditorRepo.js';
import { createArea, createUniverse, logIn, saveChanges, send, type Editor } from './editorRequests.js';
import { addPlayer } from './players.js';
import { getTestServer } from './testServer.js';

describe('The editor\'s audit of saves', () =>
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

	it('records each save with its player, role and what it changed', async () =>
	{
		const grace = await logIn('Grace');

		await setUniverseRole(universeId, grace.playerId, 'builder');
		assert.strictEqual((await saveChanges(ada, universeId, [
			{ kind: 'universe', update: { shortDescription: 'First' } },
			{ kind: 'universe', update: { shortDescription: 'Second' } }
		])).status, 200);
		assert.strictEqual((await saveChanges(grace, universeId, [
			{ kind: 'createArea', ref: 'new:cave', area: { name: 'Cave' } }
		])).status, 200);

		const response = await send<UniverseEditListPayload>(ada, 'GET', `/${universeId}/audit`);

		assert.strictEqual(response.status, 200, JSON.stringify(response.body));
		assert.strictEqual(response.body.total, 2);
		assert.deepStrictEqual(response.body.edits.map(({ player, role, details }) => ({ player, role, details })), [
			{
				player: { username: 'Grace', displayName: 'Grace' },
				role: 'builder',
				details: [{ subject: 'area', action: 'added', target: { key: null, name: 'Cave' }, fields: [], count: 1 }]
			},
			{
				player: { username: 'Ada', displayName: 'Ada' },
				role: 'creator',
				details: [
					{ subject: 'settings', action: 'changed', target: null, fields: [{ field: 'shortDescription', value: 'First' }], count: 1 },
					{ subject: 'settings', action: 'changed', target: null, fields: [{ field: 'shortDescription', value: 'Second' }], count: 1 }
				]
			}
		]);
		assert.ok(!Number.isNaN(Date.parse(response.body.edits[0].savedAt)));
	});

	it('records the value each setting is changed to, and a long description by its length', async () =>
	{
		assert.strictEqual((await saveChanges(ada, universeId, [
			{
				kind: 'ruleset',
				settings: {
					ruleset: 'pf1e',
					settings: {
						...DEFAULT_PF1E_SETTINGS,
						needsSleep: true,
						coinsHaveWeight: true,
						tracksAmmo: true
					}
				}
			},
			{ kind: 'universe', update: { name: 'Kilnhaven', shortDescription: 'Changed', longDescription: 'A **small** town.' } }
		])).status, 200);

		const [saved] = (await send<UniverseEditListPayload>(ada, 'GET', `/${universeId}/audit`)).body.edits;

		assert.deepStrictEqual(saved.details, [
			{
				subject: 'ruleset',
				action: 'changed',
				target: null,
				fields: [
					{ field: 'needsSleep', value: true },
					{ field: 'coinsHaveWeight', value: true },
					{ field: 'tracksAmmo', value: true }
				],
				count: 1
			},
			{
				subject: 'settings',
				action: 'changed',
				target: null,
				fields: [
					{ field: 'shortDescription', value: 'Changed' },
					{ field: 'longDescription', value: 17 }
				],
				count: 1
			}
		]);
	});

	it('describes each thing a save changed, by name, with the settings that differ', async () =>
	{
		const races = (await send<RaceListPayload>(ada, 'GET', `/${universeId}/races`)).body.races;
		const items = (await send<ItemListPayload>(ada, 'GET', `/${universeId}/items`)).body.items;
		const tiles = (await send<TileListPayload>(ada, 'GET', `/${universeId}/tiles`)).body.tiles;
		const dwarf = races.find((race) => (race.key === 'dwarf'))!;
		const dagger = items.find((item) => (item.key === 'dagger'))!;
		const grass = tiles.find((tile) => (tile.key === 'grass'))!;

		// Each listing's own fields, such as its ID, are left out of the settings as the save reads them
		assert.strictEqual((await saveChanges(ada, universeId, [
			{ kind: 'saveRace', id: dwarf.id, settings: { ...dwarf, rules: { ...dwarf.rules, size: 'large' } } },
			{ kind: 'saveItem', id: dagger.id, settings: { ...dagger, name: 'Shiv', enabled: false } },
			{ kind: 'saveTile', id: grass.id, settings: { ...grass, visionCost: 50, walkSeconds: 9 } },
			{ kind: 'createArea', ref: 'new:cave', area: { name: 'Cave' } },
			{ kind: 'editCells', areaId: 'new:cave', changes: [[0, 0, grass.id], [1, 0, grass.id]] },
			{ kind: 'editCells', areaId: 'new:cave', changes: [[2, 0, grass.id]] },
			{ kind: 'updateArea', areaId: 'new:cave', update: { name: 'Deep Cave', indoors: true } }
		])).status, 200);
		assert.strictEqual((await saveChanges(ada, universeId, [{ kind: 'removeItem', id: dagger.id }])).status, 200);

		const [restored, saved] = (await send<UniverseEditListPayload>(ada, 'GET', `/${universeId}/audit`)).body.edits;

		assert.deepStrictEqual(saved.details, [
			{ subject: 'race', action: 'changed', target: { key: 'dwarf', name: null }, fields: [{ field: 'size', value: 'large' }], count: 1 },
			{
				subject: 'item',
				action: 'changed',
				target: { key: 'dagger', name: 'Shiv' },
				fields: [
					{ field: 'name', value: 'Shiv' },
					{ field: 'enabled', value: false }
				],
				count: 1
			},
			{
				subject: 'tile',
				action: 'changed',
				target: { key: 'grass', name: null },
				fields: [
					{ field: 'visionCost', value: 50 },
					{ field: 'walkSeconds', value: 9 }
				],
				count: 1
			},
			{ subject: 'area', action: 'added', target: { key: null, name: 'Cave' }, fields: [], count: 1 },
			{ subject: 'cells', action: 'changed', target: { key: null, name: 'Cave' }, fields: [], count: 3 },
			{
				subject: 'area',
				action: 'changed',
				target: { key: null, name: 'Deep Cave' },
				fields: [
					{ field: 'name', value: 'Deep Cave' },
					{ field: 'indoorsOrOutdoors', value: true }
				],
				count: 1
			}
		]);
		assert.deepStrictEqual(restored.details, [
			{ subject: 'item', action: 'restored', target: { key: 'dagger', name: 'Shiv' }, fields: [], count: 1 }
		]);
	});

	it('describes changes to editors, settings, classes and difficulty levels, naming what settings name', async () =>
	{
		const grace = await logIn('Grace');
		const meadowId = await createArea(ada, universeId);
		const classes = (await send<ClassListPayload>(ada, 'GET', `/${universeId}/classes`)).body.classes;
		const levels = (await send<DifficultyLevelListPayload>(ada, 'GET', `/${universeId}/difficulty-levels`)).body.difficultyLevels;
		const items = (await send<ItemListPayload>(ada, 'GET', `/${universeId}/items`)).body.items;
		const fighter = classes.find((characterClass) => (characterClass.key === 'fighter'))!;
		const hard = levels.find((level) => (level.key === 'hard'))!;
		const dagger = items.find((item) => (item.key === 'dagger'))!;

		await setUniverseRole(universeId, grace.playerId, 'builder');
		assert.strictEqual((await saveChanges(ada, universeId, [
			{ kind: 'saveEditor', playerId: grace.playerId, settings: { role: 'translator', languages: ['de'] } },
			{
				kind: 'universe',
				update: {
					name: 'Kilnhaven',
					startingAreaId: meadowId,
					startingColumn: 3,
					startingRow: 4,
					startingItems: [{ itemId: dagger.id, quantity: 2 }]
				}
			},
			{ kind: 'saveClass', id: fighter.id, settings: { ...fighter, rules: { ...fighter.rules, primaryAbility: 'dexterity' } } },
			{ kind: 'saveDifficultyLevel', id: hard.id, settings: { ...hard, permadeath: !hard.permadeath } },
			{ kind: 'removeEditor', playerId: grace.playerId }
		])).status, 200);

		const [saved] = (await send<UniverseEditListPayload>(ada, 'GET', `/${universeId}/audit`)).body.edits;

		assert.deepStrictEqual(saved.details, [
			{
				subject: 'editor',
				action: 'changed',
				target: { key: null, name: 'Grace' },
				fields: [
					{ field: 'role', value: 'translator' },
					{ field: 'languages', value: ['de'] }
				],
				count: 1
			},
			{
				subject: 'settings',
				action: 'changed',
				target: null,
				fields: [
					{ field: 'startingItems', value: [{ item: { key: 'dagger', name: null }, quantity: 2 }] },
					{ field: 'startingArea', value: { area: 'Meadow', column: 3, row: 4 } }
				],
				count: 1
			},
			{ subject: 'class', action: 'changed', target: { key: 'fighter', name: null }, fields: [{ field: 'primaryAbility', value: 'dexterity' }], count: 1 },
			{ subject: 'difficultyLevel', action: 'changed', target: { key: 'hard', name: null }, fields: [{ field: 'permadeath', value: !hard.permadeath }], count: 1 },
			{
				subject: 'editor',
				action: 'deleted',
				target: { key: null, name: 'Grace' },
				fields: [
					{ field: 'role', value: 'translator' },
					{ field: 'languages', value: ['de'] }
				],
				count: 1
			}
		]);
	});

	it('lists the role given to each editor added, with a translator\'s languages', async () =>
	{
		const grace = await addPlayer('Grace');
		const alan = await addPlayer('Alan');

		assert.strictEqual((await saveChanges(ada, universeId, [
			{ kind: 'addEditor', username: grace.username, settings: { role: 'builder', languages: [] } },
			{ kind: 'addEditor', username: alan.username, settings: { role: 'translator', languages: ['de', 'fr'] } }
		])).status, 200);

		const [saved] = (await send<UniverseEditListPayload>(ada, 'GET', `/${universeId}/audit`)).body.edits;

		assert.deepStrictEqual(saved.details, [
			{ subject: 'editor', action: 'added', target: { key: null, name: grace.username }, fields: [{ field: 'role', value: 'builder' }], count: 1 },
			{
				subject: 'editor',
				action: 'added',
				target: { key: null, name: alan.username },
				fields: [
					{ field: 'role', value: 'translator' },
					{ field: 'languages', value: ['de', 'fr'] }
				],
				count: 1
			}
		]);
	});

	it('records no save that changed nothing', async () =>
	{
		assert.strictEqual((await saveChanges(ada, universeId, [
			{ kind: 'ruleset', settings: { ruleset: 'pf1e', settings: DEFAULT_PF1E_SETTINGS } },
			{ kind: 'universe', update: { name: 'Kilnhaven' } }
		])).status, 200);

		assert.strictEqual((await send<UniverseEditListPayload>(ada, 'GET', `/${universeId}/audit`)).body.total, 0);
	});

	it('records neither an empty save nor one that was refused', async () =>
	{
		const grace = await logIn('Grace');

		await setUniverseRole(universeId, grace.playerId, 'builder');
		assert.strictEqual((await saveChanges(ada, universeId, [])).status, 200);
		assert.strictEqual((await saveChanges(grace, universeId, [{ kind: 'universe', update: { shortDescription: 'Mine' } }])).status, 403);

		const response = await send<UniverseEditListPayload>(ada, 'GET', `/${universeId}/audit`);

		assert.strictEqual(response.body.total, 0);
	});

	it('is only for roles that may manage the universe\'s editors', async () =>
	{
		const grace = await logIn('Grace');

		for (const [role, status] of [['beta_tester', 403], ['translator', 403], ['builder', 403], ['creator', 200]] as const)
		{
			await setUniverseRole(universeId, grace.playerId, role);
			assert.strictEqual((await send(grace, 'GET', `/${universeId}/audit`)).status, status, role);
		}
	});

	it('refuses a page it can\'t read', async () =>
	{
		assert.strictEqual((await send(ada, 'GET', `/${universeId}/audit?offset=-1`)).status, 400);
		assert.strictEqual((await send(ada, 'GET', `/${universeId}/audit?limit=100000`)).status, 400);
	});
});
