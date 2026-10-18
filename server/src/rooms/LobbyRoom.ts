import { matchMaker, Room, type AuthContext, type Client, type CloseCode, type IRoomCache } from 'colyseus';
import { GAME_ROOM_NAME, LobbyMember, LobbyMessageType, LobbyServerMessageType, LobbyState, MessageType, NoticeReason, PATCH_INTERVAL_MS, type ChatHistoryPayload, type ChatMessage, type LobbyJoinOptions, type NoticePayload, type PlayingAsPayload } from '@multiverse-kiln/shared';

import { listPlayableCharacters, markCharacterPlayed, type PlayableCharacter } from '../db/characterRepo.js';
import { findUniverse } from '../db/universeRepo.js';
import { loadChunksAt, loadZone } from '../db/zoneRepo.js';
import { readBrowserId } from '../http/browserId.js';
import { onlinePlayers } from '../players/onlinePlayers.js';
import { zoneChanges } from '../world/zoneChanges.js';
import { InvalidMessages } from './invalidMessages.js';
import { chatPayload, chooseCharacterPayload, describeInvalidPayload, movePayload, roomOptions } from './payloads.js';
import { RateLimiter } from './rateLimiter.js';
import { ZoneCache } from './zoneCache.js';
import { CHUNK_REFRESH_INTERVAL_MS, SIMULATION_TICK_RATE, ZonePlayers, type Appearance } from './zonePlayers.js';

/**
 * What onAuth found out about a client, available afterward as client.auth
 */
interface LobbyIdentity
{
	browserId: string;
	playerId: string;
	name: string;
}

type LobbyClient = Client<{ auth: LobbyIdentity }>;

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
 * How a player shows on the lobby's map
 *
 * @param character The character they are playing, or undefined for a ghost
 * @return The character's name, or a ghost with no name
 */
function appearanceOf(character: PlayableCharacter | undefined): Appearance
{
	return({
		name: character?.name ?? '',
		ghost: !character
	});
}

/**
 * Chat messages kept for players who join later
 */
export const CHAT_HISTORY_LENGTH = 50;

/**
 * Most chat messages a player may send in CHAT_RATE_WINDOW_MS; more are dropped
 */
const CHAT_RATE_LIMIT = 5;

const CHAT_RATE_WINDOW_MS = 5000;

/**
 * A universe's lobby: its map, its chat, who's here, and creating groups
 *
 * Clients join with the universe's ID (LobbyJoinOptions), and every client asking for the same universe
 * joins the same room (filterBy in app.config.ts). Only logged-in browsers are admitted. Players start
 * in the universe's lobby zone and can walk through its links into other zones (see ZonePlayers)
 *
 * Each player plays one of their characters in the universe, and can switch between them. A player
 * with no character is a ghost: nobody else sees them, they hold no cell, and they can read the chat
 * but not send to it or create a group
 */
export class LobbyRoom extends Room<{ state: LobbyState; client: LobbyClient }>
{
	// Colyseus allows unlimited messages by default. A client over the limit is disconnected; clients send
	// Move only when their direction changes, so an honest client stays far below it
	maxMessagesPerSecond = 30;

	patchRate = PATCH_INTERVAL_MS;

	state = new LobbyState();

	private readonly zones = new ZoneCache(loadZone, loadChunksAt);

	/**
	 * Players whose zone is deleted go back to the lobby zone
	 */
	private readonly zonePlayers = new ZonePlayers(this.state.players, this.zones, () => this.lobbyZoneId);

	private universeId!: string;

	/**
	 * Where players start
	 */
	private lobbyZoneId!: string;

	private stopFollowingChanges?: () => void;

	/**
	 * The most recent chat messages, oldest first (server-only, not synced)
	 */
	private chatHistory: ChatMessage[] = [];

	private readonly chatLimiter = new RateLimiter(CHAT_RATE_LIMIT, CHAT_RATE_WINDOW_MS);

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

