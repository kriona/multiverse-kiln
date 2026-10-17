import assert from 'assert';
import { randomUUID } from 'crypto';
import { chunkKey, DEFAULT_PF1E_SETTINGS, DEFAULT_TILE_CELL, EDITOR_UNIVERSES_PATH, emptyPf1eMoney, isLocalizedMessage, MAX_CREATED_UNIVERSES, MAX_GROUP_PLAYERS, MAX_ITEM_QUANTITY, MAX_STARTING_ITEMS, NEW_PF1E_CLASS_RULES, NEW_PF1E_RACE_RULES, NEW_ZONE_BOUNDS, PF1E_CLASSES, PF1E_MAX_COINS, PF1E_MAX_POINT_BUY_BUDGET, PF1E_MAX_RACE_ABILITY_MODIFIER, PF1E_RACES, VOID_CELL, type ClassListPayload, type ClassSettings, type CreatedPayload, type EditableUniverse, type ErrorPayload, type EditableUniverseListPayload, type EditorClass, type EditorRace, type EditorZone, type ItemListPayload, type ItemSettings, type RaceListPayload, type RaceSettings, type ResizeConflictPayload, type RulesetSettings, type TileListPayload, type TileSettings, type UniverseRole, type ZoneListPayload } from '@multiverse-kiln/shared';

import { findDefaultItemIds } from '../src/db/itemRepo.js';
import { loadOrCreatePlayerByName } from '../src/db/playerRepo.js';
import { setUniverseRole } from '../src/db/universeEditorRepo.js';
import { BROWSER_ID_COOKIE } from '../src/http/browserId.js';
import { onlinePlayers } from '../src/players/onlinePlayers.js';
import { zoneChanges, type ZoneChange } from '../src/world/zoneChanges.js';
import { defaultTileId } from './db/fixtures.js';
import { allowedTestOrigin } from './setup.js';
import { getTestServer, logOutEveryone, testServerUrl } from './testServer.js';

/**
 * A logged-in browser to make editor requests from
 */
interface Editor
{
	browserId: string;
	playerId: string;
}

/**
 * What an editor request answered
 */
interface EditorResponse<T>
{
	status: number;
	body: T;
	headers: Headers;
}

/**
 * A bidirectional override, one of the characters names may not contain
 */
const rightToLeftOverride = String.fromCharCode(0x202e);

const lava: TileSettings = {
	name: 'Lava',
	indoors: false,
	color: 0xff4400,
	visionCost: 0,
	movementCost: 100
};

const torch: ItemSettings = {
	name: 'torch',
	type: 'torch',
	enabled: true
};

const lizardfolk: RaceSettings = {
	name: 'Lizardfolk',
	enabled: true,
	startingMoney: emptyPf1eMoney(),
	startingItems: [],
	startingZoneId: null,
	rules: NEW_PF1E_RACE_RULES
};

const gunslinger: ClassSettings = {
	name: 'Gunslinger',
	enabled: true,
	startingMoney: emptyPf1eMoney(),
	startingItems: [],
	startingZoneId: null,
	raceZones: [],
	rules: NEW_PF1E_CLASS_RULES
};

/**
 * A race's settings as the race editor sends them, without what only the list shows
 *
 * @param race The race, as listed
 * @return Its settings
 */
function raceSettingsOf(race: EditorRace): RaceSettings
{
	const { name, enabled, startingMoney, startingItems, startingZoneId, rules } = race;

	return({ name, enabled, startingMoney, startingItems, startingZoneId, rules });
}

/**
 * A class's settings as the class editor sends them, without what only the list shows
 *
 * @param characterClass The class, as listed
 * @return Its settings
 */
function classSettingsOf(characterClass: EditorClass): ClassSettings
{
	const { name, enabled, startingMoney, startingItems, startingZoneId, raceZones, rules } = characterClass;

	return({ name, enabled, startingMoney, startingItems, startingZoneId, raceZones, rules });
}

/**
 * Logs a new browser in as a player
 *
 * @param name The player's name
 * @return The browser and its player
 */
async function logIn(name: string): Promise<Editor>
{
	const browserId = randomUUID();
	const { id: playerId } = await loadOrCreatePlayerByName(name);

	onlinePlayers.logIn(browserId, playerId, name);

	return({ browserId, playerId });
}

/**
 * Sends a request to an editor route
 *
 * @param editor The browser sending it, or undefined for one that isn't logged in
 * @param method The HTTP method
 * @param path The path under EDITOR_UNIVERSES_PATH, starting with / (or empty)
 * @param options The JSON body, a raw body, and the Origin header to send
 * @return The status, the parsed JSON body (undefined when there is none) and the headers
 */
async function send<T = unknown>(editor: Editor | undefined, method: string, path: string, options: { body?: unknown; rawBody?: string; origin?: string } = {}): Promise<EditorResponse<T>>
{
	const headers: Record<string, string> = {};

	if (editor)
	{
		headers['Cookie'] = `${BROWSER_ID_COOKIE}=${editor.browserId}`;
	}

	if (options.origin !== undefined)
	{
		headers['Origin'] = options.origin;
	}

	if ((options.body !== undefined) || (options.rawBody !== undefined))
	{
		headers['Content-Type'] = 'application/json';
	}

	const response = await fetch(`${testServerUrl}${EDITOR_UNIVERSES_PATH}${path}`, {
		method,
		headers,
		body: (options.rawBody ?? ((options.body === undefined) ? undefined : JSON.stringify(options.body)))
	});
	const text = await response.text();

	return({
		status: response.status,
		body: ((text === '') ? undefined : JSON.parse(text)) as T,
		headers: response.headers
	});
}

/**
 * Creates a universe through the API
 *
 * @param editor The browser creating it
 * @param name The universe's name
 * @return The universe's ID
 */
async function createUniverse(editor: Editor, name: string = 'Kilnhaven'): Promise<string>
{
	const response = await send<CreatedPayload>(editor, 'POST', '', { body: { name, shortDescription: 'A small town.', ruleset: 'pf1e' } });

	assert.strictEqual(response.status, 201, JSON.stringify(response.body));

	return(response.body.id);
}

/**
 * Creates a zone through the API
 *
 * @param editor The browser creating it
 * @param universeId The universe's ID
 * @param settings The zone's settings
 * @return The zone's ID
 */
async function createZone(editor: Editor, universeId: string, settings: Record<string, unknown> = {}): Promise<string>
{
	const response = await send<CreatedPayload>(editor, 'POST', `/${universeId}/zones`, { body: { name: 'Meadow', ...settings } });

	assert.strictEqual(response.status, 201, JSON.stringify(response.body));

	return(response.body.id);
}

