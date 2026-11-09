import { Room, ServerError, type AuthContext, type Client, type CloseCode } from 'colyseus';
import { canPlayUniverse, characterBar, LobbyMember, LobbyMessageType, LobbyServerMessageType, LobbyState, MessageType, NOTHING_BARRED, NoticeReason, PATCH_INTERVAL_MS, PLAIN_SIGHT, ServerCloseCode, ServerMessageType, type BarredOptions, type ChatAuthorDeletedPayload, type ChatHistoryPayload, type ChatMessage, type NoticePayload, type PlayingAsPayload, type Sight } from '@multiverse-kiln/shared';

import { resolveSession, type SessionIdentity } from '../auth/sessions.js';
import { loadBarredOptions } from '../db/barredOptions.js';
import { listPlayableCharacters, markCharacterPlayed, type PlayableCharacter } from '../db/characterRepo.js';
import { loadRaceSight } from '../db/raceRepo.js';
import { findUniverse } from '../db/universeRepo.js';
import { loadChunksAt, loadArea } from '../db/areaRepo.js';
import type { Cell } from '../logic/movement.js';
import { accountDeletions } from '../players/accountDeletions.js';
import { connectedSessions } from '../players/connectedSessions.js';
import { characterChanges, type CharacterChange } from '../players/characterChanges.js';
import { groupChanges, type GroupChange } from '../players/groupChanges.js';
import { universeAccessChanges, type BarredChange, type StageChange } from '../players/universeAccess.js';
import { areaChanges } from '../world/areaChanges.js';
import { areaOccupants } from '../world/areaOccupants.js';
import { InvalidMessages } from './invalidMessages.js';
import { JoinChanges } from './joinChanges.js';
import { OneRoomPerKey } from './oneRoomPerKey.js';
import { entryRefusalCode, findPlayRefusal, type EntryRefusal } from './universePlay.js';
import { chatPayload, chooseCharacterPayload, describeInvalidPayload, movePayload, roomOptions } from './payloads.js';
import { tryTakeChatMessage } from './rateLimiter.js';
import { AreaCache, type ActiveArea } from './areaCache.js';
import { CHUNK_REFRESH_INTERVAL_MS, SIMULATION_TICK_RATE, AreaPlayers, type Appearance } from './areaPlayers.js';

/**
 * What onAuth found out about a client, available afterward as client.auth
 */
interface LobbyIdentity
{
	/**
	 * The login session the client connected with
	 */
	sessionId: string;

	playerId: string;
	name: string;
}

type LobbyClient = Client<{ auth: LobbyIdentity }>;

/**
 * What a joining window found out about itself: its session, and whether its player may play the
 * universe
 */
interface LobbyLookup
{
	/**
	 * Undefined when the window's browser isn't logged in
	 */
	session: SessionIdentity | undefined;

	/**
	 * Why the player may not play the universe; undefined when they may, or there is no session
	 */
	refusal: EntryRefusal | undefined;
}

/**
 * The changes to who may play the universe that a joining window may miss (JoinChanges): sessions
 * ending, the universe being deleted or disabled, players losing their role, and its stage changing
 */
type LobbyJoinChange = 'session' | 'universe' | 'access' | 'stage';

/**
 * Who a lobby client is
 *
 * @param client A client that has passed onAuth
 * @return Its identity
 */
function identityOf(client: LobbyClient): LobbyIdentity
{
	if (!client.auth)
	{
		throw new Error(`Lobby client ${client.sessionId} has no identity`);
	}

	return(client.auth);
}

/**
 * Chat messages kept for players who join later
 */
export const CHAT_HISTORY_LENGTH = 50;

/**
 * The open lobby of each universe, by universe ID
 */
const lobbyRooms = new OneRoomPerKey<LobbyRoom>('universe');

