import { ErrorCode, Room, ServerError, type AuthContext, type Client, type CloseCode } from 'colyseus';
import { canViewUniverse, cellIndexInChunk, characterBar, chunkCoordinate, chunkKey, DEFAULT_TILE_CELL, GameMessageType, GameServerMessageType, GameState, GroupMember, MessageType, NOTHING_BARRED, NoticeReason, PATCH_INTERVAL_MS, PLAIN_SIGHT, ServerCloseCode, ServerMessageType, visibleCells, type BarredOptions, type CellsSeenPayload, type ChatAuthorDeletedPayload, type CellValue, type NoticePayload, type Sight, type StartingCell } from '@multiverse-kiln/shared';

import { resolveSession, type SessionIdentity } from '../auth/sessions.js';
import { loadBarredOptions } from '../db/barredOptions.js';
import { markCharacterPlayed } from '../db/characterRepo.js';
import { findGroup, listGroupMembers, saveGroupClock, saveMemberPositions, type GroupMemberRecord, type MemberPosition } from '../db/groupRepo.js';
import { saveSeenChunks, loadSeenChunks } from '../db/worldStateRepo.js';
import { GroupClock } from '../logic/gameClock.js';
import { SeenCells } from '../logic/seenCells.js';
import { startingCellOn } from '../logic/startingArea.js';
import { loadRaceSight } from '../db/raceRepo.js';
import { findUniverse } from '../db/universeRepo.js';
import { loadChunksAt, loadArea } from '../db/areaRepo.js';
import { accountDeletions } from '../players/accountDeletions.js';
import { characterChanges, type CharacterChange } from '../players/characterChanges.js';
import { connectedSessions } from '../players/connectedSessions.js';
import { groupChanges, type GroupChange } from '../players/groupChanges.js';
import { universeAccessChanges, type BarredChange, type StageChange } from '../players/universeAccess.js';
import { areaChanges, type AreaChange, type AreaPlace } from '../world/areaChanges.js';
import { areaOccupants } from '../world/areaOccupants.js';
import { InvalidMessages } from './invalidMessages.js';
import { JoinChanges } from './joinChanges.js';
import { ChangesWhileCreating } from './changesWhileCreating.js';
import { CHAT_SAVE_INTERVAL_MS, KeptChatLog } from './keptChat.js';
import { isLoggedInToMatchmake } from './matchmakingAuth.js';
import { OneRoomPerKey } from './oneRoomPerKey.js';
import { unexplainedRoomError, withoutErrorDetails } from './roomErrors.js';
import { entryRefusalCode, findViewRefusal, type EntryRefusal } from './universePlay.js';
import { chatPayload, controlPayload, describeInvalidPayload, gameJoinOptions, movePayload } from './payloads.js';
import { tryTakeChatMessage } from './rateLimiter.js';
import { AreaCache, toLinkCells, type ActiveArea } from './areaCache.js';
import { AREA_MESSAGE_OPTIONS, CHUNK_REFRESH_INTERVAL_MS, SIMULATION_TICK_RATE, AreaPlayers, type Appearance, type PlayerPosition } from './areaPlayers.js';

/**
 * What onAuth found out about a client, available afterward as client.auth
 */
interface GameIdentity
{
	/**
	 * The login session the client connected with
	 */
	sessionId: string;

	/**
	 * The client's player, from the browser's login
	 */
	playerId: string;

	/**
	 * The character the client asked to play
	 */
	characterId: string;
}

type GameClient = Client<{ auth: GameIdentity }>;

/**
 * What a joining window found out about itself: its session, and whether its player may open their
 * groups in the universe
 */
interface GameLookup
{
	/**
	 * Undefined when the window's browser isn't logged in
	 */
	session: SessionIdentity | undefined;

	/**
	 * Why the player may not open their groups; undefined when they may, or there is no session
	 */
	refusal: EntryRefusal | undefined;
}

/**
 * The changes to who may open the universe's groups that a joining window may miss (JoinChanges):
 * sessions ending, the universe being deleted or disabled, players losing their role, and its stage
 * changing
 */
type GameJoinChange = 'session' | 'universe' | 'access' | 'stage';

/**
 * Milliseconds between saves of what the group has seen while players are in the room; it is saved
 * when the last of them leaves as well
 */
const SEEN_SAVE_INTERVAL_MS = 30 * 1000;

/**
 * Who a game client is
 *
 * @param client A client that has passed onAuth
 * @return Its identity
 */
function identityOf(client: GameClient): GameIdentity
{
	if (!client.auth)
	{
		throw new Error(`Game client ${client.sessionId} has no identity`);
	}

	return(client.auth);
}

/**
 * The open game room of each group, by group ID
 */
const gameRooms = new OneRoomPerKey<GameRoom>('group');

/**
 * A group's game room: its members play here, send movement input, and the server simulates and syncs
 * their positions
 *
 * Clients join with GameJoinOptions, and every client asking for the same group joins the same room
 * (filterBy in app.config.ts), which loads the group from the database as the first one arrives. A
 * second room for a group that has one is refused (gameRooms), since each would save its own copy of
 * the group's clock, seen cells and positions over the other's. A
 * client is admitted only to play one of its player's characters in the group who hasn't been given
 * their last rites and whose race and class don't bar them (characterBar(); a save barring them takes
 * them out of play). While a player has any window here, every such character of theirs is in play,
 * where they were when their player last left (or beside the anchor being, for a character new to the
 * group); each window controls one of them and can switch to another (GameMessageType.Control). When a
 * player's last window leaves, their characters are taken out of play and where they were is saved.
 * The room disposes once everyone has left. A window that joins while its session ends, or while who
 * may open the universe's groups changes, looks itself up again once it is listed (JoinChanges), so the
 * change reaches it too
 *
 * In a universe at the end of time the room is locked (state.locked): members can open it and look at
 * the area, and switch between their characters, but it ignores moves and links
 *
 * The group's chat is kept (server/src/db/chatRepo.ts), written as the character each window controls:
 * the room loads its messages as it starts, and writes new ones every CHAT_SAVE_INTERVAL_MS and as it
 * closes, never inside a tick. It works while the room is locked too
 *
 * The group routes (http/groups.ts) decide who is in the group, and the room follows them (groupChanges)
 */
