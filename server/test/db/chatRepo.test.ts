import assert from 'assert';
import { MAX_KEPT_CHAT_MESSAGES } from '@multiverse-kiln/shared';

import { addChatMessages, findChatRead, forgetChatAuthor, listChatMessages, listOwnChatMessages, listOwnChatReads, saveChatReads, type KeptChat, type NewChatMessage } from '../../src/db/chatRepo.js';
import { deletePlayer } from '../../src/db/playerRepo.js';
import { deleteUniverse } from '../../src/db/universeRepo.js';
import { addPlayer, usernameFor } from '../players.js';
import { addCharacter, addGroup, addUniverse } from './fixtures.js';

/**
 * Messages written one second apart
 *
 * @param playerId Who wrote them
 * @param texts Their text
 * @param authorName The character's name, in a group's chat
 * @return The messages
 */
function messagesOf(playerId: string, texts: readonly string[], authorName: string | null = null): NewChatMessage[]
{
	return(texts.map((text, index) => ({
		playerId,
		authorName,
		notice: null,
		text,
		sentAt: new Date(Date.UTC(2026, 10, 1, 12, 0, index))
	})));
}

describe('chatRepo', () =>
{
	it('keeps the editors\' chat and each group\'s apart, with the editors\' names and the characters\'', async () =>
	{
		const universeId = await addUniverse();
		const ada = await addPlayer('Ada');
		const groupId = await addGroup(universeId, await addCharacter(ada.id, universeId, 'Brokk'), null, 'Delvers');
		const editors: KeptChat = { kind: 'editors', universeId };
		const group: KeptChat = { kind: 'group', universeId, groupId };

		assert.strictEqual(await addChatMessages(editors, messagesOf(ada.id, ['Hello editors', 'Second'])), true);
		assert.strictEqual(await addChatMessages(group, messagesOf(ada.id, ['Hello group'], 'Brokk')), true);

		assert.deepStrictEqual((await listChatMessages(editors)).map(({ playerId, name, username, text, sentAt }) => [playerId, name, username, text, sentAt]), [
			[ada.id, 'Ada', usernameFor('Ada'), 'Hello editors', Date.UTC(2026, 10, 1, 12, 0, 0)],
			[ada.id, 'Ada', usernameFor('Ada'), 'Second', Date.UTC(2026, 10, 1, 12, 0, 1)]
		]);
		assert.deepStrictEqual((await listChatMessages(group)).map(({ name, username, text }) => [name, username, text]), [['Brokk', null, 'Hello group']]);
		assert.deepStrictEqual((await listOwnChatMessages(ada.id)).map(({ groupId: chatGroup, groupName, text }) => [chatGroup, groupName, text]), [
			[null, null, 'Hello editors'],
			[null, null, 'Second'],
			[groupId, 'Delvers', 'Hello group']
		]);
	});

	it('keeps only the newest messages of each chat', async () =>
	{
		const universeId = await addUniverse();
		const otherId = await addUniverse('Elsewhere');
		const ada = await addPlayer('Ada');
		const texts = Array.from({ length: (MAX_KEPT_CHAT_MESSAGES + 5) }, (_, index) => `Line ${index}`);

		await addChatMessages({ kind: 'editors', universeId: otherId }, messagesOf(ada.id, ['Elsewhere']));
		await addChatMessages({ kind: 'editors', universeId }, messagesOf(ada.id, texts.slice(0, 100)));
		await addChatMessages({ kind: 'editors', universeId }, messagesOf(ada.id, texts.slice(100)));

		const kept = await listChatMessages({ kind: 'editors', universeId });

		assert.strictEqual(kept.length, MAX_KEPT_CHAT_MESSAGES);
		assert.deepStrictEqual([kept[0].text, kept.at(-1)?.text], ['Line 5', `Line ${MAX_KEPT_CHAT_MESSAGES + 4}`]);
		assert.strictEqual((await listChatMessages({ kind: 'editors', universeId: otherId })).length, 1);
	});

	it('leaves a deleted account\'s messages without its name', async () =>
	{
		const universeId = await addUniverse();
		const ada = await addPlayer('Ada');

		await addChatMessages({ kind: 'editors', universeId }, messagesOf(ada.id, ['Still here']));
		await forgetChatAuthor(ada.id);
		await deletePlayer(ada.id);

		assert.deepStrictEqual((await listChatMessages({ kind: 'editors', universeId })).map(({ playerId, name, username, text }) => [playerId, name, username, text]), [[null, '', null, 'Still here']]);
	});

	it('adds the messages of a writer whose account is gone without their name, keeping the others\'', async () =>
	{
		const universeId = await addUniverse();
		const ada = await addPlayer('Ada');
		const grace = await addPlayer('Grace');
		const group: KeptChat = { kind: 'group', universeId, groupId: await addGroup(universeId, await addCharacter(grace.id, universeId, 'Brokk'), null) };
		const messages = [
			...messagesOf(grace.id, ['Before'], 'Brokk'),
			...messagesOf(ada.id, ['Gone'], 'Thora'),
			...messagesOf(grace.id, ['After'], 'Brokk')
		];

		await deletePlayer(ada.id);

		assert.strictEqual(await addChatMessages(group, messages), true);
		assert.deepStrictEqual((await listChatMessages(group)).map(({ playerId, name, text }) => [playerId, name, text]), [
			[grace.id, 'Brokk', 'Before'],
			[null, '', 'Gone'],
			[grace.id, 'Brokk', 'After']
		]);
	});

	it('adds nothing to a universe that is gone, and goes with its universe', async () =>
	{
		const universeId = await addUniverse();
		const ada = await addPlayer('Ada');

		await addChatMessages({ kind: 'editors', universeId }, messagesOf(ada.id, ['Before']));
		await deleteUniverse(universeId);

		assert.strictEqual(await addChatMessages({ kind: 'editors', universeId }, messagesOf(ada.id, ['After'])), false);
		assert.deepStrictEqual(await listOwnChatMessages(ada.id), []);
	});

	describe('how far players have read', () =>
	{
		const earlier = new Date(Date.UTC(2026, 10, 1, 12, 0, 0));
		const later = new Date(Date.UTC(2026, 10, 1, 12, 5, 0));

		it('keeps one record per player for each chat, the editors\' and each group\'s apart', async () =>
		{
			const universeId = await addUniverse('Kilnhaven');
			const ada = await addPlayer('Ada');
			const grace = await addPlayer('Grace');
			const groupId = await addGroup(universeId, await addCharacter(ada.id, universeId, 'Brokk'), null, 'Delvers');
			const editors: KeptChat = { kind: 'editors', universeId };
			const group: KeptChat = { kind: 'group', universeId, groupId };

			assert.strictEqual(await findChatRead(editors, ada.id), undefined);
			assert.strictEqual(await saveChatReads(editors, new Map([[ada.id, earlier], [grace.id, later]])), 0);
			assert.strictEqual(await saveChatReads(editors, new Map([[ada.id, later]])), 0);
			assert.strictEqual(await saveChatReads(group, new Map([[ada.id, earlier]])), 0);

			assert.deepStrictEqual(await findChatRead(editors, ada.id), later);
			assert.deepStrictEqual(await findChatRead(editors, grace.id), later);
			assert.deepStrictEqual(await findChatRead(group, ada.id), earlier);
			assert.deepStrictEqual(await listOwnChatReads(ada.id), [
				{ universeId, universeName: 'Kilnhaven', groupId, groupName: 'Delvers', readAt: earlier },
				{ universeId, universeName: 'Kilnhaven', groupId: null, groupName: null, readAt: later }
			]);
		});

		it('never moves a record back', async () =>
		{
			const universeId = await addUniverse();
			const ada = await addPlayer('Ada');
			const editors: KeptChat = { kind: 'editors', universeId };

			await saveChatReads(editors, new Map([[ada.id, later]]));
			await saveChatReads(editors, new Map([[ada.id, earlier]]));

			assert.deepStrictEqual(await findChatRead(editors, ada.id), later);
		});

		it('drops records for a player or universe that is gone, keeping the others, and goes with them', async () =>
		{
			const universeId = await addUniverse();
			const ada = await addPlayer('Ada');
			const grace = await addPlayer('Grace');
			const editors: KeptChat = { kind: 'editors', universeId };

			await deletePlayer(grace.id);

			assert.strictEqual(await saveChatReads(editors, new Map([[grace.id, earlier], [ada.id, earlier]])), 1);
			assert.deepStrictEqual(await findChatRead(editors, ada.id), earlier);

			await deleteUniverse(universeId);

			assert.deepStrictEqual(await listOwnChatReads(ada.id), []);
			assert.strictEqual(await saveChatReads(editors, new Map([[ada.id, later]])), 1);
		});
	});
});