			this.zonePlayers.queueMove(client.sessionId, result.data);
		},

		[MessageType.TakeLink]: (client: LobbyClient) =>
		{
			this.zonePlayers.takeLink(client.sessionId);
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

			if (!this.chatLimiter.tryTake(playerId))
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

			if (character && (this.playing.get(playerId)?.id !== character.id))
			{
				this.play(playerId, character);
			}
		},

		[LobbyMessageType.CreateGroup]: async (client: LobbyClient) =>
		{
			const { browserId, playerId } = identityOf(client);

			if (!onlinePlayers.get(browserId) || !this.playing.has(playerId))
			{
				return;
			}

			let room: IRoomCache;

			// The new room disposes itself if nobody joins it within its seat reservation time
			try
			{
				room = await matchMaker.createRoom(GAME_ROOM_NAME, { universeId: this.universeId } satisfies LobbyJoinOptions);
			}
			catch (error)
			{
				console.error(client.sessionId, 'could not create a group:', error);
				this.sendNotice(client, NoticeReason.GroupNotCreated);
				return;
			}

			onlinePlayers.setGroup(browserId, room.roomId);
		}
	};

	/**
	 * Loads the universe's lobby zone, starts the simulation loop and the loading of chunks near players,
	 * and starts following changes to the world. Fails for a universe that doesn't exist or has no lobby
	 * zone, which turns away the client asking for it
	 *
	 * @param options The universe, from the first client's LobbyJoinOptions
	 */
	async onCreate(options: unknown): Promise<void>
	{
		const { universeId } = roomOptions.parse(options);
		const universe = await findUniverse(universeId);
		const lobbyZone = ((universe?.lobbyZoneId !== undefined) ? await this.zones.load(universe.lobbyZoneId) : undefined);

		if (!lobbyZone)
		{
			throw new Error(`Universe ${universeId} has no lobby to join`);
		}

		this.universeId = universeId;
		this.lobbyZoneId = lobbyZone.loaded.zone.id;
		this.setTimestep((deltaTime) => this.zonePlayers.update(deltaTime / 1000), 1000 / SIMULATION_TICK_RATE);
		this.clock.setInterval(() => this.zonePlayers.refreshChunks(), CHUNK_REFRESH_INTERVAL_MS);

		this.stopFollowingChanges = zoneChanges.onChange((change) =>
		{
			this.zonePlayers.applyChange(change).catch((error: unknown) =>
			{
				console.error('Could not apply a world change to the lobby of universe', this.universeId, error);
			});
		});
	}

	/**
	 * Stops following changes to the world
	 */
	onDispose(): void
	{
		this.stopFollowingChanges?.();
	}

	/**
	 * Admits only clients whose browser is logged in
	 *
	 * @param _client The joining client
	 * @param _options Join options from the client (already used to pick this room)
	 * @param context The connection's request headers, which carry the browser ID cookie
	 * @return The client's identity, stored as client.auth; false to turn the client away
	 */
	onAuth(_client: Client, _options: unknown, context: AuthContext): LobbyIdentity | false
	{
		const browserId = readBrowserId(context.headers.get('cookie'));
		const player = ((browserId !== undefined) ? onlinePlayers.get(browserId) : undefined);

		if ((browserId === undefined) || !player)
		{
			return(false);
		}

		return({
			browserId,
			playerId: player.playerId,
			name: player.name
		});
	}

	/**
	 * Reads the joining client's player's characters, and puts a player new to the room in the lobby
	 * zone as the character they played or made most recently (a ghost when they have none). A player
	 * already here keeps their character, unless they were a ghost and have since made one. Then sends
	 * the client who it is playing and the recent chat
	 *
	 * @param client The joining client
	 */
	async onJoin(client: LobbyClient): Promise<void>
	{
		const { playerId } = identityOf(client);
		const characters = await listPlayableCharacters(playerId, this.universeId);
		const lobbyZone = await this.zones.load(this.lobbyZoneId);

		if (!lobbyZone)
		{
			throw new Error(`The lobby zone ${this.lobbyZoneId} no longer exists`);
		}

		await this.zonePlayers.prepareStart(lobbyZone);
		this.characters.set(playerId, characters);

		const isNewPlayer = !this.state.players.has(playerId);
		const character = (isNewPlayer ? characters.at(0) : undefined);

		this.zonePlayers.join(client, playerId, appearanceOf(character), this.zones.get(this.lobbyZoneId) ?? lobbyZone);

		if (character)
		{
			this.playing.set(playerId, character);
			this.state.members.set(playerId, new LobbyMember({ name: character.name }));
		}
		else if (!isNewPlayer && !this.playing.has(playerId) && (characters.length > 0))
		{
			this.play(playerId, characters[0]);
		}

		const playingAs: PlayingAsPayload = { characterId: this.playing.get(playerId)?.id ?? null };
		const history: ChatHistoryPayload = { messages: this.chatHistory };

		client.send(LobbyServerMessageType.PlayingAs, playingAs);
		client.send(LobbyServerMessageType.ChatHistory, history);
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
		const left = this.zonePlayers.leave(client);

		this.invalidMessages.forget(client.sessionId);
		console.log(client.sessionId, 'left the lobby of universe', this.universeId, code);

		if (!left?.wasLastClient)
		{
			return;
		}

		const character = this.playing.get(left.playerId);

		this.state.members.delete(left.playerId);
		this.chatLimiter.forget(left.playerId);
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
		return(this.zonePlayers.getPlayerId(sessionId));
	}

	/**
	 * The zone a player is in
	 *
	 * @param playerId The player's ID
	 * @return The zone's ID, or undefined when the player isn't in the room
	 */
	getZoneId(playerId: string): string | undefined
	{
		return(this.zonePlayers.getZoneId(playerId));
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
		this.zonePlayers.setAppearance(playerId, appearanceOf(character));
		this.state.members.set(playerId, new LobbyMember({ name: character.name }));

		for (const client of this.zonePlayers.getClients(playerId))
		{
			client.send(LobbyServerMessageType.PlayingAs, playingAs);
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