export class GameRoom extends Room<{ state: GameState; client: GameClient }>
{
	// Colyseus allows unlimited messages by default. A client over the limit is disconnected; clients send
	// Move only when their direction changes, so an honest client stays far below it
	maxMessagesPerSecond = 30;

	patchRate = PATCH_INTERVAL_MS;

	state = new GameState();

	private readonly areas = new AreaCache(loadArea, loadChunksAt);

	/**
	 * The cells the group has seen, part of its world state; loaded in onCreate
	 */
	private readonly seen = new SeenCells();

	/**
	 * The save of the seen cells going on, if any. Each waits for the one before, since a save writes
	 * whole chunks, and one finishing late would write an older copy of a chunk over a newer one
	 */
	private seenSaving: Promise<void> = Promise.resolve();

	/**
	 * Characters whose area is deleted go to the group's starting area. Everyone here is in the group,
	 * so they see what any of them sees, and are sent only the cells the group has seen. A link that
	 * needs the whole group is refused unless every member who can be played, and the anchor being, is
	 * here together
	 */
	private readonly areaPlayers = new AreaPlayers(this.state.players, this.areas, () => this.startingAreaId, {
		shared: true,
		clockSeconds: () => this.state.clock,
		memory: this.seen
	}, {
		members: () => this.linkMemberIds(),
		refuse: (characterId) =>
		{
			this.sendNotice(this.areaPlayers.getClients(characterId), NoticeReason.GroupNotTogether);
		}
	});

	private groupId!: string;

	/**
	 * The universe the group plays in
	 */
	private universeId!: string;

	/**
	 * The anchor being's character ID
	 */
	private anchorId!: string;

	/**
	 * Where members with nowhere else to be go: the group's starting area, or the universe's
	 */
	private startingAreaId!: string;

	/**
	 * The cell of the starting area they start nearest
	 */
	private startingCell: StartingCell = { column: 0, row: 0 };

	/**
	 * The group's game clock, which state.clock shows. Named apart from Room's clock, which runs timers
	 */
	private gameClock!: GroupClock;

	/**
	 * Every member of the group, by character ID (server-only; state.members has what clients see)
	 */
	private readonly members = new Map<string, GroupMemberRecord>();

	/**
	 * Each of the universe's races' darkvision and light sensitivity, by race ID, as the room found them
	 * on starting
	 */
	private raceSight = new Map<number, Sight>();

	/**
	 * The races and classes whose characters can't play (see characterBar()), loaded in onCreate and
	 * followed as saves change them
	 */
	private barred: BarredOptions = NOTHING_BARRED;

	/**
	 * Where each member last looked from and how far they saw (see explore), by character ID
	 */
	private readonly lastSights = new Map<string, string>();

	/**
	 * Each player's clients in the room, by player ID
	 */
	private readonly windows = new Map<string, Set<GameClient>>();

	/**
	 * Once the anchor being has left, or the group size was lowered, so the group is no more, the close
	 * code its windows are turned away with; nothing is saved from then on, and no window may join.
	 * Undefined while the group is still together
	 */
	private disbanded: ServerCloseCode | undefined;

	/**
	 * How many invalid messages each client has sent this session (server-only, not synced)
	 */
	private readonly invalidMessages = new InvalidMessages();

	private readonly joinChanges = new JoinChanges<GameJoinChange, GameLookup>();

	private readonly whileCreating = new ChangesWhileCreating();

	/**
	 * The group's chat, loaded in onCreate. It takes in the notices written in it, such as a character
	 * leaving, and sends them to the room's windows
	 */
	private readonly chat = new KeptChatLog((message) =>
	{
		this.broadcast(GameServerMessageType.Chat, message);
	});

	private readonly stopListening: (() => void)[] = [];

	messages = {
		[MessageType.Move]: (client: GameClient, payload: unknown) =>
		{
			const result = movePayload.safeParse(payload);

			if (!result.success)
			{
				this.invalidMessages.reject(client, MessageType.Move, describeInvalidPayload(result.error));
				return;
			}

			// Nothing moves in a universe at the end of time (areaPlayers is locked)
			this.areaPlayers.queueMove(client.sessionId, result.data);
		},

		[MessageType.TakeLink]: (client: GameClient) =>
		{
			this.areaPlayers.takeLink(client.sessionId);
		},

		[GameMessageType.Control]: (client: GameClient, payload: unknown) =>
		{
			const result = controlPayload.safeParse(payload);

			if (!result.success)
			{
				this.invalidMessages.reject(client, GameMessageType.Control, describeInvalidPayload(result.error));
				return;
			}

			const member = this.members.get(result.data.characterId);

			// A window can only switch to its own player's characters, who are in play while it is here
			if ((member?.playerId === identityOf(client).playerId) && this.areaPlayers.has(member.characterId))
			{
				this.areaPlayers.control(client, member.characterId);
			}
		},

		[GameMessageType.Chat]: (client: GameClient, payload: unknown) =>
		{
			const result = chatPayload.safeParse(payload);

			if (!result.success)
			{
				this.invalidMessages.reject(client, GameMessageType.Chat, describeInvalidPayload(result.error));
				return;
			}

			const { playerId } = identityOf(client);
			const characterId = this.areaPlayers.getPlayerId(client.sessionId);
			const member = ((characterId === undefined) ? undefined : this.members.get(characterId));

			// A window whose character has just been taken out of play has no one to write as
			if (!member)
			{
				return;
			}

			if (!tryTakeChatMessage(`group ${this.groupId}`, playerId))
			{
				this.sendNotice([client], NoticeReason.ChatTooFast);
				return;
			}

			const message = this.chat.add({
				playerId,
				name: member.name,
				username: null
			}, result.data.text);

			this.broadcast(GameServerMessageType.Chat, message);
		}
	};

