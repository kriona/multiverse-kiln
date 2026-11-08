import assert from 'assert';
import { characterPath, charactersPath, difficultyLevelsPath, groupPath, groupsPath, invitePath, type CharacterListPayload, type CharacterSheet, type DifficultyLevelListPayload, type ErrorPayload, type GroupCreatedPayload, type GroupJoinedPayload, type InviteCreatedPayload, type InviteDetails, type NewGroupRequest } from '@multiverse-kiln/shared';

import { listPlayableCharacters, scheduleCharacterDeletion } from '../src/db/characterRepo.js';
import { listChatMessages, type KeptChat } from '../src/db/chatRepo.js';
import { findDefaultDifficultyLevel, listDifficultyLevels } from '../src/db/difficultyRepo.js';
import { findGroup, findMembership, listGroupMembers } from '../src/db/groupRepo.js';
import { loadEditorRaces, saveEditedDefaultRace } from '../src/db/raceRepo.js';
import { inTransaction } from '../src/db/transactions.js';
import { removeUniverseEditor, setUniverseRole } from '../src/db/universeEditorRepo.js';
import { setUniverseDisabled, updateUniverseSettings } from '../src/db/universeRepo.js';
import { liveVersion } from '../src/db/universeVersions.js';
import { groupChanges, type GroupChange } from '../src/players/groupChanges.js';
import { addCharacter, addPlayableUniverse, defaultClassId, defaultRaceId, type PlayableUniverse } from './db/fixtures.js';
import { addPlayer, logInBrowser, type TestBrowser } from './players.js';
import { getTestServer, testServerUrl } from './testServer.js';
import { changeWhileWaitingForUniverse } from './universeLock.js';
import { waitUntil } from './waitUntil.js';

/**
 * A logged-in browser, and a character its player has in the test universe
 */
interface Browser extends TestBrowser
{
	characterId: string;
}

/**
 * What a request answered
 */
