import { formatList, t } from '../localization';
import { announce } from './announcer';

/**
 * How long players coming into or going out of view are collected before they are read out together
 */
const GATHER_MS = 1000;

/**
 * How long after entering an area players going out of view aren't read out: they are the players of
 * the area just left
 */
const AREA_CHANGE_QUIET_MS = 1000;

/**
 * How long the player must hold a direction without moving before they are told something is in the way
 */
const BLOCKED_MS = 500;

/**
 * The eight directions another player can be in, as the messages name them
 */
type Compass = 'north' | 'northeast' | 'east' | 'southeast' | 'south' | 'southwest' | 'west' | 'northwest';

/**
 * Another player the player can see, and how many cells away they are
 */
export interface SeenPlayer
{
	name: string;

	/**
	 * Cells east of the player; negative is west
	 */
	columns: number;

	/**
	 * Cells south of the player; negative is north
	 */
	rows: number;
}

/**
 * Where the player is on the map
 */
export interface PlayerPosition
{
	areaName: string;
	column: number;
	row: number;

	/**
	 * The tile the player stands on, in their language, or undefined when it isn't known
	 */
	tileName: string | undefined;
}

/**
 * Reads out what a screen reader user can't see on the game's map: the area they enter, players
 * coming into and going out of view, a way to another area underfoot, and being unable to move. The
 * map scene tells it what happens; it decides what is worth reading out and words it
 */
export class MapAnnouncer
{
	private readonly appeared: string[] = [];
	private readonly disappeared: string[] = [];
	private gatherTimer: number | undefined;
	private quietUntil = 0;
	private onLink = false;

	/**
	 * Where the player was when they last moved, or when they last held no direction
	 */
	private still: { x: number; y: number; since: number } | undefined;

	private blockedSaid = false;

	/**
	 * The player has come into an area, from another or by joining the room
	 *
	 * @param areaName The area's name
	 */
	enteredArea(areaName: string): void
	{
		this.appeared.length = 0;
		this.disappeared.length = 0;
		this.quietUntil = performance.now() + AREA_CHANGE_QUIET_MS;
		this.onLink = false;
		this.still = undefined;

		announce(t({
			id: 'map.announce.area',
			defaultMessage: 'You are in {area}.',
			description: 'Read out by screen readers when the player comes into an area; {area} is its name'
		}, {
			area: areaName
		}));
	}

	/**
	 * Another player has come into view
	 *
	 * @param name Their name
	 */
	playerAppeared(name: string): void
	{
		this.appeared.push(name);
		this.gather();
	}

	/**
	 * Another player has gone out of view, or left the room
	 *
	 * @param name Their name
	 */
	playerDisappeared(name: string): void
	{
		if (performance.now() < this.quietUntil)
		{
			return;
		}

		this.disappeared.push(name);
		this.gather();
	}

	/**
	 * Tells the player when they step onto a way to another area that they take with a key
	 *
	 * @param onLink Whether the player is standing on one
	 * @param prompt What the map shows them, e.g. "Press E to go through"
	 */
	linkChanged(onLink: boolean, prompt: string): void
	{
		if (onLink && !this.onLink)
		{
			announce(prompt);
		}

		this.onLink = onLink;
	}

	/**
	 * Tells the player once when they hold a direction and stay where they are, as when walking into a
	 * wall or another player. Called every frame
	 *
	 * @param moving Whether a direction is held
	 * @param x The player's position from the server
	 * @param y The player's position from the server
	 */
	movementChecked(moving: boolean, x: number, y: number): void
	{
		const now = performance.now();

		if (!moving || !this.still || (this.still.x !== x) || (this.still.y !== y))
		{
			this.still = { x, y, since: now };
			this.blockedSaid = false;
			return;
		}

		if (!this.blockedSaid && ((now - this.still.since) >= BLOCKED_MS))
		{
			this.blockedSaid = true;
			announce(t({
				id: 'map.announce.blocked',
				defaultMessage: 'Something is in the way.',
				description: 'Read out by screen readers when the player tries to move but can\'t, e.g. into a wall or another player'
			}));
		}
	}