	/**
	 * Makes the group's room (create()), telling the client nothing of why it couldn't be made
	 * (withoutErrorDetails())
	 *
	 * @param options The group, from the first client's GameJoinOptions
	 */
	async onCreate(options: unknown): Promise<void>
	{
		await withoutErrorDetails('Creating a game room', ErrorCode.MATCHMAKE_UNHANDLED, () => this.create(options));
	}

	/**
	 * Loads the group, its members, its chat and its starting area, starts the simulation loop, the
	 * loading of chunks near players and the writing of new chat messages, and starts following changes to
	 * the group, its characters and the world. Fails for options that aren't GameJoinOptions, a group that
	 * doesn't exist, or one whose universe has no starting area, with the same error (unexplainedRoomError())
	 * for each, which isn't logged
	 *
	 * @param options The group, from the first client's GameJoinOptions
	 */
	private async create(options: unknown): Promise<void>
	{
		const parsed = gameJoinOptions.safeParse(options);

		if (!parsed.success)
		{
			throw unexplainedRoomError();
		}

		const { groupId } = parsed.data;

		gameRooms.claim(groupId, this);
		this.followChanges();

		const group = await findGroup(groupId);
		const universe = (group ? await findUniverse(group.universeId) : undefined);

		if (!group || !universe)
		{
			throw unexplainedRoomError();
		}

		const groupArea = ((group.startingAreaId !== null) ? await this.areas.load(group.startingAreaId) : undefined);
		const startingArea = (groupArea ?? ((universe.startingAreaId !== undefined) ? await this.areas.load(universe.startingAreaId) : undefined));

		if (!startingArea)
		{
			throw unexplainedRoomError();
		}

		this.groupId = group.id;
		this.universeId = group.universeId;
		this.anchorId = group.anchorCharacterId;
		this.startingAreaId = startingArea.loaded.area.id;
		this.startingCell = (groupArea
			? { column: group.startingColumn, row: group.startingRow }
			: { column: universe.startingColumn, row: universe.startingRow });
		this.state.name = group.name;
		this.state.anchorId = group.anchorCharacterId;
		this.gameClock = new GroupClock(group.clockSeconds);
		this.state.clock = this.gameClock.seconds;
		this.state.locked = (universe.stage === 'end_of_time');
		this.areaPlayers.setLocked(this.state.locked);
		this.raceSight = await loadRaceSight(universe.id, universe.ruleset);
		this.barred = await loadBarredOptions(universe.id);

		this.areaPlayers.onWalk((characterId, seconds, time) =>
		{
			// Only areas whose time flows normally follow the group's clock; walking in any other leaves it where it is
			if (time.passage !== 'flows_normally')
			{
				return;
			}

			if (this.gameClock.walk(characterId, seconds, this.clock.currentTime))
			{
				this.state.clock = this.gameClock.seconds;
			}
		});

		for (const member of await listGroupMembers(group.id))
		{
			this.addMember(member);
		}

		this.seen.load(await loadSeenChunks(group.id));
		await this.chat.load({
			kind: 'group',
			universeId: group.universeId,
			groupId: group.id
		});

		this.setTimestep((deltaTime) =>
		{
			this.areaPlayers.update(deltaTime / 1000);
			this.explore();
		}, 1000 / SIMULATION_TICK_RATE);
		this.clock.setInterval(() => this.areaPlayers.refreshChunks(), CHUNK_REFRESH_INTERVAL_MS);
		this.clock.setInterval(() =>
		{
			this.saveSeen().catch((error: unknown) =>
			{
				console.error('Could not save what group', this.groupId, 'has seen', error);
			});
		}, SEEN_SAVE_INTERVAL_MS);
		this.clock.setInterval(() =>
		{
			void this.saveChat();
		}, CHAT_SAVE_INTERVAL_MS);

		this.stopListening.push(areaOccupants.register(this.universeId, () => [...this.members.keys()].flatMap((characterId) =>
		{
			const areaId = this.areaPlayers.getAreaId(characterId);

			return(((areaId === undefined) ? [] : [{ characterId, areaId }]));
		})));
		this.whileCreating.created();
	}