/**
 * A universe's lobby: its area, its chat and who's here
 *
 * Clients join with the universe's ID (LobbyJoinOptions), and every client asking for the same universe
 * joins the same room (filterBy in app.config.ts). A second lobby for a universe that has one is
 * refused (lobbyRooms), since it would split the universe's players and chat between them. Only
 * logged-in browsers are admitted, and a window whose session ends is turned away
 * (ServerCloseCode.LoggedOut). A window that joins while its session
 * ends, or while who may play the universe changes, looks itself up again once it is listed
 * (JoinChanges), so the change reaches it too. Players start
 * in the universe's lobby area and can walk through its links into other areas (see AreaPlayers)
 *
 * Each player plays one of their characters in the universe who isn't in a group (those play in their
 * group's room), and can switch between them, passing over those whose race or class bars them
 * (characterBar()). A player with no such character is a ghost: nobody else sees them, they hold no
 * cell, and they can read the chat but not send to it. Groups are made through the group routes
 * (http/groups.ts)
 */
export class LobbyRoom extends Room<{ state: LobbyState; client: LobbyClient }>
{
	// Colyseus allows unlimited messages by default. A client over the limit is disconnected; clients send
	// Move only when their direction changes, so an honest client stays far below it
	maxMessagesPerSecond = 30;

	patchRate = PATCH_INTERVAL_MS;

	state = new LobbyState();

	private readonly areas = new AreaCache(loadArea, loadChunksAt);

	/**
	 * Players whose area is deleted go back to the lobby area. Each player sees only what they see
	 * themselves, and the lobby has no clock
	 */
	private readonly areaPlayers = new AreaPlayers(this.state.players, this.areas, () => this.lobbyAreaId, {
		shared: false,
		clockSeconds: () => 0
	});

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

	private universeId!: string;

	/**
	 * The area players walk around in, while the lobby has one; the lobby has an area to walk around
	 * only while it is also enabled (state.hasArea)
	 */
	private lobbyAreaId: string | undefined;

	/**
	 * The cell of the lobby's area players start nearest
	 */
	private lobbyCell: Cell = { column: 0, row: 0 };

	private stopFollowingChanges?: () => void;

	private stopFollowingCharacters?: () => void;

	private stopFollowingGroups?: () => void;

	private stopFollowingSessions?: () => void;

	private stopFollowingAccess?: () => void;

	private stopFollowingStage?: () => void;

	private stopFollowingBarred?: () => void;

	private stopFollowingDeletions?: () => void;

	private stopListingOccupants?: () => void;

	/**
	 * The most recent chat messages, oldest first (server-only, not synced)
	 */
	private chatHistory: ChatMessage[] = [];

	private readonly joinChanges = new JoinChanges<LobbyJoinChange, LobbyLookup>();

	/**
	 * Each player's characters in the universe, read again whenever one of their windows joins
	 */
	private readonly characters = new Map<string, PlayableCharacter[]>();

	/**
	 * The character each player is playing; a player with none is a ghost
	 */
	private readonly playing = new Map<string, PlayableCharacter>();

	private readonly invalidMessages = new InvalidMessages();

	messages = {
		[MessageType.Move]: (client: LobbyClient, payload: unknown) =>
		{
			const result = movePayload.safeParse(payload);

			if (!result.success)
			{
				this.invalidMessages.reject(client, MessageType.Move, describeInvalidPayload(result.error));
				return;
			}

			// Without an area, nobody has anywhere to walk
			if (this.state.hasArea)
			{
				this.areaPlayers.queueMove(client.sessionId, result.data);
			}
		},

		[MessageType.TakeLink]: (client: LobbyClient) =>
		{
			if (this.state.hasArea)
			{
				this.areaPlayers.takeLink(client.sessionId);
			}
		},

		[LobbyMessageType.Chat]: (client: LobbyClient, payload: unknown) =>
		{
			const result = chatPayload.safeParse(payload);

			if (!result.success)
			{
				this.invalidMessages.reject(client, LobbyMessageType.Chat, describeInvalidPayload(result.error));
				return;
			}

			const { playerId } = identityOf(client);
			const character = this.playing.get(playerId);

			// Ghosts can read the chat but not send to it; their windows don't offer it
			if (!character)
			{
				return;
			}

			if (!tryTakeChatMessage(`lobby ${this.universeId}`, playerId))
			{
				this.sendNotice(client, NoticeReason.ChatTooFast);
				return;
			}

			const message: ChatMessage = {
				playerId,
				name: character.name,
				text: result.data.text,
				sentAt: Date.now()
			};

			this.chatHistory = [...this.chatHistory, message].slice(-CHAT_HISTORY_LENGTH);
			this.broadcast(LobbyServerMessageType.Chat, message);
		},

		[LobbyMessageType.ChooseCharacter]: (client: LobbyClient, payload: unknown) =>
		{
			const result = chooseCharacterPayload.safeParse(payload);

			if (!result.success)
			{
				this.invalidMessages.reject(client, LobbyMessageType.ChooseCharacter, describeInvalidPayload(result.error));
				return;
			}

			const { playerId } = identityOf(client);
			const character = this.characters.get(playerId)?.find((each) => (each.id === result.data.characterId));

			if (character && !this.isChoosable(character))
			{
				this.sendNotice(client, NoticeReason.CharacterBarred);
			}
			else if (character && (this.playing.get(playerId)?.id !== character.id))
			{
				this.play(playerId, character);
			}
		}
	};

