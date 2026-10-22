import { Room, type AuthContext, type Client, type CloseCode } from 'colyseus';
import { GameMessageType, GameServerMessageType, GameState, GroupMember, MessageType, NoticeReason, PATCH_INTERVAL_MS, ServerCloseCode, type NoticePayload } from '@multiverse-kiln/shared';

import { markCharacterPlayed } from '../db/characterRepo.js';
import { findGroup, listGroupMembers, saveGroupClock, saveMemberPositions, type GroupMemberRecord, type MemberPosition } from '../db/groupRepo.js';
import { GroupClock } from '../logic/gameClock.js';
import { findUniverse } from '../db/universeRepo.js';
import { loadChunksAt, loadArea } from '../db/areaRepo.js';
import { readBrowserId } from '../http/browserId.js';
import { characterChanges, type CharacterChange } from '../players/characterChanges.js';
import { groupChanges, type GroupChange } from '../players/groupChanges.js';
import { onlinePlayers } from '../players/onlinePlayers.js';
import { areaChanges } from '../world/areaChanges.js';
import { InvalidMessages } from './invalidMessages.js';
import { controlPayload, describeInvalidPayload, gameJoinOptions, movePayload } from './payloads.js';
import { AreaCache, type ActiveArea } from './areaCache.js';
import { CHUNK_REFRESH_INTERVAL_MS, SIMULATION_TICK_RATE, AreaPlayers, type PlayerPosition } from './areaPlayers.js';

/**
 * What onAuth found out about a client, available afterward as client.auth
 */
interface GameIdentity
{
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
 * A group's game room: its members play here, send movement input, and the server simulates and syncs
 * their positions
 *
 * Clients join with GameJoinOptions, and every client asking for the same group joins the same room
 * (filterBy in app.config.ts), which loads the group from the database as the first one arrives. A
 * client is admitted only to play one of its player's characters in the group who hasn't been given
 * their last rites. While a player has any window here, every such character of theirs is on the map,
 * where they were when their player last left (or beside the anchor being, for a character new to the
 * group); each window controls one of them and can switch to another (GameMessageType.Control). When a
 * player's last window leaves, their characters are taken off the map and where they were is saved.
 * The room disposes once everyone has left
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
	 * Characters whose area is deleted go to the group's starting area. A link that needs the whole
	 * group is refused unless every member who can be played, and the anchor being, is here together
	 */
	private readonly areaPlayers = new AreaPlayers(this.state.players, this.areas, () => this.startingAreaId, {
		members: () => this.linkMemberIds(),
		refuse: (characterId) =>
		{
			this.sendNotice(this.areaPlayers.getClients(characterId), NoticeReason.GroupNotTogether);
		}
	});

	private groupId!: string;

	/**
	 * The anchor being's character ID
	 */
	private anchorId!: string;

	/**
	 * Where members with nowhere else to be go: the group's starting area, or the universe's
	 */
	private startingAreaId!: string;

	/**
	 * The group's game clock, which state.clock shows. Named apart from Room's clock, which runs timers
	 */
	private gameClock!: GroupClock;

	/**
	 * Every member of the group, by character ID (server-only; state.members has what clients see)
	 */
	private readonly members = new Map<string, GroupMemberRecord>();

	/**
	 * Each player's clients in the room, by player ID
	 */
	private readonly windows = new Map<string, Set<GameClient>>();

	/**
	 * Whether the anchor being has left, so the group is no more and nothing is saved
	 */
	private disbanded = false;

	/**
	 * How many invalid messages each client has sent this session (server-only, not synced)
	 */
	private readonly invalidMessages = new InvalidMessages();

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

