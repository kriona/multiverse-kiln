import assert from 'assert';

import { ADMIN_UNIVERSES_PATH, AUTH_CODE_CHECK_PATH, AUTH_CODE_PATH, AUTH_LOGIN_PATH, EDITOR_UNIVERSES_PATH, UNIVERSE_DELETION_PATH, type AuthErrorPayload, type UniverseDeletionPayload } from '@multiverse-kiln/shared';

import { hashPassword } from '../src/auth/passwords.js';
import { adminDb } from '../src/db/adminClient.js';
import { findPlayerAdminEvents } from '../src/db/adminEventRepo.js';
import { pool } from '../src/db/client.js';
import { addGroupMember } from '../src/db/groupRepo.js';
import { createPlayer } from '../src/db/playerRepo.js';
import { addServerAdmin } from '../src/db/serverAdminRepo.js';
import { inTransaction } from '../src/db/transactions.js';
import { setUniverseRole } from '../src/db/universeEditorRepo.js';
import { setUniverseDisabled, updateUniverseSettings } from '../src/db/universeRepo.js';
import { liveVersion } from '../src/db/universeVersions.js';
import { setEmailSender, type Email } from '../src/email/mailer.js';
import { areaChanges, type AreaChange } from '../src/world/areaChanges.js';
import { Browser } from './browser.js';
import { addCharacter, addGroup, addUniverse } from './db/fixtures.js';
import { addPlayer, logInBrowser } from './players.js';
import { discardEmail } from './setup.js';
import { getTestServer } from './testServer.js';
import { authenticatorCode, turnOnTwoFactor } from './twoFactorAccounts.js';
import { waitUntil } from './waitUntil.js';

const PASSWORD = 'correct horse battery staple';