	/**
	 * Starts following changes to the group, its characters, the world, sessions and who may open the
	 * universe's groups. Called before onCreate's first read, so none published while it loads are
	 * missed: until it has loaded, they are held (whileCreating)
	 */
	private followChanges(): void
	{
		this.stopListening.push(
			groupChanges.onChange((change) =>
			{
				this.whileCreating.apply(() => this.applyGroupChange(change));
			}),
			accountDeletions.onDeleted((playerId) =>
			{
				this.whileCreating.apply(() =>
				{
					if (this.chat.forgetAuthor(playerId))
					{
						const deleted: ChatAuthorDeletedPayload = { playerId };

						this.broadcast(GameServerMessageType.ChatAuthorDeleted, deleted);
					}
				});
			}),
			characterChanges.onChange((change) =>
			{
				this.whileCreating.apply(() => this.applyCharacterChange(change));
			}),
			areaChanges.onChange((change) =>
			{
				this.whileCreating.apply(() => this.applyAreaChange(change));
			}),
			universeAccessChanges.onBarredChanged((change) =>
			{
				this.whileCreating.apply(() =>
				{
					if (change.universeId === this.universeId)
					{
						this.applyBarredChange(change);
					}
				});
			}),
			connectedSessions.onEnd((sessionIds) =>
			{
				this.whileCreating.apply(() =>
				{
					this.joinChanges.note('session');
					this.turnAwaySessions(sessionIds);
				});
			}),
			universeAccessChanges.onLost((change) =>
			{
				this.whileCreating.apply(() =>
				{
					if (change.universeId === this.universeId)
					{
						this.joinChanges.note('access');
						this.turnAwayPlayers(change.playerIds);
					}
				});
			}),
			universeAccessChanges.onStageChanged((change) =>
			{
				this.whileCreating.apply(() =>
				{
					if (change.universeId === this.universeId)
					{
						this.joinChanges.note('stage');
						this.applyStageChange(change);
					}
				});
			})
		);
	}

	/**
	 * Follows a change the world editor made: the universe being deleted or disabled turns every window
	 * away, its text changing tells them to read it again, an area disabled elsewhere sends its members
	 * away, the group's starting area being deleted makes the universe's its starting area, and any
	 * other change goes to the members it affects
	 *
	 * @param change The change
	 */
	private applyAreaChange(change: AreaChange): void
	{
		if (((change.kind === 'universeDeleted') || (change.kind === 'universeDisabled')) && (change.universeId === this.universeId))
		{
			this.joinChanges.note('universe');

			for (const client of this.clients)
			{
				client.leave(((change.kind === 'universeDeleted') ? ServerCloseCode.UniverseDeleted : ServerCloseCode.UniverseDisabled));
			}

			return;
		}

		if (change.kind === 'text')
		{
			if (change.universeId === this.universeId)
			{
				this.broadcast(ServerMessageType.UniverseText);
			}

			return;
		}

		if (change.kind === 'deleted')
		{
			this.seen.forget(change.areaId);

			// The group's own starting area, a race's or class's, can be deleted (the universe's can't), so
			// the members in it go to the universe's instead
			if (change.areaId === this.startingAreaId)
			{
				this.useUniverseStartingArea()
					.then(() => this.areaPlayers.applyChange(change))
					.catch((error: unknown) =>
					{
						console.error('Could not move the characters of group', this.groupId, 'out of its deleted starting area', change.areaId, error);
					});

				return;
			}
		}

		if (change.kind === 'evacuated')
		{
			this.evacuate(change.areaId, change.destination).catch((error: unknown) =>
			{
				console.error('Could not move the characters of group', this.groupId, 'out of area', change.areaId, error);
			});

			return;
		}

		this.areaPlayers.applyChange(change).catch((error: unknown) =>
		{
			console.error('Could not apply a world change to the room of group', this.groupId, error);
		});
	}

	/**
	 * Refuses a browser that isn't logged in before matchmaking makes a group's room for it
	 * (isLoggedInToMatchmake())
	 *
	 * @param _token The client's auth token, unused: the session is in a cookie
	 * @param _options Join options from the client
	 * @param context The matchmaking request's headers, which carry the session cookie
	 * @return Whether the browser is logged in
	 */
	static async onAuth(_token: string, _options: unknown, context: AuthContext): Promise<boolean>
	{
		return(isLoggedInToMatchmake(context));
	}

	/**
	 * Admits a client (admit()), telling it nothing of why that failed (withoutErrorDetails())
	 *
	 * @param client The joining client
	 * @param options The client's GameJoinOptions
	 * @param context The connection's request headers, which carry the session cookie
	 * @return The client's identity, stored as client.auth; false to turn the client away
	 */
	async onAuth(client: Client, options: unknown, context: AuthContext): Promise<GameIdentity | false>
	{
		return(withoutErrorDetails('Admitting a window to a game room', ErrorCode.APPLICATION_ERROR, () => this.admit(client, options, context)));
	}

	/**
	 * Admits a client only when its browser is logged in and asks to play one of its player's characters
	 * in this group who can be played
	 *
	 * @param client The joining client
	 * @param options The client's GameJoinOptions
	 * @param context The connection's request headers, which carry the session cookie
	 * @return The client's identity, stored as client.auth; false to turn the client away
	 */
	private async admit(client: Client, options: unknown, context: AuthContext): Promise<GameIdentity | false>
	{
		const joinOptions = gameJoinOptions.safeParse(options);

		if (!joinOptions.success || (joinOptions.data.groupId !== this.groupId))
		{
			return(false);
		}

		const cookieHeader = context.headers.get('cookie');

		this.joinChanges.startLookup(client, () => this.lookUp(cookieHeader));

		const { session, refusal } = await this.lookUp(cookieHeader);
		const member = this.members.get(joinOptions.data.characterId);

		if (!session || (member?.playerId !== session.playerId) || !this.canPlay(member) || (refusal !== undefined))
		{
			return(false);
		}

		return({
			sessionId: session.sessionId,
			playerId: session.playerId,
			characterId: member.characterId
		});
	}

