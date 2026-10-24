import assert from 'assert';
import { randomUUID } from 'crypto';
import { chunkKey, DEFAULT_DIFFICULTY_LEVELS, MAX_MOB_SCALE, MIN_MOB_SCALE, type DifficultyLevel, type DifficultyLevelListPayload, type DifficultyLevelSettings, DEFAULT_LOBBY_DAY_HOURS, MAX_LOBBY_DAY_HOURS, MAX_WALK_SECONDS,DEFAULT_PF1E_SETTINGS, DEFAULT_SF1E_SETTINGS, DEFAULT_SITE_SETTINGS, DEFAULT_TILE_CELL, DEFAULT_TILE_NAMES, EDITOR_UNIVERSES_PATH, emptyMoney, isLocalizedMessage, MAX_GROUP_PLAYERS, MAX_ITEM_QUANTITY, MAX_STARTING_ITEMS, NEW_PF1E_CLASS_RULES, NEW_PF1E_RACE_RULES, NEW_AREA_BOUNDS, PF1E_CLASSES, MAX_COINS, PF1E_MAX_POINT_BUY_BUDGET, PF1E_MAX_RACE_ABILITY_MODIFIER, PF1E_RACES, SF1E_CLASSES, SF1E_MAX_ABILITY_POINTS, SF1E_RACES, SF1E_THEMES, sf1eRaceRules, VOID_CELL, type Ruleset, type ThemeListPayload, type ThemeSettings, type ClassListPayload, type ClassSettings, type CreatedPayload, type EditableUniverse, type ErrorPayload, type EditableUniverseListPayload, type EditorClass, type EditorRace, type EditorArea, type ItemListPayload, type ItemSettings, type RaceListPayload, type RaceSettings, type ResizeConflictPayload, type RulesetSettings, TILE_GRAPHIC_SIZE, TILE_GRAPHICS_PATH, type TileGraphicListPayload, type TileListPayload, type TileSettings, type TileUsagePayload, type UniverseRole, type AreaListPayload } from '@multiverse-kiln/shared';
import sharp from 'sharp';

import { createGroup, findGroup } from '../src/db/groupRepo.js';
import { findDefaultItemIds } from '../src/db/itemRepo.js';
import { loadOrCreatePlayerByName } from '../src/db/playerRepo.js';
import { saveSiteSettings } from '../src/db/siteSettingsRepo.js';
import { inTransaction } from '../src/db/transactions.js';
import { setUniverseRole } from '../src/db/universeEditorRepo.js';
import { BROWSER_ID_COOKIE } from '../src/http/browserId.js';
import { onlinePlayers } from '../src/players/onlinePlayers.js';
import { areaChanges, type AreaChange } from '../src/world/areaChanges.js';
import { addCharacter, defaultTileId } from './db/fixtures.js';
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
	outdoors: true,
	color: 0xff4400,
	graphic: null,
	uploadedGraphicId: null,
	visionCost: 0,
	walkSeconds: 0
};

const torch: ItemSettings = {
	name: 'torch',
	type: 'torch',
	enabled: true
};

const lizardfolk: RaceSettings = {
	name: 'Lizardfolk',
	enabled: true,
	startingMoney: emptyMoney(),
	startingItems: [],
	startingAreaId: null,
	startingColumn: 0,
	startingRow: 0,
	rules: NEW_PF1E_RACE_RULES
};

const gunslinger: ClassSettings = {
	name: 'Gunslinger',
	enabled: true,
	startingMoney: emptyMoney(),
	startingItems: [],
	startingAreaId: null,
	startingColumn: 0,
	startingRow: 0,
	raceAreas: [],
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
	const { name, enabled, startingMoney, startingItems, startingAreaId, startingColumn, startingRow, rules } = race;

	return({ name, enabled, startingMoney, startingItems, startingAreaId, startingColumn, startingRow, rules });
}

/**
 * A class's settings as the class editor sends them, without what only the list shows
 *
 * @param characterClass The class, as listed
 * @return Its settings
 */
