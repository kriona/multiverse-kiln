import assert from 'assert';
import { AUTH_SESSION_PATH, playerProfilePath, PROFILE_PATH, profileCharacterPath, type OwnProfilePayload, type PlayerProfilePayload, type ProfileErrorPayload, type ProfileUpdateRequest, type SessionPayload } from '@multiverse-kiln/shared';

import { pool } from '../src/db/client.js';
import { scheduleCharacterDeletion } from '../src/db/characterRepo.js';
import { createUniverse } from '../src/db/universeRepo.js';
import { SESSION_COOKIE } from '../src/http/cookies.js';
import { Browser } from './browser.js';
import { addCharacter, addUniverse } from './db/fixtures.js';
import { addPlayer, logInBrowser } from './players.js';
import { getTestServer } from './testServer.js';

/**
 * A profile with every field filled in
 */
const ADA_PROFILE: ProfileUpdateRequest = {
	username: 'Ada_L',
	displayName: 'Ada',
	pronouns: 'she/her',
	location: 'London',
	timeZone: 'Europe/London',
	locale: 'en-x-pirate',
	socials: {
		discord: 'ada.lovelace',
		facebook: 'ada.lovelace',
		instagram: 'ada_lovelace',
		tiktok: 'adalovelace'
	},
	showCharacters: true
};

