import assert from 'assert';
import { accountExportFileName, AUTH_ACCOUNT_DELETE_PATH, AUTH_LOGIN_PATH, PROFILE_DELETION_PATH, PROFILE_EXPORT_PATH, type AccountDeletionPayload, type AccountExport, type AuthErrorPayload } from '@multiverse-kiln/shared';

import { hashPassword } from '../src/auth/passwords.js';
import { pool } from '../src/db/client.js';
import { addGroupMember, findMembership } from '../src/db/groupRepo.js';
import { createPlayer } from '../src/db/playerRepo.js';
import { inTransaction } from '../src/db/transactions.js';
import { findUniverseRole, setUniverseRole } from '../src/db/universeEditorRepo.js';
import { setEmailSender, type Email } from '../src/email/mailer.js';
import { connectedSessions } from '../src/players/connectedSessions.js';
import { groupChanges, type GroupChange } from '../src/players/groupChanges.js';
import { areaChanges, type AreaChange } from '../src/world/areaChanges.js';
import { Browser } from './browser.js';
import { addCharacter, addGroup, addPlayableUniverse, addUniverse } from './db/fixtures.js';
import { addPlayer, logInBrowser } from './players.js';
import { getTestServer, testServerUrl } from './testServer.js';
import { authenticatorCode, turnOnTwoFactor } from './twoFactorAccounts.js';
import { waitUntil } from './waitUntil.js';

const PASSWORD = 'correct horse battery staple';