	/**
	 * Lets a client in (join()), telling it nothing of why that failed (withoutErrorDetails())
	 *
	 * @param client The joining client
	 */
	async onJoin(client: GameClient): Promise<void>
	{
		await withoutErrorDetails('Joining a game room', ErrorCode.APPLICATION_ERROR, () => this.join(client));
	}

	/**
	 * Puts every playable character of the joining client's player into play, if they aren't already,
	 * gives the client the character it asked for, and sends it the group's chat. A window that may have
	 * missed a change while it joined looks itself up again first (recheckJoining()), and one whose group
	 * is no more is turned away
	 *
	 * @param client The joining client
	 */
	private async join(client: GameClient): Promise<void>
	{
		// Colyseus lists the client among the room's clients just before onJoin, so a disbanding from here
		// on turns it away with the rest; one before it, while onAuth looked the window up, is caught here
		if (this.disbanded !== undefined)
		{
			throw new ServerError(this.disbanded, 'The window\'s group was disbanded while it joined');
		}

		await this.recheckJoining(client);

		const { playerId, characterId } = identityOf(client);
		let clients = this.windows.get(playerId);

		if (!clients)
		{
			clients = new Set();
			this.windows.set(playerId, clients);
		}

		clients.add(client);
		await this.bringIn(playerId);

		// The character may have left the group, or been given their last rites, while the area loaded
		if (!this.areaPlayers.has(characterId))
		{
			clients.delete(client);
			throw new Error(`Character ${characterId} can no longer be played in group ${this.groupId}`);
		}

		const member = this.members.get(characterId);

		// bringIn() has put the character in play, so join() has no area to place them in
		this.areaPlayers.join(client, characterId, this.appearanceOf(member), undefined);
		client.send(GameServerMessageType.ChatHistory, this.chat.history());
		connectedSessions.connect(client, identityOf(client).sessionId);

		console.log(client.sessionId, 'joined group', this.groupId, 'as character', characterId);
	}

	/**
	 * Stops the client's character. Once the client was its player's last, takes their characters out
	 * of play, saves where they were, and records that the player last played the character the client
	 * controlled
	 *
	 * @param client The leaving client
	 * @param code WebSocket close code
	 */
	async onLeave(client: GameClient, code: CloseCode): Promise<void>
	{
		const { playerId } = identityOf(client);
		const left = this.areaPlayers.leave(client);
		const clients = this.windows.get(playerId);

		connectedSessions.disconnect(client);
		this.invalidMessages.forget(client.sessionId);
		clients?.delete(client);
		console.log(client.sessionId, 'left group', this.groupId, code);

		if (!clients || (clients.size > 0))
		{
			return;
		}

		this.windows.delete(playerId);

		const positions = this.takeOut(playerId);

		try
		{
			if (this.disbanded === undefined)
			{
				await saveMemberPositions(this.groupId, positions);
				await saveGroupClock(this.groupId, this.gameClock.seconds);
				await this.saveSeen();
			}

			if (left)
			{
				await markCharacterPlayed(left.playerId, new Date());
			}
		}
		catch (error)
		{
			console.error('Could not save where the characters of player', playerId, 'were in group', this.groupId, error);
		}
	}

	/**
	 * Stops following changes, once everyone has left (or nobody joined), and writes the chat's last new
	 * messages
	 */
	async onDispose(): Promise<void>
	{
		gameRooms.release(this);

		for (const stop of this.stopListening)
		{
			stop();
		}

		console.log('Room of group', this.groupId, 'disposing');
		this.chat.close();
		await this.saveChat();
	}

	/**
	 * Writes the chat's new messages to the database, after any write going on, unless the group is no
	 * more. Messages that can't be written are tried again next time
	 *
	 * @return Resolves once they are written, or have failed to be
	 */
	saveChat(): Promise<void>
	{
		if (this.disbanded !== undefined)
		{
			return(Promise.resolve());
		}

		return(this.chat.save());
	}

	/**
	 * The character a client controls
	 *
	 * @param sessionId The client's session ID
	 * @return The character's ID in state.players, or undefined when the client isn't in the room
	 */
	getPlayerId(sessionId: string): string | undefined
	{
		return(this.areaPlayers.getPlayerId(sessionId));
	}

	/**
	 * The area a character is in
	 *
	 * @param characterId The character's ID
	 * @return The area's ID, or undefined when the character isn't in play
	 */
	getAreaId(characterId: string): string | undefined
	{
		return(this.areaPlayers.getAreaId(characterId));
	}

	/**
	 * Puts a player's playable characters who aren't in play into it, each where they were last, or
	 * beside the anchor being when they have never been played in the group
	 *
	 * @param playerId The player's ID
	 */
	private async bringIn(playerId: string): Promise<void>
	{
		const absent = [...this.members.values()].filter((member) => ((member.playerId === playerId) && this.canPlay(member) && !this.areaPlayers.has(member.characterId)));

		for (const member of absent)
		{
			const start = await this.preparedStartOf(member);

			if (!start)
			{
				continue;
			}

			this.areaPlayers.add(member.characterId, this.appearanceOf(member), start.area, start);

			const shown = this.state.members.get(member.characterId);

			if (shown)
			{
				shown.present = true;
			}
		}
	}