function classSettingsOf(characterClass: EditorClass): ClassSettings
{
	const { name, enabled, startingMoney, startingItems, startingAreaId, startingColumn, startingRow, raceAreas, rules } = characterClass;

	return({ name, enabled, startingMoney, startingItems, startingAreaId, startingColumn, startingRow, raceAreas, rules });
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
 * @param ruleset The universe's ruleset
 * @return The universe's ID
 */
async function createUniverse(editor: Editor, name: string = 'Kilnhaven', ruleset: Ruleset = 'pf1e'): Promise<string>
{
	const response = await send<CreatedPayload>(editor, 'POST', '', { body: { name, shortDescription: 'A small town.', ruleset } });

	assert.strictEqual(response.status, 201, JSON.stringify(response.body));

	return(response.body.id);
}

/**
 * Creates an area through the API
 *
 * @param editor The browser creating it
 * @param universeId The universe's ID
 * @param settings The area's settings
 * @return The area's ID
 */
async function createArea(editor: Editor, universeId: string, settings: Record<string, unknown> = {}): Promise<string>
{
	const response = await send<CreatedPayload>(editor, 'POST', `/${universeId}/areas`, { body: { name: 'Meadow', ...settings } });

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

			for (const path of [`/${universeId}`, `/${universeId}/areas`, `/${randomUUID()}`, '/not-an-id'])
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
		it('creates a universe with a lobby and a starting area, and makes the player its creator', async () =>
		{
			const universeId = await createUniverse(ada);
			const universe = (await send<EditableUniverse>(ada, 'GET', `/${universeId}`)).body;
			const areas = (await send<AreaListPayload>(ada, 'GET', `/${universeId}/areas`)).body;

			assert.strictEqual(universe.name, 'Kilnhaven');
			assert.strictEqual(universe.stage, 'in_the_beginning');
			assert.strictEqual(universe.role, 'creator');
			assert.deepStrictEqual(areas.areas.map((area) => area.name), ['Lobby', 'Starting Area']);
			assert.strictEqual(areas.lobbyAreaId, universe.lobbyAreaId);
			assert.strictEqual(areas.startingAreaId, universe.startingAreaId);
			assert.notStrictEqual(universe.lobbyAreaId, universe.startingAreaId);

			const lobby = (await send<EditorArea>(ada, 'GET', `/${universeId}/areas/${universe.lobbyAreaId}`)).body;

			assert.deepStrictEqual(lobby.bounds, NEW_AREA_BOUNDS);
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

		it('allows each player as many universes as the site settings allow', async () =>
		{
			const { universesPerCreator } = DEFAULT_SITE_SETTINGS;

			for (let created = 0; created < universesPerCreator; created++)
			{
				await createUniverse(ada, `Universe ${created}`);
			}

			const refused = await send(ada, 'POST', '', { body: { name: 'One Too Many', shortDescription: '', ruleset: 'pf1e' } });
			const list = (await send<EditableUniverseListPayload>(ada, 'GET', '')).body;

			assert.strictEqual(refused.status, 409);
			assert.strictEqual(list.universes.length, universesPerCreator);
			assert.strictEqual(list.universesPerCreator, universesPerCreator);

			await saveSiteSettings({
				...DEFAULT_SITE_SETTINGS,
				universesPerCreator: (universesPerCreator + 1)
			});
			await createUniverse(ada, 'One More');
			assert.strictEqual((await send(ada, 'POST', '', { body: { name: 'Too Many Again', shortDescription: '', ruleset: 'pf1e' } })).status, 409);
		});

		it('refuses every new universe while creating universes is turned off', async () =>
		{
			await saveSiteSettings({
				...DEFAULT_SITE_SETTINGS,
				universeCreationEnabled: false
			});

			const refused = await send(ada, 'POST', '', { body: { name: 'Kilnhaven', shortDescription: '', ruleset: 'pf1e' } });
			const list = (await send<EditableUniverseListPayload>(ada, 'GET', '')).body;

			assert.strictEqual(refused.status, 403);
			assert.deepStrictEqual(list.universes, []);
			assert.strictEqual(list.universeCreationEnabled, false);
		});

		it('refuses a universe without a valid name or ruleset', async () =>
		{
			for (const body of [{ name: '', shortDescription: '', ruleset: 'pf1e' }, { name: `A${rightToLeftOverride}b`, shortDescription: '', ruleset: 'pf1e' }, { name: '!?', shortDescription: '', ruleset: 'pf1e' }, { name: 'Kilnhaven', shortDescription: '', ruleset: 'dnd' }])
			{
				assert.strictEqual((await send(ada, 'POST', '', { body })).status, 400, JSON.stringify(body));
			}
		});

		it('refuses a name another universe has, or one too much like it, when creating or renaming', async () =>
		{
			const universeId = await createUniverse(ada, 'Kilnhaven');
			const grace = await logIn('Grace');
			const otherId = await createUniverse(grace, 'Brightwater');

			// The last has a Cyrillic К
			for (const name of ['Kilnhaven', 'KILNHAVEN', '"Kilnhaven!"', 'Kiln Haven', 'K1lnhaven', 'Кilnhaven'])
			{
				const refused = await send<ErrorPayload>(grace, 'POST', '', { body: { name, shortDescription: '', ruleset: 'pf1e' } });

				assert.strictEqual(refused.status, 409, name);
				assert.strictEqual(refused.body.error.id, 'error.universeNameTaken', name);
			}

			assert.strictEqual((await send(grace, 'PATCH', `/${otherId}`, { body: { name: 'kilnhaven' } })).status, 409);
			assert.strictEqual((await send(ada, 'PATCH', `/${universeId}`, { body: { name: 'KilnHaven' } })).status, 204);
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

		it('changes the lobby\'s time, keeping faerie time off a lobby whose map loops', async () =>
		{
			const universeId = await createUniverse(ada);
			const path = `/${universeId}`;
			let universe = (await send<EditableUniverse>(ada, 'GET', path)).body;
			const lobbyPath = `${path}/areas/${universe.lobbyAreaId}`;

			assert.strictEqual(universe.lobbyPassageOfTime, 'real_time');
			assert.strictEqual(universe.lobbyDayHours, DEFAULT_LOBBY_DAY_HOURS);
			assert.strictEqual((await send(ada, 'PATCH', path, { body: { lobbyDayHours: 0 } })).status, 400);
			assert.strictEqual((await send(ada, 'PATCH', path, { body: { lobbyDayHours: MAX_LOBBY_DAY_HOURS + 1 } })).status, 400);
			assert.strictEqual((await send(ada, 'PATCH', path, { body: { lobbyDayHours: 6 } })).status, 204);
			assert.strictEqual((await send(ada, 'PATCH', path, { body: { lobbyPassageOfTime: 'faerie' } })).status, 400);

			assert.strictEqual((await send(ada, 'PATCH', lobbyPath, { body: { loopsNorthSouth: true } })).status, 204);
			assert.strictEqual((await send<ErrorPayload>(ada, 'PATCH', path, { body: { lobbyPassageOfTime: 'faerie', lobbyFaerieMorning: 'west' } })).body.error.id, 'error.faerieLobbyCantLoop');
			assert.strictEqual((await send(ada, 'PATCH', lobbyPath, { body: { loopsNorthSouth: false } })).status, 204);
			assert.strictEqual((await send(ada, 'PATCH', path, { body: { lobbyPassageOfTime: 'faerie', lobbyFaerieMorning: 'west' } })).status, 204);
			assert.strictEqual((await send<ErrorPayload>(ada, 'PATCH', lobbyPath, { body: { loopsEastWest: true } })).body.error.id, 'error.faerieLobbyCantLoop');

			universe = (await send<EditableUniverse>(ada, 'GET', path)).body;

			assert.strictEqual(universe.lobbyPassageOfTime, 'faerie');
			assert.strictEqual(universe.lobbyFaerieMorning, 'west');
			assert.strictEqual(universe.lobbyDayHours, 6);
		});

		it('gives the lobby no vision cost until it is turned off', async () =>
		{
			const universeId = await createUniverse(ada);
			const path = `/${universeId}`;

			assert.strictEqual((await send<EditableUniverse>(ada, 'GET', path)).body.lobbyNoVisionCost, true);
			assert.strictEqual((await send(ada, 'PATCH', path, { body: { lobbyNoVisionCost: 'no' } })).status, 400);
			assert.strictEqual((await send(ada, 'PATCH', path, { body: { lobbyNoVisionCost: false } })).status, 204);
			assert.strictEqual((await send<EditableUniverse>(ada, 'GET', path)).body.lobbyNoVisionCost, false);
		});

		it('shows the time precisely until another way is chosen', async () =>
		{
			const universeId = await createUniverse(ada);
			const path = `/${universeId}`;

			assert.strictEqual((await send<EditableUniverse>(ada, 'GET', path)).body.displayTime, 'precise');
			assert.strictEqual((await send(ada, 'PATCH', path, { body: { displayTime: 'exact' } })).status, 400);
			assert.strictEqual((await send(ada, 'PATCH', path, { body: { displayTime: 'rough' } })).status, 204);
			assert.strictEqual((await send<EditableUniverse>(ada, 'GET', path)).body.displayTime, 'rough');
		});
	});

	describe('character settings', () =>
	{
		it('starts a universe with groups of the most players, no money, and its starting area', async () =>
		{
			const universe = (await send<EditableUniverse>(ada, 'GET', `/${await createUniverse(ada)}`)).body;

			assert.strictEqual(universe.groupSize, MAX_GROUP_PLAYERS);
			assert.deepStrictEqual(universe.startingMoney, emptyMoney());
			assert.notStrictEqual(universe.startingAreaId, null);
		});

		it('changes the group size, starting money and starting area, keeping each coin as given', async () =>
		{
			const universeId = await createUniverse(ada);
			const areaId = await createArea(ada, universeId);
			const path = `/${universeId}`;
			const startingMoney = {
				pp: 1,
				gp: 302,
				sp: 4444,
				cp: 10,
				cr: 0
			};

			assert.strictEqual((await send(ada, 'PATCH', path, { body: { groupSize: 1, startingMoney, startingAreaId: areaId } })).status, 204);

			const universe = (await send<EditableUniverse>(ada, 'GET', path)).body;

			assert.strictEqual(universe.groupSize, 1);
			assert.deepStrictEqual(universe.startingMoney, startingMoney);
			assert.strictEqual(universe.startingAreaId, areaId);
		});

		it('refuses group sizes and money out of range', async () =>
		{
			const path = `/${await createUniverse(ada)}`;
			const tooMuchGold = {
				...emptyMoney(),
				gp: MAX_COINS + 1
			};
			const negativeCopper = {
				...emptyMoney(),
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
				{ startingAreaId: null }
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

		it('refuses the lobby, or an area of another universe, as the starting area', async () =>
		{
			const universeId = await createUniverse(ada);
			const universe = (await send<EditableUniverse>(ada, 'GET', `/${universeId}`)).body;
			const otherAreaId = await createArea(ada, await createUniverse(ada, 'Elsewhere'));

			for (const startingAreaId of [universe.lobbyAreaId, otherAreaId, randomUUID()])
			{
				const response = await send<ErrorPayload>(ada, 'PATCH', `/${universeId}`, { body: { startingAreaId } });

				assert.strictEqual(response.status, 400);
				assert.strictEqual(response.body.error.id, 'error.unusableStartingArea');
			}

			assert.strictEqual((await send<EditableUniverse>(ada, 'GET', `/${universeId}`)).body.startingAreaId, universe.startingAreaId);
		});
	});

	describe('ruleset settings', () =>
	{
		const custom: Extract<RulesetSettings, { ruleset: 'pf1e' }> = {
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
			const indoor = (await send<TileListPayload>(ada, 'GET', `/${universeId}/tiles?usedIn=indoors`)).body;
			const page = (await send<TileListPayload>(ada, 'GET', `/${universeId}/tiles?limit=2&offset=1`)).body;

			assert.deepStrictEqual(indoor.tiles.map((tile) => tile.key), ['wood_floor']);
			assert.deepStrictEqual(custom.tiles,[{ id: created.body.id, key: null, ...lava, custom: true, edited: false, uploadedGraphic: null }]);

			// Default tiles that keep their names are named by their keys, in the player's language
			assert.deepStrictEqual(impassable.tiles.map((tile) => (tile.name ?? tile.key)), ['mountains', 'water', 'Lava']);
			assert.strictEqual(page.total, 7);
			assert.strictEqual(page.tiles.length, 2);
			assert.strictEqual((await send(ada, 'GET', `/${universeId}/tiles?passable=yes`)).status, 400);
			assert.strictEqual((await send(ada, 'GET', `/${universeId}/tiles?usedIn=upstairs`)).status, 400);
		});

		it('edits a default tile for this universe only, and restores it', async () =>
		{
			const universeId = await createUniverse(ada);
			const otherId = await createUniverse(ada, 'Other');
			const grassId = await defaultTileId('grass');
			const autumn = { name: 'Autumn Grass', indoors: false, outdoors: true, color: 0xc08030, graphic: null, uploadedGraphicId: null, visionCost: 0, walkSeconds: 600 };

			assert.strictEqual((await send(ada, 'PUT', `/${universeId}/tiles/${grassId}`, { body: autumn })).status, 204);

			const edited = (await send<TileListPayload>(ada, 'GET', `/${universeId}/tiles?edited=true`)).body;
			const untouched = (await send<TileListPayload>(ada, 'GET', `/${otherId}/tiles?edited=true`)).body;

			assert.deepStrictEqual(edited.tiles, [{ id: grassId, key: 'grass', ...autumn, custom: false, edited: true, uploadedGraphic: null }]);
			assert.deepStrictEqual(untouched.tiles, []);

			assert.strictEqual((await send(ada, 'DELETE', `/${universeId}/tiles/${grassId}`)).status, 204);
			assert.deepStrictEqual((await send<TileListPayload>(ada, 'GET', `/${universeId}/tiles?edited=true`)).body.tiles, []);
		});

		it('keeps a default tile\'s own name when an edit leaves the name out, but not a custom tile\'s', async () =>
		{
			const universeId = await createUniverse(ada);
			const grassId = await defaultTileId('grass');
			const tileId = (await send<CreatedPayload<number>>(ada, 'POST', `/${universeId}/tiles`, { body: lava })).body.id;
			const darker = { name: null, indoors: false, outdoors: true, color: 0x206010, graphic: 'grass', uploadedGraphicId: null, visionCost: 0, walkSeconds: 600 };

			assert.strictEqual((await send(ada, 'PUT', `/${universeId}/tiles/${grassId}`, { body: darker })).status, 204);
			assert.deepStrictEqual((await send<TileListPayload>(ada, 'GET', `/${universeId}/tiles?edited=true`)).body.tiles, [{ id: grassId, key: 'grass', ...darker, custom: false, edited: true, uploadedGraphic: null }]);
			assert.strictEqual((await send(ada, 'PUT', `/${universeId}/tiles/${tileId}`, { body: darker })).status, 400);
		});

		it('refuses to delete a tile a map uses, and deletes it once nothing does', async () =>
		{
			const universeId = await createUniverse(ada);
			const universe = (await send<EditableUniverse>(ada, 'GET', `/${universeId}`)).body;
			const tileId = (await send<CreatedPayload<number>>(ada, 'POST', `/${universeId}/tiles`, { body: lava })).body.id;
			const cellsPath = `/${universeId}/areas/${universe.lobbyAreaId}/cells`;

			await send(ada, 'PATCH', cellsPath, { body: { changes: [[0, 0, tileId]] } });
			assert.strictEqual((await send(ada, 'DELETE', `/${universeId}/tiles/${tileId}`)).status, 409);

			await send(ada, 'PATCH', cellsPath, { body: { changes: [[0, 0, DEFAULT_TILE_CELL]] } });
			assert.strictEqual((await send(ada, 'DELETE', `/${universeId}/tiles/${tileId}`)).status, 204);
			assert.strictEqual((await send(ada, 'DELETE', `/${universeId}/tiles/${tileId}`)).status, 404);
		});

		it('lists the areas using a tile, and deletes it after painting its maps with a replacement', async () =>
		{
			const universeId = await createUniverse(ada);
			const otherId = await createUniverse(ada, 'Other');
			const universe = (await send<EditableUniverse>(ada, 'GET', `/${universeId}`)).body;
			const lobbyAreaId = universe.lobbyAreaId as string;
			const tileId = (await send<CreatedPayload<number>>(ada, 'POST', `/${universeId}/tiles`, { body: lava })).body.id;
			const theirTileId = (await send<CreatedPayload<number>>(ada, 'POST', `/${otherId}/tiles`, { body: lava })).body.id;
			const meadowId = await createArea(ada, universeId, { defaultTileId: tileId });
			const grassId = await defaultTileId('grass');
			const changes: AreaChange[] = [];

			await send(ada, 'PATCH', `/${universeId}/areas/${lobbyAreaId}/cells`, { body: { changes: [[0, 0, tileId]] } });

			const usage = (await send<TileUsagePayload>(ada, 'GET', `/${universeId}/tiles/${tileId}/usage`)).body;

			assert.deepStrictEqual(usage.areas.map((area) => area.id).sort(), [lobbyAreaId, meadowId].sort());

			for (const replaceWith of [tileId, theirTileId, 'abc'])
			{
				assert.strictEqual((await send(ada, 'DELETE', `/${universeId}/tiles/${tileId}?replaceWith=${replaceWith}`)).status, 400, String(replaceWith));
			}

			const stopListening = areaChanges.onChange((change) =>
			{
				changes.push(change);
			});

			try
			{
				assert.strictEqual((await send(ada, 'DELETE', `/${universeId}/tiles/${tileId}?replaceWith=${grassId}`)).status, 204);
			}
			finally
			{
				stopListening();
			}

			const meadow = (await send<EditorArea>(ada, 'GET', `/${universeId}/areas/${meadowId}`)).body;
			const grassUsage = (await send<TileUsagePayload>(ada, 'GET', `/${universeId}/tiles/${grassId}/usage`)).body;

			assert.strictEqual(meadow.defaultTileId, grassId);
			assert.ok(grassUsage.areas.some((area) => (area.id === lobbyAreaId)), 'the lobby\'s painted cell is grass now');
			assert.strictEqual((await send(ada, 'GET', `/${universeId}/tiles/${tileId}/usage`)).status, 404);
			assert.deepStrictEqual(changes.filter((change) => (change.kind === 'area')).map((change) => change.areaId).sort(), [lobbyAreaId, meadowId].sort());
			assert.deepStrictEqual(changes.at(-1), { kind: 'tiles', universeId });
		});

		it('answers 404 for a tile of another universe, and 400 for invalid settings', async () =>
		{
			const universeId = await createUniverse(ada);
			const otherId = await createUniverse(ada, 'Other');
			const theirTileId = (await send<CreatedPayload<number>>(ada, 'POST', `/${otherId}/tiles`, { body: lava })).body.id;

			assert.strictEqual((await send(ada, 'PUT', `/${universeId}/tiles/${theirTileId}`, { body: lava })).status, 404);
			assert.strictEqual((await send(ada, 'PUT', `/${universeId}/tiles/abc`, { body: lava })).status, 404);

			for (const body of [{ ...lava, walkSeconds: MAX_WALK_SECONDS + 1 }, { ...lava, walkSeconds: -1 },{ ...lava, color: 0x1000000 }, { ...lava, name: '' }, { ...lava, name: null }, { ...lava, graphic: 'lava' }, { ...lava, graphic: undefined }, { ...lava, uploadedGraphicId: 'abc' }, { ...lava, uploadedGraphicId: undefined }])
			{
				assert.strictEqual((await send(ada, 'POST', `/${universeId}/tiles`, { body })).status, 400, JSON.stringify(body));
			}
		});
	});

	describe('tile graphics', () =>
	{
		/**
		 * A PNG filled with one color
		 *
		 * @param size Its width and height in pixels
		 * @param withCopyright Whether to give it metadata, which uploads must not keep
		 * @return The PNG, base64-encoded as an upload carries it
		 */
		async function solidPng(size: number = TILE_GRAPHIC_SIZE, withCopyright: boolean = false): Promise<string>
		{
			let image = sharp({
				create: {
					width: size,
					height: size,
					channels: 4,
					background: { r: 40, g: 140, b: 60, alpha: 1 }
				}
			});

			if (withCopyright)
			{
				image = image.withExif({ IFD0: { Copyright: 'hidden-metadata-marker' } });
			}

			return((await image.png().toBuffer()).toString('base64'));
		}

		it('uploads a tileset, lists it, serves it without its metadata, and draws tiles with it', async () =>
		{
			const universeId = await createUniverse(ada);
			const upload = { name: 'Moss', drawOrder: 35, image: await solidPng(TILE_GRAPHIC_SIZE, true), rightsConfirmed: true };
			const created = await send<CreatedPayload<string>>(ada, 'POST', `/${universeId}/tile-graphics`, { body: upload });

			assert.strictEqual(created.status, 201, JSON.stringify(created.body));

			const graphicId = created.body.id;

			assert.deepStrictEqual((await send<TileGraphicListPayload>(ada, 'GET', `/${universeId}/tile-graphics`)).body, { graphics: [{ id: graphicId, name: 'Moss', drawOrder: 35 }] });

			const served = await fetch(`${testServerUrl}${TILE_GRAPHICS_PATH}/${graphicId}.png`);
			const image = Buffer.from(await served.arrayBuffer());
			const metadata = await sharp(image).metadata();

			assert.strictEqual(served.status, 200);
			assert.strictEqual(served.headers.get('content-type'), 'image/png');
			assert.ok(served.headers.get('cache-control')?.includes('immutable'), served.headers.get('cache-control') ?? '');
			assert.strictEqual(served.headers.get('x-content-type-options'), 'nosniff');
			assert.deepStrictEqual([metadata.format, metadata.width, metadata.height], ['png', TILE_GRAPHIC_SIZE, TILE_GRAPHIC_SIZE]);
			assert.ok(!image.includes('hidden-metadata-marker'), 'the upload\'s metadata was stored');

			const tile = { ...lava, uploadedGraphicId: graphicId };
			const tileId = (await send<CreatedPayload<number>>(ada, 'POST', `/${universeId}/tiles`, { body: tile })).body.id;
			const custom = (await send<TileListPayload>(ada, 'GET', `/${universeId}/tiles?custom=true`)).body;

			assert.deepStrictEqual(custom.tiles, [{ id: tileId, key: null, ...tile, custom: true, edited: false, uploadedGraphic: { id: graphicId, name: 'Moss', drawOrder: 35 } }]);
		});

		it('refuses tilesets that aren\'t PNGs of the right size, or whose rights aren\'t confirmed', async () =>
		{
			const universeId = await createUniverse(ada);
			const upload = { name: 'Moss', drawOrder: 35, image: await solidPng(), rightsConfirmed: true };
			const jpeg = (await sharp(Buffer.from(upload.image, 'base64')).jpeg().toBuffer()).toString('base64');

			for (const body of [{ ...upload, image: await solidPng(64) }, { ...upload, image: jpeg }, { ...upload, image: Buffer.from('not an image').toString('base64') }, { ...upload, image: 'not base64!' }, { ...upload, rightsConfirmed: false }, { ...upload, name: '' }, { ...upload, drawOrder: 0 }, { ...upload, drawOrder: 100 }])
			{
				assert.strictEqual((await send(ada, 'POST', `/${universeId}/tile-graphics`, { body })).status, 400, JSON.stringify({ ...body, image: body.image.slice(0, 20) }));
			}

			assert.deepStrictEqual((await send<TileGraphicListPayload>(ada, 'GET', `/${universeId}/tile-graphics`)).body, { graphics: [] });
		});

		it('refuses a tile drawn with another universe\'s tileset, or with two graphics', async () =>
		{
			const universeId = await createUniverse(ada);
			const otherId = await createUniverse(ada, 'Other');
			const theirGraphicId = (await send<CreatedPayload<string>>(ada, 'POST', `/${otherId}/tile-graphics`, { body: { name: 'Moss', drawOrder: 35, image: await solidPng(), rightsConfirmed: true } })).body.id;
			const grassId = await defaultTileId('grass');

			assert.strictEqual((await send(ada, 'POST', `/${universeId}/tiles`, { body: { ...lava, uploadedGraphicId: theirGraphicId } })).status, 400);
			assert.strictEqual((await send(ada, 'PUT', `/${universeId}/tiles/${grassId}`, { body: { ...lava, uploadedGraphicId: theirGraphicId } })).status, 400);
			assert.strictEqual((await send(ada, 'POST', `/${otherId}/tiles`, { body: { ...lava, graphic: 'grass', uploadedGraphicId: theirGraphicId } })).status, 400);
		});

		it('deletes a tileset and its image, drawing the tiles that used it in their colors', async () =>
		{
			const universeId = await createUniverse(ada);
			const otherId = await createUniverse(ada, 'Other');
			const graphicId = (await send<CreatedPayload<string>>(ada, 'POST', `/${universeId}/tile-graphics`, { body: { name: 'Moss', drawOrder: 35, image: await solidPng(), rightsConfirmed: true } })).body.id;
			const tileId = (await send<CreatedPayload<number>>(ada, 'POST', `/${universeId}/tiles`, { body: { ...lava, uploadedGraphicId: graphicId } })).body.id;
			const changes: AreaChange[] = [];
			const stopListening = areaChanges.onChange((change) =>
			{
				changes.push(change);
			});

			try
			{
				assert.strictEqual((await send(ada, 'DELETE', `/${otherId}/tile-graphics/${graphicId}`)).status, 404, 'another universe\'s tileset');
				assert.strictEqual((await send(ada, 'DELETE', `/${universeId}/tile-graphics/abc`)).status, 404);
				assert.strictEqual((await send(ada, 'DELETE', `/${universeId}/tile-graphics/${graphicId}`)).status, 204);
				assert.strictEqual((await send(ada, 'DELETE', `/${universeId}/tile-graphics/${graphicId}`)).status, 404, 'already deleted');
			}
			finally
			{
				stopListening();
			}

			const tile = (await send<TileListPayload>(ada, 'GET', `/${universeId}/tiles?custom=true`)).body.tiles.find((listed) => (listed.id === tileId));

			assert.deepStrictEqual((await send<TileGraphicListPayload>(ada, 'GET', `/${universeId}/tile-graphics`)).body, { graphics: [] });
			assert.deepStrictEqual([tile?.uploadedGraphicId, tile?.uploadedGraphic], [null, null]);
			assert.strictEqual((await fetch(`${testServerUrl}${TILE_GRAPHICS_PATH}/${graphicId}.png`)).status, 404);
			assert.deepStrictEqual(changes, [{ kind: 'tiles', universeId }]);
		});

		it('answers 404 for a tileset that doesn\'t exist', async () =>
		{
			for (const file of [`${randomUUID()}.png`, 'nothing', `${randomUUID()}.jpg`])
			{
				const response = await fetch(`${testServerUrl}${TILE_GRAPHICS_PATH}/${file}`);

				assert.strictEqual(response.status, 404, file);
				assert.strictEqual(response.headers.get('x-content-type-options'), 'nosniff', file);
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
					...emptyMoney(),
					gp: 10
				},
				startingAreaId: await createArea(ada, universeId)
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

		it('refuses a custom race without a name, invalid rules, and areas or items the universe can\'t use', async () =>
		{
			const universeId = await createUniverse(ada);
			const universe = (await send<EditableUniverse>(ada, 'GET', `/${universeId}`)).body;
			const otherId = await createUniverse(ada, 'Other');
			const theirAreaId = await createArea(ada, otherId);
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

			for (const startingAreaId of [universe.lobbyAreaId, theirAreaId])
			{
				const response = await send<ErrorPayload>(ada, 'POST', `/${universeId}/races`, { body: { ...lizardfolk, startingAreaId } });

				assert.strictEqual(response.body.error.id, 'error.unusableStartingArea');
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
		it('adds a class with an area for some races, and edits a default class before restoring it', async () =>
		{
			const universeId = await createUniverse(ada);
			const areaId = await createArea(ada, universeId);
			const races = (await send<RaceListPayload>(ada, 'GET', `/${universeId}/races`)).body.races;
			const settings: ClassSettings = {
				...gunslinger,
				raceAreas: [{ raceId: races[0].id, areaId, column: 3, row: -2 }]
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
				startingAreaId: areaId
			};

			assert.strictEqual((await send(ada, 'PUT', `/${universeId}/classes/${id}`, { body: changed })).status, 204);
			assert.deepStrictEqual((await send<ClassListPayload>(ada, 'GET', `/${universeId}/classes`)).body.classes.find((characterClass) => (characterClass.id === id)), { id, key, ...changed, custom, edited: true });

			assert.strictEqual((await send(ada, 'DELETE', `/${universeId}/classes/${id}`)).status, 204);
			assert.deepStrictEqual((await send<ClassListPayload>(ada, 'GET', `/${universeId}/classes`)).body.classes.find((characterClass) => (characterClass.id === id)), wizard);
		});

		it('refuses areas for races alongside an area for every race, and areas for races the universe doesn\'t have', async () =>
		{
			const universeId = await createUniverse(ada);
			const areaId = await createArea(ada, universeId);
			const theirRaceId = (await send<CreatedPayload<number>>(ada, 'POST', `/${await createUniverse(ada, 'Other')}/races`, { body: lizardfolk })).body.id;
			const elfId = (await send<RaceListPayload>(ada, 'GET', `/${universeId}/races`)).body.races[3].id;
			const both = {
				...gunslinger,
				startingAreaId: areaId,
				raceAreas: [{ raceId: elfId, areaId, column: 0, row: 0 }]
			};
			const twice = {
				...gunslinger,
				raceAreas: [{ raceId: elfId, areaId, column: 0, row: 0 }, { raceId: elfId, areaId, column: 0, row: 0 }]
			};

			assert.strictEqual((await send(ada, 'POST', `/${universeId}/classes`, { body: both })).status, 400);
			assert.strictEqual((await send(ada, 'POST', `/${universeId}/classes`, { body: twice })).status, 400);
			assert.strictEqual((await send(ada, 'POST', `/${universeId}/classes`, { body: { ...gunslinger, rules: { ...gunslinger.rules, tradition: 'psychic' } } })).status, 400);

			const response = await send<ErrorPayload>(ada, 'POST', `/${universeId}/classes`, { body: { ...gunslinger, raceAreas: [{ raceId: theirRaceId, areaId, column: 0, row: 0 }] } });

			assert.strictEqual(response.status, 400);
			assert.strictEqual(response.body.error.id, 'error.unknownRaceArea');
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

	describe('difficulty levels', () =>
	{
		const nightmare: DifficultyLevelSettings = {
			name: 'Nightmare',
			isDefault: false,
			mobScale: 300,
			permadeath: true
		};

		/**
		 * A universe's difficulty levels through the API
		 *
		 * @param universeId The universe's ID
		 * @return The levels, easiest first
		 */
		async function listLevels(universeId: string): Promise<DifficultyLevel[]>
		{
			return((await send<DifficultyLevelListPayload>(ada, 'GET', `/${universeId}/difficulty-levels`)).body.difficultyLevels);
		}

		it('starts a universe with the default levels, Normal the default', async () =>
		{
			const universeId = await createUniverse(ada);

			assert.deepStrictEqual((await listLevels(universeId)).map(({ id: _id, ...level }) => level), DEFAULT_DIFFICULTY_LEVELS.map((level) => ({ ...level, name: null })));
		});

		it('edits a level, and makes another level the default in place of the old one', async () =>
		{
			const universeId = await createUniverse(ada);
			const [story, normal] = await listLevels(universeId);
			const changed: DifficultyLevelSettings = {
				name: 'Tale',
				isDefault: true,
				mobScale: -75,
				permadeath: false
			};

			assert.strictEqual((await send(ada, 'PUT', `/${universeId}/difficulty-levels/${story.id}`, { body: changed })).status, 204);

			const after = await listLevels(universeId);

			assert.deepStrictEqual(after[0], { id: story.id, key: 'story', ...changed });
			assert.deepStrictEqual(after[1], { ...normal, isDefault: false });
		});

		it('adds a level, and deleting it moves its groups to the default', async () =>
		{
			const universeId = await createUniverse(ada);
			const created = await send<CreatedPayload<number>>(ada, 'POST', `/${universeId}/difficulty-levels`, { body: nightmare });
			const characterId = await addCharacter(ada.playerId, universeId, 'Ada');
			const groupId = await inTransaction((transaction) => createGroup({ universeId, anchorCharacterId: characterId, name: '', startingAreaId: null, startingColumn: 0, startingRow: 0, difficultyLevelId: created.body.id }, transaction));
			const normal = (await listLevels(universeId)).find((level) => level.isDefault);

			assert.strictEqual(created.status, 201);
			assert.deepStrictEqual((await listLevels(universeId)).at(-1), { id: created.body.id, key: null, ...nightmare });
			assert.strictEqual((await send(ada, 'DELETE', `/${universeId}/difficulty-levels/${created.body.id}`)).status, 204);
			assert.strictEqual((await findGroup(groupId))?.difficultyLevelId, normal?.id);
			assert.strictEqual((await listLevels(universeId)).length, DEFAULT_DIFFICULTY_LEVELS.length);
			assert.strictEqual((await send(ada, 'DELETE', `/${universeId}/difficulty-levels/${created.body.id}`)).status, 404);
		});

		it('makes a new default level the only default', async () =>
		{
			const universeId = await createUniverse(ada);
			const created = await send<CreatedPayload<number>>(ada, 'POST', `/${universeId}/difficulty-levels`, { body: { ...nightmare, isDefault: true } });

			assert.deepStrictEqual((await listLevels(universeId)).filter((level) => level.isDefault).map((level) => level.id), [created.body.id]);
		});

		it('keeps a default level: refuses deleting it or making it an ordinary one', async () =>
		{
			const universeId = await createUniverse(ada);
			const normal = (await listLevels(universeId)).find((level) => level.isDefault) as DifficultyLevel;
			const ordinary: DifficultyLevelSettings = {
				name: normal.name,
				isDefault: false,
				mobScale: normal.mobScale,
				permadeath: normal.permadeath
			};

			assert.strictEqual((await send(ada, 'DELETE', `/${universeId}/difficulty-levels/${normal.id}`)).status, 409);
			assert.strictEqual((await send(ada, 'PUT', `/${universeId}/difficulty-levels/${normal.id}`, { body: ordinary })).status, 409);
			assert.deepStrictEqual((await listLevels(universeId)).find((level) => (level.id === normal.id)), normal);
		});

		it('refuses a level without a name, a mob scale out of range, and another universe\'s level', async () =>
		{
			const universeId = await createUniverse(ada);
			const otherId = await createUniverse(ada, 'Other');
			const [theirs] = await listLevels(otherId);
			const custom = (await send<CreatedPayload<number>>(ada, 'POST', `/${universeId}/difficulty-levels`, { body: nightmare })).body.id;
			const invalid = [
				{ ...nightmare, name: '' },
				{ ...nightmare, mobScale: MAX_MOB_SCALE + 1 },
				{ ...nightmare, mobScale: MIN_MOB_SCALE - 1 },
				{ ...nightmare, mobScale: 12.5 }
			];

			assert.strictEqual((await send(ada, 'POST', `/${universeId}/difficulty-levels`, { body: { ...nightmare, name: null } })).status, 400);
			assert.strictEqual((await send(ada, 'PUT', `/${universeId}/difficulty-levels/${custom}`, { body: { ...nightmare, name: null } })).status, 400);

			for (const body of invalid)
			{
				assert.strictEqual((await send(ada, 'POST', `/${universeId}/difficulty-levels`, { body })).status, 400, JSON.stringify(body));
			}

			assert.strictEqual((await send(ada, 'PUT', `/${universeId}/difficulty-levels/${theirs.id}`, { body: nightmare })).status, 404);
			assert.strictEqual((await send(ada, 'DELETE', `/${universeId}/difficulty-levels/${theirs.id}`)).status, 404);
			assert.strictEqual((await listLevels(universeId)).length, DEFAULT_DIFFICULTY_LEVELS.length + 1);
		});

		it('lets only creators change them', async () =>
		{
			const universeId = await createUniverse(ada);
			const grace = await logIn('Grace');
			const [story] = await listLevels(universeId);

			await setUniverseRole(universeId, grace.playerId, 'builder');

			assert.strictEqual((await send(grace, 'GET', `/${universeId}/difficulty-levels`)).status, 200);
			assert.strictEqual((await send(grace, 'POST', `/${universeId}/difficulty-levels`, { body: nightmare })).status, 403);
			assert.strictEqual((await send(grace, 'DELETE', `/${universeId}/difficulty-levels/${story.id}`)).status, 403);
		});
	});

	describe('areas', () =>
	{
		it('creates an area with its defaults', async () =>
		{
			const universeId = await createUniverse(ada);
			const outsideId = await createArea(ada, universeId);
			const insideId = await createArea(ada, universeId, { name: 'Cellar', indoors: true, parentAreaId: outsideId });
			const outside = (await send<EditorArea>(ada, 'GET', `/${universeId}/areas/${outsideId}`)).body;
			const inside = (await send<EditorArea>(ada, 'GET', `/${universeId}/areas/${insideId}`)).body;

			assert.deepStrictEqual(outside, {
				id: outsideId,
				name: 'Meadow',
				parentAreaId: null,
				enabled: true,
				indoors: false,
				lightLevel: 'lit',
				defaultTileId: await defaultTileId('grass'),
				passageOfTime: 'inherit',
				faerieMorning: null,
				loopsEastWest: false,
				loopsNorthSouth: false,
				bounds: NEW_AREA_BOUNDS
			});
			assert.strictEqual(inside.defaultTileId, await defaultTileId('wood_floor'));
			assert.strictEqual(inside.parentAreaId, outsideId);
		});

		it('starts new areas disabled once the universe is past in_the_beginning', async () =>
		{
			const universeId = await createUniverse(ada);

			await send(ada, 'PATCH', `/${universeId}`, { body: { stage: 'prologue' } });

			const areaId = await createArea(ada, universeId);

			assert.strictEqual((await send<EditorArea>(ada, 'GET', `/${universeId}/areas/${areaId}`)).body.enabled, false);
		});

		it('refuses a parent that would put an area inside itself, or that is in another universe', async () =>
		{
			const universeId = await createUniverse(ada);
			const otherId = await createUniverse(ada, 'Other');
			const worldId = await createArea(ada, universeId, { name: 'World' });
			const cityId = await createArea(ada, universeId, { name: 'City', parentAreaId: worldId });
			const elsewhereId = await createArea(ada, otherId, { name: 'Elsewhere' });

			assert.strictEqual((await send(ada, 'PATCH', `/${universeId}/areas/${worldId}`, { body: { parentAreaId: cityId } })).status, 400);
			assert.strictEqual((await send(ada, 'PATCH', `/${universeId}/areas/${worldId}`, { body: { parentAreaId: worldId } })).status, 400);
			assert.strictEqual((await send(ada, 'PATCH', `/${universeId}/areas/${worldId}`, { body: { parentAreaId: elsewhereId } })).status, 400);
			assert.strictEqual((await send(ada, 'POST', `/${universeId}/areas`, { body: { name: 'Lost', parentAreaId: elsewhereId } })).status, 400);
		});

		it('refuses faerie time on a looping area, and a default tile of another universe', async () =>
		{
			const universeId = await createUniverse(ada);
			const otherId = await createUniverse(ada, 'Other');
			const areaId = await createArea(ada, universeId, { loopsEastWest: true });
			const theirTileId = (await send<CreatedPayload<number>>(ada, 'POST', `/${otherId}/tiles`, { body: lava })).body.id;
			const path = `/${universeId}/areas/${areaId}`;

			assert.strictEqual((await send(ada, 'PATCH', path, { body: { passageOfTime: 'faerie', faerieMorning: 'east' } })).status, 400);
			assert.strictEqual((await send(ada, 'PATCH', path, { body: { passageOfTime: 'faerie', faerieMorning: 'east', loopsEastWest: false } })).status, 204);
			assert.strictEqual((await send(ada, 'PATCH', path, { body: { defaultTileId: theirTileId } })).status, 400);
		});

		it('changes an area\'s light level', async () =>
		{
			const universeId = await createUniverse(ada);
			const areaId = await createArea(ada, universeId, { name: 'Cellar', indoors: true });
			const path = `/${universeId}/areas/${areaId}`;

			assert.strictEqual((await send(ada, 'PATCH', path, { body: { lightLevel: 'dim' } })).status, 400);
			assert.strictEqual((await send(ada, 'PATCH', path, { body: { lightLevel: 'dark' } })).status, 204);
			assert.strictEqual((await send<EditorArea>(ada, 'GET', path)).body.lightLevel, 'dark');
		});

		it('deletes areas, but not the lobby or starting area', async () =>
		{
			const universeId = await createUniverse(ada);
			const universe = (await send<EditableUniverse>(ada, 'GET', `/${universeId}`)).body;
			const areaId = await createArea(ada, universeId);

			assert.strictEqual((await send(ada, 'DELETE', `/${universeId}/areas/${universe.lobbyAreaId}`)).status, 409);
			assert.strictEqual((await send(ada, 'DELETE', `/${universeId}/areas/${universe.startingAreaId}`)).status, 409);
			assert.strictEqual((await send(ada, 'DELETE', `/${universeId}/areas/${areaId}`)).status, 204);
			assert.strictEqual((await send(ada, 'GET', `/${universeId}/areas/${areaId}`)).status, 404);
		});

		it('answers 404 for an area of another universe', async () =>
		{
			const universeId = await createUniverse(ada);
			const otherId = await createUniverse(ada, 'Other');
			const theirAreaId = await createArea(ada, otherId);

			assert.strictEqual((await send(ada, 'GET', `/${universeId}/areas/${theirAreaId}`)).status, 404);
			assert.strictEqual((await send(ada, 'PATCH', `/${universeId}/areas/${theirAreaId}/cells`, { body: { changes: [[0, 0, VOID_CELL]] } })).status, 404);
		});
	});

	describe('maps', () =>
	{
		it('paints cells and reads them back by chunk', async () =>
		{
			const universeId = await createUniverse(ada);
			const areaId = await createArea(ada, universeId);
			const forest = await defaultTileId('forest');
			const path = `/${universeId}/areas/${areaId}`;

			assert.strictEqual((await send(ada, 'PATCH', `${path}/cells`, { body: { changes: [[0, 0, forest], [-1, -1, VOID_CELL]] } })).status, 204);

			const chunks = (await send<{ chunks: { chunkColumn: number; chunkRow: number; cells: number[] }[] }>(ada, 'GET', `${path}/chunks?minChunkColumn=-1&minChunkRow=-1&maxChunkColumn=0&maxChunkRow=0`)).body.chunks;

			assert.deepStrictEqual(chunks.map((chunk) => [chunk.chunkColumn, chunk.chunkRow]), [[-1, -1], [0, 0]]);
			assert.strictEqual(chunks[1].cells[0], forest);
		});

		it('refuses cells outside the map, tiles the universe cannot use, and ranges that are too large', async () =>
		{
			const universeId = await createUniverse(ada);
			const otherId = await createUniverse(ada, 'Other');
			const areaId = await createArea(ada, universeId);
			const theirTileId = (await send<CreatedPayload<number>>(ada, 'POST', `/${otherId}/tiles`, { body: lava })).body.id;
			const path = `/${universeId}/areas/${areaId}`;

			assert.strictEqual((await send(ada, 'PATCH', `${path}/cells`, { body: { changes: [[NEW_AREA_BOUNDS.maxColumn + 1, 0, VOID_CELL]] } })).status, 400);
			assert.strictEqual((await send(ada, 'PATCH', `${path}/cells`, { body: { changes: [[0, 0, theirTileId]] } })).status, 400);
			assert.strictEqual((await send(ada, 'PATCH', `${path}/cells`, { body: { changes: [] } })).status, 400);
			assert.strictEqual((await send(ada, 'GET', `${path}/chunks?minChunkColumn=0&minChunkRow=0&maxChunkColumn=16&maxChunkRow=15`)).status, 400);
			assert.strictEqual((await send(ada, 'GET', `${path}/chunks?minChunkColumn=1&minChunkRow=0&maxChunkColumn=0&maxChunkRow=0`)).status, 400);
		});

		it('resizes a map, asking before it discards painted cells', async () =>
		{
			const universeId = await createUniverse(ada);
			const areaId = await createArea(ada, universeId);
			const path = `/${universeId}/areas/${areaId}`;
			const small = { minColumn: -5, minRow: -5, maxColumn: 5, maxRow: 5 };

			await send(ada, 'PATCH', `${path}/cells`, { body: { changes: [[10, 0, VOID_CELL]] } });

			const refused = await send<ResizeConflictPayload>(ada, 'PUT', `${path}/bounds`, { body: { bounds: small, discard: false } });

			assert.strictEqual(refused.status, 409);
			assert.strictEqual(refused.body.discardedCells, 1);
			assert.strictEqual(refused.body.discardedLinks, 0);

			assert.strictEqual((await send(ada, 'PUT', `${path}/bounds`, { body: { bounds: small, discard: true } })).status, 204);
			assert.deepStrictEqual((await send<EditorArea>(ada, 'GET', path)).body.bounds, small);
		});

		it('refuses bounds that leave out the center or are too large', async () =>
		{
			const universeId = await createUniverse(ada);
			const areaId = await createArea(ada, universeId);
			const path = `/${universeId}/areas/${areaId}/bounds`;

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
			const outsideId = await createArea(ada, universeId, { name: 'Outside' });
			const insideId = await createArea(ada, universeId, { name: 'Inside', indoors: true });
			const target = { targetAreaId: insideId, targetColumn: 1, targetRow: 2, mode: 'automatic', requiresWholeGroup: true };
			const path = `/${universeId}/areas/${outsideId}/links`;

			assert.strictEqual((await send(ada, 'PUT', `${path}/3/-4`, { body: target })).status, 204);
			assert.deepStrictEqual((await send(ada, 'GET', path)).body, { links: [{ column: 3, row: -4, ...target }] });
			assert.strictEqual((await send(ada, 'DELETE', `${path}/3/-4`)).status, 204);
			assert.strictEqual((await send(ada, 'DELETE', `${path}/3/-4`)).status, 404);
		});

		it('refuses links to the same area, another universe, or a cell off either map', async () =>
		{
			const universeId = await createUniverse(ada);
			const otherId = await createUniverse(ada, 'Other');
			const outsideId = await createArea(ada, universeId, { name: 'Outside' });
			const insideId = await createArea(ada, universeId, { name: 'Inside' });
			const elsewhereId = await createArea(ada, otherId, { name: 'Elsewhere' });
			const target = { targetAreaId: insideId, targetColumn: 0, targetRow: 0, mode: 'manual', requiresWholeGroup: false };
			const path = `/${universeId}/areas/${outsideId}/links`;

			assert.strictEqual((await send(ada, 'PUT', `${path}/0/0`, { body: { ...target, targetAreaId: outsideId } })).status, 400);
			assert.strictEqual((await send(ada, 'PUT', `${path}/0/0`, { body: { ...target, targetAreaId: elsewhereId } })).status, 400);
			assert.strictEqual((await send(ada, 'PUT', `${path}/0/0`, { body: { ...target, targetColumn: 99 } })).status, 400);
			assert.strictEqual((await send(ada, 'PUT', `${path}/99/0`, { body: target })).status, 400);
			assert.strictEqual((await send(ada, 'PUT', `${path}/x/0`, { body: target })).status, 400);
			assert.deepStrictEqual((await send(ada, 'GET', path)).body, { links: [] });
		});
	});

	describe('world changes', () =>
	{
		let published: AreaChange[];
		let stopListening: () => void;

		beforeEach(() =>
		{
			published = [];
			stopListening = areaChanges.onChange((change) =>
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
			const areaId = await createArea(ada, universeId);

			await send(ada, 'PATCH', `/${universeId}/areas/${areaId}/cells`, { body: { changes: [[0, 0, VOID_CELL], [-1, 0, VOID_CELL], [1, 1, VOID_CELL]] } });

			assert.deepStrictEqual(published, [{ kind: 'cells', areaId, chunkKeys: [chunkKey(0, 0), chunkKey(-1, 0)] }]);
		});

		it('tells the rooms about changes to an area\'s settings, bounds and links, and its deletion', async () =>
		{
			const universeId = await createUniverse(ada);
			const areaId = await createArea(ada, universeId);
			const otherId = await createArea(ada, universeId, { name: 'Other' });
			const path = `/${universeId}/areas/${areaId}`;

			await send(ada, 'PATCH', path, { body: { name: 'Renamed' } });
			await send(ada, 'PUT', `${path}/bounds`, { body: { bounds: { minColumn: -5, minRow: -5, maxColumn: 5, maxRow: 5 }, discard: true } });
			await send(ada, 'PUT', `${path}/links/0/0`, { body: { targetAreaId: otherId, targetColumn: 0, targetRow: 0, mode: 'manual', requiresWholeGroup: false } });
			await send(ada, 'DELETE', `${path}/links/0/0`);
			await send(ada, 'DELETE', path);

			assert.deepStrictEqual(published, [
				{ kind: 'area', areaId },
				{ kind: 'area', areaId },
				{ kind: 'area', areaId },
				{ kind: 'area', areaId },
				{ kind: 'deleted', areaId }
			]);
		});

		it('tells the rooms when the universe\'s tiles change, and nothing when a change is refused', async () =>
		{
			const universeId = await createUniverse(ada);
			const grassId = await defaultTileId('grass');

			await send(ada, 'PUT', `/${universeId}/tiles/${grassId}`, { body: lava });
			await send(ada, 'DELETE', `/${universeId}/tiles/${grassId}`);
			await send(ada, 'POST', `/${universeId}/tiles`, { body: { ...lava, walkSeconds: MAX_WALK_SECONDS + 1 } });

			assert.deepStrictEqual(published, [
				{ kind: 'tiles', universeId },
				{ kind: 'tiles', universeId }
			]);
		});

		it('tells the rooms when a passage of time changes, which other areas may inherit', async () =>
		{
			const universeId = await createUniverse(ada);
			const areaId = await createArea(ada, universeId);

			await send(ada, 'PATCH', `/${universeId}`, { body: { name: 'Renamed Universe' } });
			await send(ada, 'PATCH', `/${universeId}`, { body: { passageOfTime: 'always_dusk' } });
			await send(ada, 'PATCH', `/${universeId}`, { body: { lobbyPassageOfTime: 'always_noon' } });
			await send(ada, 'PATCH', `/${universeId}/areas/${areaId}`, { body: { passageOfTime: 'always_dawn' } });

			assert.deepStrictEqual(published, [
				{ kind: 'time', universeId },
				{ kind: 'time', universeId },
				{ kind: 'area', areaId },
				{ kind: 'time', universeId }
			]);
		});
	});

	describe('Starfinder 1E', () =>
	{
		it('gives a new universe its ruleset\'s settings, races, classes, themes, tiles and starting knife', async () =>
		{
			const universeId = await createUniverse(ada, 'Absalom Station', 'sf1e');
			const ruleset = await send<RulesetSettings>(ada, 'GET', `/${universeId}/ruleset`);
			const races = (await send<RaceListPayload>(ada, 'GET', `/${universeId}/races`)).body.races;
			const classes = (await send<ClassListPayload>(ada, 'GET', `/${universeId}/classes`)).body.classes;
			const themes = (await send<ThemeListPayload>(ada, 'GET', `/${universeId}/themes`)).body.themes;
			const tiles = (await send<TileListPayload>(ada, 'GET', `/${universeId}/tiles`)).body.tiles;
			const items = (await send<ItemListPayload>(ada, 'GET', `/${universeId}/items`)).body.items;
			const universe = (await send<EditableUniverse>(ada, 'GET', `/${universeId}`)).body;

			assert.deepStrictEqual(ruleset.body, { ruleset: 'sf1e', settings: DEFAULT_SF1E_SETTINGS });
			assert.deepStrictEqual(races.map(({ key, rules }) => ({ key, rules })), Object.entries(SF1E_RACES).map(([key, race]) => ({ key, rules: sf1eRaceRules(race) })));
			assert.deepStrictEqual(classes.map(({ key, rules }) => ({ key, rules })), Object.entries(SF1E_CLASSES).map(([key, rules]) => ({ key, rules })));
			assert.deepStrictEqual(themes.map(({ key, rules }) => ({ key, rules })), Object.entries(SF1E_THEMES).map(([key, rules]) => ({ key, rules })));
			assert.deepStrictEqual(tiles.map(({ key }) => key), Object.keys(DEFAULT_TILE_NAMES.sf1e));
			assert.deepStrictEqual(items.map(({ key }) => key), ['survival_knife']);
			assert.deepStrictEqual(universe.startingItems, [{ itemId: items[0].id, quantity: 1 }]);
		});

		it('saves its settings, and refuses Pathfinder\'s', async () =>
		{
			const path = `/${await createUniverse(ada, 'Absalom Station', 'sf1e')}/ruleset`;
			const settings: RulesetSettings = {
				ruleset: 'sf1e',
				settings: {
					abilityPoints: 12,
					needsSleep: true,
					tracksAmmo: true
				}
			};

			assert.strictEqual((await send(ada, 'PUT', path, { body: settings })).status, 204);
			assert.deepStrictEqual((await send<RulesetSettings>(ada, 'GET', path)).body, settings);
			assert.strictEqual((await send(ada, 'PUT', path, { body: { ...settings, settings: { ...settings.settings, abilityPoints: SF1E_MAX_ABILITY_POINTS + 1 } } })).status, 400);
			assert.strictEqual((await send(ada, 'PUT', path, { body: { ruleset: 'pf1e', settings: DEFAULT_PF1E_SETTINGS } })).status, 400);
		});

		it('keeps money in credits', async () =>
		{
			const path = `/${await createUniverse(ada, 'Absalom Station', 'sf1e')}`;

			assert.strictEqual((await send(ada, 'PATCH', path, { body: { startingMoney: { ...emptyMoney(), cr: 150 } } })).status, 204);
			assert.deepStrictEqual((await send<EditableUniverse>(ada, 'GET', path)).body.startingMoney, { ...emptyMoney(), cr: 150 });
			assert.strictEqual((await send(ada, 'PATCH', path, { body: { startingMoney: { ...emptyMoney(), gp: 5 } } })).status, 400);
		});

		it('edits a default race and class with their Starfinder rules, refusing Pathfinder rules', async () =>
		{
			const universeId = await createUniverse(ada, 'Absalom Station', 'sf1e');
			const ysoki = (await send<RaceListPayload>(ada, 'GET', `/${universeId}/races`)).body.races.find((race) => (race.key === 'ysoki'));
			const soldier = (await send<ClassListPayload>(ada, 'GET', `/${universeId}/classes`)).body.classes.find((characterClass) => (characterClass.key === 'soldier'));

			assert.ok(ysoki && soldier);

			const raceSettings: RaceSettings = {
				...raceSettingsOf(ysoki),
				rules: {
					...sf1eRaceRules(SF1E_RACES.ysoki),
					hitPoints: 3
				}
			};
			const classSettings: ClassSettings = {
				...classSettingsOf(soldier),
				rules: {
					keyAbility: 'dexterity',
					hitPoints: 7,
					staminaPoints: 8
				}
			};

			assert.strictEqual((await send(ada, 'PUT', `/${universeId}/races/${ysoki.id}`, { body: raceSettings })).status, 204);
			assert.strictEqual((await send(ada, 'PUT', `/${universeId}/classes/${soldier.id}`, { body: classSettings })).status, 204);
			assert.deepStrictEqual((await send<RaceListPayload>(ada, 'GET', `/${universeId}/races`)).body.races.find((race) => (race.id === ysoki.id))?.rules, raceSettings.rules);
			assert.deepStrictEqual((await send<ClassListPayload>(ada, 'GET', `/${universeId}/classes`)).body.classes.find((characterClass) => (characterClass.id === soldier.id))?.rules, classSettings.rules);

			assert.strictEqual((await send(ada, 'PUT', `/${universeId}/races/${ysoki.id}`, { body: { ...raceSettings, rules: NEW_PF1E_RACE_RULES } })).status, 400);
			assert.strictEqual((await send(ada, 'PUT', `/${universeId}/classes/${soldier.id}`, { body: { ...classSettings, rules: NEW_PF1E_CLASS_RULES } })).status, 400);
		});

		it('adds, edits, restores and deletes themes, keeping one enabled', async () =>
		{
			const universeId = await createUniverse(ada, 'Absalom Station', 'sf1e');
			const path = `/${universeId}/themes`;
			const themes = (await send<ThemeListPayload>(ada, 'GET', path)).body.themes;
			const pilot = themes.find((theme) => (theme.key === 'ace_pilot'));
			const smuggler: ThemeSettings = {
				name: 'Smuggler',
				enabled: true,
				rules: {
					ability: 'dexterity'
				}
			};

			assert.ok(pilot);

			const created = await send<CreatedPayload<number>>(ada, 'POST', path, { body: smuggler });

			assert.strictEqual(created.status, 201);
			assert.strictEqual((await send(ada, 'PUT', `${path}/${pilot.id}`, { body: { name: null, enabled: false, rules: { ability: 'wisdom' } } })).status, 204);

			const listed = (await send<ThemeListPayload>(ada, 'GET', path)).body.themes;

			assert.deepStrictEqual(listed.find((theme) => (theme.id === created.body.id)), { id: created.body.id, key: null, ...smuggler, custom: true, edited: false });
			assert.deepStrictEqual(listed.find((theme) => (theme.id === pilot.id)), { ...pilot, enabled: false, rules: { ability: 'wisdom' }, edited: true });

			assert.strictEqual((await send(ada, 'DELETE', `${path}/${pilot.id}`)).status, 204);
			assert.deepStrictEqual((await send<ThemeListPayload>(ada, 'GET', path)).body.themes.find((theme) => (theme.id === pilot.id)), pilot);
			assert.strictEqual((await send(ada, 'POST', path, { body: { ...smuggler, name: null } })).status, 400);
			assert.strictEqual((await send(ada, 'DELETE', `${path}/${created.body.id}`)).status, 204);

			// Disabling every theme would leave new characters none to choose
			for (const theme of themes.slice(1))
			{
				assert.strictEqual((await send(ada, 'PUT', `${path}/${theme.id}`, { body: { name: null, enabled: false, rules: theme.rules } })).status, 204);
			}

			assert.strictEqual((await send(ada, 'PUT', `${path}/${themes[0].id}`, { body: { name: null, enabled: false, rules: themes[0].rules } })).status, 409);
		});

		it('answers 404 for themes in a Pathfinder universe', async () =>
		{
			const universeId = await createUniverse(ada);

			assert.strictEqual((await send(ada, 'GET', `/${universeId}/themes`)).status, 404);
		});
	});
});
