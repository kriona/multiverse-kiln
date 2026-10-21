import assert from 'assert';
import { randomUUID } from 'crypto';
import { characterPath, charactersPath, DEFAULT_SITE_SETTINGS, EDITOR_UNIVERSES_PATH, emptyMoney, MAX_CHARACTERS_PER_UNIVERSE, NEW_PF1E_RACE_RULES, PF1E_ABILITIES, type CharacterDeletionPayload, type CharacterDraft, type CharacterListPayload, type CharacterSheet, type CreatedPayload, type NewCharacterOptions, type NewCharacterRequest, type Pf1eAbilityScores, type RaceSettings } from '@multiverse-kiln/shared';

import { findDefaultClassIds } from '../src/db/classRepo.js';
import { loadOrCreatePlayerByName } from '../src/db/playerRepo.js';
import { findDefaultRaceIds } from '../src/db/raceRepo.js';
import { saveSiteSettings } from '../src/db/siteSettingsRepo.js';
import { setUniverseRole } from '../src/db/universeEditorRepo.js';
import { BROWSER_ID_COOKIE } from '../src/http/browserId.js';
import { onlinePlayers } from '../src/players/onlinePlayers.js';
import { getTestServer, logOutEveryone, testServerUrl } from './testServer.js';

/**
 * A logged-in browser
 */
interface Browser
{
	browserId: string;
	playerId: string;
}

/**
 * What a request answered
 */
interface Answer<T>
{
	status: number;
	body: T;
}

// 7 + 5 + 2 + 0 + 0 + 1 = 15 points
const standardBuy: Pf1eAbilityScores = {
	strength: 15,
	dexterity: 14,
	constitution: 12,
	intelligence: 10,
	wisdom: 10,
	charisma: 11
};

/**
 * Logs a new browser in as a player
 *
 * @param name The player's name
 * @return The browser and its player
 */
async function logIn(name: string): Promise<Browser>
{
	const browserId = randomUUID();
	const { id: playerId } = await loadOrCreatePlayerByName(name);

	onlinePlayers.logIn(browserId, playerId, name);

	return({ browserId, playerId });
}

/**
 * Sends a JSON request to the server
 *
 * @param browser The browser sending it, or undefined for one that isn't logged in
 * @param method The HTTP method
 * @param path The path
 * @param body The JSON body, if any
 * @return The status and the parsed body
 */
async function send<T = unknown>(browser: Browser | undefined, method: string, path: string, body?: unknown): Promise<Answer<T>>
{
	const headers: Record<string, string> = {};

	if (browser)
	{
		headers['Cookie'] = `${BROWSER_ID_COOKIE}=${browser.browserId}`;
	}

	if (body !== undefined)
	{
		headers['Content-Type'] = 'application/json';
	}

	const response = await fetch(`${testServerUrl}${path}`, {
		method,
		headers,
		body: ((body === undefined) ? undefined : JSON.stringify(body))
	});
	const text = await response.text();

	return({
		status: response.status,
		body: ((text === '') ? undefined : JSON.parse(text)) as T
	});
}

/**
 * The ID of a Pathfinder 1E default race or class
 *
 * @param ids The default races' or classes' IDs, by key
 * @param key The key
 * @return The ID
 */
function idOf(ids: Map<string, number>, key: string): number
{
	const id = ids.get(key);

	if (id === undefined)
	{
		throw new Error(`The default "${key}" is missing from the test database`);
	}

	return(id);
}

/**
 * The rolled scores, given to the abilities in the order they were rolled
 *
 * @param rolls The six rolled scores
 * @return The scores, by ability
 */
function inRolledOrder(rolls: number[]): Pf1eAbilityScores
{
	return(Object.fromEntries(PF1E_ABILITIES.map((ability, index) => [ability, rolls[index]])) as Pf1eAbilityScores);
}