	/**
	 * Where a member starts (startOf()), with the chunks around it loaded. Looks again when
	 * where they were last, or the area, changes while the chunks load, as when the area is disabled and
	 * the members in it are sent elsewhere
	 *
	 * @param member The member
	 * @return The area and cell; undefined when the member left, was barred, or their player's windows
	 * all closed, while the area loaded
	 */
	private async preparedStartOf(member: GroupMemberRecord): Promise<{ area: ActiveArea; column: number; row: number } | undefined>
	{
		for (;;)
		{
			const position = member.position;
			const start = await this.startOf(member);

			if (!this.mayBringIn(member))
			{
				return(undefined);
			}

			const area = await this.areaPlayers.prepareStart(start.area, start);

			if (!this.mayBringIn(member))
			{
				return(undefined);
			}

			if (area && (member.position === position))
			{
				return({
					...start,
					area
				});
			}
		}
	}

	/**
	 * Whether a member is still one to put into play
	 *
	 * @param member The member, as bringIn() found them
	 * @return True while they are in the group, may play, and their player has a window here
	 */
	private mayBringIn(member: GroupMemberRecord): boolean
	{
		return((this.members.get(member.characterId) === member) && this.windows.has(member.playerId) && this.canPlay(member));
	}

	/**
	 * Where a member starts: where they were last, then beside the anchor being (where they
	 * are now, or were last), then the group's starting cell of its starting area. An area that is gone or
	 * disabled is passed over, and a cell an area no longer holds since it was made smaller moves inside it
	 *
	 * @param member The member
	 * @return The area and cell
	 */
	private async startOf(member: GroupMemberRecord): Promise<{ area: ActiveArea; column: number; row: number }>
	{
		const anchor = this.members.get(this.anchorId);
		const candidates: (PlayerPosition | null | undefined)[] = [
			member.position,
			this.areaPlayers.getPosition(this.anchorId),
			anchor?.position
		];

		for (const candidate of candidates)
		{
			const area = (candidate ? await this.areas.load(candidate.areaId) : undefined);

			if (candidate && area?.loaded.area.enabled)
			{
				return({
					area,
					...startingCellOn(area.loaded.bounds, candidate)
				});
			}
		}

		const startingArea = await this.loadStartingArea();

		if (!startingArea)
		{
			throw new Error(`The starting area ${this.startingAreaId} of group ${this.groupId} no longer exists`);
		}

		return({
			area: startingArea,
			...startingCellOn(startingArea.loaded.bounds, this.startingCell)
		});
	}

	/**
	 * Loads the group's starting area, switching to the universe's when the group's own is gone
	 * (useUniverseStartingArea())
	 *
	 * @return The area; undefined when neither exists
	 */
	private async loadStartingArea(): Promise<ActiveArea | undefined>
	{
		const startingArea = await this.areas.load(this.startingAreaId);

		if (startingArea)
		{
			return(startingArea);
		}

		await this.useUniverseStartingArea();

		return(this.areas.load(this.startingAreaId));
	}

	/**
	 * Makes the universe's starting area and cell the group's, as they are for a room whose group has no
	 * starting area of its own, for when the group's own has been deleted
	 */
	private async useUniverseStartingArea(): Promise<void>
	{
		const universe = await findUniverse(this.universeId);

		if (universe?.startingAreaId !== undefined)
		{
			this.startingAreaId = universe.startingAreaId;
			this.startingCell = {
				column: universe.startingColumn,
				row: universe.startingRow
			};
		}
	}

	/**
	 * Takes a player's characters out of play, remembering where they were for when they come back
	 *
	 * @param playerId The player's ID
	 * @return Where each one was
	 */
	private takeOut(playerId: string): MemberPosition[]
	{
		const positions: MemberPosition[] = [];

		for (const member of this.members.values())
		{
			const position = ((member.playerId === playerId) ? this.areaPlayers.getPosition(member.characterId) : undefined);

			if (!position)
			{
				continue;
			}

			member.position = position;
			positions.push({ characterId: member.characterId, ...position });
			this.areaPlayers.remove(member.characterId);

			const shown = this.state.members.get(member.characterId);

			if (shown)
			{
				shown.present = false;
			}
		}

		return(positions);
	}

	/**
	 * Marks what each member in play sees as seen by the group, working it out again only for those
	 * who have moved to another cell or whose sight has changed since the last tick, and only for the
	 * cells the group hasn't seen yet. Nothing is recorded in an area without fog of war
	 */
	private explore(): void
	{
		for (const { playerId, area, cell, budget } of this.areaPlayers.sights())
		{
			const areaId = area.loaded.area.id;

			if (!area.loaded.fogOfWar)
			{
				this.lastSights.delete(playerId);
				continue;
			}

			// A tenth of a square, as the light changes around dawn and dusk, makes too little difference to look again
			const key = `${areaId};${cell.column},${cell.row};${Math.floor(budget * 10)}`;

			if (this.lastSights.get(playerId) !== key)
			{
				this.lastSights.set(playerId, key);

				const fresh = this.seen.mark(areaId, visibleCells(cell, budget, area.vision, (column, row) => this.seen.has(areaId, column, row)));

				if (fresh.length > 0)
				{
					this.sendCellsSeen(area, fresh);
				}
			}
		}
	}

