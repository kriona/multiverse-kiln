import assert from 'assert';
import { randomUUID } from 'crypto';
import type { ColyseusTestServer } from '@colyseus/testing';
import { Client as SDKClient, type Room as ClientRoom } from '@colyseus/sdk';

import { EDITOR_ROOM_NAME, EditorMessageType, EditorServerMessageType, EditorState, MAX_CHAT_MESSAGE_LENGTH, NoticeReason, ServerCloseCode, VOID_CELL, type EditorJoinOptions, type EditorPlacePayload, type EditorSavedPayload, type KeptChatHistoryPayload, type KeptChatMessage, type NoticePayload, type RaceListPayload } from '@multiverse-kiln/shared';
import type appConfig from '../src/app.config.js';
import { listChatMessages } from '../src/db/chatRepo.js';
import { addServerAdmin } from '../src/db/serverAdminRepo.js';
import { listUniverseEdits } from '../src/db/universeEditRepo.js';
import { setUniverseRole } from '../src/db/universeEditorRepo.js';
import { connectedSessions } from '../src/players/connectedSessions.js';
import { universeAccessChanges } from '../src/players/universeAccess.js';
import type { EditorRoom } from '../src/rooms/EditorRoom.js';
import { areaChanges } from '../src/world/areaChanges.js';
import { editorUpdates } from '../src/world/editorUpdates.js';
import { createArea, createUniverse, logIn, saveChanges, send, type Editor } from './editorRequests.js';
import { Inbox } from './inbox.js';
import { usernameFor } from './players.js';
import { getTestServer, testServerUrl } from './testServer.js';
import { turnOnTwoFactor } from './twoFactorAccounts.js';
import { waitUntil } from './waitUntil.js';

/**
 * A browser window with a universe's editor open
 */
interface EditorWindow
{
	room: ClientRoom<unknown, EditorState>;
	inbox: Inbox<EditorServerMessageType>;
	playerId: string;
}

/**
 * Connects to a universe's editor room like a browser window holding its browser's session cookie
 *
 * @param cookie The Cookie header the window sends
 * @param options The join options
 * @return The client-side room
 */
function connect(cookie: string, options: unknown): Promise<ClientRoom<unknown, EditorState>>
{
	const sdk = new SDKClient(testServerUrl.replace(/^http/, 'ws'), { headers: { cookie } });

	return(sdk.joinOrCreate<EditorState>(EDITOR_ROOM_NAME, options, EditorState));
}

/**
 * Opens a window of a logged-in browser on a universe's editor
 *
 * @param editor The browser
 * @param universeId The universe
 * @return The window, with the chat it was sent on joining still in its inbox
 */
async function openEditor(editor: Editor, universeId: string): Promise<EditorWindow>
{
	const options: EditorJoinOptions = { universeId };
	const room = await connect(editor.cookie, options);

	return({
		room,
		inbox: new Inbox<EditorServerMessageType>(room, Object.values(EditorServerMessageType)),
		playerId: editor.playerId
	});
}

/**
 * Waits for a window to be turned away
 *
 * @param window The window
 * @return The close code it was turned away with
 */
function closeOf(window: EditorWindow): Promise<number>
{
	return(new Promise<number>((resolve) =>
	{
		window.room.onLeave(resolve);
	}));
}

