import assert from 'assert';

import { pool } from '../../src/db/client.js';
import { AccountTakenError, createPlayer, findLocalLogin, findOwnProfile, findPasswordHash, findPlayer, findPlayerByUsername, findPlayerEmail, findPlayerIdByEmail, findProfileByUsername, saveEmail, savePasswordHash, saveProfile, type NewPlayer, type ProfileChanges } from '../../src/db/playerRepo.js';

/**
 * A local account with an email address and password
 *
 * @param username The account's username
 * @param email Its address
 * @return The account to create
 */
function localAccount(username: string, email: string): NewPlayer
{
	return({
		username,
		displayName: username,
		email,
		passwordHash: '$argon2id$v=19$m=19456,p=1,t=2$c2FsdA$aGFzaA'
	});
}

describe('playerRepo', () =>
{
	describe('createPlayer', () =>
	{
		it('creates an account', async () =>
		{
			const player = await createPlayer(localAccount('Ada', 'ada@example.com'));

			assert.match(player.id, /^[0-9a-f-]{36}$/);
			assert.deepStrictEqual(await findPlayer(player.id), {
				id: player.id,
				username: 'Ada',
				displayName: 'Ada'
			});
		});

		it('refuses a username another account has, ignoring capitals', async () =>
		{
			await createPlayer(localAccount('Ada', 'ada@example.com'));

			await assert.rejects(createPlayer(localAccount('ADA', 'other@example.com')), (error) => ((error instanceof AccountTakenError) && (error.field === 'username')));
		});

		it('refuses an email address another account has, ignoring capitals', async () =>
		{
			await createPlayer(localAccount('Ada', 'ada@example.com'));

			await assert.rejects(createPlayer(localAccount('Grace', 'ADA@Example.com')), (error) => ((error instanceof AccountTakenError) && (error.field === 'email')));
		});

		it('lets two accounts share a display name, and have no email address', async () =>
		{
			await createPlayer({
				username: 'ada_one',
				displayName: 'Ada',
				email: null,
				passwordHash: null
			});
			await createPlayer({
				username: 'ada_two',
				displayName: 'Ada',
				email: null,
				passwordHash: null
			});
		});

		it('refuses a username the database doesn\'t allow', async () =>
		{
			await assert.rejects(createPlayer(localAccount('a b', 'ada@example.com')));
			await assert.rejects(createPlayer(localAccount('ab', 'ada@example.com')));
		});
	});

	describe('finding accounts', () =>
	{
		it('finds an account by username, ignoring capitals', async () =>
		{
			const player = await createPlayer(localAccount('Ada', 'ada@example.com'));

			assert.deepStrictEqual(await findPlayerByUsername('aDA'), player);
			assert.strictEqual(await findPlayerByUsername('Grace'), undefined);
		});

		it('finds an account by email address, ignoring capitals and surrounding spaces', async () =>
		{
			const player = await createPlayer(localAccount('Ada', 'Ada@Example.com'));

			assert.strictEqual(await findPlayerIdByEmail(' ada@example.COM '), player.id);
			assert.strictEqual(await findPlayerIdByEmail('grace@example.com'), undefined);
			assert.strictEqual(await findPlayerEmail(player.id), 'Ada@Example.com');
		});

		it('finds a local login only for an account with a password', async () =>
		{
			const player = await createPlayer(localAccount('Ada', 'ada@example.com'));

			await createPlayer({
				username: 'Grace',
				displayName: 'Grace',
				email: 'grace@example.com',
				passwordHash: null
			});

			assert.deepStrictEqual(await findLocalLogin('ADA@example.com'), {
				id: player.id,
				passwordHash: '$argon2id$v=19$m=19456,p=1,t=2$c2FsdA$aGFzaA'
			});
			assert.strictEqual(await findLocalLogin('grace@example.com'), undefined);
			assert.strictEqual(await findLocalLogin('nobody@example.com'), undefined);
		});
	});

	describe('changing an account', () =>
	{
		it('stores a new password hash', async () =>
		{
			const player = await createPlayer(localAccount('Ada', 'ada@example.com'));

			await savePasswordHash(player.id, '$argon2id$new');

			assert.strictEqual((await findLocalLogin('ada@example.com'))?.passwordHash, '$argon2id$new');
		});

		it('changes the email address, refusing one another account has', async () =>
		{
			const ada = await createPlayer(localAccount('Ada', 'ada@example.com'));

			await createPlayer(localAccount('Grace', 'grace@example.com'));
			await saveEmail(ada.id, 'lovelace@example.com');

			assert.strictEqual(await findPlayerEmail(ada.id), 'lovelace@example.com');
			await assert.rejects(saveEmail(ada.id, 'Grace@example.com'), (error) => ((error instanceof AccountTakenError) && (error.field === 'email')));
		});

		it('deletes an account\'s sessions with it', async () =>
		{
			const player = await createPlayer(localAccount('Ada', 'ada@example.com'));

			await pool.query('INSERT INTO sessions (token_hash, player_id, remember_me) VALUES ($1, $2, false)', [Buffer.alloc(32, 1), player.id]);
			await pool.query('DELETE FROM players WHERE id = $1', [player.id]);

			assert.strictEqual((await pool.query('SELECT id FROM sessions WHERE player_id = $1', [player.id])).rowCount, 0);
		});
	});

	describe('profiles', () =>
	{
		const changes: ProfileChanges = {
			username: 'Ada_L',
			displayName: 'Ada',
			locale: 'fr',
			pronouns: 'she/her',
			location: 'London',
			timeZone: 'Europe/London',
			socials: {
				discord: 'ada.lovelace',
				facebook: null,
				instagram: 'ada_lovelace',
				tiktok: null
			},
			showCharacters: false
		};

		it('saves a profile, and finds it by ID and by username in any capitals', async () =>
		{
			const ada = await createPlayer(localAccount('Ada', 'ada@example.com'));

			await saveProfile(ada.id, changes);

			const own = await findOwnProfile(ada.id);

			assert.deepStrictEqual(own, {
				id: ada.id,
				...changes,
				email: 'ada@example.com',
				hasPassword: true
			});
			assert.deepStrictEqual(await findProfileByUsername('ADA_L'), {
				id: ada.id,
				username: own.username,
				displayName: own.displayName,
				pronouns: own.pronouns,
				location: own.location,
				timeZone: own.timeZone,
				socials: own.socials,
				showCharacters: own.showCharacters
			});
			assert.strictEqual(await findProfileByUsername('Ada'), undefined);
			assert.strictEqual(await findPasswordHash(ada.id), '$argon2id$v=19$m=19456,p=1,t=2$c2FsdA$aGFzaA');
		});

		it('refuses a username another account has', async () =>
		{
			const ada = await createPlayer(localAccount('Ada', 'ada@example.com'));

			await createPlayer(localAccount('Grace', 'grace@example.com'));
			await assert.rejects(saveProfile(ada.id, { ...changes, username: 'GRACE' }), (error) => ((error instanceof AccountTakenError) && (error.field === 'username')));
		});

		it('checks each field\'s length in the database too', async () =>
		{
			const ada = await createPlayer(localAccount('Ada', 'ada@example.com'));

			await assert.rejects(saveProfile(ada.id, { ...changes, pronouns: 'x'.repeat(41) }));
			await assert.rejects(saveProfile(ada.id, { ...changes, socials: { ...changes.socials, tiktok: 'x'.repeat(51) } }));
		});
	});
});