	/**
	 * Loads the universe's lobby area, when it has an enabled one, starts the simulation loop and the
	 * loading of chunks near players, and starts following changes to the world. Fails for a universe
	 * that doesn't exist, which turns away the client asking for it
	 *
	 * @param options The universe, from the first client's LobbyJoinOptions
	 */
	async onCreate(options: unknown): Promise<void>
	{
		const { universeId } = roomOptions.parse(options);

		lobbyRooms.claim(universeId, this);

		const universe = await findUniverse(universeId);

		if (!universe)
		{
			throw new Error(`Universe ${universeId} has no lobby to join`);
		}

		this.universeId = universeId;
		this.lobbyAreaId = universe.lobbyAreaId;
		this.lobbyCell = {
			column: universe.lobbyColumn,
			row: universe.lobbyRow
		};
		this.state.hasArea = ((await this.lobbyArea()) !== undefined);
		this.raceSight = await loadRaceSight(universeId, universe.ruleset);
		this.barred = await loadBarredOptions(universeId);
		this.setTimestep((deltaTime) => this.areaPlayers.update(deltaTime / 1000), 1000 / SIMULATION_TICK_RATE);
		this.clock.setInterval(() => this.areaPlayers.refreshChunks(), CHUNK_REFRESH_INTERVAL_MS);

		this.stopFollowingChanges = areaChanges.onChange((change) =>
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

			if ((change.kind === 'lobby') && (change.universeId === this.universeId))
			{
				this.refreshLobby().catch((error: unknown) =>
				{
					console.error('Could not move the lobby of universe', this.universeId, error);
				});
				return;
			}

			// Players in the lobby start in its area, at its starting cell. Without a lobby area, nobody is in an area
			if (change.kind === 'evacuated')
			{
				const destination = (change.destination ?? ((this.lobbyAreaId === undefined) ? undefined : { areaId: this.lobbyAreaId, ...this.lobbyCell }));

				if (destination)
				{
					this.areaPlayers.evacuate(change.areaId, destination);
				}

				return;
			}

			this.areaPlayers.applyChange(change)
				.then(() => (((change.kind === 'area') && (change.areaId === this.lobbyAreaId)) ? this.loadLobbyArea(false) : undefined))
				.catch((error: unknown) =>
				{
					console.error('Could not apply a world change to the lobby of universe', this.universeId, error);
				});
		});

		this.stopListingOccupants = areaOccupants.register(universeId, () => [...this.playing].flatMap(([playerId, character]) =>
		{
			const areaId = this.areaPlayers.getAreaId(playerId);

			return(((areaId === undefined) ? [] : [{ characterId: character.id, areaId }]));
		}));

		this.stopFollowingBarred = universeAccessChanges.onBarredChanged((change) =>
		{
			if (change.universeId === this.universeId)
			{
				this.applyBarredChange(change);
			}
		});

		this.stopFollowingCharacters = characterChanges.onChange((change) =>
		{
			this.applyCharacterChange(change);
		});

		this.stopFollowingGroups = groupChanges.onChange((change) =>
		{
			this.applyGroupChange(change);
		});

		this.stopFollowingSessions = connectedSessions.onEnd((sessionIds) =>
		{
			this.joinChanges.note('session');
			this.turnAwaySessions(sessionIds);
		});

		this.stopFollowingDeletions = accountDeletions.onDeleted((playerId) =>
		{
			this.forgetChatAuthor(playerId);
		});

