import assert from 'assert';
import { type ChangeImpact, type ClassListPayload, type EditorChange, type EditorClass, type Pf1eSettings, type RaceListPayload, type RulesetSettings, type SaveImpactPayload } from '@multiverse-kiln/shared';

import { loadBarredOptions } from '../src/db/barredOptions.js';
import { createCharacter } from '../src/db/characterRepo.js';
import { inTransaction } from '../src/db/transactions.js';
import { setUniverseRole } from '../src/db/universeEditorRepo.js';
import { addPlayableUniverse, defaultClassId, dwarfFighter, type PlayableUniverse } from './db/fixtures.js';
import { logIn, saveAll, saveChanges, send, type Editor } from './editorRequests.js';
import { addPlayer } from './players.js';
import { getTestServer } from './testServer.js';

describe('Rulebooks', () =>
{
	let ada: Editor;
	let universe: PlayableUniverse;

	before(async () =>
	{
		await getTestServer();
	});

	beforeEach(async () =>
	{
		ada = await logIn('Ada');
		universe = await addPlayableUniverse();
		await setUniverseRole(universe.universeId, ada.playerId, 'creator');
	});

	/**
	 * The universe's Pathfinder settings, as the Ruleset tab loads them
	 *
	 * @return The settings
	 */
	async function loadSettings(): Promise<Pf1eSettings>
	{
		const { body } = await send<RulesetSettings>(ada, 'GET', `/${universe.universeId}/ruleset`);

		assert.strictEqual(body.ruleset, 'pf1e');

		return(body.settings);
	}

	/**
	 * A ruleset change giving the universe other books
	 *
	 * @param rulebooks The optional books to have on
	 * @param barredRulebooks The books off whose characters can't play
	 * @return The change
	 */
	async function rulebooksChange(rulebooks: string[], barredRulebooks: string[] = []): Promise<EditorChange>
	{
		return({
			kind: 'ruleset',
			settings: {
				ruleset: 'pf1e',
				settings: {
					...await loadSettings(),
					rulebooks,
					barredRulebooks
				}
			}
		});
	}

	/**
	 * The universe's classes, as the Characters tab lists them
	 *
	 * @return The classes
	 */
	async function listClasses(): Promise<EditorClass[]>
	{
		return((await send<ClassListPayload>(ada, 'GET', `/${universe.universeId}/classes`)).body.classes);
	}

	/**
	 * A change disabling one of the universe's classes
	 *
	 * @param characterClass The class, as listed
	 * @return The change
	 */
	function disableClass(characterClass: EditorClass): EditorChange
	{
		const { name, keepPlaying, startingMoney, startingItems, startingAreaId, startingColumn, startingRow, raceAreas, rules } = characterClass;

		return({
			kind: 'saveClass',
			id: characterClass.id,
			settings: { name, enabled: false, keepPlaying, startingMoney, startingItems, startingAreaId, startingColumn, startingRow, raceAreas, rules }
		});
	}

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

	it('lists every default race and class with its book, and gives a universe only the core rulebook', async () =>
	{
		const races = (await send<RaceListPayload>(ada, 'GET', `/${universe.universeId}/races`)).body.races;
		const classes = await listClasses();

		assert.deepStrictEqual((await loadSettings()).rulebooks, []);
		assert.strictEqual(races.find((race) => (race.key === 'tiefling'))?.rulebook, 'arg');
		assert.strictEqual(races.find((race) => (race.key === 'dwarf'))?.rulebook, 'core');
		assert.strictEqual(classes.find((option) => (option.key === 'witch'))?.rulebook, 'apg');
		assert.strictEqual(classes.find((option) => (option.key === 'arcanist'))?.rulebook, 'acg');
	});

	it('saves the books in the order the Ruleset tab lists them, bars only books that are off, and refuses others', async () =>
	{
		await saveAll(ada, universe.universeId, [await rulebooksChange(['acg', 'apg'], ['apg', 'arg'])]);

		const saved = await loadSettings();

		assert.deepStrictEqual(saved.rulebooks, ['apg', 'acg']);
		assert.deepStrictEqual(saved.barredRulebooks, ['arg']);

		for (const rulebooks of [['core'], ['apg', 'apg'], ['unknown']])
		{
			assert.strictEqual((await saveChanges(ada, universe.universeId, [await rulebooksChange(rulebooks)])).status, 400, rulebooks.join());
		}
	});

	it('refuses turning off a book whose classes are the only usable ones, and disabling the last usable class', async () =>
	{
		const classes = await listClasses();
		const core = classes.filter((option) => (option.rulebook === 'core'));
		const witch = classes.find((option) => (option.key === 'witch'));

		assert.ok(witch);
		await saveAll(ada, universe.universeId, [
			await rulebooksChange(['apg']),
			...core.map(disableClass),
			...classes
				.filter((option) => ((option.rulebook === 'apg') && (option.id !== witch.id)))
				.map(disableClass)
		]);

		const turnOff = await saveChanges(ada, universe.universeId, [await rulebooksChange([])]);

		assert.strictEqual(turnOff.status, 409);
		assert.strictEqual(turnOff.body.error.id, 'error.rulebookLeavesNoClass');

		// The Advanced Class Guide's classes are enabled, but its book is off, so they don't count
		const disableWitch = await saveChanges(ada, universe.universeId, [disableClass(witch)]);

		assert.strictEqual(disableWitch.status, 409);
		assert.strictEqual(disableWitch.body.error.id, 'error.noEnabledClass');
	});

	it('warns about the characters of a book being turned off, and bars them only when told to', async () =>
	{
		const playerId = (await addPlayer('Bob')).id;
		const witchId = await defaultClassId('witch');
		const character = await dwarfFighter(playerId, universe.universeId, 'Hexa');

		await saveAll(ada, universe.universeId, [await rulebooksChange(['apg'])]);
		await inTransaction((transaction) => createCharacter({ ...character, classId: witchId }, transaction));

		const keep = await rulebooksChange([]);

		assert.deepStrictEqual(await impactsOf([keep]), [{
			changeIndex: 0,
			kind: 'rulebook',
			rulebook: 'apg',
			races: [],
			classes: [{ id: witchId, name: { key: 'witch', name: null }, characters: 1 }],
			items: []
		}]);

		await saveAll(ada, universe.universeId, [keep]);
		assert.strictEqual((await loadBarredOptions(universe.universeId)).classIds.size, 0);

		// Every class of the book is barred, not only those characters are
		const apgClassIds = (await listClasses())
			.filter((option) => (option.rulebook === 'apg'))
			.map((option) => option.id);

		await saveAll(ada, universe.universeId, [await rulebooksChange([], ['apg'])]);
		assert.ok(apgClassIds.includes(witchId));
		assert.deepStrictEqual([...(await loadBarredOptions(universe.universeId)).classIds].sort((a, b) => (a - b)), apgClassIds.sort((a, b) => (a - b)));

		// Turning the book on again lets them play
		await saveAll(ada, universe.universeId, [await rulebooksChange(['apg'], ['apg'])]);
		assert.strictEqual((await loadBarredOptions(universe.universeId)).classIds.size, 0);
		assert.deepStrictEqual((await loadSettings()).barredRulebooks, []);
	});

	it('warns about nothing when a book turned off has no characters', async () =>
	{
		await saveAll(ada, universe.universeId, [await rulebooksChange(['apg', 'arg'])]);
		assert.deepStrictEqual(await impactsOf([await rulebooksChange([])]), []);
	});
});
