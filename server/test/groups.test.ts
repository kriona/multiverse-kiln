import assert from 'assert';
import { randomUUID } from 'crypto';
import { characterPath, charactersPath, difficultyLevelsPath, groupPath, groupsPath, invitePath, type CharacterListPayload, type DifficultyLevelListPayload, type GroupCreatedPayload, type GroupJoinedPayload, type InviteCreatedPayload, type InviteDetails, type NewGroupRequest } from '@multiverse-kiln/shared';

import { listPlayableCharacters, scheduleCharacterDeletion } from '../src/db/characterRepo.js';
import { findDefaultDifficultyLevel, listDifficultyLevels } from '../src/db/difficultyRepo.js';
import { findGroup, findMembership, listGroupMembers } from '../src/db/groupRepo.js';
import { loadOrCreatePlayerByName } from '../src/db/playerRepo.js';
import { updateUniverseSettings } from '../src/db/universeRepo.js';
import { BROWSER_ID_COOKIE } from '../src/http/browserId.js';
import { groupChanges, type GroupChange } from '../src/players/groupChanges.js';
import { onlinePlayers } from '../src/players/onlinePlayers.js';
import { addCharacter, addPlayableUniverse, defaultRaceId, type PlayableUniverse } from './db/fixtures.js';
import { getTestServer, logOutEveryone, testServerUrl } from './testServer.js';

/**
 * A logged-in browser, and a character its player has in the test universe
 */
interface Browser
{
	browserId: string;
	playerId: string;
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
		headers['Cookie'] = `${BROWSER_ID_COOKIE}=${browser.browserId}`;
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
		const browserId = randomUUID();
		const { id: playerId } = await loadOrCreatePlayerByName(name);
		const characterId = await addCharacter(playerId, universe.universeId, name);

		onlinePlayers.logIn(browserId, playerId, name);

		return({ browserId, playerId, characterId });
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
		logOutEveryone();
		universe = await addPlayableUniverse();
		defaultLevelId = (await findDefaultDifficultyLevel(universe.universeId))?.id ?? 0;
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
				'Cookie': `${BROWSER_ID_COOKIE}=${ada.browserId}`,
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
				character: { characterId: ada.characterId, playerId: ada.playerId, name: 'Ada', raceId: await defaultRaceId('dwarf'), playable: true }
			}]);
		});

		it('starts at the universe\'s starting cell when the character has no starting area of their own', async () =>
		{
			await updateUniverseSettings(universe.universeId, { startingColumn: 6, startingRow: 4 });

			const group = await findGroup(await createGroup(ada));

			assert.strictEqual(group?.startingAreaId, universe.fieldAreaId);
			assert.strictEqual(group?.startingColumn, 6);
			assert.strictEqual(group?.startingRow, 4);
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
			const levels = await listDifficultyLevels(universe.universeId);
			const hardcore = levels.find((level) => (level.key === 'hardcore'));
			const created = await send<GroupCreatedPayload>(ada, 'POST', groupsPath(universe.universeId), { ...groupRequest(ada.characterId), difficultyLevelId: hardcore?.id });

			assert.strictEqual(created.status, 201);
			assert.strictEqual((await findGroup(created.body.groupId))?.difficultyLevelId, hardcore?.id);
		});

		it('refuses a difficulty level of another universe, and a missing one', async () =>
		{
			const other = await addPlayableUniverse();
			const othersLevel = await findDefaultDifficultyLevel(other.universeId);
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
			const hardcore = (await listDifficultyLevels(universe.universeId)).find((level) => (level.key === 'hardcore'));
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
			await updateUniverseSettings(universe.universeId, { groupSize: 2 });

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
				character: { characterId: grace.characterId, playerId: grace.playerId, name: 'Grace', raceId: await defaultRaceId('dwarf'), playable: true }
			});
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

		it('refuses another player\'s character, and a character not in the group', async () =>
		{
			const groupId = await createGroup(ada);

			assert.strictEqual((await send(grace, 'POST', `${groupPath(universe.universeId, groupId)}/leave`, { characterId: ada.characterId })).status, 404);
			assert.strictEqual((await send(grace, 'POST', `${groupPath(universe.universeId, groupId)}/leave`, { characterId: grace.characterId })).status, 404);
			assert.ok(await findGroup(groupId));
		});

		it('disbands the group when the anchor being is deleted', async () =>
		{
			const groupId = await createGroup(ada);

			await send(grace, 'POST', invitePath(await invite(ada, groupId)), { characterId: grace.characterId });

			const deleted = await send(ada, 'DELETE', characterPath(universe.universeId, ada.characterId));

			assert.strictEqual(deleted.status, 204);
			assert.strictEqual(await findGroup(groupId), undefined);
			assert.strictEqual(changes.at(-1)?.kind, 'disbanded');

			const members = (changes.at(-1) as Extract<GroupChange, { kind: 'disbanded' }>).members;

			assert.strictEqual(members.find(({ characterId }) => (characterId === ada.characterId))?.playable, false);
			assert.strictEqual(members.find(({ characterId }) => (characterId === grace.characterId))?.playable, true);
		});
	});
});
