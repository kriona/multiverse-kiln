import assert from 'assert';
import { sql } from 'drizzle-orm';
import type { KeptChatMessage } from '@multiverse-kiln/shared';

import { findChatRead, listChatMessages, type KeptChat } from '../src/db/chatRepo.js';
import { inTransaction } from '../src/db/transactions.js';
import { KeptChatLog, postNotice } from '../src/rooms/keptChat.js';
import { addCharacter, addGroup, addUniverse } from './db/fixtures.js';
import { addPlayer } from './players.js';
import { someoneWaitsForALock } from './universeLock.js';
import { waitUntil } from './waitUntil.js';

describe('KeptChatLog', () =>
{
	it('loads a chat once the last writes of a log for the same chat, still closing, are done', async () =>
	{
		const universeId = await addUniverse();
		const ada = await addPlayer('Ada');
		const groupId = await addGroup(universeId, await addCharacter(ada.id, universeId, 'Brokk'), null);
		const group: KeptChat = {
			kind: 'group',
			universeId,
			groupId
		};
		const closing = new KeptChatLog();
		const opening = new KeptChatLog();
		let saving: Promise<void> | undefined;
		let loading: Promise<void> | undefined;

		await closing.load(group);
		closing.add({
			playerId: ada.id,
			name: 'Brokk',
			username: null
		}, 'Last words');
		closing.markRead(ada.id, Date.now());

		// Holding the group's row keeps the closing log's write waiting, as a slow database would, while the next log loads
		await inTransaction(async (transaction) =>
		{
			await transaction.execute(sql`SELECT id FROM groups WHERE id = ${groupId} FOR UPDATE`);
			saving = closing.save();
			await waitUntil(someoneWaitsForALock);
			loading = opening.load(group);
		});

		await saving;
		await loading;

		assert.deepStrictEqual(opening.history().messages.map(({ name, text }) => [name, text]), [['Brokk', 'Last words']]);
		assert.notStrictEqual(await findChatRead(group, ada.id), undefined);
	});

	describe('notices', () =>
	{
		let ada: Awaited<ReturnType<typeof addPlayer>>;
		let group: KeptChat;

		beforeEach(async () =>
		{
			const universeId = await addUniverse();

			ada = await addPlayer('Ada');
			group = {
				kind: 'group',
				universeId,
				groupId: await addGroup(universeId, await addCharacter(ada.id, universeId, 'Brokk'), null)
			};
		});

		/**
		 * The chat's messages as the database keeps them, with what each notice says
		 *
		 * @return The name, notice and text of each, oldest first
		 */
		async function kept(): Promise<[string, string | null, string][]>
		{
			return((await listChatMessages(group)).map(({ name, notice, text }) => [name, notice, text]));
		}

		it('writes a notice to the database when no log has the chat open', async () =>
		{
			await postNotice(group, 'left', {
				playerId: ada.id,
				name: 'Brokk'
			});

			assert.deepStrictEqual(await kept(), [['Brokk', 'left', '']]);
		});

		it('gives a notice to the log that has the chat open, which sends it on and writes it after its messages', async () =>
		{
			const sent: KeptChatMessage[] = [];
			const log = new KeptChatLog((message) =>
			{
				sent.push(message);
			});

			await log.load(group);
			log.add({
				playerId: ada.id,
				name: 'Brokk',
				username: null
			}, 'Farewell');
			await postNotice(group, 'left', {
				playerId: ada.id,
				name: 'Brokk'
			});

			assert.deepStrictEqual(sent.map(({ name, notice }) => [name, notice]), [['Brokk', 'left']]);
			assert.deepStrictEqual(log.history().messages.map(({ notice, text }) => [notice, text]), [[null, 'Farewell'], ['left', '']]);
			assert.deepStrictEqual(await kept(), []);

			await log.save();

			assert.deepStrictEqual(await kept(), [['Brokk', null, 'Farewell'], ['Brokk', 'left', '']]);
		});

		it('puts a notice written while the log loads after the messages kept', async () =>
		{
			const earlier = new KeptChatLog();
			const log = new KeptChatLog(() =>
			{
				// Nothing to send it to
			});

			await earlier.load(group);
			earlier.add({
				playerId: ada.id,
				name: 'Brokk',
				username: null
			}, 'Before');
			await earlier.save();

			const loading = log.load(group);

			await postNotice(group, 'left', {
				playerId: ada.id,
				name: 'Brokk'
			});
			await loading;

			assert.deepStrictEqual(log.history().messages.map(({ notice, text }) => [notice, text]), [[null, 'Before'], ['left', '']]);
		});

		it('writes notices to the database once the log is closed, after its last write', async () =>
		{
			const log = new KeptChatLog(() =>
			{
				// Nothing to send it to
			});

			await log.load(group);
			log.add({
				playerId: ada.id,
				name: 'Brokk',
				username: null
			}, 'Last words');
			log.close();

			const saving = log.save();

			await postNotice(group, 'left', {
				playerId: ada.id,
				name: 'Brokk'
			});
			await saving;

			assert.deepStrictEqual(log.history().messages.map(({ text }) => text), ['Last words']);
			assert.deepStrictEqual(await kept(), [['Brokk', null, 'Last words'], ['Brokk', 'left', '']]);
		});
	});
});
