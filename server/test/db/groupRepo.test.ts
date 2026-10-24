import assert from 'assert';
import { randomUUID } from 'crypto';
import { GROUP_START_SECONDS } from '@multiverse-kiln/shared';

import { findLastPlayedCharacterId, findOwnCharacter, listPlayableCharacters, markCharacterPlayed, purgeExpiredCharacters, scheduleCharacterDeletion } from '../../src/db/characterRepo.js';
import { db } from '../../src/db/client.js';
import { findDefaultDifficultyLevel } from '../../src/db/difficultyRepo.js';
import { addGroupMember, countGroupMembers, createInvite, deleteInvite, findGroup, findInvite, findMembership, leaveGroup, listExpiredMemberships, listGroupMembers, listMembersOfGroups, listPlayerGroupIds, purgeExpiredInvites, saveGroupClock, saveMemberPositions } from '../../src/db/groupRepo.js';
import { loadOrCreatePlayerByName } from '../../src/db/playerRepo.js';
import { characters } from '../../src/db/schema.js';
import { inTransaction } from '../../src/db/transactions.js';
import { addCharacter, addGroup, addPlayableUniverse, defaultRaceId, type PlayableUniverse } from './fixtures.js';

describe('groupRepo', () =>
{
	let universe: PlayableUniverse;
	let playerId: string;
	let anchorId: string;
	let memberId: string;
	let groupId: string;

	beforeEach(async () =>
	{
		universe = await addPlayableUniverse();
		playerId = (await loadOrCreatePlayerByName('Ada')).id;
		anchorId = await addCharacter(playerId, universe.universeId, 'Anchor');
		memberId = await addCharacter(playerId, universe.universeId, 'Member');
		groupId = await addGroup(universe.universeId, anchorId, universe.fieldAreaId, 'The Fellowship');
		await inTransaction((transaction) => addGroupMember(groupId, memberId, transaction));
	});

	it('makes a group with its anchor being as a member', async () =>
	{
		assert.deepStrictEqual(await findGroup(groupId), {
			id: groupId,
			universeId: universe.universeId,
			anchorCharacterId: anchorId,
			name: 'The Fellowship',
			startingAreaId: universe.fieldAreaId,
			startingColumn: 0,
			startingRow: 0,
			clockSeconds: GROUP_START_SECONDS,
			difficultyLevelId: (await findDefaultDifficultyLevel(universe.universeId))?.id
		});
		assert.deepStrictEqual(await findMembership(anchorId), { groupId, universeId: universe.universeId, isAnchor: true });
		assert.deepStrictEqual(await findMembership(memberId), { groupId, universeId: universe.universeId, isAnchor: false });
		assert.strictEqual(await countGroupMembers(groupId), 2);
		assert.deepStrictEqual(await listPlayerGroupIds(playerId, universe.universeId), new Map([[anchorId, groupId], [memberId, groupId]]));
	});

	it('saves the group\'s clock', async () =>
	{
		await saveGroupClock(groupId, GROUP_START_SECONDS + 1234.5);

		assert.strictEqual((await findGroup(groupId))?.clockSeconds, GROUP_START_SECONDS + 1234.5);
	});

	it('lists the members, with where they were last', async () =>
	{
		await saveMemberPositions(groupId, [{ characterId: memberId, areaId: universe.houseAreaId, column: 3, row: 4 }]);

		const members = await listGroupMembers(groupId);

		assert.deepStrictEqual(members.map(({ characterId, name, playable, position }) => ({ characterId, name, playable, position })), [
			{ characterId: anchorId, name: 'Anchor', playable: true, position: null },
			{ characterId: memberId, name: 'Member', playable: true, position: { areaId: universe.houseAreaId, column: 3, row: 4 } }
		]);
		assert.deepStrictEqual((await listMembersOfGroups([groupId])).get(groupId)?.map(({ characterId }) => characterId).sort(), [anchorId, memberId].sort());
	});

	it('marks a member given their last rites as not playable', async () =>
	{
		await scheduleCharacterDeletion(playerId, universe.universeId, memberId, new Date(Date.now() + 60000));

		assert.strictEqual((await listGroupMembers(groupId)).find(({ characterId }) => (characterId === memberId))?.playable, false);
	});

	it('leaves the lobby out of a character in a group, but remembers them as last played', async () =>
	{
		const lonerId = await addCharacter(playerId, universe.universeId, 'Loner');

		await markCharacterPlayed(anchorId, new Date(Date.now() + 1000));

		assert.deepStrictEqual((await listPlayableCharacters(playerId, universe.universeId)).map(({ id }) => id), [lonerId]);
		assert.strictEqual(await findLastPlayedCharacterId(playerId, universe.universeId), anchorId);
		assert.deepStrictEqual(await findOwnCharacter(playerId, universe.universeId, anchorId), { id: anchorId, name: 'Anchor', raceId: await defaultRaceId('dwarf'), areaId: null, startingColumn: 0, startingRow: 0, playable: true });
		assert.strictEqual(await findOwnCharacter(playerId, universe.universeId, randomUUID()), undefined);
	});

	it('takes a member out of the group', async () =>
	{
		const left = await leaveGroup(groupId, memberId);

		assert.deepStrictEqual(left, { kind: 'left', character: { characterId: memberId, playerId, name: 'Member', raceId: await defaultRaceId('dwarf'), playable: true } });
		assert.strictEqual(await findMembership(memberId), undefined);
		assert.strictEqual(await leaveGroup(groupId, memberId), undefined);
	});

	it('disbands the group when the anchor being leaves, with its invites', async () =>
	{
		await createInvite({ groupId, tokenHash: 'hash', multiUse: true, expiresAt: null });

		const left = await leaveGroup(groupId, anchorId);

		assert.strictEqual(left?.kind, 'disbanded');
		assert.strictEqual(await findGroup(groupId), undefined);
		assert.strictEqual(await findMembership(memberId), undefined);
		assert.strictEqual(await findInvite('hash'), undefined);
	});

	it('finds invites until they expire, and purges expired ones', async () =>
	{
		await createInvite({ groupId, tokenHash: 'current', multiUse: false, expiresAt: new Date(Date.now() + 60000) });
		await createInvite({ groupId, tokenHash: 'expired', multiUse: false, expiresAt: new Date(Date.now() - 60000) });

		const current = await findInvite('current');

		assert.strictEqual(current?.groupId, groupId);
		assert.strictEqual(current?.multiUse, false);
		assert.strictEqual(await findInvite('expired'), undefined);
		assert.strictEqual(await purgeExpiredInvites(), 1);

		await deleteInvite(current.id);

		assert.strictEqual(await findInvite('current'), undefined);
	});

	it('lists the memberships of characters whose last rites are over, for the sweep', async () =>
	{
		await scheduleCharacterDeletion(playerId, universe.universeId, memberId, new Date(Date.now() + 60000));
		await db.update(characters).set({ deleteAt: new Date(Date.now() - 1000) });

		const expired = await listExpiredMemberships();

		assert.deepStrictEqual(expired.map(({ character, isAnchor }) => [character.characterId, isAnchor]).sort(), [[anchorId, true], [memberId, false]].sort());

		await purgeExpiredCharacters();

		assert.strictEqual(await findGroup(groupId), undefined);
	});
});
