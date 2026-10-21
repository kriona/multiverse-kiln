import { matchMaker, Room, type AuthContext, type Client, type CloseCode, type IRoomCache } from 'colyseus';
import { GAME_ROOM_NAME, LobbyMember, LobbyMessageType, LobbyServerMessageType, LobbyState, MessageType, NoticeReason, PATCH_INTERVAL_MS, type ChatHistoryPayload, type ChatMessage, type LobbyJoinOptions, type NoticePayload, type PlayingAsPayload } from '@multiverse-kiln/shared';

import { listPlayableCharacters, markCharacterPlayed, type PlayableCharacter } from '../db/characterRepo.js';
import { findUniverse } from '../db/universeRepo.js';
import { loadChunksAt, loadArea } from '../db/areaRepo.js';
import { readBrowserId } from '../http/browserId.js';
import { onlinePlayers } from '../players/onlinePlayers.js';
import { characterChanges, type CharacterChange } from '../players/characterChanges.js';
import { areaChanges } from '../world/areaChanges.js';
import { InvalidMessages } from './invalidMessages.js';
import { chatPayload, chooseCharacterPayload, describeInvalidPayload, movePayload, roomOptions } from './payloads.js';
import { RateLimiter } from './rateLimiter.js';
import { AreaCache } from './areaCache.js';
import { CHUNK_REFRESH_INTERVAL_MS, SIMULATION_TICK_RATE, AreaPlayers, type Appearance } from './areaPlayers.js';

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
 * in the universe's lobby area and can walk through its links into other areas (see AreaPlayers)
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

	private readonly areas = new AreaCache(loadArea, loadChunksAt);

	/**
	 * Players whose area is deleted go back to the lobby area
	 */
	private readonly areaPlayers = new AreaPlayers(this.state.players, this.areas, () => this.lobbyAreaId);

	private universeId!: string;

	/**
	 * Where players start
	 */
	private lobbyAreaId!: string;

	private stopFollowingChanges?: () => void;

	private stopFollowingCharacters?: () => void;

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

			this.areaPlayers.queueMove(client.sessionId, result.data);
		},

		[MessageType.TakeLink]: (client: LobbyClient) =>
		{
			this.areaPlayers.takeLink(client.sessionId);
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
	 * Loads the universe's lobby area, starts the simulation loop and the loading of chunks near players,
	 * and starts following changes to the world. Fails for a universe that doesn't exist or has no lobby
	 * area, which turns away the client asking for it
	 *
	 * @param options The universe, from the first client's LobbyJoinOptions
	 */
	async onCreate(options: unknown): Promise<void>
	{
		const { universeId } = roomOptions.parse(options);
		const universe = await findUniverse(universeId);
		const lobbyArea = ((universe?.lobbyAreaId !== undefined) ? await this.areas.load(universe.lobbyAreaId) : undefined);

		if (!lobbyArea)
		{
			throw new Error(`Universe ${universeId} has no lobby to join`);
		}

		this.universeId = universeId;
		this.lobbyAreaId = lobbyArea.loaded.area.id;
		this.setTimestep((deltaTime) => this.areaPlayers.update(deltaTime / 1000), 1000 / SIMULATION_TICK_RATE);
		this.clock.setInterval(() => this.areaPlayers.refreshChunks(), CHUNK_REFRESH_INTERVAL_MS);

		this.stopFollowingChanges = areaChanges.onChange((change) =>
		{
			this.areaPlayers.applyChange(change).catch((error: unknown) =>
			{
				console.error('Could not apply a world change to the lobby of universe', this.universeId, error);
			});
		});

		this.stopFollowingCharacters = characterChanges.onChange((change) =>
		{
			this.applyCharacterChange(change);
		});
	}

	/**
	 * Stops following changes to the world and to players' characters
	 */
	onDispose(): void
	{
		this.stopFollowingChanges?.();
		this.stopFollowingCharacters?.();
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
	 * area as the character they played or made most recently (a ghost when they have none). A player
	 * already here keeps their character, unless they were a ghost and have since made one. Then sends
	 * the client who it is playing and the recent chat
	 *
	 * @param client The joining client
	 */
	async onJoin(client: LobbyClient): Promise<void>
	{
		const { playerId } = identityOf(client);
		const characters = await listPlayableCharacters(playerId, this.universeId);
		const lobbyArea = await this.areas.load(this.lobbyAreaId);

		if (!lobbyArea)
		{
			throw new Error(`The lobby area ${this.lobbyAreaId} no longer exists`);
		}

		await this.areaPlayers.prepareStart(lobbyArea);
		this.characters.set(playerId, characters);

		const isNewPlayer = !this.state.players.has(playerId);
		const character = (isNewPlayer ? characters.at(0) : undefined);

		this.areaPlayers.join(client, playerId, appearanceOf(character), this.areas.get(this.lobbyAreaId) ?? lobbyArea);

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
		const left = this.areaPlayers.leave(client);

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
		this.areaPlayers.setAppearance(playerId, appearanceOf(character));
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
		this.areaPlayers.setAppearance(playerId, appearanceOf(undefined));
		this.state.members.delete(playerId);

		for (const client of this.areaPlayers.getClients(playerId))
		{
			client.send(LobbyServerMessageType.PlayingAs, playingAs);
		}
	}

	/**
	 * Follows a change to a player in the room's characters, then has their windows list them again. A
	 * player whose character can no longer be played switches to the one they played or made most
	 * recently, or becomes a ghost; a ghost plays a character restored
	 *
	 * @param change The change
	 */
	private applyCharacterChange(change: CharacterChange): void
	{
		const { playerId } = change;
		const characters = this.characters.get(playerId);

		if ((change.universeId !== this.universeId) || !characters)
		{
			return;
		}

		if (change.kind === 'removed')
		{
			const remaining = characters.filter((character) => (character.id !== change.characterId));

			this.characters.set(playerId, remaining);

			if (this.playing.get(playerId)?.id === change.characterId)
			{
				const next = remaining.at(0);

				if (next)
				{
					this.play(playerId, next);
				}
				else
				{
					this.becomeGhost(playerId);
				}
			}
		}
		else
		{
			if (!characters.some((character) => (character.id === change.character.id)))
			{
				this.characters.set(playerId, [change.character, ...characters]);
			}

			if (!this.playing.has(playerId))
			{
				this.play(playerId, change.character);
			}
		}

		for (const client of this.areaPlayers.getClients(playerId))
		{
			client.send(LobbyServerMessageType.CharactersChanged);
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