			// A window can only switch to its own player's characters, who are on the map while it is here
			if ((member?.playerId === identityOf(client).playerId) && this.areaPlayers.has(member.characterId))
			{
				this.areaPlayers.control(client, member.characterId);
			}
		}
	};

	/**
	 * Loads the group, its members and its starting area, starts the simulation loop and the loading of
	 * chunks near players, and starts following changes to the group, its characters and the world. Fails
	 * for a group that doesn't exist, or whose universe has no starting area
	 *
	 * @param options The group, from the first client's GameJoinOptions
	 */
	async onCreate(options: unknown): Promise<void>
	{
		const { groupId } = gameJoinOptions.parse(options);
		const group = await findGroup(groupId);
		const universe = (group ? await findUniverse(group.universeId) : undefined);

		if (!group || !universe)
		{
			throw new Error(`Group ${groupId} doesn't exist`);
		}

		const startingArea = (((group.startingAreaId !== null) ? await this.areas.load(group.startingAreaId) : undefined)
			?? ((universe.startingAreaId !== undefined) ? await this.areas.load(universe.startingAreaId) : undefined));

		if (!startingArea)
		{
			throw new Error(`Group ${groupId} has no starting area to play in`);
		}

		this.groupId = group.id;
		this.anchorId = group.anchorCharacterId;
		this.startingAreaId = startingArea.loaded.area.id;
		this.state.name = group.name;
		this.state.anchorId = group.anchorCharacterId;
		this.gameClock = new GroupClock(group.clockSeconds);
		this.state.clock = this.gameClock.seconds;

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

		this.setTimestep((deltaTime) => this.areaPlayers.update(deltaTime / 1000), 1000 / SIMULATION_TICK_RATE);
		this.clock.setInterval(() => this.areaPlayers.refreshChunks(), CHUNK_REFRESH_INTERVAL_MS);

		this.stopListening.push(
			groupChanges.onChange((change) =>
			{
				this.applyGroupChange(change);
			}),
			characterChanges.onChange((change) =>
			{
				this.applyCharacterChange(change);
			}),
			areaChanges.onChange((change) =>
			{
				this.areaPlayers.applyChange(change).catch((error: unknown) =>
				{
					console.error('Could not apply a world change to the room of group', this.groupId, error);
				});
			})
		);
	}

	/**
	 * Admits a client only when its browser is logged in and asks to play one of its player's characters
	 * in this group who can be played
	 *
	 * @param _client The joining client
	 * @param options The client's GameJoinOptions
	 * @param context The connection's request headers, which carry the browser ID cookie
	 * @return The client's identity, stored as client.auth; false to turn the client away
	 */
	onAuth(_client: Client, options: unknown, context: AuthContext): GameIdentity | false
	{
		const joinOptions = gameJoinOptions.safeParse(options);
		const browserId = readBrowserId(context.headers.get('cookie'));
		const player = ((browserId !== undefined) ? onlinePlayers.get(browserId) : undefined);

		if (!joinOptions.success || !player || (joinOptions.data.groupId !== this.groupId))
		{
			return(false);
		}

		const member = this.members.get(joinOptions.data.characterId);

		if ((member?.playerId !== player.playerId) || !member.playable)
		{
			return(false);
		}

		return({
			playerId: player.playerId,
			characterId: member.characterId
		});
	}

	/**
	 * Puts every playable character of the joining client's player on the map, if they aren't already,
	 * and gives the client the character it asked for
	 *
	 * @param client The joining client
	 */
	async onJoin(client: GameClient): Promise<void>
	{
		const { playerId, characterId } = identityOf(client);
		let clients = this.windows.get(playerId);

		if (!clients)
		{
			clients = new Set();
			this.windows.set(playerId, clients);
		}

		clients.add(client);
		await this.bringIn(playerId);

		const startingArea = this.areas.get(this.startingAreaId);

		// The character may have left the group, or been given their last rites, while the map loaded
		if (!this.areaPlayers.has(characterId) || !startingArea)
		{
			clients.delete(client);
			throw new Error(`Character ${characterId} can no longer be played in group ${this.groupId}`);
		}

		this.areaPlayers.join(client, characterId, { name: this.members.get(characterId)?.name ?? '', ghost: false }, startingArea);

		console.log(client.sessionId, 'joined group', this.groupId, 'as character', characterId);
	}

	/**
	 * Stops the client's character. Once the client was its player's last, takes their characters off
	 * the map, saves where they were, and records that the player last played the character the client
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
			if (!this.disbanded)
			{
				await saveMemberPositions(this.groupId, positions);
				await saveGroupClock(this.groupId, this.gameClock.seconds);
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
	 * Stops following changes, once everyone has left (or nobody joined)
	 */
	onDispose(): void
	{
		for (const stop of this.stopListening)
		{
			stop();
		}

		console.log('Room of group', this.groupId, 'disposing');
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
	 * @return The area's ID, or undefined when the character isn't on the map
	 */
	getAreaId(characterId: string): string | undefined
	{
		return(this.areaPlayers.getAreaId(characterId));
	}

	/**
	 * Puts a player's playable characters who aren't on the map on it, each where they were last, or
	 * beside the anchor being when they have never been played in the group
	 *
	 * @param playerId The player's ID
	 */
	private async bringIn(playerId: string): Promise<void>
	{
		const absent = [...this.members.values()].filter((member) => ((member.playerId === playerId) && member.playable && !this.areaPlayers.has(member.characterId)));

		for (const member of absent)
		{
			const start = await this.startOf(member);

			// The member may have left, or their player's windows all closed, while the area loaded
			if ((this.members.get(member.characterId) !== member) || !this.windows.has(playerId) || !member.playable)
			{
				continue;
			}

			await this.areaPlayers.prepareStart(start.area, start);
			this.areaPlayers.add(member.characterId, { name: member.name, ghost: false }, this.areas.get(start.area.loaded.area.id) ?? start.area, start);

			const shown = this.state.members.get(member.characterId);

			if (shown)
			{
				shown.present = true;
			}
		}
	}

	/**
	 * Where a member starts on the map: where they were last, then beside the anchor being (where they
	 * are now, or were last), then the center of the group's starting area. An area that is gone or
	 * disabled is passed over
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
					column: candidate.column,
					row: candidate.row
				});
			}
		}

		const startingArea = await this.areas.load(this.startingAreaId);

		if (!startingArea)
		{
			throw new Error(`The starting area ${this.startingAreaId} of group ${this.groupId} no longer exists`);
		}

		return({
			area: startingArea,
			column: 0,
			row: 0
		});
	}

	/**
	 * Takes a player's characters off the map, remembering where they were for when they come back
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
	 * Adds a member of the group, not yet on the map
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
	 * Takes a character off the map, disconnecting the windows controlling them
	 *
	 * @param characterId The character's ID
	 */
	private dropCharacter(characterId: string): void
	{
		for (const client of this.areaPlayers.getClients(characterId))
		{
			client.leave(ServerCloseCode.LeftGroup);
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
			.filter((member) => (member.playable || (member.characterId === this.anchorId)))
			.map((member) => member.characterId));
	}

	/**
	 * Follows a change to who is in a group, if it is this one: a character who joins is put on the map
	 * if their player is here, one who leaves is taken off it, and when the group is disbanded everyone
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
			this.disbanded = true;

			for (const client of this.clients)
			{
				client.leave(ServerCloseCode.GroupDisbanded);
			}

			return;
		}

		if (change.kind === 'left')
		{
			const { characterId } = change.character;

			this.dropCharacter(characterId);
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
	 * Follows a change to a member: one given their last rites can't be played, so they are taken off
	 * the map, and one restored is put back on it if their player is here
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
			this.dropCharacter(characterId);
			return;
		}

		member.playable = true;

		if (this.windows.has(member.playerId))
		{
			this.bringIn(member.playerId).catch((error: unknown) =>
			{
				console.error('Could not bring character', characterId, 'back into group', this.groupId, error);
			});
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