		this.stopFollowingAccess = universeAccessChanges.onLost((change) =>
		{
			if (change.universeId === this.universeId)
			{
				this.joinChanges.note('access');
				this.turnAwayPlayers(change.playerIds);
			}
		});

		this.stopFollowingStage = universeAccessChanges.onStageChanged((change) =>
		{
			if (change.universeId === this.universeId)
			{
				this.joinChanges.note('stage');
				this.applyStageChange(change);
			}
		});
	}

	/**
	 * Stops following changes to the world, to players' characters, to groups, to sessions, to who may
	 * play, to the universe's stage and to what bars characters, and stops listing its characters' areas
	 */
	onDispose(): void
	{
		lobbyRooms.release(this);
		this.stopFollowingChanges?.();
		this.stopFollowingCharacters?.();
		this.stopFollowingGroups?.();
		this.stopFollowingSessions?.();
		this.stopFollowingAccess?.();
		this.stopFollowingStage?.();
		this.stopFollowingBarred?.();
		this.stopFollowingDeletions?.();
		this.stopListingOccupants?.();
	}

	/**
	 * Takes the name off the chat messages a player sent, once their account is deleted, and tells the
	 * windows to
	 *
	 * @param playerId The player's ID
	 */
	private forgetChatAuthor(playerId: string): void
	{
		if (!this.chatHistory.some((message) => (message.playerId === playerId)))
		{
			return;
		}

		const deleted: ChatAuthorDeletedPayload = { playerId };

		this.chatHistory = this.chatHistory.map((message) => ((message.playerId === playerId)
			? {
				...message,
				playerId: null,
				name: ''
			}
			: message));
		this.broadcast(LobbyServerMessageType.ChatAuthorDeleted, deleted);
	}

	/**
	 * Admits only clients whose browser is logged in as a player who may play the universe
	 *
	 * @param client The joining client
	 * @param _options Join options from the client (already used to pick this room)
	 * @param context The connection's request headers, which carry the session cookie
	 * @return The client's identity, stored as client.auth; false to turn the client away
	 */
	async onAuth(client: Client, _options: unknown, context: AuthContext): Promise<LobbyIdentity | false>
	{
		const cookieHeader = context.headers.get('cookie');

		this.joinChanges.startLookup(client, () => this.lookUp(cookieHeader));

		const { session, refusal } = await this.lookUp(cookieHeader);

		if (!session || (refusal !== undefined))
		{
			return(false);
		}

		return({
			sessionId: session.sessionId,
			playerId: session.playerId,
			name: session.name
		});
	}

	/**
	 * Reads the joining client's player's characters, and puts a player new to the room in the lobby
	 * area, while the lobby has an area, as the character they played or made most recently (a ghost when
	 * they have none). A player
	 * already here keeps their character, unless they were a ghost and have since made one. Then sends
	 * the client who it is playing and the recent chat. A window that may have missed a change while it
	 * joined looks itself up again first (recheckJoining())
	 *
	 * @param client The joining client
	 */
	async onJoin(client: LobbyClient): Promise<void>
	{
		await this.recheckJoining(client);

		const { playerId } = identityOf(client);
		const characters = await listPlayableCharacters(playerId, this.universeId);
		const lobbyStart = (this.state.hasArea ? await this.lobbyStart() : undefined);

		this.characters.set(playerId, characters);

		const isNewPlayer = (this.areaPlayers.getClients(playerId).length === 0);
		const choosable = characters.find((each) => this.isChoosable(each));
		const character = (isNewPlayer ? choosable : undefined);

		// The lobby's area may have been taken away while it loaded
		const startArea = (this.state.hasArea ? lobbyStart : undefined);

		this.areaPlayers.join(client, playerId, this.appearanceOf(character), startArea, this.lobbyCell);

		if (character)
		{
			this.playing.set(playerId, character);
			this.state.members.set(playerId, new LobbyMember({ name: character.name }));
		}
		else if (!isNewPlayer && !this.playing.has(playerId) && choosable)
		{
			this.play(playerId, choosable);
		}

		const playingAs: PlayingAsPayload = { characterId: this.playing.get(playerId)?.id ?? null };
		const history: ChatHistoryPayload = { messages: this.chatHistory };

		client.send(LobbyServerMessageType.PlayingAs, playingAs);
		client.send(LobbyServerMessageType.ChatHistory, history);
		connectedSessions.connect(client, identityOf(client).sessionId);
	}

	/**
	 * Stops the client's player, and removes the player once their last client has left, recording
	 * that they last played the character they were playing
	 *
	 * @param client The leaving client
	 * @param code WebSocket close code
	 */
	async onLeave(client: LobbyClient, code: CloseCode): Promise<void>
	{
		const left = this.areaPlayers.leave(client);

		connectedSessions.disconnect(client);

		this.invalidMessages.forget(client.sessionId);
		console.log(client.sessionId, 'left the lobby of universe', this.universeId, code);

		if (!left?.wasLastClient)
		{
			return;
		}

		const character = this.playing.get(left.playerId);

		this.areaPlayers.remove(left.playerId);
		this.state.members.delete(left.playerId);
		this.characters.delete(left.playerId);
		this.playing.delete(left.playerId);

		if (character)
		{
			try
			{
				await markCharacterPlayed(character.id, new Date());
			}
			catch (error)
			{
				console.error('Could not record that character', character.id, 'was played:', error);
			}
		}
	}

	/**
	 * The player a client controls
	 *
	 * @param sessionId The client's session ID
	 * @return The player's ID in state.players, or undefined when the client isn't in the room
	 */
	getPlayerId(sessionId: string): string | undefined
	{
		return(this.areaPlayers.getPlayerId(sessionId));
	}

	/**
	 * The area a player is in
	 *
	 * @param playerId The player's ID
	 * @return The area's ID, or undefined when the player isn't in the room
	 */
	getAreaId(playerId: string): string | undefined
	{
		return(this.areaPlayers.getAreaId(playerId));
	}

	/**
	 * Makes a player in the room play one of their characters, in every window of theirs
	 *
	 * @param playerId The player's ID
	 * @param character The character
	 */
	private play(playerId: string, character: PlayableCharacter): void
	{
		const playingAs: PlayingAsPayload = { characterId: character.id };

		this.playing.set(playerId, character);
		this.areaPlayers.setAppearance(playerId, this.appearanceOf(character));
		this.state.members.set(playerId, new LobbyMember({ name: character.name }));

		for (const client of this.areaPlayers.getClients(playerId))
		{
			client.send(LobbyServerMessageType.PlayingAs, playingAs);
		}
	}

	/**
	 * Makes a player in the room a ghost, in every window of theirs
	 *
	 * @param playerId The player's ID
	 */
	private becomeGhost(playerId: string): void
	{
		const playingAs: PlayingAsPayload = { characterId: null };

		this.playing.delete(playerId);
		this.areaPlayers.setAppearance(playerId, this.appearanceOf(undefined));
		this.state.members.delete(playerId);

		for (const client of this.areaPlayers.getClients(playerId))
		{
			client.send(LobbyServerMessageType.PlayingAs, playingAs);
		}
	}

	/**
	 * Follows a change to a player in the room's characters, then has their windows list them again. A
	 * player whose character can no longer be played switches to the one they played or made most
	 * recently, or becomes a ghost; a ghost plays a character restored, unless the character is in a group
	 *
	 * @param change The change
	 */
	private applyCharacterChange(change: CharacterChange): void
	{
		if ((change.universeId !== this.universeId) || !this.characters.has(change.playerId))
		{
			return;
		}

		if (change.kind === 'removed')
		{
			this.withdraw(change.playerId, change.characterId);
		}
		else if (!change.inGroup)
		{
			this.offer(change.playerId, change.character);
		}

		this.sendCharactersChanged(change.playerId);
	}

	/**
	 * Follows a character joining or leaving a group, for players in the room: a character who joins a
	 * group plays there, so they can't be played here, and one who leaves it (or whose group is
	 * disbanded) can again. Then each player affected has their windows list their characters again
	 *
	 * @param change The change
	 */
	private applyGroupChange(change: GroupChange): void
	{
		if (change.universeId !== this.universeId)
		{
			return;
		}

		const affected = ((change.kind === 'disbanded') ? change.members : [change.character]);
		const players = new Set<string>();

		for (const { characterId, playerId, name, raceId, classId, playable } of affected)
		{
			if (!this.characters.has(playerId))
			{
				continue;
			}

			if (change.kind === 'joined')
			{
				this.withdraw(playerId, characterId);
			}
			else if (playable)
			{
				this.offer(playerId, { id: characterId, name, raceId, classId });
			}

			players.add(playerId);
		}

		for (const playerId of players)
		{
			this.sendCharactersChanged(playerId);
		}
	}

	/**
	 * Stops a player in the room from playing one of their characters here. If they were playing them,
	 * they switch to the one they played or made most recently, or become a ghost
	 *
	 * @param playerId The player's ID
	 * @param characterId The character's ID
	 */
	private withdraw(playerId: string, characterId: string): void
	{
		const remaining = (this.characters.get(playerId) ?? []).filter((character) => (character.id !== characterId));

		this.characters.set(playerId, remaining);

		if (this.playing.get(playerId)?.id === characterId)
		{
			this.playNext(playerId);
		}
	}

	/**
	 * Makes a player in the room play the character they played or made most recently who can be played
	 * here, or a ghost when none can
	 *
	 * @param playerId The player's ID
	 */
	private playNext(playerId: string): void
	{
		const next = (this.characters.get(playerId) ?? []).find((character) => this.isChoosable(character));

		if (next)
		{
			this.play(playerId, next);
		}
		else
		{
			this.becomeGhost(playerId);
		}
	}

	/**
	 * Lets a player in the room play one of their characters here, playing them immediately if the
	 * player is a ghost and the character's race and class don't bar them
	 *
	 * @param playerId The player's ID
	 * @param character The character
	 */
	private offer(playerId: string, character: PlayableCharacter): void
	{
		const characters = (this.characters.get(playerId) ?? []);

		if (!characters.some((each) => (each.id === character.id)))
		{
			this.characters.set(playerId, [character, ...characters]);
		}

		if (!this.playing.has(playerId) && this.isChoosable(character))
		{
			this.play(playerId, character);
		}
	}

	/**
	 * Whether a character's race and class let them play
	 *
	 * @param character The character
	 * @return True when nothing bars them
	 */
	private isChoosable(character: PlayableCharacter): boolean
	{
		return(characterBar(character, this.barred) === null);
	}

	/**
	 * Follows a change to the races and classes barring their characters: a player playing a character
	 * it bars switches to another, or becomes a ghost, and their windows are told why; a ghost plays a
	 * character it lets play again. Every player in the room has their windows list their characters
	 * again, which shows who is barred
	 *
	 * @param change What is barred now
	 */
	private applyBarredChange(change: BarredChange): void
	{
		this.barred = change.barred;

		for (const playerId of this.characters.keys())
		{
			const playing = this.playing.get(playerId);

			if (playing && !this.isChoosable(playing))
			{
				const notice: NoticePayload = { reason: NoticeReason.CharacterBarred };

				this.playNext(playerId);

				for (const client of this.areaPlayers.getClients(playerId))
				{
					client.send(LobbyServerMessageType.Notice, notice);
				}
			}
			else if (!playing)
			{
				this.playNext(playerId);
			}

			this.sendCharactersChanged(playerId);
		}
	}

	/**
	 * How a player shows in the lobby's area
	 *
	 * @param character The character they are playing, or undefined for a ghost
	 * @return The character's name, darkvision and light sensitivity, or a ghost with no name
	 */
	private appearanceOf(character: PlayableCharacter | undefined): Appearance
	{
		return({
			name: character?.name ?? '',
			ghost: !character,
			...(((character === undefined) ? undefined : this.raceSight.get(character.raceId)) ?? PLAIN_SIGHT)
		});
	}

	/**
	 * The lobby's area, while the universe has one and it is enabled
	 *
	 * @return The area, loaded, or undefined when the lobby has no area
	 */
	private async lobbyArea(): Promise<ActiveArea | undefined>
	{
		const area = ((this.lobbyAreaId === undefined) ? undefined : await this.areas.load(this.lobbyAreaId));

		return((area?.loaded.area.enabled ?? false) ? area : undefined);
	}

	/**
	 * The lobby's area with the chunks around its starting cell loaded, to place players on. Looks again
	 * when the lobby moves to another area or cell, or its area is changed, while the chunks load, so
	 * nobody is placed on an area the lobby has left or that has been disabled
	 *
	 * @return The area, or undefined when the lobby has no area
	 */
	private async lobbyStart(): Promise<ActiveArea | undefined>
	{
		for (;;)
		{
			const cell = this.lobbyCell;
			const area = await this.lobbyArea();

			if (!area)
			{
				return(undefined);
			}

			const prepared = await this.areaPlayers.prepareStart(area, cell);

			if (prepared && (prepared.loaded.area.id === this.lobbyAreaId) && (this.lobbyCell === cell))
			{
				return(prepared);
			}
		}
	}

	/**
	 * Reads the universe's lobby area and starting cell again, after an editor changed them, and puts
	 * the lobby's players in its new area, or takes the area away
	 */
	private async refreshLobby(): Promise<void>
	{
		const universe = await findUniverse(this.universeId);

		if (!universe)
		{
			return;
		}

		const moved = (universe.lobbyAreaId !== this.lobbyAreaId);

		this.lobbyAreaId = universe.lobbyAreaId;
		this.lobbyCell = {
			column: universe.lobbyColumn,
			row: universe.lobbyRow
		};
		await this.loadLobbyArea(moved);
	}

	/**
	 * Gives the lobby its area or takes it away, as its area is set and enabled or not. Every player is
	 * put on the lobby's starting cell when the area appears, or moves to another area; a starting cell
	 * changed within the same area is only for players who join later
	 *
	 * @param moved Whether the lobby has just moved to another area
	 */
	private async loadLobbyArea(moved: boolean): Promise<void>
	{
		const area = await this.lobbyArea();

		if (area && this.state.hasArea && !moved)
		{
			return;
		}

		const start = (area ? await this.lobbyStart() : undefined);

		if (!start)
		{
			if (this.state.hasArea)
			{
				this.areaPlayers.clearArea();
				this.state.hasArea = false;
			}

			return;
		}

		this.areaPlayers.placeAll(start, this.lobbyCell, (playerId) => this.appearanceOf(this.playing.get(playerId)));
		this.state.hasArea = true;
	}

	/**
	 * Has a player's windows list their characters again
	 *
	 * @param playerId The player's ID
	 */
	private sendCharactersChanged(playerId: string): void
	{
		for (const client of this.areaPlayers.getClients(playerId))
		{
			client.send(LobbyServerMessageType.CharactersChanged);
		}
	}

	/**
	 * Looks a joining window up: its session, and whether its player may play the universe
	 *
	 * @param cookieHeader The connection's Cookie header
	 * @return What it found
	 */
	private async lookUp(cookieHeader: string | null): Promise<LobbyLookup>
	{
		const session = await resolveSession(cookieHeader);

		return({
			session,
			refusal: (session ? await findPlayRefusal(this.universeId, session.playerId) : undefined)
		});
	}

	/**
	 * Looks a joining window up again when a change it may have missed was published while onAuth looked
	 * it up (JoinChanges), and turns it away, with the code the room's listeners would have turned it away
	 * with, when its session has ended or its player may no longer play the universe
	 *
	 * @param client The joining client, already among the room's clients
	 * @return Resolves once the window may stay
	 */
	private async recheckJoining(client: LobbyClient): Promise<void>
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
			throw new ServerError(entryRefusalCode(found.refusal, missed.has('stage')), 'The window\'s player may no longer play the universe');
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
	 * Turns away the windows of players the universe's new stage doesn't let play it: everyone at the
	 * end of time, when the lobby is locked
	 *
	 * @param change The new stage, and every editor's role
	 */
	private applyStageChange(change: StageChange): void
	{
		for (const client of this.clients)
		{
			if (change.stage === 'end_of_time')
			{
				client.leave(ServerCloseCode.UniverseLocked);
			}
			else if (!canPlayUniverse(change.stage, change.roles.get(identityOf(client).playerId)))
			{
				client.leave(ServerCloseCode.StageChanged);
			}
		}
	}

	/**
	 * Tells a window that something its player asked for didn't happen
	 *
	 * @param client The window
	 * @param reason Why
	 */
	private sendNotice(client: LobbyClient, reason: NoticeReason): void
	{
		const notice: NoticePayload = { reason };

		client.send(LobbyServerMessageType.Notice, notice);
	}
}