describe('profile routes', () =>
{
	/**
	 * A browser logged in as a new player
	 *
	 * @param name The player's name, from which their username comes
	 * @return The browser, and the player's ID
	 */
	async function logIn(name: string): Promise<{ browser: Browser; playerId: string }>
	{
		const player = await addPlayer(name);
		const { cookie } = await logInBrowser(player.id);
		const browser = new Browser();

		browser.cookies.set(SESSION_COOKIE, cookie.slice(SESSION_COOKIE.length + 1));

		return({
			browser,
			playerId: player.id
		});
	}

	/**
	 * A universe anyone can play, by name
	 *
	 * @param name Its name
	 * @return Its ID
	 */
	function addPublicUniverse(name: string): Promise<string>
	{
		return(createUniverse({
			name,
			ruleset: 'pf1e',
			stage: 'let_there_be_light'
		}));
	}

	before(async () =>
	{
		await getTestServer();
	});

	it('needs a login for the player\'s own profile', async () =>
	{
		assert.strictEqual((await new Browser().send('GET', PROFILE_PATH)).status, 401);
		assert.strictEqual((await new Browser().send('PUT', PROFILE_PATH, ADA_PROFILE)).status, 401);
	});

	it('starts with only the username and name filled in', async () =>
	{
		const { browser } = await logIn('Ada');
		const profile = await browser.send<OwnProfilePayload>('GET', PROFILE_PATH);

		assert.strictEqual(profile.status, 200);
		assert.deepStrictEqual(profile.body, {
			username: 'Ada',
			displayName: 'Ada',
			pronouns: null,
			location: null,
			timeZone: null,
			socials: {
				discord: null,
				facebook: null,
				instagram: null,
				tiktok: null
			},
			email: null,
			hasPassword: false,
			providers: [],
			locale: null,
			showCharacters: true,
			characters: []
		});
	});

	it('saves the profile, which other players can then read by username', async () =>
	{
		const { browser } = await logIn('Ada');

		assert.strictEqual((await browser.send('PUT', PROFILE_PATH, {
			...ADA_PROFILE,
			location: '  London  ',
			socials: {
				...ADA_PROFILE.socials,
				instagram: '@ada_lovelace'
			}
		})).status, 204);

		const own = await browser.send<OwnProfilePayload>('GET', PROFILE_PATH);
		const fields = {
			username: ADA_PROFILE.username,
			displayName: ADA_PROFILE.displayName,
			pronouns: ADA_PROFILE.pronouns,
			location: ADA_PROFILE.location,
			timeZone: ADA_PROFILE.timeZone,
			socials: ADA_PROFILE.socials
		};

		assert.deepStrictEqual({ ...own.body, email: undefined, hasPassword: undefined, providers: undefined, characters: undefined }, {
			...ADA_PROFILE,
			email: undefined,
			hasPassword: undefined,
			providers: undefined,
			characters: undefined
		});
		assert.deepStrictEqual((await (await logIn('Grace')).browser.send<PlayerProfilePayload>('GET', playerProfilePath('ada_l'))).body, {
			...fields,
			characters: []
		});
		assert.strictEqual((await browser.send<SessionPayload>('GET', AUTH_SESSION_PATH)).body.player?.locale, 'en-x-pirate');
	});

	it('leaves blank fields empty, and writes language tags the usual way', async () =>
	{
		const { browser } = await logIn('Ada');

		assert.strictEqual((await browser.send('PUT', PROFILE_PATH, {
			...ADA_PROFILE,
			pronouns: '   ',
			location: '',
			timeZone: null,
			locale: 'PT-br',
			socials: {
				discord: '',
				facebook: null,
				instagram: null,
				tiktok: null
			}
		})).status, 204);

		const own = (await browser.send<OwnProfilePayload>('GET', PROFILE_PATH)).body;

		assert.strictEqual(own.pronouns, null);
		assert.strictEqual(own.location, null);
		assert.strictEqual(own.socials.discord, null);
		assert.strictEqual(own.locale, 'pt-BR');
	});

	it('says which field it refuses', async () =>
	{
		const { browser } = await logIn('Ada');

		await addPlayer('Grace');

		const refusals: [Partial<ProfileUpdateRequest>, string, number][] = [
			[{ username: 'GRACE' }, 'username', 409],
			[{ username: 'a' }, 'username', 400],
			[{ timeZone: 'Atlantis/Lost' }, 'timeZone', 400],
			[{ locale: 'not a language' }, 'locale', 400],
			[{ socials: { ...ADA_PROFILE.socials, instagram: 'https://instagram.com/ada' } }, 'instagram', 400],
			[{ socials: { ...ADA_PROFILE.socials, facebook: 'ada' } }, 'facebook', 400]
		];

		for (const [changes, field, status] of refusals)
		{
			const answer = await browser.send<ProfileErrorPayload>('PUT', PROFILE_PATH, { ...ADA_PROFILE, ...changes });

			assert.strictEqual(answer.status, status, field);
			assert.strictEqual(answer.body.field, field);
		}

		assert.strictEqual((await browser.send('PUT', PROFILE_PATH, { ...ADA_PROFILE, pronouns: 'x'.repeat(41) })).status, 400);
		assert.strictEqual((await browser.send<OwnProfilePayload>('GET', PROFILE_PATH)).body.username, 'Ada');
	});

	it('shows others\' profiles only to logged-in players', async () =>
	{
		await addPlayer('Ada');

		assert.strictEqual((await new Browser().send('GET', playerProfilePath('ada'))).status, 401);
	});

	it('answers 404 for a username nobody has', async () =>
	{
		const { browser } = await logIn('Grace');

		assert.strictEqual((await browser.send('GET', playerProfilePath('nobody_here'))).status, 404);
	});

	it('lists the player\'s characters, and others only those in universes anyone can play', async () =>
	{
		const { browser, playerId } = await logIn('Ada');
		const openId = await addPublicUniverse('Brightwater');
		const draftId = await addUniverse('Workshop');

		await addCharacter(playerId, openId, 'Brokk');
		await addCharacter(playerId, draftId, 'Dain');

		const goneId = await addCharacter(playerId, openId, 'Gimli');

		await scheduleCharacterDeletion(playerId, openId, goneId, new Date(Date.now() + 60000));

		const own = (await browser.send<OwnProfilePayload>('GET', PROFILE_PATH)).body;

		assert.deepStrictEqual(own.characters.map((character) => [character.universe.name, character.name]), [['Brightwater', 'Brokk'], ['Workshop', 'Dain']]);
		assert.deepStrictEqual(own.characters[0].race, { key: 'dwarf', name: null });
		assert.strictEqual(own.characters[0].characterClass.key, 'fighter');
		assert.strictEqual(own.characters[0].visibleOnProfile, true);

		const others = (await (await logIn('Grace')).browser.send<PlayerProfilePayload>('GET', playerProfilePath('ada'))).body;

		assert.deepStrictEqual(others.characters.map((character) => character.name), ['Brokk']);
		assert.ok(!('visibleOnProfile' in others.characters[0]));
	});

	it('shows others only the characters marked visible, once the player stops showing them all', async () =>
	{
		const { browser, playerId } = await logIn('Ada');
		const universeId = await addPublicUniverse('Brightwater');
		const brokkId = await addCharacter(playerId, universeId, 'Brokk');

		await addCharacter(playerId, universeId, 'Dain');

		assert.strictEqual((await browser.send('PUT', profileCharacterPath(brokkId), { visibleOnProfile: false })).status, 204);

		const { browser: viewer } = await logIn('Grace');
		const names = async (): Promise<string[]> => (await viewer.send<PlayerProfilePayload>('GET', playerProfilePath('ada'))).body.characters.map((character) => character.name);

		assert.deepStrictEqual(await names(), ['Brokk', 'Dain']);

		assert.strictEqual((await browser.send('PUT', PROFILE_PATH, { ...ADA_PROFILE, username: 'Ada', showCharacters: false })).status, 204);
		assert.deepStrictEqual(await names(), ['Dain']);
	});

	it('changes only the player\'s own characters', async () =>
	{
		const { browser } = await logIn('Ada');
		const grace = await addPlayer('Grace');
		const universeId = await addPublicUniverse('Brightwater');
		const gracesId = await addCharacter(grace.id, universeId, 'Brokk');

		assert.strictEqual((await browser.send('PUT', profileCharacterPath(gracesId), { visibleOnProfile: false })).status, 404);
		assert.strictEqual((await browser.send('PUT', profileCharacterPath('not-an-id'), { visibleOnProfile: false })).status, 404);
		assert.deepStrictEqual((await pool.query('SELECT visible_on_profile FROM characters')).rows, [{ visible_on_profile: true }]);
	});
});