describe('EditorRoom', () =>
{
	let colyseus: ColyseusTestServer<typeof appConfig>;
	let ada: Editor;
	let universeId: string;

	/**
	 * The server-side room a window is in
	 *
	 * @param window The window
	 * @return The room
	 */
	function roomOf(window: EditorWindow): EditorRoom
	{
		return(colyseus.getRoomById<EditorRoom>(window.room.roomId));
	}

	/**
	 * Gives a new player a role in the universe and logs a browser in as them
	 *
	 * @param name The player's name
	 * @param role Their role
	 * @return The browser
	 */
	async function addEditor(name: string, role: 'creator' | 'builder' | 'beta_tester' | 'translator'): Promise<Editor>
	{
		const editor = await logIn(name);

		await setUniverseRole(universeId, editor.playerId, role);

		return(editor);
	}

	before(async () =>
	{
		colyseus = await getTestServer();
	});

	beforeEach(async () =>
	{
		await colyseus.cleanup();
		ada = await logIn('Ada');
		universeId = await createUniverse(ada);
	});

	describe('joining', () =>
	{
		it('turns away a browser that is not logged in, a player without a role, and a universe that does not exist', async () =>
		{
			const alan = await logIn('Alan');

			await assert.rejects(connect('', { universeId }));
			await assert.rejects(connect(alan.cookie, { universeId }));
			await assert.rejects(connect(ada.cookie, { universeId: randomUUID() }));
			await assert.rejects(connect(ada.cookie, {}));
		});

		it('admits a server admin with 2FA on with the site admin role, but not one without 2FA', async () =>
		{
			const admin = await logIn('Grace');

			await addServerAdmin(admin.playerId);
			await assert.rejects(connect(admin.cookie, { universeId }));
			await turnOnTwoFactor(admin.playerId);

			const window = await openEditor(admin, universeId);

			assert.strictEqual(roomOf(window).state.editors.get(admin.playerId)?.role, 'admin');
		});

		it('lists each player once with their name, username and role, and what each of their windows has open', async () =>
		{
			const grace = await addEditor('Grace', 'builder');
			const first = await openEditor(ada, universeId);
			const second = await openEditor(ada, universeId);
			const other = await openEditor(grace, universeId);
			const room = roomOf(first);
			const place: EditorPlacePayload = {
				version: 'draft',
				tab: 'areas',
				areaId: randomUUID()
			};

			assert.strictEqual(roomOf(other), room);
			second.room.send(EditorMessageType.Place, place);
			await waitUntil(() => [...(room.state.editors.get(ada.playerId)?.windows.values() ?? [])].some((window) => (window.tab === 'areas')));

			const presence = room.state.editors.get(ada.playerId);

			assert.deepStrictEqual([presence?.name, presence?.username, presence?.role], ['Ada', usernameFor('Ada'), 'creator']);
			assert.deepStrictEqual([...(presence?.windows.values() ?? [])].map((window) => [window.version, window.tab, window.areaId]).sort(), [['draft', 'areas', place.areaId], ['live', 'universe', '']]);
			assert.strictEqual(room.state.editors.get(grace.playerId)?.role, 'builder');

			await second.room.leave();
			await waitUntil(() => (room.state.editors.get(ada.playerId)?.windows.size === 1));
			await first.room.leave();
			await waitUntil(() => !room.state.editors.has(ada.playerId));
			assert.ok(room.state.editors.has(grace.playerId));
		});

		it('shows other windows the area a window has open, as its claim, until it closes the area or leaves', async () =>
		{
			const grace = await addEditor('Grace', 'builder');
			const claiming = await openEditor(grace, universeId);
			const watching = await openEditor(ada, universeId);
			const areaId = randomUUID();

			/**
			 * The areas Grace's windows have open, as the watching window's synced state has them
			 *
			 * @return The areas' IDs, empty for a window with none open
			 */
			const claimed = (): string[] => [...(watching.room.state.editors.get(grace.playerId)?.windows.values() ?? [])].map((window) => window.areaId);

			claiming.room.send(EditorMessageType.Place, { version: 'live', tab: 'areas', areaId });
			await waitUntil(() => claimed().includes(areaId));

			// A window on another tab keeps its area open
			claiming.room.send(EditorMessageType.Place, { version: 'live', tab: 'items', areaId });
			await waitUntil(() => [...(watching.room.state.editors.get(grace.playerId)?.windows.values() ?? [])].some((window) => (window.tab === 'items')));
			assert.deepStrictEqual(claimed(), [areaId]);

			claiming.room.send(EditorMessageType.Place, { version: 'live', tab: 'areas', areaId: null });
			await waitUntil(() => claimed().every((each) => (each === '')));

			claiming.room.send(EditorMessageType.Place, { version: 'live', tab: 'areas', areaId });
			await waitUntil(() => claimed().includes(areaId));
			await claiming.room.leave();
			await waitUntil(() => !watching.room.state.editors.has(grace.playerId));
		});

		it('ignores a place that names no tab or version it has', async () =>
		{
			const window = await openEditor(ada, universeId);
			const room = roomOf(window);

			window.room.send(EditorMessageType.Place, { version: 'old', tab: 'areas', areaId: null });
			window.room.send(EditorMessageType.Place, { version: 'live', tab: 'secrets', areaId: null });
			window.room.send(EditorMessageType.Place, { version: 'live', tab: 'items', areaId: 'not an ID' });
			window.room.send(EditorMessageType.Place, { version: 'live', tab: 'lobby', areaId: null });
			await waitUntil(() => [...(room.state.editors.get(ada.playerId)?.windows.values() ?? [])].some((each) => (each.tab === 'lobby')));
		});
	});

	describe('chat', () =>
	{
		it('sends a message to every window as the player, and the chat to windows joining later', async () =>
		{
			const grace = await addEditor('Grace', 'translator');
			const adaWindow = await openEditor(ada, universeId);
			const graceWindow = await openEditor(grace, universeId);

			assert.deepStrictEqual((await adaWindow.inbox.take<KeptChatHistoryPayload>(EditorServerMessageType.ChatHistory)).messages, []);
			adaWindow.room.send(EditorMessageType.Chat, { text: '  The dwarves need a start area  ' });

			const received = await graceWindow.inbox.take<KeptChatMessage>(EditorServerMessageType.Chat);

			assert.deepStrictEqual([received.playerId, received.name, received.username, received.text], [ada.playerId, 'Ada', usernameFor('Ada'), 'The dwarves need a start area']);
			assert.strictEqual((await adaWindow.inbox.take<KeptChatMessage>(EditorServerMessageType.Chat)).text, received.text);

			const later = await openEditor(ada, universeId);

			assert.deepStrictEqual((await later.inbox.take<KeptChatHistoryPayload>(EditorServerMessageType.ChatHistory)).messages, [received]);
		});

		it('drops messages that are empty, too long or hold disallowed characters, and tells a player sending too fast', async () =>
		{
			const window = await openEditor(ada, universeId);

			window.room.send(EditorMessageType.Chat, { text: '   ' });
			window.room.send(EditorMessageType.Chat, { text: 'x'.repeat(MAX_CHAT_MESSAGE_LENGTH + 1) });
			window.room.send(EditorMessageType.Chat, { text: 'right‮to left' });

			for (let sent = 0; sent < 6; sent++)
			{
				window.room.send(EditorMessageType.Chat, { text: `Line ${sent}` });
			}

			const notice = await window.inbox.take<NoticePayload>(EditorServerMessageType.Notice);

			assert.strictEqual(notice.reason, NoticeReason.ChatTooFast);
			assert.strictEqual((await window.inbox.take<KeptChatMessage>(EditorServerMessageType.Chat)).text, 'Line 0');
			assert.strictEqual(window.inbox.pending(EditorServerMessageType.Chat), 4);
		});

		it('keeps the chat in the database, written as the room closes, for the room that opens next', async () =>
		{
			const window = await openEditor(ada, universeId);

			window.room.send(EditorMessageType.Chat, { text: 'Saved for later' });
			await window.inbox.take<KeptChatMessage>(EditorServerMessageType.Chat);
			assert.deepStrictEqual(await listChatMessages({ kind: 'editors', universeId }), []);
			await window.room.leave();
			await waitUntil(async () => ((await listChatMessages({ kind: 'editors', universeId })).length === 1));

			const reopened = await openEditor(ada, universeId);
			const [kept] = (await reopened.inbox.take<KeptChatHistoryPayload>(EditorServerMessageType.ChatHistory)).messages;

			assert.deepStrictEqual([kept.playerId, kept.name, kept.username, kept.text], [ada.playerId, 'Ada', usernameFor('Ada'), 'Saved for later']);
		});

		it('writes new messages every few seconds while the room is open', async () =>
		{
			const window = await openEditor(ada, universeId);

			window.room.send(EditorMessageType.Chat, { text: 'Checkpoint' });
			await window.inbox.take<KeptChatMessage>(EditorServerMessageType.Chat);
			await roomOf(window).saveChat();
			assert.deepStrictEqual((await listChatMessages({ kind: 'editors', universeId })).map((message) => message.text), ['Checkpoint']);
		});
	});

	describe('save notices', () =>
	{
		it('tells every other window who saved what, but not the window that saved', async () =>
		{
			const grace = await addEditor('Grace', 'builder');
			const saving = await openEditor(ada, universeId);
			const other = await openEditor(ada, universeId);
			const graceWindow = await openEditor(grace, universeId);
			const saved = await saveChanges(ada, universeId, [{ kind: 'universe', update: { groupSize: 3 } }], saving.room.sessionId);

			assert.strictEqual(saved.status, 200);

			const notice = await graceWindow.inbox.take<EditorSavedPayload>(EditorServerMessageType.Saved);

			assert.deepStrictEqual([notice.playerId, notice.name, notice.username, notice.version], [ada.playerId, 'Ada', usernameFor('Ada'), 'live']);
			assert.deepStrictEqual(notice.details, [{ subject: 'settings', action: 'changed', target: null, fields: [{ field: 'groupSize', value: 3 }], count: 1, id: null }]);
			assert.deepStrictEqual((await other.inbox.take<EditorSavedPayload>(EditorServerMessageType.Saved)).details, notice.details);
			await assert.rejects(saving.inbox.take(EditorServerMessageType.Saved, 200));
		});

		it('tells a window with the other version open only of what the universe holds once, and of a save to that version with no details, for the Audit tab', async () =>
		{
			const window = await openEditor(ada, universeId);
			const room = roomOf(window);
			const place: EditorPlacePayload = {
				version: 'draft',
				tab: 'universe',
				areaId: null
			};

			window.room.send(EditorMessageType.Place, place);
			await waitUntil(() => [...(room.state.editors.get(ada.playerId)?.windows.values() ?? [])].some((each) => (each.version === 'draft')));
			assert.strictEqual((await saveChanges(ada, universeId, [{ kind: 'universe', update: { groupSize: 3 } }])).status, 200);

			const versionOnly = await window.inbox.take<EditorSavedPayload>(EditorServerMessageType.Saved);

			assert.deepStrictEqual([versionOnly.version, versionOnly.details], ['live', []]);
			assert.strictEqual((await saveChanges(ada, universeId, [{ kind: 'universe', update: { groupSize: 3, stage: 'prologue' } }])).status, 200);

			const notice = await window.inbox.take<EditorSavedPayload>(EditorServerMessageType.Saved);

			assert.deepStrictEqual(notice.details, [{ subject: 'settings', action: 'changed', target: null, fields: [{ field: 'stage', value: 'prologue' }], count: 1, id: null }]);
			assert.strictEqual(window.inbox.pending(EditorServerMessageType.Saved), 0);
		});

		it('tells no window of a save that changed nothing', async () =>
		{
			const window = await openEditor(ada, universeId);

			assert.strictEqual((await saveChanges(ada, universeId, [{ kind: 'universe', update: { groupSize: 3 } }])).status, 200);
			await window.inbox.take(EditorServerMessageType.Saved);
			assert.strictEqual((await saveChanges(ada, universeId, [{ kind: 'universe', update: { groupSize: 3 } }])).status, 200);
			await assert.rejects(window.inbox.take(EditorServerMessageType.Saved, 200));
		});

		it('names each thing changed by its ID, and nothing added, so other windows can find it', async () =>
		{
			const window = await openEditor(ada, universeId);
			const races = (await send<RaceListPayload>(ada, 'GET', `/${universeId}/races`)).body.races;
			const dwarf = races.find((race) => (race.key === 'dwarf'))!;
			const areaId = await createArea(ada, universeId);

			await window.inbox.take(EditorServerMessageType.Saved);
			assert.strictEqual((await saveChanges(ada, universeId, [
				{ kind: 'saveRace', id: dwarf.id, settings: { ...dwarf, name: 'Stout' } },
				{ kind: 'editCells', areaId, changes: [[0, 0, VOID_CELL]] },
				{ kind: 'createArea', ref: 'new:cave', area: { name: 'Cave' } }
			])).status, 200);

			const notice = await window.inbox.take<EditorSavedPayload>(EditorServerMessageType.Saved);

			assert.deepStrictEqual(notice.details.map((detail) => [detail.subject, detail.action, detail.id]), [
				['race', 'changed', dwarf.id],
				['cells', 'changed', areaId],
				['area', 'added', null]
			]);
		});

		it('names the chunks each area\'s painting touched, without keeping them for the Audit tab', async () =>
		{
			const window = await openEditor(ada, universeId);
			const areaId = await createArea(ada, universeId);

			await window.inbox.take(EditorServerMessageType.Saved);
			assert.strictEqual((await saveChanges(ada, universeId, [
				{ kind: 'editCells', areaId, changes: [[0, 0, VOID_CELL], [1, 0, VOID_CELL], [-1, -1, VOID_CELL]] }
			])).status, 200);

			const [painted] = (await window.inbox.take<EditorSavedPayload>(EditorServerMessageType.Saved)).details;

			assert.deepStrictEqual([painted.subject, painted.count, painted.chunks], ['cells', 3, [{ chunkColumn: 0, chunkRow: 0 }, { chunkColumn: -1, chunkRow: -1 }]]);

			const [recorded] = (await listUniverseEdits(universeId, { offset: 0, limit: 1 })).edits;

			assert.ok((recorded.changeDetails ?? []).every((detail) => !('chunks' in detail)));
		});
	});

	describe('changes to who may edit', () =>
	{
		it('turns away the windows of a player whose role a save takes away, and tells a player whose role it changes', async () =>
		{
			const grace = await addEditor('Grace', 'builder');
			const alan = await addEditor('Alan', 'builder');
			const graceWindow = await openEditor(grace, universeId);
			const alanWindow = await openEditor(alan, universeId);
			const adaWindow = await openEditor(ada, universeId);
			const room = roomOf(adaWindow);
			const left = closeOf(graceWindow);
			const saved = await saveChanges(ada, universeId, [
				{ kind: 'removeEditor', playerId: grace.playerId },
				{ kind: 'saveEditor', playerId: alan.playerId, settings: { role: 'beta_tester', languages: [] } }
			]);

			assert.strictEqual(saved.status, 200);
			assert.strictEqual(await left, ServerCloseCode.AccessLost);
			await alanWindow.inbox.take(EditorServerMessageType.AccessChanged);
			assert.strictEqual(room.state.editors.get(alan.playerId)?.role, 'beta_tester');
			await waitUntil(() => !room.state.editors.has(grace.playerId));
			assert.strictEqual(adaWindow.inbox.pending(EditorServerMessageType.AccessChanged), 0);
		});

		it('keeps a server admin whose role is taken away, with the site admin role', async () =>
		{
			const grace = await addEditor('Grace', 'builder');

			await addServerAdmin(grace.playerId);
			await turnOnTwoFactor(grace.playerId);

			const window = await openEditor(grace, universeId);

			editorUpdates.publish({
				kind: 'roles',
				universeId,
				roles: new Map([[grace.playerId, undefined]])
			});
			await window.inbox.take(EditorServerMessageType.AccessChanged);
			assert.strictEqual(roomOf(window).state.editors.get(grace.playerId)?.role, 'admin');
		});

		it('tells every window when the stage changes or the universe is disabled or enabled, and ignores other universes', async () =>
		{
			const window = await openEditor(ada, universeId);

			universeAccessChanges.publishStage({
				universeId,
				stage: 'end_of_time',
				roles: new Map([[ada.playerId, 'creator']])
			});
			await window.inbox.take(EditorServerMessageType.AccessChanged);
			editorUpdates.publish({
				kind: 'access',
				universeId
			});
			await window.inbox.take(EditorServerMessageType.AccessChanged);
			editorUpdates.publish({
				kind: 'access',
				universeId: randomUUID()
			});
			await assert.rejects(window.inbox.take(EditorServerMessageType.AccessChanged, 200));
		});

		it('turns away every window when the universe is deleted, and a browser\'s windows when its session ends', async () =>
		{
			const grace = await addEditor('Grace', 'builder');
			const adaWindow = await openEditor(ada, universeId);
			const graceWindow = await openEditor(grace, universeId);
			const loggedOut = closeOf(adaWindow);

			connectedSessions.end([ada.sessionId]);
			assert.strictEqual(await loggedOut, ServerCloseCode.LoggedOut);

			const deleted = closeOf(graceWindow);

			areaChanges.publish({
				kind: 'universeDeleted',
				universeId
			});
			assert.strictEqual(await deleted, ServerCloseCode.UniverseDeleted);
		});
	});
});