	/**
	 * Reads out where the player is, the tile they stand on, and the other players they can see, nearest first
	 *
	 * @param position Where the player is
	 * @param others The other players they can see
	 */
	describePosition(position: PlayerPosition, others: readonly SeenPlayer[]): void
	{
		const players = [...others]
			.sort((first, second) => (distance(first) - distance(second)))
			.map((other) => describePlayer(other));

		announce(t({
			id: 'map.announce.position',
			defaultMessage: '{area}, column {column}, row {row}{onTile, select, yes {, on {tile}} other {}}. {count, plural, =0 {You can\'t see anyone else.} other {You can see {players}.}}',
			description: 'Read out by screen readers when the player asks where they are: the area\'s name, their cell, the tile they stand on (e.g. Grass) when it is known, and the other players they can see; {players} is a list of descriptions such as "Bo, 3 cells northeast"'
		}, {
			area: position.areaName,
			column: position.column,
			row: position.row,
			onTile: ((position.tileName === undefined) ? 'no' : 'yes'),
			tile: (position.tileName ?? ''),
			count: players.length,
			players: formatList(players, 'conjunction')
		}), true);
	}

	/**
	 * Stops reading anything out that is still waiting, for when the map stops
	 */
	stop(): void
	{
		window.clearTimeout(this.gatherTimer);
		this.gatherTimer = undefined;
		this.appeared.length = 0;
		this.disappeared.length = 0;
	}

	/**
	 * Reads out the players who came into or went out of view a moment after the first of them, so
	 * several at once are read out in one go
	 */
	private gather(): void
	{
		if (this.gatherTimer !== undefined)
		{
			return;
		}

		this.gatherTimer = window.setTimeout(() =>
		{
			this.gatherTimer = undefined;
			this.readGathered();
		}, GATHER_MS);
	}

	/**
	 * Reads out the players gathered since the last time
	 */
	private readGathered(): void
	{
		const lines: string[] = [];

		if (this.appeared.length > 0)
		{
			lines.push(t({
				id: 'map.announce.appeared',
				defaultMessage: '{count, plural, one {{players} comes into view.} other {{players} come into view.}}',
				description: 'Read out by screen readers when other players come into view on the map; {players} is a list of their names'
			}, {
				count: this.appeared.length,
				players: formatList(this.appeared, 'conjunction')
			}));
		}

		if (this.disappeared.length > 0)
		{
			lines.push(t({
				id: 'map.announce.disappeared',
				defaultMessage: '{count, plural, one {{players} goes out of view.} other {{players} go out of view.}}',
				description: 'Read out by screen readers when other players go out of view on the map or leave; {players} is a list of their names'
			}, {
				count: this.disappeared.length,
				players: formatList(this.disappeared, 'conjunction')
			}));
		}

		this.appeared.length = 0;
		this.disappeared.length = 0;

		if (lines.length > 0)
		{
			// Each line is a whole sentence
			announce(lines.join(' '));
		}
	}
}

/**
 * How many cells away another player is, counting a diagonal step as one, as the player moves
 *
 * @param other The other player
 * @return The distance in cells
 */
function distance(other: SeenPlayer): number
{
	return(Math.max(Math.abs(other.columns), Math.abs(other.rows)));
}

/**
 * Another player's name and where they are from the player, e.g. "Bo, 3 cells northeast"
 *
 * @param other The other player
 * @return The description
 */
function describePlayer(other: SeenPlayer): string
{
	if (distance(other) === 0)
	{
		return(t({
			id: 'map.announce.playerHere',
			defaultMessage: '{name}, right where you are',
			description: 'Read out by screen readers in the list of players the player can see, for one in the same cell; {name} is their name'
		}, {
			name: other.name
		}));
	}

	return(t({
		id: 'map.announce.player',
		defaultMessage: '{name}, {cells, plural, one {# cell} other {# cells}} {direction, select, north {north} northeast {northeast} east {east} southeast {southeast} south {south} southwest {southwest} west {west} other {northwest}}',
		description: 'Read out by screen readers in the list of players the player can see: their name, how many cells away and in which direction, e.g. "Bo, 3 cells northeast"'
	}, {
		name: other.name,
		cells: distance(other),
		direction: compass(other.columns, other.rows)
	}));
}

/**
 * The nearest of the eight compass directions to an offset on the map
 *
 * @param columns Cells east; negative is west
 * @param rows Cells south; negative is north
 * @return The direction
 */
function compass(columns: number, rows: number): Compass
{
	// atan2 gives the angle counterclockwise from east, from -pi to pi (both west), with north up; each
	// eighth of a turn is one direction
	const directions: Compass[] = ['west', 'southwest', 'south', 'southeast', 'east', 'northeast', 'north', 'northwest', 'west'];
	const eighth = Math.round(Math.atan2(-rows, columns) / (Math.PI / 4));

	return(directions[eighth + 4]);
}