describe('account deletion and data export', () =>
{
	let emails: Email[];
	let groupChangesSeen: GroupChange[];
	let areaChangesSeen: AreaChange[];
	let endedSessions: string[];
	let stopListening: (() => void)[];

	/**
	 * Makes an account with a password, and logs a browser in to it
	 *
	 * @param username The account's username, which its address is made from
	 * @return The account's ID, and the browser
	 */
	async function addLocalAccount(username: string): Promise<{ playerId: string; browser: Browser }>
	{
		const email = `${username}@example.com`;
		const playerId = (await createPlayer({
			username,
			displayName: username,
			email,
			passwordHash: await hashPassword(PASSWORD)
		})).id;
		const browser = new Browser();

		assert.strictEqual((await browser.send('POST', AUTH_LOGIN_PATH, { email, password: PASSWORD, rememberMe: false })).status, 200);

		return({ playerId, browser });
	}

	/**
	 * A browser logged in to an account
	 *
	 * @param playerId The account
	 * @return The browser
	 */
	async function browserFor(playerId: string): Promise<Browser>
	{
		const browser = new Browser();
		const [name, value] = (await logInBrowser(playerId)).cookie.split('=');

		browser.cookies.set(name, value);

		return(browser);
	}

	/**
	 * Deletes the account a browser is logged in to
	 *
	 * @param browser The browser
	 * @param request What the request gives, besides the language
	 * @return The answer
	 */
	function deleteAccount(browser: Browser, request: { password?: string | null; twoFactorCode?: string | null; username?: string | null; universes?: { universeId: string; newCreatorId: string | null }[] }): Promise<{ status: number; body: AuthErrorPayload }>
	{
		return(browser.send('POST', AUTH_ACCOUNT_DELETE_PATH, {
			password: (request.password ?? null),
			twoFactorCode: (request.twoFactorCode ?? null),
			username: (request.username ?? null),
			universes: (request.universes ?? []),
			locale: 'en'
		}));
	}

	/**
	 * Whether an account still exists
	 *
	 * @param playerId The account
	 * @return Whether it does
	 */
	async function accountExists(playerId: string): Promise<boolean>
	{
		return(((await pool.query('SELECT id FROM players WHERE id = $1', [playerId])).rowCount ?? 0) > 0);
	}

	before(async () =>
	{
		await getTestServer();
	});

	beforeEach(() =>
	{
		emails = [];
		groupChangesSeen = [];
		areaChangesSeen = [];
		endedSessions = [];
		setEmailSender((email) =>
		{
			emails.push(email);
			return(Promise.resolve());
		});
		stopListening = [
			groupChanges.onChange((change) =>
			{
				groupChangesSeen.push(change);
			}),
			areaChanges.onChange((change) =>
			{
				areaChangesSeen.push(change);
			}),
			connectedSessions.onEnd((sessionIds) =>
			{
				endedSessions.push(...sessionIds);
			})
		];
	});

	afterEach(() =>
	{
		for (const stop of stopListening)
		{
			stop();
		}
	});

	after(() =>
	{
		setEmailSender(undefined);
	});

	it('exports the account\'s data without its secrets', async () =>
	{
		const { playerId, browser } = await addLocalAccount('ada');
		const universe = await addPlayableUniverse();
		const characterId = await addCharacter(playerId, universe.universeId, 'Brokk');

		await addGroup(universe.universeId, characterId, null);
		await setUniverseRole(universe.universeId, playerId, 'builder');

		const response = await fetch(`${testServerUrl}${PROFILE_EXPORT_PATH}?locale=en`, {
			headers: {
				Cookie: [...browser.cookies].map(([name, value]) => `${name}=${value}`).join('; ')
			}
		});
		const text = await response.text();
		const exported = JSON.parse(text) as AccountExport;

		assert.strictEqual(response.status, 200);
		assert.strictEqual((response.headers.get('Content-Disposition') ?? '').replace(/"/g, ''), `attachment; filename=${accountExportFileName('ada')}`);
		assert.strictEqual(exported.account.id, playerId);
		assert.strictEqual(exported.account.email, 'ada@example.com');
		assert.strictEqual(exported.account.hasPassword, true);
		assert.strictEqual(exported.sessions.length, 1);
		assert.deepStrictEqual(exported.authEvents.map((event) => event.kind), ['loggedIn']);
		assert.deepStrictEqual(exported.universes.map((each) => each.role), ['builder']);
		assert.strictEqual(exported.characters.length, 1);
		assert.strictEqual(exported.characters[0].name, 'Brokk');
		assert.strictEqual(exported.characters[0].race, 'Dwarf');
		assert.strictEqual(exported.characters[0].characterClass, 'Fighter');
		assert.ok(exported.characters[0].items.every((item) => (item.name !== '')));
		assert.deepStrictEqual(exported.characters[0].group, {
			id: (await findMembership(characterId))?.groupId,
			anchorBeing: true
		});

		// Nothing that could log in, or tell where the player logged in from
		assert.doesNotMatch(text, /argon2|password_hash|networkHash|tokenHash|secret/i);
	});

	it('lists the universes only the player creates, with who else could create them', async () =>
	{
		const { playerId, browser } = await addLocalAccount('ada');
		const grace = await addPlayer('Grace');
		const alone = await addUniverse('Alone');
		const shared = await addUniverse('Shared');

		await setUniverseRole(alone, playerId, 'creator');
		await setUniverseRole(alone, grace.id, 'beta_tester');
		await setUniverseRole(shared, playerId, 'creator');
		await setUniverseRole(shared, grace.id, 'creator');

		const answer = await browser.send<AccountDeletionPayload>('GET', PROFILE_DELETION_PATH);

		assert.deepStrictEqual(answer.body, {
			universes: [{
				id: alone,
				name: 'Alone',
				editors: [{
					playerId: grace.id,
					username: grace.username,
					displayName: 'Grace',
					role: 'beta_tester'
				}]
			}],
			hasPassword: true,
			twoFactor: false
		});
	});

	it('needs the password, and the authenticator code when the account has 2FA', async () =>
	{
		const { playerId, browser } = await addLocalAccount('ada');
		const authenticator = await turnOnTwoFactor(playerId);

		assert.strictEqual((await deleteAccount(new Browser(), { password: PASSWORD })).status, 401);

		const wrong = await deleteAccount(browser, { password: 'not the password at all' });

		assert.strictEqual(wrong.status, 401);
		assert.strictEqual(wrong.body.field, 'password');

		const missingCode = await deleteAccount(browser, { password: PASSWORD });

		assert.strictEqual(missingCode.status, 401);
		assert.strictEqual(missingCode.body.field, 'twoFactorCode');
		assert.ok(await accountExists(playerId));

		assert.strictEqual((await deleteAccount(browser, { password: PASSWORD, twoFactorCode: authenticatorCode(authenticator.secret) })).status, 204);
		assert.ok(!await accountExists(playerId));
		assert.strictEqual(await browser.username(), null);
		await waitUntil(() => (emails.length === 1));
		assert.strictEqual(emails[0].to, 'ada@example.com');
		assert.match(emails[0].subject, /was deleted/);
	});

	it('asks an account without a password to type its username', async () =>
	{
		const ada = await addPlayer('Ada');
		const browser = await browserFor(ada.id);
		const wrong = await deleteAccount(browser, { username: 'someone' });

		assert.strictEqual(wrong.status, 400);
		assert.strictEqual(wrong.body.field, 'username');
		assert.strictEqual((await deleteAccount(browser, { username: ada.username.toUpperCase() })).status, 204);
		assert.ok(!await accountExists(ada.id));
	});

	it('hands on or deletes each universe the player alone creates, as they chose', async () =>
	{
		const { playerId, browser } = await addLocalAccount('ada');
		const grace = await addPlayer('Grace');
		const handed = await addUniverse('Handed On');
		const deleted = await addUniverse('Deleted');

		for (const universeId of [handed, deleted])
		{
			await setUniverseRole(universeId, playerId, 'creator');
			await setUniverseRole(universeId, grace.id, 'builder');
		}

		// Every universe needs a decision, and only one of its editors can take it on
		assert.strictEqual((await deleteAccount(browser, {
			password: PASSWORD,
			universes: [{ universeId: handed, newCreatorId: grace.id }]
		})).status, 409);
		assert.strictEqual((await deleteAccount(browser, {
			password: PASSWORD,
			universes: [{ universeId: handed, newCreatorId: playerId }, { universeId: deleted, newCreatorId: null }]
		})).status, 409);
		assert.ok(await accountExists(playerId));

		// A refusal changes nothing, though the universe it could delete comes first
		assert.strictEqual((await pool.query('SELECT id FROM universes WHERE id = ANY($1)', [[handed, deleted]])).rowCount, 2);
		assert.strictEqual(await findUniverseRole(handed, grace.id), 'builder');

		assert.strictEqual((await deleteAccount(browser, {
			password: PASSWORD,
			universes: [{ universeId: handed, newCreatorId: grace.id }, { universeId: deleted, newCreatorId: null }]
		})).status, 204);
		assert.strictEqual(await findUniverseRole(handed, grace.id), 'creator');
		assert.strictEqual((await pool.query('SELECT id FROM universes WHERE id = $1', [deleted])).rowCount, 0);
		await waitUntil(() => (areaChangesSeen.length > 0));
		assert.deepStrictEqual(areaChangesSeen, [{ kind: 'universeDeleted', universeId: deleted }]);
	});

	it('disbands the groups the player\'s characters anchor, takes them out of others, and ends their sessions', async () =>
	{
		const { playerId, browser } = await addLocalAccount('ada');
		const grace = await addPlayer('Grace');
		const universe = await addPlayableUniverse();
		const adaAnchor = await addCharacter(playerId, universe.universeId, 'Brokk');
		const adaMember = await addCharacter(playerId, universe.universeId, 'Sindri');
		const graceAnchor = await addCharacter(grace.id, universe.universeId, 'Grace');
		const graceMember = await addCharacter(grace.id, universe.universeId, 'Hopper');
		const adaGroup = await addGroup(universe.universeId, adaAnchor, null);
		const graceGroup = await addGroup(universe.universeId, graceAnchor, null);

		await inTransaction(async (transaction) =>
		{
			await addGroupMember(adaGroup, graceMember, transaction);
			await addGroupMember(graceGroup, adaMember, transaction);
		});

		const otherBrowser = await browserFor(playerId);
		const otherSession = (await pool.query<{ id: string }>('SELECT id FROM sessions WHERE player_id = $1', [playerId])).rows.map((row) => row.id);

		assert.strictEqual((await deleteAccount(browser, { password: PASSWORD })).status, 204);
		assert.strictEqual(await otherBrowser.username(), null);
		await waitUntil(() => (groupChangesSeen.length === 2));
		assert.deepStrictEqual(new Set(endedSessions), new Set(otherSession));

		assert.strictEqual(await findMembership(graceMember), undefined);
		assert.strictEqual((await findMembership(graceAnchor))?.groupId, graceGroup);

		const disbanded = groupChangesSeen.find((change) => (change.kind === 'disbanded'));
		const left = groupChangesSeen.find((change) => (change.kind === 'left'));

		assert.strictEqual(disbanded?.groupId, adaGroup);
		assert.deepStrictEqual((disbanded?.kind === 'disbanded') && disbanded.members.map(({ characterId, playable }) => [characterId, playable]).sort(), [[adaAnchor, false], [graceMember, true]].sort());
		assert.strictEqual(left?.groupId, graceGroup);
		assert.strictEqual((left?.kind === 'left') && left.character.characterId, adaMember);
	});
});