	/**
	 * Sends the clients in an area the tiles of cells the group has just seen for the first time, each
	 * client only those in chunks it holds. A cell in a chunk a client hasn't been sent yet, or one the
	 * server hasn't loaded, arrives with its chunk
	 *
	 * @param area The area
	 * @param cells The cells
	 */
	private sendCellsSeen(area: ActiveArea, cells: readonly { column: number; row: number }[]): void
	{
		const areaId = area.loaded.area.id;
		const byClient = new Map<Client, CellValue[]>();

		for (const { column, row } of cells)
		{
			const key = chunkKey(chunkCoordinate(column), chunkCoordinate(row));

			if (!area.loadedChunks.has(key))
			{
				continue;
			}

			const value = (area.chunks.get(key)?.[cellIndexInChunk(column, row)] ?? DEFAULT_TILE_CELL);

			for (const client of this.areaPlayers.clientsSentChunk(areaId, key))
			{
				let values = byClient.get(client);

				if (!values)
				{
					values = [];
					byClient.set(client, values);
				}

				values.push({ column, row, value });
			}
		}

		for (const [client, values] of byClient)
		{
			const revealed = new Set(values.map(({ column, row }) => `${column},${row}`));
			const payload: CellsSeenPayload = {
				areaId,
				cells: values,
				links: toLinkCells(area.loaded, (link) => revealed.has(`${link.column},${link.row}`))
			};

			client.send(GameServerMessageType.CellsSeen, payload, AREA_MESSAGE_OPTIONS);
		}
	}

	/**
	 * Saves the chunks the group has seen more of since the last save, unless the group is no more, after
	 * any save going on. Those that couldn't be saved are tried again next time
	 *
	 * @return Resolves once they are saved, or rejects when they couldn't be
	 */
	private saveSeen(): Promise<void>
	{
		const saving = this.seenSaving.then(async () =>
		{
			if (this.disbanded !== undefined)
			{
				return;
			}

			const changed = this.seen.takeChanged();

			try
			{
				await saveSeenChunks(this.groupId, changed);
			}
			catch (error)
			{
				this.seen.putBack(changed);
				throw error;
			}
		});

		this.seenSaving = saving.catch(() => undefined);

		return(saving);
	}

	/**
	 * How a member shows in their area
	 *
	 * @param member The member, or undefined when they have left the group
	 * @return Their name, darkvision and light sensitivity
	 */
	private appearanceOf(member: GroupMemberRecord | undefined): Appearance
	{
		return({
			name: member?.name ?? '',
			ghost: false,
			...(((member === undefined) ? undefined : this.raceSight.get(member.raceId)) ?? PLAIN_SIGHT)
		});
	}

	/**
	 * Adds a member of the group, not yet in play
	 *
	 * @param member The member
	 */
	private addMember(member: GroupMemberRecord): void
	{
		this.members.set(member.characterId, member);
		this.state.members.set(member.characterId, new GroupMember({
			name: member.name,
			playerId: member.playerId,
			present: false
		}));
	}

	/**
	 * Takes a character out of play, disconnecting the windows controlling them
	 *
	 * @param characterId The character's ID
	 * @param code Why, for the windows
	 */
	private dropCharacter(characterId: string, code: ServerCloseCode): void
	{
		for (const client of this.areaPlayers.getClients(characterId))
		{
			client.leave(code);
		}

		this.areaPlayers.remove(characterId);

		const shown = this.state.members.get(characterId);

		if (shown)
		{
			shown.present = false;
		}
	}

	/**
	 * The members who must be together to take a link that requires the whole group: those who can be
	 * played, and the anchor being whatever happens
	 *
	 * @return Their character IDs
	 */
	private linkMemberIds(): string[]
	{
		return([...this.members.values()]
			.filter((member) => (this.canPlay(member) || (member.characterId === this.anchorId)))
			.map((member) => member.characterId));
	}

	/**
	 * Whether a member can be played: they haven't been given their last rites, and their race and class
	 * don't bar them
	 *
	 * @param member The member
	 * @return True when they can
	 */
	private canPlay(member: GroupMemberRecord): boolean
	{
		return(member.playable && (characterBar(member, this.barred) === null));
	}

	/**
	 * Follows a change to the races and classes barring their characters: members it bars are taken out
	 * of play, where they were saved for when they can play again, and their windows are told why; members
	 * it lets play again are put back into it if their player is here
	 *
	 * @param change What is barred now
	 */
	private applyBarredChange(change: BarredChange): void
	{
		this.barred = change.barred;

		const positions: MemberPosition[] = [];
		const players = new Set<string>();

		for (const member of this.members.values())
		{
			const position = this.areaPlayers.getPosition(member.characterId);

			if (!this.canPlay(member))
			{
				if (position)
				{
					member.position = position;
					positions.push({ characterId: member.characterId, ...position });
				}

				this.dropCharacter(member.characterId, ServerCloseCode.CharacterBarred);
			}
			else if (!position && this.windows.has(member.playerId))
			{
				players.add(member.playerId);
			}
		}

		if (positions.length > 0)
		{
			saveMemberPositions(this.groupId, positions).catch((error: unknown) =>
			{
				console.error('Could not save where the barred characters of group', this.groupId, 'were', error);
			});
		}

		for (const playerId of players)
		{
			this.bringIn(playerId).catch((error: unknown) =>
			{
				console.error('Could not bring the characters of player', playerId, 'back into group', this.groupId, error);
			});
		}
	}

	/**
	 * Sends the members in an area that has been disabled elsewhere: those in play travel there, and
	 * those out of it are put there for when they are next played
	 *
	 * @param areaId The disabled area
	 * @param destination Where they go, or null for the group's starting area
	 */
	private async evacuate(areaId: string, destination: AreaPlace | null): Promise<void>
	{
		const startingArea = (destination ? undefined : await this.loadStartingArea());
		const target = (destination ?? (startingArea
			? {
				areaId: startingArea.loaded.area.id,
				...startingCellOn(startingArea.loaded.bounds, this.startingCell)
			}
			: undefined));

		if (!target)
		{
			return;
		}

		this.areaPlayers.evacuate(areaId, target);

		for (const member of this.members.values())
		{
			if ((member.position?.areaId === areaId) && !this.areaPlayers.has(member.characterId))
			{
				member.position = { ...target };
			}
		}
	}