describe('deleting a universe', () =>
{
	let emails: Email[];
	let areaChangesSeen: AreaChange[];
	let stopListening: () => void;

	/**
	 * Makes an account with a password and an address, and logs a browser in to it
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

		assert.strictEqual((await browser.send('POST', AUTH_LOGIN_PATH, { email, password: PASSWORD, rememberMe: false, locale: 'en' })).status, 200);

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
	 * Makes a player with an address, whom the deletion emails, and gives them a role in a universe
	 *
	 * @param universeId The universe
	 * @param username Their username, which their address is made from
	 * @return Their ID
	 */
	async function addEmailedBuilder(universeId: string, username: string): Promise<string>
	{
		const playerId = (await createPlayer({
			username,
			displayName: `${username[0].toUpperCase()}${username.slice(1)}`,
			email: `${username}@example.com`,
			passwordHash: null
		})).id;

		await setUniverseRole(universeId, playerId, 'builder');

		return(playerId);
	}

	/**
	 * What deleting a universe deletes, as the editor asks
	 *
	 * @param browser The browser asking
	 * @param universeId The universe
	 * @return The answer
	 */
	function getDeletion(browser: Browser, universeId: string): Promise<{ status: number; body: UniverseDeletionPayload }>
	{
		return(browser.send<UniverseDeletionPayload>('GET', `${EDITOR_UNIVERSES_PATH}/${universeId}${UNIVERSE_DELETION_PATH}`));
	}

	/**
	 * Deletes a universe through the editor's route, or the admin route
	 *
	 * @param browser The browser
	 * @param universeId The universe
	 * @param request What the request gives, besides the language, and whether it goes to the admin route
	 * @return The answer
	 */
	function deleteUniverse(browser: Browser, universeId: string, request: { password?: string | null; twoFactorCode?: string | null; username?: string | null; asAdmin?: boolean }): Promise<{ status: number; body: AuthErrorPayload }>
	{
		const path = (request.asAdmin ? `${ADMIN_UNIVERSES_PATH}/${universeId}` : `${EDITOR_UNIVERSES_PATH}/${universeId}`);

		return(browser.send('POST', `${path}${UNIVERSE_DELETION_PATH}`, {
			password: (request.password ?? null),
			twoFactorCode: (request.twoFactorCode ?? null),
			username: (request.username ?? null),
			locale: 'en'
		}));
	}

	/**
	 * Whether a universe still exists
	 *
	 * @param universeId The universe
	 * @return Whether it does
	 */
	async function universeExists(universeId: string): Promise<boolean>
	{
		return(((await pool.query('SELECT id FROM universes WHERE id = $1', [universeId])).rowCount ?? 0) > 0);
	}

	before(async () =>
	{
		await getTestServer();
	});

	beforeEach(() =>
	{
		emails = [];
		areaChangesSeen = [];
		setEmailSender((email) =>
		{
			emails.push(email);
			return(Promise.resolve());
		});
		stopListening = areaChanges.onChange((change) =>
		{
			areaChangesSeen.push(change);
		});
	});

	afterEach(() =>
	{
		stopListening();
		setEmailSender(discardEmail);
	});

	it('says what deleting the universe deletes, and how the player confirms it', async () =>
	{
		const { playerId, browser } = await addLocalAccount('ada');
		const grace = await addPlayer('Grace');
		const linus = await addPlayer('Linus');
		const universeId = await addUniverse('Doomed');

		await setUniverseRole(universeId, playerId, 'creator');
		await setUniverseRole(universeId, grace.id, 'beta_tester');

		const anchor = await addCharacter(grace.id, universeId, 'Brokk');
		const groupId = await addGroup(universeId, anchor, null);

		await addCharacter(grace.id, universeId, 'Dain');
		await inTransaction(async (transaction) =>
		{
			await addGroupMember(groupId, await addCharacter(linus.id, universeId, 'Thorin'), transaction);
		});

		const answer = await getDeletion(browser, universeId);

		assert.strictEqual(answer.status, 200);
		assert.deepStrictEqual(answer.body, {
			characters: 3,
			players: 2,
			groups: 1,
			editors: 1,
			deletionPrevented: false,
			asAdmin: false,
			email: 'ada@example.com',
			hasPassword: true,
			twoFactor: false
		});
	});

	it('lets only the universe\'s creators delete it', async () =>
	{
		const grace = await addPlayer('Grace');
		const universeId = await addUniverse('Kept');
		const browser = await browserFor(grace.id);

		await setUniverseRole(universeId, grace.id, 'builder');

		assert.strictEqual((await getDeletion(browser, universeId)).status, 403);
		assert.strictEqual((await deleteUniverse(browser, universeId, { username: grace.username })).status, 403);

		// Only a server admin may use the admin route
		assert.strictEqual((await deleteUniverse(browser, universeId, { username: grace.username, asAdmin: true })).status, 403);
		assert.ok(await universeExists(universeId));
	});

	it('needs the password, and the authenticator code when the account has 2FA, then deletes the universe and emails its other editors', async () =>
	{
		const { playerId, browser } = await addLocalAccount('ada');
		const universeId = await addUniverse('Doomed');
		const authenticator = await turnOnTwoFactor(playerId);

		await setUniverseRole(universeId, playerId, 'creator');
		await addEmailedBuilder(universeId, 'grace');

		const wrongPassword = await deleteUniverse(browser, universeId, { password: 'not the password at all', twoFactorCode: authenticatorCode(authenticator.secret) });

		assert.strictEqual(wrongPassword.status, 401);
		assert.strictEqual(wrongPassword.body.field, 'password');

		const noCode = await deleteUniverse(browser, universeId, { password: PASSWORD });

		assert.strictEqual(noCode.status, 401);
		assert.strictEqual(noCode.body.field, 'twoFactorCode');
		assert.ok(await universeExists(universeId));
		assert.strictEqual((await deleteUniverse(browser, universeId, { password: PASSWORD, twoFactorCode: authenticatorCode(authenticator.secret) })).status, 204);
		assert.ok(!await universeExists(universeId));
		await waitUntil(() => ((areaChangesSeen.length > 0) && (emails.length > 0)));
		assert.deepStrictEqual(areaChangesSeen, [{ kind: 'universeDeleted', universeId }]);
		assert.deepStrictEqual(emails.map((email) => email.to), ['grace@example.com']);
		assert.match(emails[0].subject, /Doomed was deleted/);
		assert.match(emails[0].text, /ada deleted the universe Doomed/);
	});

	it('asks an account without a password, but with an address, for its username and a code sent to the address', async () =>
	{
		const grace = await createPlayer({
			username: 'grace',
			displayName: 'Grace',
			email: 'grace@example.com',
			passwordHash: null
		});
		const universeId = await addUniverse('Doomed');
		const another = await addUniverse('Also Doomed');
		const browser = await browserFor(grace.id);

		await setUniverseRole(universeId, grace.id, 'creator');
		await setUniverseRole(another, grace.id, 'creator');
		assert.strictEqual((await deleteUniverse(browser, universeId, { username: 'grace' })).status, 403);
		assert.strictEqual((await browser.send('POST', AUTH_CODE_PATH, { purpose: 'deleteUniverse', email: 'grace@example.com', locale: 'en' })).status, 204);
		await waitUntil(() => (emails.length > 0));
		assert.match(emails[0].subject, /delete a universe/);

		const code = /\r\n\r\n([0-9A-Z]{6})\r\n\r\n/.exec(emails[0].text)?.[1];

		assert.strictEqual((await browser.send('POST', AUTH_CODE_CHECK_PATH, { purpose: 'deleteUniverse', email: 'grace@example.com', code })).status, 200);

		const wrongUsername = await deleteUniverse(browser, universeId, { username: 'someone' });

		assert.strictEqual(wrongUsername.status, 400);
		assert.strictEqual(wrongUsername.body.field, 'username');
		const cookies = new Map(browser.cookies);

		assert.strictEqual((await deleteUniverse(browser, universeId, { username: 'GRACE' })).status, 204);
		assert.ok(!await universeExists(universeId));

		// The code deleted one universe, so another needs a new one, even sending the cookie the answer cleared
		for (const [name, value] of cookies)
		{
			browser.cookies.set(name, value);
		}

		assert.strictEqual((await deleteUniverse(browser, another, { username: 'grace' })).status, 403);
		assert.ok(await universeExists(another));
	});

	it('won\'t let its creators delete a universe the site\'s admins disabled and kept from being deleted, but deletes one they didn\'t', async () =>
	{
		const ada = await addPlayer('Ada');
		const browser = await browserFor(ada.id);
		const prevented = await addUniverse('Prevented');
		const disabled = await addUniverse('Disabled');

		await setUniverseRole(prevented, ada.id, 'creator');
		await setUniverseRole(disabled, ada.id, 'creator');
		await setUniverseDisabled(prevented, { reason: 'Spam', preventDeletion: true }, adminDb);
		await setUniverseDisabled(disabled, { reason: 'Spam', preventDeletion: false }, adminDb);

		assert.strictEqual((await getDeletion(browser, prevented)).body.deletionPrevented, true);
		assert.strictEqual((await getDeletion(browser, prevented)).body.asAdmin, false);
		assert.strictEqual((await deleteUniverse(browser, prevented, { username: ada.username })).status, 409);
		assert.ok(await universeExists(prevented));
		assert.strictEqual((await deleteUniverse(browser, disabled, { username: ada.username })).status, 204);
		assert.ok(!await universeExists(disabled));
	});

	it('won\'t let a creator without 2FA delete a universe that requires it', async () =>
	{
		const ada = await addPlayer('Ada');
		const browser = await browserFor(ada.id);
		const universeId = await addUniverse('Guarded');

		await setUniverseRole(universeId, ada.id, 'creator');
		await updateUniverseSettings(liveVersion(universeId), { requireTwoFactor: true });

		assert.strictEqual((await getDeletion(browser, universeId)).status, 403);
		assert.strictEqual((await deleteUniverse(browser, universeId, { username: ada.username })).status, 403);
		assert.ok(await universeExists(universeId));
	});

	it('deletes a universe as a server admin through the admin route, recording it without naming the admin to its editors', async () =>
	{
		const admin = await addPlayer('Admin');
		const universeId = await addUniverse('Spam Universe');

		await addServerAdmin(admin.id, adminDb);

		const authenticator = await turnOnTwoFactor(admin.id);
		const browser = await browserFor(admin.id);

		await setUniverseDisabled(universeId, { reason: 'Spam', preventDeletion: true }, adminDb);
		await addEmailedBuilder(universeId, 'grace');

		const deletion = await getDeletion(browser, universeId);

		assert.strictEqual(deletion.status, 200);
		assert.strictEqual(deletion.body.asAdmin, true);
		assert.strictEqual(deletion.body.twoFactor, true);

		// The editor's route is only for its creators
		assert.strictEqual((await deleteUniverse(browser, universeId, { username: admin.username, twoFactorCode: authenticatorCode(authenticator.secret) })).status, 403);
		assert.strictEqual((await deleteUniverse(browser, universeId, { username: admin.username, twoFactorCode: authenticatorCode(authenticator.secret, 1), asAdmin: true })).status, 204);
		assert.ok(!await universeExists(universeId));
		assert.deepStrictEqual((await findPlayerAdminEvents(admin.id)).map((event) => [event.kind, event.universeId, event.universeName]), [
			['universeDeleted', null, 'Spam Universe']
		]);
		await waitUntil(() => (emails.length > 0));
		assert.deepStrictEqual(emails.map((email) => email.to), ['grace@example.com']);
		assert.match(emails[0].text, /The site's admins deleted the universe Spam Universe/);
		assert.doesNotMatch(emails[0].text, /Admin deleted/);
	});
});
