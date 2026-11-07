import assert from 'assert';
import { sql } from 'drizzle-orm';

import { findChatRead, type KeptChat } from '../src/db/chatRepo.js';
import { inTransaction } from '../src/db/transactions.js';
import { KeptChatLog } from '../src/rooms/keptChat.js';
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
});