describe('World editor API', () =>
{
	let ada: Editor;

	before(async () =>
	{
		await getTestServer();
	});

	beforeEach(async () =>
	{
		logOutEveryone();
		ada = await logIn('Ada');
	});

	describe('access', () =>
	{
		it('answers 401 to a browser that is not logged in, uncached', async () =>
		{
			const response = await send(undefined, 'GET', '');

			assert.strictEqual(response.status, 401);
			assert.strictEqual(response.headers.get('cache-control'), 'no-store');
		});

		it('refuses writes from other origins, and allows them from allowed origins', async () =>
		{
			const body = { name: 'Kilnhaven', shortDescription: '', ruleset: 'pf1e' };

			assert.strictEqual((await send(ada, 'POST', '', { body, origin: 'https://evil.example' })).status, 403);
			assert.strictEqual((await send(ada, 'POST', '', { body, origin: allowedTestOrigin })).status, 201);
		});

		it('answers 404 for a universe the player has no role in, or that does not exist', async () =>
		{
			const universeId = await createUniverse(ada);
			const grace = await logIn('Grace');

			for (const path of [`/${universeId}`, `/${universeId}/zones`, `/${randomUUID()}`, '/not-an-id'])
			{
				assert.strictEqual((await send(grace, 'GET', path)).status, 404, path);
			}
		});

		it('lets builders change the world but not the universe\'s settings, and beta testers neither', async () =>
		{
			const universeId = await createUniverse(ada);
			const roles: [UniverseRole, number, number][] = [['builder', 201, 403], ['beta_tester', 403, 403]];

			for (const [role, tileStatus, settingsStatus] of roles)
			{
				const player = await logIn(`Player ${role}`);

				await setUniverseRole(universeId, player.playerId, role);

				assert.strictEqual((await send(player, 'GET', `/${universeId}`)).status, 200, role);
				assert.strictEqual((await send(player, 'POST', `/${universeId}/tiles`, { body: lava })).status, tileStatus, role);
				assert.strictEqual((await send(player, 'PATCH', `/${universeId}`, { body: { name: 'Mine Now' } })).status, settingsStatus, role);
			}
		});

		it('answers 400 to a body that is not JSON, with a reason the client can translate', async () =>
		{
			const response = await send<ErrorPayload>(ada, 'POST', '', { rawBody: '{ not json' });

			assert.strictEqual(response.status, 400);
			assert.ok(isLocalizedMessage(response.body.error));
			assert.strictEqual(response.body.error.id, 'error.unreadableBody');
		});

		it('gives a refused request\'s reason as a message with its values', async () =>
		{
			const response = await send<ErrorPayload>(ada, 'POST', '', { body: { name: '', shortDescription: '', ruleset: 'pf1e' } });

			assert.strictEqual(response.status, 400);
			assert.strictEqual(response.body.error.id, 'error.invalidRequest');
			assert.strictEqual(typeof response.body.error.values?.problem, 'string');
		});
	});

	describe('universes', () =>
	{
		it('creates a universe with a lobby and a starting zone, and makes the player its creator', async () =>
		{
			const universeId = await createUniverse(ada);
			const universe = (await send<EditableUniverse>(ada, 'GET', `/${universeId}`)).body;
			const zones = (await send<ZoneListPayload>(ada, 'GET', `/${universeId}/zones`)).body;

			assert.strictEqual(universe.name, 'Kilnhaven');
			assert.strictEqual(universe.stage, 'in_the_beginning');
			assert.strictEqual(universe.role, 'creator');
			assert.deepStrictEqual(zones.zones.map((zone) => zone.name), ['Lobby', 'Starting Zone']);
			assert.strictEqual(zones.lobbyZoneId, universe.lobbyZoneId);
			assert.strictEqual(zones.startingZoneId, universe.startingZoneId);
			assert.notStrictEqual(universe.lobbyZoneId, universe.startingZoneId);

			const lobby = (await send<EditorZone>(ada, 'GET', `/${universeId}/zones/${universe.lobbyZoneId}`)).body;

			assert.deepStrictEqual(lobby.bounds, NEW_ZONE_BOUNDS);
			assert.strictEqual(lobby.defaultTileId, await defaultTileId('grass'));
		});

		it('lists the player\'s universes', async () =>
		{
			await createUniverse(ada, 'Zebra');
			await createUniverse(ada, 'Apple');
			await createUniverse(await logIn('Grace'), 'Theirs');

			const response = await send<EditableUniverseListPayload>(ada, 'GET', '');

			assert.deepStrictEqual(response.body.universes.map((universe) => [universe.name, universe.role]), [['Apple', 'creator'], ['Zebra', 'creator']]);
		});

		it(`allows each player at most ${MAX_CREATED_UNIVERSES} universes`, async () =>
		{
			for (let created = 0; created < MAX_CREATED_UNIVERSES; created++)
			{
				await createUniverse(ada, `Universe ${created}`);
			}

			const refused = await send(ada, 'POST', '', { body: { name: 'One Too Many', shortDescription: '', ruleset: 'pf1e' } });

			assert.strictEqual(refused.status, 409);
			assert.strictEqual((await send<EditableUniverseListPayload>(ada, 'GET', '')).body.universes.length, MAX_CREATED_UNIVERSES);
		});

		it('refuses a universe without a valid name or ruleset', async () =>
		{
			for (const body of [{ name: '', shortDescription: '', ruleset: 'pf1e' }, { name: `A${rightToLeftOverride}b`, shortDescription: '', ruleset: 'pf1e' }, { name: 'Kilnhaven', shortDescription: '', ruleset: 'dnd' }])
			{
				assert.strictEqual((await send(ada, 'POST', '', { body })).status, 400, JSON.stringify(body));
			}
		});

		it('changes the settings, keeping faerie time and its morning together', async () =>
		{
			const universeId = await createUniverse(ada);
			const path = `/${universeId}`;

			assert.strictEqual((await send(ada, 'PATCH', path, { body: { passageOfTime: 'faerie' } })).status, 400);
			assert.strictEqual((await send(ada, 'PATCH', path, { body: { faerieMorning: 'east' } })).status, 400);
			assert.strictEqual((await send(ada, 'PATCH', path, { body: { passageOfTime: 'faerie', faerieMorning: 'east', longDescription: '# Welcome\n\nA **small** town.', stage: 'prologue' } })).status, 204);

			let universe = (await send<EditableUniverse>(ada, 'GET', path)).body;

			assert.strictEqual(universe.passageOfTime, 'faerie');
			assert.strictEqual(universe.faerieMorning, 'east');
			assert.strictEqual(universe.longDescription, '# Welcome\n\nA **small** town.');
			assert.strictEqual(universe.stage, 'prologue');

			assert.strictEqual((await send(ada, 'PATCH', path, { body: { passageOfTime: 'always_noon' } })).status, 400);
			assert.strictEqual((await send(ada, 'PATCH', path, { body: { passageOfTime: 'always_noon', faerieMorning: null } })).status, 204);

			universe = (await send<EditableUniverse>(ada, 'GET', path)).body;

			assert.strictEqual(universe.faerieMorning, null);
		});
	});

	describe('character settings', () =>
	{
		it('starts a universe with groups of the most players, no money, and its starting zone', async () =>
		{
			const universe = (await send<EditableUniverse>(ada, 'GET', `/${await createUniverse(ada)}`)).body;

			assert.strictEqual(universe.groupSize, MAX_GROUP_PLAYERS);
			assert.deepStrictEqual(universe.startingMoney, emptyPf1eMoney());
			assert.notStrictEqual(universe.startingZoneId, null);
		});

		it('changes the group size, starting money and starting zone, keeping each coin as given', async () =>
		{
			const universeId = await createUniverse(ada);
			const zoneId = await createZone(ada, universeId);
			const path = `/${universeId}`;
			const startingMoney = {
				pp: 1,
				gp: 302,
				sp: 4444,
				cp: 10
			};

			assert.strictEqual((await send(ada, 'PATCH', path, { body: { groupSize: 1, startingMoney, startingZoneId: zoneId } })).status, 204);

			const universe = (await send<EditableUniverse>(ada, 'GET', path)).body;

			assert.strictEqual(universe.groupSize, 1);
			assert.deepStrictEqual(universe.startingMoney, startingMoney);
			assert.strictEqual(universe.startingZoneId, zoneId);
		});

		it('refuses group sizes and money out of range', async () =>
		{
			const path = `/${await createUniverse(ada)}`;
			const tooMuchGold = {
				...emptyPf1eMoney(),
				gp: PF1E_MAX_COINS + 1
			};
			const negativeCopper = {
				...emptyPf1eMoney(),
				cp: -1
			};
			const bodies = [
				{ groupSize: 0 },
				{ groupSize: MAX_GROUP_PLAYERS + 1 },
				{ groupSize: 2.5 },
				{ startingMoney: 1224 },
				{ startingMoney: { gp: 5 } },
				{ startingMoney: tooMuchGold },
				{ startingMoney: negativeCopper },
				{ startingZoneId: null }
			];

			for (const body of bodies)
			{
				assert.strictEqual((await send(ada, 'PATCH', path, { body })).status, 400, JSON.stringify(body));
			}
		});

		it('starts a universe with a dagger for every character, and changes its starting equipment', async () =>
		{
			const universeId = await createUniverse(ada);
			const path = `/${universeId}`;
			const daggerId = (await findDefaultItemIds('pf1e')).get('dagger') as number;
			const torchId = (await send<CreatedPayload<number>>(ada, 'POST', `${path}/items`, { body: torch })).body.id;

			assert.deepStrictEqual((await send<EditableUniverse>(ada, 'GET', path)).body.startingItems, [{ itemId: daggerId, quantity: 1 }]);

			const startingItems = [{ itemId: torchId, quantity: 3 }, { itemId: daggerId, quantity: 2 }];

			assert.strictEqual((await send(ada, 'PATCH', path, { body: { startingItems } })).status, 204);
			assert.deepStrictEqual((await send<EditableUniverse>(ada, 'GET', path)).body.startingItems, [{ itemId: daggerId, quantity: 2 }, { itemId: torchId, quantity: 3 }]);

			const listed = (await send<ItemListPayload>(ada, 'GET', `${path}/items?ids=${torchId},${daggerId}`)).body;

			assert.deepStrictEqual(listed.items.map((item) => item.id), [daggerId, torchId]);

			assert.strictEqual((await send(ada, 'PATCH', path, { body: { startingItems: [] } })).status, 204);
			assert.deepStrictEqual((await send<EditableUniverse>(ada, 'GET', path)).body.startingItems, []);
		});

		it('refuses starting equipment with an item twice, a quantity out of range, or an item the universe doesn\'t have', async () =>
		{
			const universeId = await createUniverse(ada);
			const path = `/${universeId}`;
			const daggerId = (await findDefaultItemIds('pf1e')).get('dagger') as number;
			const theirItemId = (await send<CreatedPayload<number>>(ada, 'POST', `/${await createUniverse(ada, 'Other')}/items`, { body: torch })).body.id;
			const tooMany = Array.from({ length: MAX_STARTING_ITEMS + 1 }, (_, index) => ({ itemId: index + 1, quantity: 1 }));

			for (const startingItems of [[{ itemId: daggerId, quantity: 1 }, { itemId: daggerId, quantity: 2 }], [{ itemId: daggerId, quantity: 0 }], [{ itemId: daggerId, quantity: MAX_ITEM_QUANTITY + 1 }], tooMany])
			{
				assert.strictEqual((await send(ada, 'PATCH', path, { body: { startingItems } })).status, 400, JSON.stringify(startingItems).slice(0, 80));
			}

			const response = await send<ErrorPayload>(ada, 'PATCH', path, { body: { startingItems: [{ itemId: theirItemId, quantity: 1 }] } });

			assert.strictEqual(response.status, 400);
			assert.strictEqual(response.body.error.id, 'error.unusableStartingItem');
			assert.deepStrictEqual((await send<EditableUniverse>(ada, 'GET', path)).body.startingItems, [{ itemId: daggerId, quantity: 1 }]);
		});

		it('refuses to delete an item characters start with, and deletes it once they don\'t', async () =>
		{
			const universeId = await createUniverse(ada);
			const path = `/${universeId}`;
			const torchId = (await send<CreatedPayload<number>>(ada, 'POST', `${path}/items`, { body: torch })).body.id;

			await send(ada, 'PATCH', path, { body: { startingItems: [{ itemId: torchId, quantity: 1 }] } });
			assert.strictEqual((await send(ada, 'DELETE', `${path}/items/${torchId}`)).status, 409);

			await send(ada, 'PATCH', path, { body: { startingItems: [] } });
			assert.strictEqual((await send(ada, 'DELETE', `${path}/items/${torchId}`)).status, 204);
		});

		it('refuses the lobby, or a zone of another universe, as the starting zone', async () =>
		{
			const universeId = await createUniverse(ada);
			const universe = (await send<EditableUniverse>(ada, 'GET', `/${universeId}`)).body;
			const otherZoneId = await createZone(ada, await createUniverse(ada, 'Elsewhere'));

			for (const startingZoneId of [universe.lobbyZoneId, otherZoneId, randomUUID()])
			{
				const response = await send<ErrorPayload>(ada, 'PATCH', `/${universeId}`, { body: { startingZoneId } });

				assert.strictEqual(response.status, 400);
				assert.strictEqual(response.body.error.id, 'error.unusableStartingZone');
			}

			assert.strictEqual((await send<EditableUniverse>(ada, 'GET', `/${universeId}`)).body.startingZoneId, universe.startingZoneId);
		});
	});

	describe('ruleset settings', () =>
	{
		const custom: RulesetSettings = {
			ruleset: 'pf1e',
			settings: {
				statMethod: 'point_buy_custom',
				customPointBuyBudget: 30,
				needsSleep: true,
				coinsHaveWeight: true,
				tracksAmmo: false
			}
		};

		it('gives a new universe the default settings', async () =>
		{
			const response = await send<RulesetSettings>(ada, 'GET', `/${await createUniverse(ada)}/ruleset`);

			assert.strictEqual(response.status, 200);
			assert.deepStrictEqual(response.body, { ruleset: 'pf1e', settings: DEFAULT_PF1E_SETTINGS });
		});

		it('saves the settings, and saves them again over the first', async () =>
		{
			const path = `/${await createUniverse(ada)}/ruleset`;

			assert.strictEqual((await send(ada, 'PUT', path, { body: custom })).status, 204);
			assert.deepStrictEqual((await send<RulesetSettings>(ada, 'GET', path)).body, custom);

			const rolled: RulesetSettings = {
				ruleset: 'pf1e',
				settings: {
					...custom.settings,
					statMethod: 'roll_3d6'
				}
			};

			assert.strictEqual((await send(ada, 'PUT', path, { body: rolled })).status, 204);
			assert.deepStrictEqual((await send<RulesetSettings>(ada, 'GET', path)).body, rolled);
		});

		it('refuses unknown methods and budgets out of range', async () =>
		{
			const path = `/${await createUniverse(ada)}/ruleset`;
			const settings = [
				{ statMethod: 'roll_2d6' },
				{ customPointBuyBudget: -1 },
				{ customPointBuyBudget: PF1E_MAX_POINT_BUY_BUDGET + 1 },
				{ needsSleep: 'yes' }
			];

			for (const changed of settings)
			{
				const body = {
					ruleset: 'pf1e',
					settings: {
						...custom.settings,
						...changed
					}
				};

				assert.strictEqual((await send(ada, 'PUT', path, { body })).status, 400, JSON.stringify(changed));
			}

			assert.strictEqual((await send(ada, 'PUT', path, { body: { ...custom, ruleset: 'dnd' } })).status, 400);
		});

		it('lets builders read the settings but only creators change them', async () =>
		{
			const universeId = await createUniverse(ada);
			const grace = await logIn('Grace');

			await setUniverseRole(universeId, grace.playerId, 'builder');

			assert.strictEqual((await send(grace, 'GET', `/${universeId}/ruleset`)).status, 200);
			assert.strictEqual((await send(grace, 'PUT', `/${universeId}/ruleset`, { body: custom })).status, 403);
		});
	});

	describe('tiles', () =>
	{
		it('adds a tile, and lists tiles with filters', async () =>
		{
			const universeId = await createUniverse(ada);
			const created = await send<CreatedPayload<number>>(ada, 'POST', `/${universeId}/tiles`, { body: lava });

			assert.strictEqual(created.status, 201);

			const custom = (await send<TileListPayload>(ada, 'GET', `/${universeId}/tiles?custom=true`)).body;
			const impassable = (await send<TileListPayload>(ada, 'GET', `/${universeId}/tiles?passable=false&name=a`)).body;
			const page = (await send<TileListPayload>(ada, 'GET', `/${universeId}/tiles?limit=2&offset=1`)).body;

			assert.deepStrictEqual(custom.tiles, [{ id: created.body.id, key: null, ...lava, custom: true, edited: false }]);

			// Default tiles that keep their names are named by their keys, in the player's language
			assert.deepStrictEqual(impassable.tiles.map((tile) => (tile.name ?? tile.key)), ['mountains', 'water', 'Lava']);
			assert.strictEqual(page.total, 7);
			assert.strictEqual(page.tiles.length, 2);
			assert.strictEqual((await send(ada, 'GET', `/${universeId}/tiles?passable=yes`)).status, 400);
		});

		it('edits a default tile for this universe only, and restores it', async () =>
		{
			const universeId = await createUniverse(ada);
			const otherId = await createUniverse(ada, 'Other');
			const grassId = await defaultTileId('grass');
			const autumn = { name: 'Autumn Grass', indoors: false, color: 0xc08030, visionCost: 0, movementCost: 0 };

			assert.strictEqual((await send(ada, 'PUT', `/${universeId}/tiles/${grassId}`, { body: autumn })).status, 204);

			const edited = (await send<TileListPayload>(ada, 'GET', `/${universeId}/tiles?edited=true`)).body;
			const untouched = (await send<TileListPayload>(ada, 'GET', `/${otherId}/tiles?edited=true`)).body;

			assert.deepStrictEqual(edited.tiles, [{ id: grassId, key: 'grass', ...autumn, custom: false, edited: true }]);
			assert.deepStrictEqual(untouched.tiles, []);

			assert.strictEqual((await send(ada, 'DELETE', `/${universeId}/tiles/${grassId}`)).status, 204);
			assert.deepStrictEqual((await send<TileListPayload>(ada, 'GET', `/${universeId}/tiles?edited=true`)).body.tiles, []);
		});

		it('keeps a default tile\'s own name when an edit leaves the name out, but not a custom tile\'s', async () =>
		{
			const universeId = await createUniverse(ada);
			const grassId = await defaultTileId('grass');
			const tileId = (await send<CreatedPayload<number>>(ada, 'POST', `/${universeId}/tiles`, { body: lava })).body.id;
			const darker = { name: null, indoors: false, color: 0x206010, visionCost: 0, movementCost: 0 };

			assert.strictEqual((await send(ada, 'PUT', `/${universeId}/tiles/${grassId}`, { body: darker })).status, 204);
			assert.deepStrictEqual((await send<TileListPayload>(ada, 'GET', `/${universeId}/tiles?edited=true`)).body.tiles, [{ id: grassId, key: 'grass', ...darker, custom: false, edited: true }]);
			assert.strictEqual((await send(ada, 'PUT', `/${universeId}/tiles/${tileId}`, { body: darker })).status, 400);
		});

		it('refuses to delete a tile a map uses, and deletes it once nothing does', async () =>
		{
			const universeId = await createUniverse(ada);
			const universe = (await send<EditableUniverse>(ada, 'GET', `/${universeId}`)).body;
			const tileId = (await send<CreatedPayload<number>>(ada, 'POST', `/${universeId}/tiles`, { body: lava })).body.id;
			const cellsPath = `/${universeId}/zones/${universe.lobbyZoneId}/cells`;

			await send(ada, 'PATCH', cellsPath, { body: { changes: [[0, 0, tileId]] } });
			assert.strictEqual((await send(ada, 'DELETE', `/${universeId}/tiles/${tileId}`)).status, 409);

			await send(ada, 'PATCH', cellsPath, { body: { changes: [[0, 0, DEFAULT_TILE_CELL]] } });
			assert.strictEqual((await send(ada, 'DELETE', `/${universeId}/tiles/${tileId}`)).status, 204);
			assert.strictEqual((await send(ada, 'DELETE', `/${universeId}/tiles/${tileId}`)).status, 404);
		});

		it('answers 404 for a tile of another universe, and 400 for invalid settings', async () =>
		{
			const universeId = await createUniverse(ada);
			const otherId = await createUniverse(ada, 'Other');
			const theirTileId = (await send<CreatedPayload<number>>(ada, 'POST', `/${otherId}/tiles`, { body: lava })).body.id;

			assert.strictEqual((await send(ada, 'PUT', `/${universeId}/tiles/${theirTileId}`, { body: lava })).status, 404);
			assert.strictEqual((await send(ada, 'PUT', `/${universeId}/tiles/abc`, { body: lava })).status, 404);

			for (const body of [{ ...lava, movementCost: 101 }, { ...lava, color: 0x1000000 }, { ...lava, name: '' }, { ...lava, name: null }])
			{
				assert.strictEqual((await send(ada, 'POST', `/${universeId}/tiles`, { body })).status, 400, JSON.stringify(body));
			}
		});
	});

	describe('items', () =>
	{
		it('adds an item, and lists items with filters', async () =>
		{
			const universeId = await createUniverse(ada);
			const created = await send<CreatedPayload<number>>(ada, 'POST', `/${universeId}/items`, { body: torch });

			assert.strictEqual(created.status, 201);

			const custom = (await send<ItemListPayload>(ada, 'GET', `/${universeId}/items?custom=true`)).body;
			const weapons = (await send<ItemListPayload>(ada, 'GET', `/${universeId}/items?category=weapon`)).body;
			const page = (await send<ItemListPayload>(ada, 'GET', `/${universeId}/items?limit=1&offset=1`)).body;

			assert.deepStrictEqual(custom.items, [{ id: created.body.id, key: null, ...torch, custom: true, edited: false }]);

			// Default items that keep their names are named by their keys, in the player's language
			assert.deepStrictEqual(weapons.items.map((item) => (item.name ?? item.key)), ['dagger']);
			assert.strictEqual(page.total, 2);
			assert.deepStrictEqual(page.items.map((item) => item.id), [created.body.id]);
			assert.strictEqual((await send(ada, 'GET', `/${universeId}/items?enabled=yes`)).status, 400);
		});

		it('edits a default item for this universe only, and restores it', async () =>
		{
			const universeId = await createUniverse(ada);
			const otherId = await createUniverse(ada, 'Other');
			const daggerId = (await findDefaultItemIds('pf1e')).get('dagger');
			const disabled = { name: null, type: 'dagger', enabled: false };

			assert.strictEqual((await send(ada, 'PUT', `/${universeId}/items/${daggerId}`, { body: disabled })).status, 204);
			assert.deepStrictEqual((await send<ItemListPayload>(ada, 'GET', `/${universeId}/items?edited=true`)).body.items, [{ id: daggerId, key: 'dagger', ...disabled, custom: false, edited: true }]);
			assert.deepStrictEqual((await send<ItemListPayload>(ada, 'GET', `/${otherId}/items?edited=true`)).body.items, []);

			assert.strictEqual((await send(ada, 'DELETE', `/${universeId}/items/${daggerId}`)).status, 204);
			assert.deepStrictEqual((await send<ItemListPayload>(ada, 'GET', `/${universeId}/items?edited=true`)).body.items, []);
		});

		it('deletes a custom item, and answers 404 for one of another universe', async () =>
		{
			const universeId = await createUniverse(ada);
			const otherId = await createUniverse(ada, 'Other');
			const itemId = (await send<CreatedPayload<number>>(ada, 'POST', `/${universeId}/items`, { body: torch })).body.id;
			const theirItemId = (await send<CreatedPayload<number>>(ada, 'POST', `/${otherId}/items`, { body: torch })).body.id;

			assert.strictEqual((await send(ada, 'PUT', `/${universeId}/items/${theirItemId}`, { body: torch })).status, 404);
			assert.strictEqual((await send(ada, 'PUT', `/${universeId}/items/abc`, { body: torch })).status, 404);
			assert.strictEqual((await send(ada, 'DELETE', `/${universeId}/items/${itemId}`)).status, 204);
			assert.strictEqual((await send(ada, 'DELETE', `/${universeId}/items/${itemId}`)).status, 404);
		});

		it('refuses an unknown type, a custom item without a name and invalid settings', async () =>
		{
			const universeId = await createUniverse(ada);
			const itemId = (await send<CreatedPayload<number>>(ada, 'POST', `/${universeId}/items`, { body: torch })).body.id;

			for (const body of [{ ...torch, type: 'lightsaber' }, { ...torch, name: null }, { ...torch, name: '' }, { ...torch, enabled: 'yes' }])
			{
				assert.strictEqual((await send(ada, 'POST', `/${universeId}/items`, { body })).status, 400, JSON.stringify(body));
			}

			assert.strictEqual((await send(ada, 'PUT', `/${universeId}/items/${itemId}`, { body: { ...torch, name: null } })).status, 400);
			assert.strictEqual((await send(ada, 'PUT', `/${universeId}/items/${itemId}`, { body: { ...torch, type: 'lightsaber' } })).status, 400);
		});

		it('lets builders change items, but not beta testers', async () =>
		{
			const universeId = await createUniverse(ada);
			const grace = await logIn('Grace');

			await setUniverseRole(universeId, grace.playerId, 'beta_tester');
			assert.strictEqual((await send(grace, 'GET', `/${universeId}/items`)).status, 200);
			assert.strictEqual((await send(grace, 'POST', `/${universeId}/items`, { body: torch })).status, 403);

			await setUniverseRole(universeId, grace.playerId, 'builder');
			assert.strictEqual((await send(grace, 'POST', `/${universeId}/items`, { body: torch })).status, 201);
		});
	});

	describe('races', () =>
	{
		it('lists the default races, and edits one for this universe only before restoring it', async () =>
		{
			const universeId = await createUniverse(ada);
			const otherId = await createUniverse(ada, 'Other');
			const races = (await send<RaceListPayload>(ada, 'GET', `/${universeId}/races`)).body.races;
			const dwarf = races.find((race) => (race.key === 'dwarf')) as EditorRace;
			const { id, key, custom } = dwarf;
			const changed: RaceSettings = {
				...raceSettingsOf(dwarf),
				startingMoney: {
					...emptyPf1eMoney(),
					gp: 10
				},
				startingZoneId: await createZone(ada, universeId)
			};

			assert.deepStrictEqual(races.map((race) => race.key), Object.keys(PF1E_RACES));
			assert.strictEqual((await send(ada, 'PUT', `/${universeId}/races/${id}`, { body: changed })).status, 204);

			const after = (await send<RaceListPayload>(ada, 'GET', `/${universeId}/races`)).body.races;
			const theirs = (await send<RaceListPayload>(ada, 'GET', `/${otherId}/races`)).body.races;

			assert.deepStrictEqual(after.find((race) => (race.id === id)), { id, key, ...changed, custom, edited: true });
			assert.deepStrictEqual(theirs.find((race) => (race.id === id)), dwarf);

			assert.strictEqual((await send(ada, 'DELETE', `/${universeId}/races/${id}`)).status, 204);
			assert.deepStrictEqual((await send<RaceListPayload>(ada, 'GET', `/${universeId}/races`)).body.races.find((race) => (race.id === id)), dwarf);
		});

		it('adds and deletes a custom race, and answers 404 for one of another universe', async () =>
		{
			const universeId = await createUniverse(ada);
			const otherId = await createUniverse(ada, 'Other');
			const created = await send<CreatedPayload<number>>(ada, 'POST', `/${universeId}/races`, { body: lizardfolk });
			const theirRaceId = (await send<CreatedPayload<number>>(ada, 'POST', `/${otherId}/races`, { body: lizardfolk })).body.id;

			assert.strictEqual(created.status, 201);
			assert.deepStrictEqual((await send<RaceListPayload>(ada, 'GET', `/${universeId}/races`)).body.races.filter((race) => race.custom), [{ id: created.body.id, key: null, ...lizardfolk, custom: true, edited: false }]);
			assert.strictEqual((await send(ada, 'PUT', `/${universeId}/races/${theirRaceId}`, { body: lizardfolk })).status, 404);
			assert.strictEqual((await send(ada, 'PUT', `/${universeId}/races/abc`, { body: lizardfolk })).status, 404);
			assert.strictEqual((await send(ada, 'DELETE', `/${universeId}/races/${created.body.id}`)).status, 204);
			assert.strictEqual((await send(ada, 'DELETE', `/${universeId}/races/${created.body.id}`)).status, 404);
		});

		it('refuses a custom race without a name, invalid rules, and zones or items the universe can\'t use', async () =>
		{
			const universeId = await createUniverse(ada);
			const universe = (await send<EditableUniverse>(ada, 'GET', `/${universeId}`)).body;
			const otherId = await createUniverse(ada, 'Other');
			const theirZoneId = await createZone(ada, otherId);
			const theirItemId = (await send<CreatedPayload<number>>(ada, 'POST', `/${otherId}/items`, { body: torch })).body.id;
			const invalid = [
				{ ...lizardfolk, name: null },
				{ ...lizardfolk, name: '' },
				{ ...lizardfolk, rules: { ...lizardfolk.rules, size: 'enormous' } },
				{ ...lizardfolk, rules: { ...lizardfolk.rules, abilityModifiers: { ...lizardfolk.rules.abilityModifiers, wisdom: PF1E_MAX_RACE_ABILITY_MODIFIER + 1 } } },
				{ ...lizardfolk, startingItems: [{ itemId: 1, quantity: 0 }] }
			];

			for (const body of invalid)
			{
				assert.strictEqual((await send(ada, 'POST', `/${universeId}/races`, { body })).status, 400, JSON.stringify(body));
			}

			for (const startingZoneId of [universe.lobbyZoneId, theirZoneId])
			{
				const response = await send<ErrorPayload>(ada, 'POST', `/${universeId}/races`, { body: { ...lizardfolk, startingZoneId } });

				assert.strictEqual(response.body.error.id, 'error.unusableStartingZone');
			}

			const response = await send<ErrorPayload>(ada, 'POST', `/${universeId}/races`, { body: { ...lizardfolk, startingItems: [{ itemId: theirItemId, quantity: 1 }] } });

			assert.strictEqual(response.body.error.id, 'error.unusableStartingItem');
			assert.deepStrictEqual((await send<RaceListPayload>(ada, 'GET', `/${universeId}/races`)).body.races.filter((race) => race.custom), []);
		});

		it('keeps at least one race enabled', async () =>
		{
			const universeId = await createUniverse(ada);
			const raceId = (await send<CreatedPayload<number>>(ada, 'POST', `/${universeId}/races`, { body: lizardfolk })).body.id;

			for (const race of (await send<RaceListPayload>(ada, 'GET', `/${universeId}/races`)).body.races.filter((listed) => !listed.custom))
			{
				assert.strictEqual((await send(ada, 'PUT', `/${universeId}/races/${race.id}`, { body: { ...raceSettingsOf(race), enabled: false } })).status, 204, race.key ?? '');
			}

			assert.strictEqual((await send<ErrorPayload>(ada, 'PUT', `/${universeId}/races/${raceId}`, { body: { ...lizardfolk, enabled: false } })).body.error.id, 'error.noEnabledRace');
			assert.strictEqual((await send(ada, 'DELETE', `/${universeId}/races/${raceId}`)).status, 409);
			assert.strictEqual((await send(ada, 'POST', `/${universeId}/races`, { body: { ...lizardfolk, enabled: false } })).status, 201);
		});

		it('refuses to delete an item a race starts with', async () =>
		{
			const universeId = await createUniverse(ada);
			const torchId = (await send<CreatedPayload<number>>(ada, 'POST', `/${universeId}/items`, { body: torch })).body.id;
			const raceId = (await send<CreatedPayload<number>>(ada, 'POST', `/${universeId}/races`, { body: { ...lizardfolk, startingItems: [{ itemId: torchId, quantity: 2 }] } })).body.id;

			assert.strictEqual((await send(ada, 'DELETE', `/${universeId}/items/${torchId}`)).status, 409);

			await send(ada, 'PUT', `/${universeId}/races/${raceId}`, { body: lizardfolk });
			assert.strictEqual((await send(ada, 'DELETE', `/${universeId}/items/${torchId}`)).status, 204);
		});

		it('lets only creators change races', async () =>
		{
			const universeId = await createUniverse(ada);
			const grace = await logIn('Grace');

			await setUniverseRole(universeId, grace.playerId, 'builder');
			assert.strictEqual((await send(grace, 'GET', `/${universeId}/races`)).status, 200);
			assert.strictEqual((await send(grace, 'POST', `/${universeId}/races`, { body: lizardfolk })).status, 403);
		});
	});

	describe('classes', () =>
	{
		it('adds a class with a zone for some races, and edits a default class before restoring it', async () =>
		{
			const universeId = await createUniverse(ada);
			const zoneId = await createZone(ada, universeId);
			const races = (await send<RaceListPayload>(ada, 'GET', `/${universeId}/races`)).body.races;
			const settings: ClassSettings = {
				...gunslinger,
				raceZones: [{ raceId: races[0].id, zoneId }]
			};
			const created = await send<CreatedPayload<number>>(ada, 'POST', `/${universeId}/classes`, { body: settings });
			const classes = (await send<ClassListPayload>(ada, 'GET', `/${universeId}/classes`)).body.classes;

			assert.strictEqual(created.status, 201);
			assert.deepStrictEqual(classes.map((characterClass) => characterClass.key), [...Object.keys(PF1E_CLASSES), null]);
			assert.deepStrictEqual(classes.find((characterClass) => characterClass.custom), { id: created.body.id, key: null, ...settings, custom: true, edited: false });

			const wizard = classes.find((characterClass) => (characterClass.key === 'wizard')) as EditorClass;
			const { id, key, custom } = wizard;
			const changed: ClassSettings = {
				...classSettingsOf(wizard),
				startingZoneId: zoneId
			};

			assert.strictEqual((await send(ada, 'PUT', `/${universeId}/classes/${id}`, { body: changed })).status, 204);
			assert.deepStrictEqual((await send<ClassListPayload>(ada, 'GET', `/${universeId}/classes`)).body.classes.find((characterClass) => (characterClass.id === id)), { id, key, ...changed, custom, edited: true });

			assert.strictEqual((await send(ada, 'DELETE', `/${universeId}/classes/${id}`)).status, 204);
			assert.deepStrictEqual((await send<ClassListPayload>(ada, 'GET', `/${universeId}/classes`)).body.classes.find((characterClass) => (characterClass.id === id)), wizard);
		});

		it('refuses zones for races alongside a zone for every race, and zones for races the universe doesn\'t have', async () =>
		{
			const universeId = await createUniverse(ada);
			const zoneId = await createZone(ada, universeId);
			const theirRaceId = (await send<CreatedPayload<number>>(ada, 'POST', `/${await createUniverse(ada, 'Other')}/races`, { body: lizardfolk })).body.id;
			const elfId = (await send<RaceListPayload>(ada, 'GET', `/${universeId}/races`)).body.races[3].id;
			const both = {
				...gunslinger,
				startingZoneId: zoneId,
				raceZones: [{ raceId: elfId, zoneId }]
			};
			const twice = {
				...gunslinger,
				raceZones: [{ raceId: elfId, zoneId }, { raceId: elfId, zoneId }]
			};

			assert.strictEqual((await send(ada, 'POST', `/${universeId}/classes`, { body: both })).status, 400);
			assert.strictEqual((await send(ada, 'POST', `/${universeId}/classes`, { body: twice })).status, 400);
			assert.strictEqual((await send(ada, 'POST', `/${universeId}/classes`, { body: { ...gunslinger, rules: { ...gunslinger.rules, tradition: 'psychic' } } })).status, 400);

			const response = await send<ErrorPayload>(ada, 'POST', `/${universeId}/classes`, { body: { ...gunslinger, raceZones: [{ raceId: theirRaceId, zoneId }] } });

			assert.strictEqual(response.status, 400);
			assert.strictEqual(response.body.error.id, 'error.unknownRaceZone');
		});

		it('keeps at least one class enabled', async () =>
		{
			const universeId = await createUniverse(ada);
			const classId = (await send<CreatedPayload<number>>(ada, 'POST', `/${universeId}/classes`, { body: gunslinger })).body.id;

			for (const characterClass of (await send<ClassListPayload>(ada, 'GET', `/${universeId}/classes`)).body.classes.filter((listed) => !listed.custom))
			{
				assert.strictEqual((await send(ada, 'PUT', `/${universeId}/classes/${characterClass.id}`, { body: { ...classSettingsOf(characterClass), enabled: false } })).status, 204, characterClass.key ?? '');
			}

			assert.strictEqual((await send<ErrorPayload>(ada, 'PUT', `/${universeId}/classes/${classId}`, { body: { ...gunslinger, enabled: false } })).body.error.id, 'error.noEnabledClass');
			assert.strictEqual((await send(ada, 'DELETE', `/${universeId}/classes/${classId}`)).status, 409);
		});

		it('refuses to delete an item a class starts with', async () =>
		{
			const universeId = await createUniverse(ada);
			const torchId = (await send<CreatedPayload<number>>(ada, 'POST', `/${universeId}/items`, { body: torch })).body.id;

			await send(ada, 'POST', `/${universeId}/classes`, { body: { ...gunslinger, startingItems: [{ itemId: torchId, quantity: 1 }] } });
			assert.strictEqual((await send(ada, 'DELETE', `/${universeId}/items/${torchId}`)).status, 409);
		});
	});

	describe('zones', () =>
	{
		it('creates a zone with its defaults', async () =>
		{
			const universeId = await createUniverse(ada);
			const outsideId = await createZone(ada, universeId);
			const insideId = await createZone(ada, universeId, { name: 'Cellar', indoors: true, parentZoneId: outsideId });
			const outside = (await send<EditorZone>(ada, 'GET', `/${universeId}/zones/${outsideId}`)).body;
			const inside = (await send<EditorZone>(ada, 'GET', `/${universeId}/zones/${insideId}`)).body;

			assert.deepStrictEqual(outside, {
				id: outsideId,
				name: 'Meadow',
				parentZoneId: null,
				enabled: true,
				indoors: false,
				defaultTileId: await defaultTileId('grass'),
				passageOfTime: 'inherit',
				faerieMorning: null,
				loopsEastWest: false,
				loopsNorthSouth: false,
				bounds: NEW_ZONE_BOUNDS
			});
			assert.strictEqual(inside.defaultTileId, await defaultTileId('wood_floor'));
			assert.strictEqual(inside.parentZoneId, outsideId);
		});

		it('starts new zones disabled once the universe is past in_the_beginning', async () =>
		{
			const universeId = await createUniverse(ada);

			await send(ada, 'PATCH', `/${universeId}`, { body: { stage: 'prologue' } });

			const zoneId = await createZone(ada, universeId);

			assert.strictEqual((await send<EditorZone>(ada, 'GET', `/${universeId}/zones/${zoneId}`)).body.enabled, false);
		});

		it('refuses a parent that would put a zone inside itself, or that is in another universe', async () =>
		{
			const universeId = await createUniverse(ada);
			const otherId = await createUniverse(ada, 'Other');
			const worldId = await createZone(ada, universeId, { name: 'World' });
			const cityId = await createZone(ada, universeId, { name: 'City', parentZoneId: worldId });
			const elsewhereId = await createZone(ada, otherId, { name: 'Elsewhere' });

			assert.strictEqual((await send(ada, 'PATCH', `/${universeId}/zones/${worldId}`, { body: { parentZoneId: cityId } })).status, 400);
			assert.strictEqual((await send(ada, 'PATCH', `/${universeId}/zones/${worldId}`, { body: { parentZoneId: worldId } })).status, 400);
			assert.strictEqual((await send(ada, 'PATCH', `/${universeId}/zones/${worldId}`, { body: { parentZoneId: elsewhereId } })).status, 400);
			assert.strictEqual((await send(ada, 'POST', `/${universeId}/zones`, { body: { name: 'Lost', parentZoneId: elsewhereId } })).status, 400);
		});

		it('refuses faerie time on a looping zone, and a default tile of another universe', async () =>
		{
			const universeId = await createUniverse(ada);
			const otherId = await createUniverse(ada, 'Other');
			const zoneId = await createZone(ada, universeId, { loopsEastWest: true });
			const theirTileId = (await send<CreatedPayload<number>>(ada, 'POST', `/${otherId}/tiles`, { body: lava })).body.id;
			const path = `/${universeId}/zones/${zoneId}`;

			assert.strictEqual((await send(ada, 'PATCH', path, { body: { passageOfTime: 'faerie', faerieMorning: 'east' } })).status, 400);
			assert.strictEqual((await send(ada, 'PATCH', path, { body: { passageOfTime: 'faerie', faerieMorning: 'east', loopsEastWest: false } })).status, 204);
			assert.strictEqual((await send(ada, 'PATCH', path, { body: { defaultTileId: theirTileId } })).status, 400);
		});

		it('deletes zones, but not the lobby or starting zone', async () =>
		{
			const universeId = await createUniverse(ada);
			const universe = (await send<EditableUniverse>(ada, 'GET', `/${universeId}`)).body;
			const zoneId = await createZone(ada, universeId);

			assert.strictEqual((await send(ada, 'DELETE', `/${universeId}/zones/${universe.lobbyZoneId}`)).status, 409);
			assert.strictEqual((await send(ada, 'DELETE', `/${universeId}/zones/${universe.startingZoneId}`)).status, 409);
			assert.strictEqual((await send(ada, 'DELETE', `/${universeId}/zones/${zoneId}`)).status, 204);
			assert.strictEqual((await send(ada, 'GET', `/${universeId}/zones/${zoneId}`)).status, 404);
		});

		it('answers 404 for a zone of another universe', async () =>
		{
			const universeId = await createUniverse(ada);
			const otherId = await createUniverse(ada, 'Other');
			const theirZoneId = await createZone(ada, otherId);

			assert.strictEqual((await send(ada, 'GET', `/${universeId}/zones/${theirZoneId}`)).status, 404);
			assert.strictEqual((await send(ada, 'PATCH', `/${universeId}/zones/${theirZoneId}/cells`, { body: { changes: [[0, 0, VOID_CELL]] } })).status, 404);
		});
	});

	describe('maps', () =>
	{
		it('paints cells and reads them back by chunk', async () =>
		{
			const universeId = await createUniverse(ada);
			const zoneId = await createZone(ada, universeId);
			const forest = await defaultTileId('forest');
			const path = `/${universeId}/zones/${zoneId}`;

			assert.strictEqual((await send(ada, 'PATCH', `${path}/cells`, { body: { changes: [[0, 0, forest], [-1, -1, VOID_CELL]] } })).status, 204);

			const chunks = (await send<{ chunks: { chunkColumn: number; chunkRow: number; cells: number[] }[] }>(ada, 'GET', `${path}/chunks?minChunkColumn=-1&minChunkRow=-1&maxChunkColumn=0&maxChunkRow=0`)).body.chunks;

			assert.deepStrictEqual(chunks.map((chunk) => [chunk.chunkColumn, chunk.chunkRow]), [[-1, -1], [0, 0]]);
			assert.strictEqual(chunks[1].cells[0], forest);
		});

		it('refuses cells outside the map, tiles the universe cannot use, and ranges that are too large', async () =>
		{
			const universeId = await createUniverse(ada);
			const otherId = await createUniverse(ada, 'Other');
			const zoneId = await createZone(ada, universeId);
			const theirTileId = (await send<CreatedPayload<number>>(ada, 'POST', `/${otherId}/tiles`, { body: lava })).body.id;
			const path = `/${universeId}/zones/${zoneId}`;

			assert.strictEqual((await send(ada, 'PATCH', `${path}/cells`, { body: { changes: [[NEW_ZONE_BOUNDS.maxColumn + 1, 0, VOID_CELL]] } })).status, 400);
			assert.strictEqual((await send(ada, 'PATCH', `${path}/cells`, { body: { changes: [[0, 0, theirTileId]] } })).status, 400);
			assert.strictEqual((await send(ada, 'PATCH', `${path}/cells`, { body: { changes: [] } })).status, 400);
			assert.strictEqual((await send(ada, 'GET', `${path}/chunks?minChunkColumn=0&minChunkRow=0&maxChunkColumn=16&maxChunkRow=15`)).status, 400);
			assert.strictEqual((await send(ada, 'GET', `${path}/chunks?minChunkColumn=1&minChunkRow=0&maxChunkColumn=0&maxChunkRow=0`)).status, 400);
		});

		it('resizes a map, asking before it discards painted cells', async () =>
		{
			const universeId = await createUniverse(ada);
			const zoneId = await createZone(ada, universeId);
			const path = `/${universeId}/zones/${zoneId}`;
			const small = { minColumn: -5, minRow: -5, maxColumn: 5, maxRow: 5 };

			await send(ada, 'PATCH', `${path}/cells`, { body: { changes: [[10, 0, VOID_CELL]] } });

			const refused = await send<ResizeConflictPayload>(ada, 'PUT', `${path}/bounds`, { body: { bounds: small, discard: false } });

			assert.strictEqual(refused.status, 409);
			assert.strictEqual(refused.body.discardedCells, 1);
			assert.strictEqual(refused.body.discardedLinks, 0);

			assert.strictEqual((await send(ada, 'PUT', `${path}/bounds`, { body: { bounds: small, discard: true } })).status, 204);
			assert.deepStrictEqual((await send<EditorZone>(ada, 'GET', path)).body.bounds, small);
		});

		it('refuses bounds that leave out the center or are too large', async () =>
		{
			const universeId = await createUniverse(ada);
			const zoneId = await createZone(ada, universeId);
			const path = `/${universeId}/zones/${zoneId}/bounds`;

			for (const bounds of [{ minColumn: 1, minRow: 0, maxColumn: 5, maxRow: 5 }, { minColumn: -25000, minRow: 0, maxColumn: 25000, maxRow: 0 }])
			{
				assert.strictEqual((await send(ada, 'PUT', path, { body: { bounds, discard: true } })).status, 400, JSON.stringify(bounds));
			}
		});
	});

	describe('links', () =>
	{
		it('adds, lists and deletes a cell\'s link', async () =>
		{
			const universeId = await createUniverse(ada);
			const outsideId = await createZone(ada, universeId, { name: 'Outside' });
			const insideId = await createZone(ada, universeId, { name: 'Inside', indoors: true });
			const target = { targetZoneId: insideId, targetColumn: 1, targetRow: 2, mode: 'automatic', requiresWholeGroup: true };
			const path = `/${universeId}/zones/${outsideId}/links`;

			assert.strictEqual((await send(ada, 'PUT', `${path}/3/-4`, { body: target })).status, 204);
			assert.deepStrictEqual((await send(ada, 'GET', path)).body, { links: [{ column: 3, row: -4, ...target }] });
			assert.strictEqual((await send(ada, 'DELETE', `${path}/3/-4`)).status, 204);
			assert.strictEqual((await send(ada, 'DELETE', `${path}/3/-4`)).status, 404);
		});

		it('refuses links to the same zone, another universe, or a cell off either map', async () =>
		{
			const universeId = await createUniverse(ada);
			const otherId = await createUniverse(ada, 'Other');
			const outsideId = await createZone(ada, universeId, { name: 'Outside' });
			const insideId = await createZone(ada, universeId, { name: 'Inside' });
			const elsewhereId = await createZone(ada, otherId, { name: 'Elsewhere' });
			const target = { targetZoneId: insideId, targetColumn: 0, targetRow: 0, mode: 'manual', requiresWholeGroup: false };
			const path = `/${universeId}/zones/${outsideId}/links`;

			assert.strictEqual((await send(ada, 'PUT', `${path}/0/0`, { body: { ...target, targetZoneId: outsideId } })).status, 400);
			assert.strictEqual((await send(ada, 'PUT', `${path}/0/0`, { body: { ...target, targetZoneId: elsewhereId } })).status, 400);
			assert.strictEqual((await send(ada, 'PUT', `${path}/0/0`, { body: { ...target, targetColumn: 99 } })).status, 400);
			assert.strictEqual((await send(ada, 'PUT', `${path}/99/0`, { body: target })).status, 400);
			assert.strictEqual((await send(ada, 'PUT', `${path}/x/0`, { body: target })).status, 400);
			assert.deepStrictEqual((await send(ada, 'GET', path)).body, { links: [] });
		});
	});

	describe('world changes', () =>
	{
		let published: ZoneChange[];
		let stopListening: () => void;

		beforeEach(() =>
		{
			published = [];
			stopListening = zoneChanges.onChange((change) =>
			{
				published.push(change);
			});
		});

		afterEach(() =>
		{
			stopListening();
		});

		it('tells the rooms which chunks painting changed', async () =>
		{
			const universeId = await createUniverse(ada);
			const zoneId = await createZone(ada, universeId);

			await send(ada, 'PATCH', `/${universeId}/zones/${zoneId}/cells`, { body: { changes: [[0, 0, VOID_CELL], [-1, 0, VOID_CELL], [1, 1, VOID_CELL]] } });

			assert.deepStrictEqual(published, [{ kind: 'cells', zoneId, chunkKeys: [chunkKey(0, 0), chunkKey(-1, 0)] }]);
		});

		it('tells the rooms about changes to a zone\'s settings, bounds and links, and its deletion', async () =>
		{
			const universeId = await createUniverse(ada);
			const zoneId = await createZone(ada, universeId);
			const otherId = await createZone(ada, universeId, { name: 'Other' });
			const path = `/${universeId}/zones/${zoneId}`;

			await send(ada, 'PATCH', path, { body: { name: 'Renamed' } });
			await send(ada, 'PUT', `${path}/bounds`, { body: { bounds: { minColumn: -5, minRow: -5, maxColumn: 5, maxRow: 5 }, discard: true } });
			await send(ada, 'PUT', `${path}/links/0/0`, { body: { targetZoneId: otherId, targetColumn: 0, targetRow: 0, mode: 'manual', requiresWholeGroup: false } });
			await send(ada, 'DELETE', `${path}/links/0/0`);
			await send(ada, 'DELETE', path);

			assert.deepStrictEqual(published, [
				{ kind: 'zone', zoneId },
				{ kind: 'zone', zoneId },
				{ kind: 'zone', zoneId },
				{ kind: 'zone', zoneId },
				{ kind: 'deleted', zoneId }
			]);
		});

		it('tells the rooms when the universe\'s tiles change, and nothing when a change is refused', async () =>
		{
			const universeId = await createUniverse(ada);
			const grassId = await defaultTileId('grass');

			await send(ada, 'PUT', `/${universeId}/tiles/${grassId}`, { body: lava });
			await send(ada, 'DELETE', `/${universeId}/tiles/${grassId}`);
			await send(ada, 'POST', `/${universeId}/tiles`, { body: { ...lava, movementCost: 101 } });

			assert.deepStrictEqual(published, [
				{ kind: 'tiles', universeId },
				{ kind: 'tiles', universeId }
			]);
		});
	});
});