	/**
	 * Follows a change to who is in a group, if it is this one: a character who joins is put into play
	 * if their player is here, one who leaves is taken out of it, and when the group is disbanded everyone
	 * is disconnected
	 *
	 * @param change The change
	 */
	private applyGroupChange(change: GroupChange): void
	{
		if (change.groupId !== this.groupId)
		{
			return;
		}

		if (change.kind === 'disbanded')
		{
			const code = ((change.groupSizeLowered === true) ? ServerCloseCode.GroupSizeLowered : ServerCloseCode.GroupDisbanded);

			this.disbanded = code;

			for (const client of this.clients)
			{
				client.leave(code);
			}

			return;
		}

		if (change.kind === 'left')
		{
			const { characterId } = change.character;

			this.dropCharacter(characterId, ((change.groupSizeLowered === true) ? ServerCloseCode.GroupSizeLowered : ServerCloseCode.LeftGroup));
			this.members.delete(characterId);
			this.state.members.delete(characterId);
			return;
		}

		if (this.members.has(change.character.characterId))
		{
			return;
		}

		this.addMember({
			...change.character,
			position: null
		});

		if (this.windows.has(change.character.playerId))
		{
			this.bringIn(change.character.playerId).catch((error: unknown) =>
			{
				console.error('Could not bring character', change.character.characterId, 'into group', this.groupId, error);
			});
		}
	}

	/**
	 * Follows a change to a member: one given their last rites can't be played, so they are taken out
	 * of play, and one restored is put back into it if their player is here
	 *
	 * @param change The change
	 */
	private applyCharacterChange(change: CharacterChange): void
	{
		const characterId = ((change.kind === 'removed') ? change.characterId : change.character.id);
		const member = this.members.get(characterId);

		if (!member)
		{
			return;
		}

		if (change.kind === 'removed')
		{
			member.playable = false;
			this.dropCharacter(characterId, ServerCloseCode.LeftGroup);
			return;
		}

		member.playable = true;

		if (this.windows.has(member.playerId) && this.canPlay(member))
		{
			this.bringIn(member.playerId).catch((error: unknown) =>
			{
				console.error('Could not bring character', characterId, 'back into group', this.groupId, error);
			});
		}
	}

	/**
	 * Looks a joining window up: its session, and whether its player may open their groups in the
	 * universe
	 *
	 * @param cookieHeader The connection's Cookie header
	 * @return What it found
	 */
	private async lookUp(cookieHeader: string | null): Promise<GameLookup>
	{
		const session = await resolveSession(cookieHeader);

		return({
			session,
			refusal: (session ? await findViewRefusal(this.universeId, session.playerId) : undefined)
		});
	}

	/**
	 * Looks a joining window up again when a change it may have missed was published while onAuth looked
	 * it up (JoinChanges), and turns it away, with the code the room's listeners would have turned it away
	 * with, when its session has ended or its player may no longer open their groups in the universe
	 *
	 * @param client The joining client, already among the room's clients
	 * @return Resolves once the window may stay
	 */
	private async recheckJoining(client: GameClient): Promise<void>
	{
		const rechecked = await this.joinChanges.recheck(client);

		if (!rechecked)
		{
			return;
		}

		const { found, missed } = rechecked;

		if (!found.session)
		{
			throw new ServerError(ServerCloseCode.LoggedOut, 'The window\'s session ended while it joined');
		}

		if (found.refusal !== undefined)
		{
			throw new ServerError(entryRefusalCode(found.refusal, missed.has('stage')), 'The window\'s player may no longer open their groups in the universe');
		}
	}

	/**
	 * Turns away the windows of sessions that ended
	 *
	 * @param sessionIds The sessions that ended
	 */
	private turnAwaySessions(sessionIds: ReadonlySet<string>): void
	{
		for (const client of this.clients)
		{
			if (sessionIds.has(identityOf(client).sessionId))
			{
				client.leave(ServerCloseCode.LoggedOut);
			}
		}
	}

	/**
	 * Turns away the windows of players who may no longer play the universe
	 *
	 * @param playerIds The players
	 */
	private turnAwayPlayers(playerIds: ReadonlySet<string>): void
	{
		for (const client of this.clients)
		{
			if (playerIds.has(identityOf(client).playerId))
			{
				client.leave(ServerCloseCode.AccessLost);
			}
		}
	}

	/**
	 * Follows the universe's new stage: at the end of time the room locks and every character stops,
	 * and in any other stage it unlocks. Windows of players the stage doesn't let look at the universe
	 * are turned away
	 *
	 * @param change The new stage, and every editor's role
	 */
	private applyStageChange(change: StageChange): void
	{
		this.state.locked = (change.stage === 'end_of_time');
		this.areaPlayers.setLocked(this.state.locked);

		for (const client of this.clients)
		{
			if (!canViewUniverse(change.stage, change.roles.get(identityOf(client).playerId)))
			{
				client.leave(ServerCloseCode.StageChanged);
			}
		}
	}

	/**
	 * Tells windows that something their player asked for didn't happen
	 *
	 * @param clients The windows
	 * @param reason Why
	 */
	private sendNotice(clients: Client[], reason: NoticeReason): void
	{
		const notice: NoticePayload = { reason };

		for (const client of clients)
		{
			client.send(GameServerMessageType.Notice, notice);
		}
	}
}