interface Answer<T>
{
	status: number;
	body: T;
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
		headers['Cookie'] = browser.cookie;
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

describe('group routes', () =>
{
	let universe: PlayableUniverse;
	let ada: Browser;
	let grace: Browser;
	let changes: GroupChange[];
	let stopListening: () => void;

	/**
	 * The test universe's default difficulty level
	 */
	let defaultLevelId: number;

	/**
	 * Logs a new browser in as a player with a character in the test universe
	 *
	 * @param name The player's and character's name
	 * @return The browser
	 */
	async function logIn(name: string): Promise<Browser>
	{
		const { id: playerId } = await addPlayer(name);
		const characterId = await addCharacter(playerId, universe.universeId, name);

		return({
			...(await logInBrowser(playerId)),
			characterId
		});
	}

	/**
	 * The body of a request to make a group at the universe's default difficulty level
	 *
	 * @param characterId The anchor being
	 * @param name The group's name
	 * @return The body
	 */
	function groupRequest(characterId: string, name: string = ''): NewGroupRequest
	{
		return({
			characterId,
			name,
			difficultyLevelId: defaultLevelId
		});
	}

	/**
	 * Makes a group around a browser's character
	 *
	 * @param browser The browser
	 * @param name The group's name
	 * @return The group's ID
	 */
	async function createGroup(browser: Browser, name: string = ''): Promise<string>
	{
		const created = await send<GroupCreatedPayload>(browser, 'POST', groupsPath(universe.universeId), groupRequest(browser.characterId, name));

		assert.strictEqual(created.status, 201, JSON.stringify(created.body));

		return(created.body.groupId);
	}

	/**
	 * Makes an invite link to a group
	 *
	 * @param browser The anchor being's browser
	 * @param groupId The group's ID
	 * @param multiUse Whether the link can be used more than once
	 * @return The link's token
	 */
	async function invite(browser: Browser, groupId: string, multiUse: boolean = false): Promise<string>
	{
		const created = await send<InviteCreatedPayload>(browser, 'POST', `${groupPath(universe.universeId, groupId)}/invites`, { multiUse, duration: 'day' });

		assert.strictEqual(created.status, 201, JSON.stringify(created.body));

		return(created.body.token);
	}

	before(async () =>
	{
		await getTestServer();
	});

	beforeEach(async () =>
	{
		universe = await addPlayableUniverse();
		defaultLevelId = (await findDefaultDifficultyLevel(liveVersion(universe.universeId)))?.id ?? 0;
		ada = await logIn('Ada');
		grace = await logIn('Grace');
		changes = [];
		stopListening = groupChanges.onChange((change) =>
		{
			changes.push(change);
		});
	});

	afterEach(() =>
	{
		stopListening();
	});

	it('needs a logged-in browser', async () =>
	{
		const answer = await send(undefined, 'POST', groupsPath(universe.universeId), groupRequest(ada.characterId));
		const levels = await send(undefined, 'GET', difficultyLevelsPath(universe.universeId));
		const invite = await send(undefined, 'GET', invitePath('no-such-invite-token'));

		assert.strictEqual(answer.status, 401);
		assert.strictEqual(levels.status, 401);
		assert.strictEqual(invite.status, 401);
	});

	it('refuses changes from browsers on other origins, uncached', async () =>
	{
		const response = await fetch(`${testServerUrl}${groupsPath(universe.universeId)}`, {
			method: 'POST',
			headers: {
				'Cookie': ada.cookie,
				'Content-Type': 'application/json',
				'Origin': 'https://evil.example'
			},
			body: JSON.stringify(groupRequest(ada.characterId))
		});

		assert.strictEqual(response.status, 403);
		assert.strictEqual(response.headers.get('cache-control'), 'no-store');
		assert.strictEqual(await findMembership(ada.characterId), undefined);
	});

	describe('making a group', () =>
	{
		it('makes the character its anchor being, starting in their starting area', async () =>
		{
			const groupId = await createGroup(ada, '  The Fellowship  ');
			const group = await findGroup(groupId);

			assert.strictEqual(group?.anchorCharacterId, ada.characterId);
			assert.strictEqual(group?.name, 'The Fellowship');
			assert.strictEqual(group?.startingAreaId, universe.fieldAreaId);
			assert.deepStrictEqual(await findMembership(ada.characterId), { groupId, universeId: universe.universeId, isAnchor: true });
			assert.deepStrictEqual(changes, [{
				kind: 'joined',
				groupId,
				universeId: universe.universeId,
				character: { characterId: ada.characterId, playerId: ada.playerId, name: 'Ada', raceId: await defaultRaceId('dwarf'), classId: await defaultClassId('fighter'), playable: true },
				created: true
			}]);
		});

		it('refuses a character whose race is disabled for characters already of it', async () =>
		{
			const dwarfId = await defaultRaceId('dwarf');
			const dwarf = (await loadEditorRaces(liveVersion(universe.universeId), 'pf1e')).find((race) => (race.id === dwarfId));

			assert.ok(dwarf);
			await inTransaction((transaction) => saveEditedDefaultRace(liveVersion(universe.universeId), 'pf1e', dwarfId, {
				...dwarf,
				enabled: false,
				keepPlaying: false
			}, transaction));

			const refused = await send<ErrorPayload>(ada, 'POST', groupsPath(universe.universeId), groupRequest(ada.characterId));

			assert.strictEqual(refused.status, 409);
			assert.strictEqual(refused.body.error.id, 'error.groupCharacterBarred');
			assert.strictEqual(await findMembership(ada.characterId), undefined);
		});

		it('starts at the universe\'s starting cell when the character has no starting area of their own', async () =>
		{
			await updateUniverseSettings(liveVersion(universe.universeId), { startingColumn: 6, startingRow: 4 });

			const group = await findGroup(await createGroup(ada));

			assert.strictEqual(group?.startingAreaId, universe.fieldAreaId);
			assert.strictEqual(group?.startingColumn, 6);
			assert.strictEqual(group?.startingRow, 4);
		});

		it('starts where the character\'s race starts as the group is made, not as the character was', async () =>
		{
			const dwarfId = await defaultRaceId('dwarf');
			const dwarf = (await loadEditorRaces(liveVersion(universe.universeId), 'pf1e')).find((race) => (race.id === dwarfId));

			assert.ok(dwarf);
			await inTransaction((transaction) => saveEditedDefaultRace(liveVersion(universe.universeId), 'pf1e', dwarfId, {
				...dwarf,
				startingAreaId: universe.houseAreaId,
				startingColumn: 3,
				startingRow: 2
			}, transaction));

			const group = await findGroup(await createGroup(ada));

			assert.strictEqual(group?.startingAreaId, universe.houseAreaId);
			assert.strictEqual(group?.startingColumn, 3);
			assert.strictEqual(group?.startingRow, 2);
		});

		it('lists the character in their group, and no longer plays them in the lobby', async () =>
		{
			const groupId = await createGroup(ada);
			const list = await send<CharacterListPayload>(ada, 'GET', charactersPath(universe.universeId));

			assert.strictEqual(list.body.characters[0].groupId, groupId);
			assert.strictEqual(list.body.lastPlayedId, ada.characterId);
			assert.deepStrictEqual(await listPlayableCharacters(ada.playerId, universe.universeId), []);
		});

		it('refuses a character who is already in a group', async () =>
		{
			await createGroup(ada);

			const again = await send(ada, 'POST', groupsPath(universe.universeId), groupRequest(ada.characterId));

			assert.strictEqual(again.status, 409);
		});

		it('refuses another player\'s character, and one given their last rites', async () =>
		{
			const others = await send(ada, 'POST', groupsPath(universe.universeId), groupRequest(grace.characterId));

			assert.strictEqual(others.status, 404);

			await scheduleCharacterDeletion(ada.playerId, universe.universeId, ada.characterId, new Date(Date.now() + 60000));

			const leaving = await send(ada, 'POST', groupsPath(universe.universeId), groupRequest(ada.characterId));

			assert.strictEqual(leaving.status, 404);
		});

		it('refuses a name that is too long', async () =>
		{
			const answer = await send(ada, 'POST', groupsPath(universe.universeId), groupRequest(ada.characterId, 'x'.repeat(41)));

			assert.strictEqual(answer.status, 400);
		});

		it('lists the universe\'s difficulty levels, easiest first', async () =>
		{
			const answer = await send<DifficultyLevelListPayload>(ada, 'GET', difficultyLevelsPath(universe.universeId));

			assert.strictEqual(answer.status, 200);
			assert.deepStrictEqual(answer.body.difficultyLevels.map(({ id: _id, ...level }) => level), [
				{ key: 'story', name: null, isDefault: false, mobScale: -50, permadeath: false },
				{ key: 'normal', name: null, isDefault: true, mobScale: 0, permadeath: false },
				{ key: 'hard', name: null, isDefault: false, mobScale: 50, permadeath: false },
				{ key: 'hardcore', name: null, isDefault: false, mobScale: 100, permadeath: true }
			]);
			assert.strictEqual(answer.body.difficultyLevels[1].id, defaultLevelId);
		});

		it('saves the difficulty level chosen to the group', async () =>
		{
			const levels = await listDifficultyLevels(liveVersion(universe.universeId));
			const hardcore = levels.find((level) => (level.key === 'hardcore'));
			const created = await send<GroupCreatedPayload>(ada, 'POST', groupsPath(universe.universeId), { ...groupRequest(ada.characterId), difficultyLevelId: hardcore?.id });

			assert.strictEqual(created.status, 201);
			assert.strictEqual((await findGroup(created.body.groupId))?.difficultyLevelId, hardcore?.id);
		});

		it('refuses a difficulty level of another universe, and a missing one', async () =>
		{
			const other = await addPlayableUniverse();
			const othersLevel = await findDefaultDifficultyLevel(liveVersion(other.universeId));
			const fromOther = await send(ada, 'POST', groupsPath(universe.universeId), { ...groupRequest(ada.characterId), difficultyLevelId: othersLevel?.id });
			const missing = await send(ada, 'POST', groupsPath(universe.universeId), { ...groupRequest(ada.characterId), difficultyLevelId: 2147483647 });
			const none = await send(ada, 'POST', groupsPath(universe.universeId), { characterId: ada.characterId, name: '' });

			assert.strictEqual(fromOther.status, 404);
			assert.strictEqual(missing.status, 404);
			assert.strictEqual(none.status, 400);
			assert.strictEqual(await findMembership(ada.characterId), undefined);
		});
	});

	describe('invite links', () =>
	{
		it('are made only by the anchor being\'s player', async () =>
		{
			const groupId = await createGroup(ada);
			const answer = await send(grace, 'POST', `${groupPath(universe.universeId, groupId)}/invites`, { multiUse: false, duration: 'week' });

			assert.strictEqual(answer.status, 403);
		});

		it('expire after the duration chosen, or never', async () =>
		{
			const groupId = await createGroup(ada);
			const week = await send<InviteCreatedPayload>(ada, 'POST', `${groupPath(universe.universeId, groupId)}/invites`, { multiUse: true, duration: 'week' });
			const forever = await send<InviteCreatedPayload>(ada, 'POST', `${groupPath(universe.universeId, groupId)}/invites`, { multiUse: true, duration: 'indefinite' });
			const weekMs = Date.parse(week.body.expiresAt ?? '') - Date.now();

			assert.ok((weekMs > (6.9 * 24 * 60 * 60 * 1000)) && (weekMs <= (7 * 24 * 60 * 60 * 1000)), String(weekMs));
			assert.strictEqual(forever.body.expiresAt, null);
			assert.notStrictEqual(week.body.token, forever.body.token);
		});

		it('say which group they lead to', async () =>
		{
			const groupId = await createGroup(ada, 'The Fellowship');
			const token = await invite(ada, groupId);
			const details = await send<InviteDetails>(grace, 'GET', invitePath(token));

			assert.strictEqual(details.status, 200);
			assert.strictEqual(details.body.groupId, groupId);
			assert.strictEqual(details.body.groupName, 'The Fellowship');
			assert.strictEqual(details.body.anchorName, 'Ada');
			assert.strictEqual(details.body.memberCount, 1);
			assert.strictEqual(details.body.universeId, universe.universeId);
			assert.deepStrictEqual(details.body.difficulty, { key: 'normal', name: null, mobScale: 0, permadeath: false });
		});

		it('say what difficulty the group plays at', async () =>
		{
			const hardcore = (await listDifficultyLevels(liveVersion(universe.universeId))).find((level) => (level.key === 'hardcore'));
			const created = await send<GroupCreatedPayload>(ada, 'POST', groupsPath(universe.universeId), { ...groupRequest(ada.characterId), difficultyLevelId: hardcore?.id });
			const token = await invite(ada, created.body.groupId);
			const details = await send<InviteDetails>(grace, 'GET', invitePath(token));

			assert.deepStrictEqual(details.body.difficulty, { key: 'hardcore', name: null, mobScale: 100, permadeath: true });
		});

		it('answer 404 for a token that was never made', async () =>
		{
			const answer = await send(grace, 'GET', invitePath('not-a-real-token-at-all'));

			assert.strictEqual(answer.status, 404);
		});

		it('put a character in the group, once for a single-use link', async () =>
		{
			const groupId = await createGroup(ada);
			const token = await invite(ada, groupId);
			const joined = await send<GroupJoinedPayload>(grace, 'POST', invitePath(token), { characterId: grace.characterId });

			assert.strictEqual(joined.status, 200, JSON.stringify(joined.body));
			assert.strictEqual(joined.body.groupId, groupId);
			assert.strictEqual((await findMembership(grace.characterId))?.groupId, groupId);
			assert.strictEqual(changes.at(-1)?.kind, 'joined');

			const alan = await logIn('Alan');
			const used = await send(alan, 'POST', invitePath(token), { characterId: alan.characterId });

			assert.strictEqual(used.status, 404);
		});

		it('let several characters of one player join through a multi-use link', async () =>
		{
			const groupId = await createGroup(ada);
			const token = await invite(ada, groupId, true);
			const secondId = await addCharacter(grace.playerId, universe.universeId, 'Hopper');

			assert.strictEqual((await send(grace, 'POST', invitePath(token), { characterId: grace.characterId })).status, 200);
			assert.strictEqual((await send(grace, 'POST', invitePath(token), { characterId: secondId })).status, 200);
			assert.strictEqual((await listGroupMembers(groupId)).length, 3);
		});

		it('refuse a character once the group has the universe\'s group size', async () =>
		{
			await updateUniverseSettings(liveVersion(universe.universeId), { groupSize: 2 });

			const groupId = await createGroup(ada);
			const token = await invite(ada, groupId, true);
			const alan = await logIn('Alan');

			assert.strictEqual((await send(grace, 'POST', invitePath(token), { characterId: grace.characterId })).status, 200);

			const full = await send(alan, 'POST', invitePath(token), { characterId: alan.characterId });

			assert.strictEqual(full.status, 409);
			assert.strictEqual((await listGroupMembers(groupId)).length, 2);
		});

		it('refuse a character already in another group', async () =>
		{
			const groupId = await createGroup(ada);
			const token = await invite(ada, groupId);

			await createGroup(grace);

			const answer = await send(grace, 'POST', invitePath(token), { characterId: grace.characterId });

			assert.strictEqual(answer.status, 409);
		});
	});

	it('refuses making groups, invites, joining and leaving at the end of time', async () =>
	{
		const groupId = await createGroup(ada);
		const token = await invite(ada, groupId);
		const alan = await logIn('Alan');

		await updateUniverseSettings(liveVersion(universe.universeId), { stage: 'end_of_time' });

		assert.strictEqual((await send(grace, 'POST', groupsPath(universe.universeId), groupRequest(grace.characterId))).status, 404);
		assert.strictEqual((await send(ada, 'POST', `${groupPath(universe.universeId, groupId)}/invites`, { multiUse: false, duration: 'day' })).status, 404);
		assert.strictEqual((await send(alan, 'GET', invitePath(token))).status, 404);
		assert.strictEqual((await send(alan, 'POST', invitePath(token), { characterId: alan.characterId })).status, 404);
		assert.strictEqual((await send(ada, 'POST', `${groupPath(universe.universeId, groupId)}/leave`, { characterId: ada.characterId })).status, 404);
		assert.strictEqual((await findMembership(ada.characterId))?.groupId, groupId);
		assert.strictEqual(await findMembership(alan.characterId), undefined);
	});

	it('makes no group in a universe disabled while the request waited for it', async () =>
	{
		const answer = await changeWhileWaitingForUniverse(universe.universeId, () => send(grace, 'POST', groupsPath(universe.universeId), groupRequest(grace.characterId)), async (transaction) =>
		{
			await setUniverseDisabled(universe.universeId, 'Spam', transaction);
		});

		assert.strictEqual(answer.status, 404);
		assert.strictEqual(await findMembership(grace.characterId), undefined);
	});

	it('lets no character follow an invite into a universe moved to the end of time, or one their role no longer lets them play, while the request waited for it', async () =>
	{
		const groupId = await createGroup(ada);
		const token = await invite(ada, groupId, true);
		const alan = await logIn('Alan');
		const follow = (): Promise<Answer<unknown>> => send(alan, 'POST', invitePath(token), { characterId: alan.characterId });
		const ended = await changeWhileWaitingForUniverse(universe.universeId, follow, async (transaction) =>
		{
			await updateUniverseSettings(liveVersion(universe.universeId), { stage: 'end_of_time' }, transaction);
		});

		assert.strictEqual(ended.status, 404);

		// In the prologue only players with a role in the universe may play it
		await updateUniverseSettings(liveVersion(universe.universeId), { stage: 'prologue' });
		await setUniverseRole(universe.universeId, alan.playerId, 'beta_tester');

		const removed = await changeWhileWaitingForUniverse(universe.universeId, follow, async (transaction) =>
		{
			await removeUniverseEditor(universe.universeId, alan.playerId, transaction);
		});

		assert.strictEqual(removed.status, 404);
		assert.strictEqual(await findMembership(alan.characterId), undefined);
	});

	describe('leaving', () =>
	{
		it('takes a member out of the group', async () =>
		{
			const groupId = await createGroup(ada);

			await send(grace, 'POST', invitePath(await invite(ada, groupId)), { characterId: grace.characterId });

			const left = await send(grace, 'POST', `${groupPath(universe.universeId, groupId)}/leave`, { characterId: grace.characterId });

			assert.strictEqual(left.status, 204);
			assert.strictEqual(await findMembership(grace.characterId), undefined);
			assert.ok(await findGroup(groupId));
			assert.deepStrictEqual(changes.at(-1), {
				kind: 'left',
				groupId,
				universeId: universe.universeId,
				character: { characterId: grace.characterId, playerId: grace.playerId, name: 'Grace', raceId: await defaultRaceId('dwarf'), classId: await defaultClassId('fighter'), playable: true }
			});
		});

		it('says in the group\'s chat who created it, who joined and who left, with no room open', async () =>
		{
			const groupId = await createGroup(ada);
			const chat: KeptChat = {
				kind: 'group',
				universeId: universe.universeId,
				groupId
			};

			await send(grace, 'POST', invitePath(await invite(ada, groupId)), { characterId: grace.characterId });
			await send(grace, 'POST', `${groupPath(universe.universeId, groupId)}/leave`, { characterId: grace.characterId });
			await waitUntil(async () => ((await listChatMessages(chat)).length === 3));

			assert.deepStrictEqual((await listChatMessages(chat)).map(({ playerId, name, notice, text }) => [playerId, name, notice, text]), [
				[ada.playerId, 'Ada', 'created', ''],
				[grace.playerId, 'Grace', 'joined', ''],
				[grace.playerId, 'Grace', 'left', '']
			]);
		});

		it('disbands the group when the anchor being leaves, freeing every member', async () =>
		{
			const groupId = await createGroup(ada);

			await send(grace, 'POST', invitePath(await invite(ada, groupId)), { characterId: grace.characterId });

			const left = await send(ada, 'POST', `${groupPath(universe.universeId, groupId)}/leave`, { characterId: ada.characterId });

			assert.strictEqual(left.status, 204);
			assert.strictEqual(await findGroup(groupId), undefined);
			assert.strictEqual(await findMembership(grace.characterId), undefined);
			assert.strictEqual(changes.at(-1)?.kind, 'disbanded');
			assert.deepStrictEqual((changes.at(-1) as Extract<GroupChange, { kind: 'disbanded' }>).members.map(({ characterId }) => characterId).sort(), [ada.characterId, grace.characterId].sort());
		});

		it('lets a character whose race is disabled for characters already of it leave, as their sheet offers', async () =>
		{
			const groupId = await createGroup(ada);
			const dwarfId = await defaultRaceId('dwarf');
			const path = characterPath(universe.universeId, grace.characterId);

			await send(grace, 'POST', invitePath(await invite(ada, groupId)), { characterId: grace.characterId });

			const dwarf = (await loadEditorRaces(liveVersion(universe.universeId), 'pf1e')).find((race) => (race.id === dwarfId));

			assert.ok(dwarf);
			await inTransaction((transaction) => saveEditedDefaultRace(liveVersion(universe.universeId), 'pf1e', dwarfId, {
				...dwarf,
				enabled: false,
				keepPlaying: false
			}, transaction));

			const { group, barredBy } = (await send<CharacterSheet>(grace, 'GET', path)).body;

			assert.deepStrictEqual({ group, barredBy }, {
				group: {
					groupId,
					isAnchor: false
				},
				barredBy: 'race'
			});
			assert.strictEqual((await send(grace, 'POST', `${groupPath(universe.universeId, groupId)}/leave`, { characterId: grace.characterId })).status, 204);
			assert.strictEqual((await send<CharacterSheet>(grace, 'GET', path)).body.group, null);
		});

		it('refuses another player\'s character, and a character not in the group', async () =>
		{
			const groupId = await createGroup(ada);

			assert.strictEqual((await send(grace, 'POST', `${groupPath(universe.universeId, groupId)}/leave`, { characterId: ada.characterId })).status, 404);
			assert.strictEqual((await send(grace, 'POST', `${groupPath(universe.universeId, groupId)}/leave`, { characterId: grace.characterId })).status, 404);
			assert.ok(await findGroup(groupId));
		});

		it('refuses to delete a member, immediately or with last rites, until they leave', async () =>
		{
			const groupId = await createGroup(ada);

			await send(grace, 'POST', invitePath(await invite(ada, groupId)), { characterId: grace.characterId });

			for (const member of [ada, grace])
			{
				const path = characterPath(universe.universeId, member.characterId);

				assert.strictEqual((await send(member, 'DELETE', path)).status, 409);
				assert.strictEqual((await send(member, 'PUT', `${path}/deletion`)).status, 409);
				assert.deepStrictEqual((await send<CharacterSheet>(member, 'GET', path)).body.group, {
					groupId,
					isAnchor: (member === ada)
				});
			}

			assert.ok(await findGroup(groupId));
			assert.ok(await findMembership(grace.characterId));

			await send(grace, 'POST', `${groupPath(universe.universeId, groupId)}/leave`, { characterId: grace.characterId });

			assert.strictEqual((await send(grace, 'DELETE', characterPath(universe.universeId, grace.characterId))).status, 204);
			assert.ok(await findGroup(groupId));
		});
	});
});