describe('Character routes', () =>
{
	let ada: Browser;
	let universeId: string;
	let dwarfId: number;
	let humanId: number;
	let fighterId: number;

	before(async () =>
	{
		await getTestServer();
	});

	beforeEach(async () =>
	{
		logOutEveryone();
		ada = await logIn('Ada');

		const created = await send<CreatedPayload>(ada, 'POST', EDITOR_UNIVERSES_PATH, {
			name: 'Kilnhaven',
			shortDescription: 'A small town.',
			ruleset: 'pf1e'
		});

		assert.strictEqual(created.status, 201, JSON.stringify(created.body));
		universeId = created.body.id;

		const raceIds = await findDefaultRaceIds('pf1e');

		dwarfId = idOf(raceIds, 'dwarf');
		humanId = idOf(raceIds, 'human');
		fighterId = idOf(await findDefaultClassIds('pf1e'), 'fighter');
	});

	/**
	 * What Create Character offers Ada
	 *
	 * @return The options
	 */
	async function newOptions(): Promise<NewCharacterOptions>
	{
		const answer = await send<NewCharacterOptions>(ada, 'GET', `${charactersPath(universeId)}/new`);

		assert.strictEqual(answer.status, 200, JSON.stringify(answer.body));

		return(answer.body);
	}

	/**
	 * A dwarf fighter named Brokk with Ada's rolled scores in the order they were rolled
	 *
	 * @return The request
	 */
	async function rolledDwarf(): Promise<NewCharacterRequest>
	{
		const { abilities } = await newOptions();

		assert.strictEqual(abilities.kind, 'roll');

		return({
			name: 'Brokk',
			raceId: dwarfId,
			classId: fighterId,
			baseScores: inRolledOrder(abilities.rolls),
			themeId: null,
			floatingAbility: null
		});
	}

	/**
	 * Makes the universe use standard fantasy point buy
	 */
	async function usePointBuy(): Promise<void>
	{
		const answer = await send(ada, 'PUT', `${EDITOR_UNIVERSES_PATH}/${universeId}/ruleset`, {
			ruleset: 'pf1e',
			settings: {
				statMethod: 'point_buy_standard_fantasy',
				customPointBuyBudget: 15,
				needsSleep: false,
				coinsHaveWeight: false,
				tracksAmmo: false
			}
		});

		assert.strictEqual(answer.status, 204);
	}

	it('needs a logged-in browser', async () =>
	{
		const answer = await send(undefined, 'GET', charactersPath(universeId));

		assert.strictEqual(answer.status, 401);
	});

	it('answers 404 for a universe the player can\'t play yet', async () =>
	{
		const grace = await logIn('Grace');

		assert.strictEqual((await send(grace, 'GET', charactersPath(universeId))).status, 404);
		assert.strictEqual((await send(grace, 'GET', `${charactersPath(universeId)}/new`)).status, 404);

		await setUniverseRole(universeId, grace.playerId, 'beta_tester');
		assert.strictEqual((await send(grace, 'GET', charactersPath(universeId))).status, 404);

		await send(ada, 'PATCH', `${EDITOR_UNIVERSES_PATH}/${universeId}`, { stage: 'prologue' });
		assert.strictEqual((await send(grace, 'GET', charactersPath(universeId))).status, 200);
	});

	it('rolls the scores once, and offers the enabled races and classes', async () =>
	{
		const first = await newOptions();
		const second = await newOptions();

		assert.strictEqual(first.abilities.kind, 'roll');
		assert.strictEqual(first.abilities.rolls.length, PF1E_ABILITIES.length);
		assert.ok(first.abilities.rolls.every((score) => ((score >= 3) && (score <= 18))));
		assert.deepStrictEqual(second.abilities, first.abilities);
		assert.ok(first.races.some((race) => (race.id === dwarfId)));
		assert.ok(first.classes.some((characterClass) => (characterClass.id === fighterId)));
		assert.strictEqual(first.characterCount, 0);
	});

	it('makes a character from the rolled scores in any order, and rolls again for the next', async () =>
	{
		const request = await rolledDwarf();
		const rolls = PF1E_ABILITIES.map((ability) => request.baseScores[ability]);
		const reversed = inRolledOrder([...rolls].reverse());
		const created = await send<CreatedPayload>(ada, 'POST', charactersPath(universeId), { ...request, baseScores: reversed });

		assert.strictEqual(created.status, 201, JSON.stringify(created.body));

		const list = await send<CharacterListPayload>(ada, 'GET', charactersPath(universeId));

		assert.deepStrictEqual(list.body, {
			ruleset: 'pf1e',
			characters: [{
				id: created.body.id,
				name: 'Brokk',
				race: { key: 'dwarf', name: null },
				characterClass: { key: 'fighter', name: null },
				deleteAt: null
			}]
		});

		// The rolls were used up, so making another with them is refused until new ones are rolled
		const again = await send(ada, 'POST', charactersPath(universeId), request);

		assert.strictEqual(again.status, 409);
		assert.strictEqual((await newOptions()).characterCount, 1);
	});

	it('shows a character\'s sheet only to their player', async () =>
	{
		const request = await rolledDwarf();
		const created = await send<CreatedPayload>(ada, 'POST', charactersPath(universeId), request);

		assert.strictEqual(created.status, 201, JSON.stringify(created.body));

		const path = characterPath(universeId, created.body.id);
		const sheet = await send<CharacterSheet>(ada, 'GET', path);
		const { baseScores } = request;
		const { money, items, ...character } = sheet.body;

		assert.strictEqual(sheet.status, 200, JSON.stringify(sheet.body));
		assert.deepStrictEqual(character, {
			ruleset: 'pf1e',
			id: created.body.id,
			name: 'Brokk',
			race: { key: 'dwarf', name: null },
			characterClass: { key: 'fighter', name: null },
			deleteAt: null,
			deletionDays: DEFAULT_SITE_SETTINGS.characterDeletionDays,
			size: 'medium',
			darkvision: true,
			theme: null,
			hitPoints: null,
			staminaPoints: null,
			abilityScores: {
				...baseScores,
				constitution: (baseScores.constitution + 2),
				wisdom: (baseScores.wisdom + 2),
				charisma: (baseScores.charisma - 2)
			}
		});
		assert.deepStrictEqual(Object.keys(money), Object.keys(emptyMoney()));
		assert.deepStrictEqual(items.map(({ key, type, quantity }) => ({ key, type, quantity })), [{ key: 'dagger', type: 'dagger', quantity: 1 }]);

		await send(ada, 'PATCH', `${EDITOR_UNIVERSES_PATH}/${universeId}`, { stage: 'prologue' });

		const grace = await logIn('Grace');

		assert.strictEqual((await send(grace, 'GET', path)).status, 404);
		assert.strictEqual((await send(ada, 'GET', characterPath(universeId, randomUUID()))).status, 404);
		assert.strictEqual((await send(ada, 'GET', characterPath(universeId, 'brokk'))).status, 404);
	});

	it('gives a character their last rites, restores them, and deletes them', async () =>
	{
		const created = await send<CreatedPayload>(ada, 'POST', charactersPath(universeId), await rolledDwarf());

		assert.strictEqual(created.status, 201, JSON.stringify(created.body));

		const path = characterPath(universeId, created.body.id);
		const before = Date.now();
		const scheduled = await send<CharacterDeletionPayload>(ada, 'PUT', `${path}/deletion`);
		const deleteAt = Date.parse(scheduled.body.deleteAt);
		const delay = (DEFAULT_SITE_SETTINGS.characterDeletionDays * 24 * 60 * 60 * 1000);

		assert.strictEqual(scheduled.status, 200, JSON.stringify(scheduled.body));
		assert.ok((deleteAt >= (before + delay - 1000)) && (deleteAt <= (Date.now() + delay)));

		const list = await send<CharacterListPayload>(ada, 'GET', charactersPath(universeId));

		assert.strictEqual(list.body.characters[0].deleteAt, scheduled.body.deleteAt);
		assert.strictEqual((await send<CharacterSheet>(ada, 'GET', path)).body.deleteAt, scheduled.body.deleteAt);

		assert.strictEqual((await send(ada, 'DELETE', `${path}/deletion`)).status, 204);
		assert.strictEqual((await send(ada, 'DELETE', `${path}/deletion`)).status, 404);
		assert.strictEqual((await send<CharacterSheet>(ada, 'GET', path)).body.deleteAt, null);

		await send(ada, 'PATCH', `${EDITOR_UNIVERSES_PATH}/${universeId}`, { stage: 'prologue' });

		const grace = await logIn('Grace');

		assert.strictEqual((await send(grace, 'PUT', `${path}/deletion`)).status, 404);
		assert.strictEqual((await send(grace, 'DELETE', path)).status, 404);

		assert.strictEqual((await send(ada, 'DELETE', path)).status, 204);
		assert.strictEqual((await send(ada, 'GET', path)).status, 404);
		assert.strictEqual((await send(ada, 'DELETE', path)).status, 404);
		assert.deepStrictEqual((await send<CharacterListPayload>(ada, 'GET', charactersPath(universeId))).body.characters, []);
	});

	it('waits the days the site sets after last rites, and refuses them when it sets none', async () =>
	{
		const created = await send<CreatedPayload>(ada, 'POST', charactersPath(universeId), await rolledDwarf());
		const path = characterPath(universeId, created.body.id);

		await saveSiteSettings({
			...DEFAULT_SITE_SETTINGS,
			characterDeletionDays: 0
		});

		assert.strictEqual((await send<CharacterSheet>(ada, 'GET', path)).body.deletionDays, 0);
		assert.strictEqual((await send(ada, 'PUT', `${path}/deletion`)).status, 409);
		assert.strictEqual((await send<CharacterSheet>(ada, 'GET', path)).body.deleteAt, null);

		await saveSiteSettings({
			...DEFAULT_SITE_SETTINGS,
			characterDeletionDays: 30
		});

		const before = Date.now();
		const scheduled = await send<CharacterDeletionPayload>(ada, 'PUT', `${path}/deletion`);
		const delay = (30 * 24 * 60 * 60 * 1000);
		const deleteAt = Date.parse(scheduled.body.deleteAt);

		assert.strictEqual(scheduled.status, 200, JSON.stringify(scheduled.body));
		assert.ok((deleteAt >= (before + delay - 1000)) && (deleteAt <= (Date.now() + delay)));
	});

	it('refuses scores that weren\'t rolled', async () =>
	{
		const request = await rolledDwarf();

		// No roll of three dice makes less than 3
		const answer = await send(ada, 'POST', charactersPath(universeId), {
			...request,
			baseScores: {
				...request.baseScores,
				strength: 2
			}
		});

		assert.strictEqual(answer.status, 400);
	});

	it('checks point buy against the budget', async () =>
	{
		await usePointBuy();

		const { abilities } = await newOptions();

		assert.deepStrictEqual(abilities, {
			kind: 'pointBuy',
			statMethod: 'point_buy_standard_fantasy',
			budget: 15
		});

		const request: NewCharacterRequest = {
			name: 'Brokk',
			raceId: dwarfId,
			classId: fighterId,
			baseScores: standardBuy,
			themeId: null,
			floatingAbility: null
		};
		const over = await send(ada, 'POST', charactersPath(universeId), {
			...request,
			baseScores: {
				...standardBuy,
				charisma: 12
			}
		});

		assert.strictEqual(over.status, 400);
		assert.strictEqual((await send(ada, 'POST', charactersPath(universeId), request)).status, 201);
	});

	it('needs a floating ability exactly for a race with the bonus', async () =>
	{
		await usePointBuy();

		const human: NewCharacterRequest = {
			name: 'Ada',
			raceId: humanId,
			classId: fighterId,
			baseScores: standardBuy,
			themeId: null,
			floatingAbility: null
		};

		assert.strictEqual((await send(ada, 'POST', charactersPath(universeId), human)).status, 400);
		assert.strictEqual((await send(ada, 'POST', charactersPath(universeId), { ...human, raceId: dwarfId, floatingAbility: 'strength' })).status, 400);
		assert.strictEqual((await send(ada, 'POST', charactersPath(universeId), { ...human, floatingAbility: 'strength' })).status, 201);
	});

	it('refuses a disabled race', async () =>
	{
		await usePointBuy();

		const lizardfolk: RaceSettings = {
			name: 'Lizardfolk',
			enabled: false,
			startingMoney: emptyMoney(),
			startingItems: [],
			startingAreaId: null,
			rules: NEW_PF1E_RACE_RULES
		};
		const created = await send<CreatedPayload<number>>(ada, 'POST', `${EDITOR_UNIVERSES_PATH}/${universeId}/races`, lizardfolk);
		const answer = await send(ada, 'POST', charactersPath(universeId), {
			name: 'Sss',
			raceId: created.body.id,
			classId: fighterId,
			baseScores: standardBuy,
			themeId: null,
			floatingAbility: null
		});

		assert.strictEqual(answer.status, 409);
		assert.ok(!(await newOptions()).races.some((race) => (race.id === created.body.id)));
	});

	it('won\'t delete a race characters are', async () =>
	{
		await usePointBuy();

		const lizardfolk: RaceSettings = {
			name: 'Lizardfolk',
			enabled: true,
			startingMoney: emptyMoney(),
			startingItems: [],
			startingAreaId: null,
			rules: NEW_PF1E_RACE_RULES
		};
		const race = await send<CreatedPayload<number>>(ada, 'POST', `${EDITOR_UNIVERSES_PATH}/${universeId}/races`, lizardfolk);

		await send(ada, 'POST', charactersPath(universeId), {
			name: 'Sss',
			raceId: race.body.id,
			classId: fighterId,
			baseScores: standardBuy,
			themeId: null,
			floatingAbility: null
		});

		assert.strictEqual((await send(ada, 'DELETE', `${EDITOR_UNIVERSES_PATH}/${universeId}/races/${race.body.id}`)).status, 409);
	});

	it('allows at most MAX_CHARACTERS_PER_UNIVERSE characters', async () =>
	{
		await usePointBuy();

		const request: NewCharacterRequest = {
			name: 'Brokk',
			raceId: dwarfId,
			classId: fighterId,
			baseScores: standardBuy,
			themeId: null,
			floatingAbility: null
		};

		for (let count = 0; count < MAX_CHARACTERS_PER_UNIVERSE; count++)
		{
			assert.strictEqual((await send(ada, 'POST', charactersPath(universeId), request)).status, 201);
		}

		assert.strictEqual((await send(ada, 'POST', charactersPath(universeId), request)).status, 409);
	});

	it('saves progress, gives it back, and throws it away to start over', async () =>
	{
		const draft: CharacterDraft = {
			step: 'class',
			name: 'Bro',
			raceId: dwarfId,
			classId: null,
			baseScores: null,
			themeId: null,
			floatingAbility: null
		};

		assert.strictEqual((await newOptions()).draft, null);
		assert.strictEqual((await send(ada, 'PUT', `${charactersPath(universeId)}/draft`, draft)).status, 204);
		assert.deepStrictEqual((await newOptions()).draft, draft);

		const rolls = (await newOptions()).abilities;

		assert.strictEqual((await send(ada, 'DELETE', `${charactersPath(universeId)}/draft`)).status, 204);
		assert.strictEqual((await newOptions()).draft, null);

		// Starting over keeps the rolled scores
		assert.deepStrictEqual((await newOptions()).abilities, rolls);
	});

	it('refuses progress that isn\'t a draft', async () =>
	{
		const answer = await send(ada, 'PUT', `${charactersPath(universeId)}/draft`, {
			step: 'somewhere',
			name: '',
			raceId: null,
			classId: null,
			baseScores: null,
			themeId: null,
			floatingAbility: null
		});

		assert.strictEqual(answer.status, 400);
	});

	it('throws the progress away once the character is made', async () =>
	{
		const request = await rolledDwarf();

		await send(ada, 'PUT', `${charactersPath(universeId)}/draft`, {
			step: 'review',
			name: 'Brokk',
			raceId: dwarfId,
			classId: fighterId,
			baseScores: request.baseScores,
			themeId: null,
			floatingAbility: null
		});
		assert.strictEqual((await send(ada, 'POST', charactersPath(universeId), request)).status, 201);
		assert.strictEqual((await newOptions()).draft, null);
	});

	it('refuses a name that passes as staff', async () =>
	{
		await usePointBuy();

		const answer = await send(ada, 'POST', charactersPath(universeId), {
			name: 'Moderator',
			raceId: dwarfId,
			classId: fighterId,
			baseScores: standardBuy,
			themeId: null,
			floatingAbility: null
		});

		assert.strictEqual(answer.status, 400);
		assert.strictEqual((await newOptions()).characterCount, 0);
	});

	it('refuses a name with disallowed characters', async () =>
	{
		await usePointBuy();

		const answer = await send(ada, 'POST', charactersPath(universeId), {
			name: 'Brokk' + String.fromCharCode(0x202e),
			raceId: dwarfId,
			classId: fighterId,
			baseScores: standardBuy,
			themeId: null,
			floatingAbility: null
		});

		assert.strictEqual(answer.status, 400);
	});

	describe('in a Starfinder 1E universe', () =>
	{
		let starUniverseId: string;
		let options: NewCharacterOptions;
		let request: NewCharacterRequest;

		beforeEach(async () =>
		{
			const created = await send<CreatedPayload>(ada, 'POST', EDITOR_UNIVERSES_PATH, {
				name: 'Absalom Station',
				shortDescription: 'A station at the center of the galaxy.',
				ruleset: 'sf1e'
			});

			assert.strictEqual(created.status, 201, JSON.stringify(created.body));
			starUniverseId = created.body.id;

			const answer = await send<NewCharacterOptions>(ada, 'GET', `${charactersPath(starUniverseId)}/new`);

			assert.strictEqual(answer.status, 200, JSON.stringify(answer.body));
			options = answer.body;

			const vesk = options.races.find((race) => (race.key === 'vesk'));
			const soldier = options.classes.find((characterClass) => (characterClass.key === 'soldier'));
			const mercenary = options.themes.find((theme) => (theme.key === 'mercenary'));

			assert.ok(vesk && soldier && mercenary);

			// Vesk +2 Str +2 Con -2 Int, mercenary +1 Str: 5 + 4 = 9 of the 10 points, raising Strength to 18
			request = {
				name: 'Grenn',
				raceId: vesk.id,
				classId: soldier.id,
				themeId: mercenary.id,
				baseScores: {
					strength: 15,
					dexterity: 14,
					constitution: 10,
					intelligence: 10,
					wisdom: 10,
					charisma: 10
				},
				floatingAbility: null
			};
		});

		it('offers ability points and themes', () =>
		{
			assert.deepStrictEqual(options.abilities, { kind: 'abilityPoints', points: 10 });
			assert.strictEqual(options.themes.length, 9);
		});

		it('makes a character with their race\'s and theme\'s bonuses, hit points, stamina and credits', async () =>
		{
			await send(ada, 'PATCH', `${EDITOR_UNIVERSES_PATH}/${starUniverseId}`, { startingMoney: { ...emptyMoney(), cr: 1000 } });

			const created = await send<CreatedPayload>(ada, 'POST', charactersPath(starUniverseId), request);

			assert.strictEqual(created.status, 201, JSON.stringify(created.body));

			const sheet = (await send<CharacterSheet>(ada, 'GET', characterPath(starUniverseId, created.body.id))).body;

			assert.deepStrictEqual(sheet.abilityScores, {
				strength: 18,
				dexterity: 14,
				constitution: 12,
				intelligence: 8,
				wisdom: 10,
				charisma: 10
			});
			assert.deepStrictEqual(sheet.theme, { key: 'mercenary', name: null });

			// 6 from vesk and 7 from soldier; 7 stamina from soldier and +1 from Constitution 12
			assert.strictEqual(sheet.hitPoints, 13);
			assert.strictEqual(sheet.staminaPoints, 8);
			assert.deepStrictEqual(sheet.money, { ...emptyMoney(), cr: 1000 });
			assert.deepStrictEqual(sheet.items.map(({ key }) => key), ['survival_knife']);
		});

		it('refuses more ability points than the universe gives, or raising a score past 18', async () =>
		{
			const tooMany = await send(ada, 'POST', charactersPath(starUniverseId), { ...request, baseScores: { ...request.baseScores, wisdom: 12 } });
			const pastEighteen = await send(ada, 'POST', charactersPath(starUniverseId), { ...request, baseScores: { ...request.baseScores, strength: 16, dexterity: 13 } });

			assert.strictEqual(tooMany.status, 400);
			assert.strictEqual(pastEighteen.status, 400);
		});

		it('needs a theme', async () =>
		{
			const answer = await send(ada, 'POST', charactersPath(starUniverseId), { ...request, themeId: null });

			assert.strictEqual(answer.status, 409);
		});

		it('refuses a theme in a Pathfinder universe', async () =>
		{
			await usePointBuy();

			const answer = await send(ada, 'POST', charactersPath(universeId), {
				name: 'Brokk',
				raceId: dwarfId,
				classId: fighterId,
				baseScores: standardBuy,
				themeId: request.themeId,
				floatingAbility: null
			});

			assert.strictEqual(answer.status, 409);
		});
	});
});
