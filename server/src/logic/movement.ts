/**
 * Player movement rules
 *
 * Pure functions: no Colyseus, database, network or timers (CLAUDE.md architecture rule 4)
 */
import type { MovePayload } from '@multiverse-kiln/shared';

/**
 * A point in world units
 */
export interface Position
{
	x: number;
	y: number;
}

/**
 * The area players can move in, from (0, 0) to (width, height)
 */
export interface Bounds
{
	width: number;
	height: number;
}

/**
 * Player movement speed in world units per second
 */
export const PLAYER_SPEED = 200;

/**
 * Moves a position in a direction for a period of time, staying inside the bounds
 *
 * Diagonal movement is normalized so it isn't faster than moving along one axis
 *
 * @param position Current position
 * @param direction Direction held on each axis
 * @param deltaSeconds Time to move for, in seconds
 * @param bounds Area the position must stay inside
 * @param speed Speed in world units per second
 * @return The new position
 */
export function stepPosition(position: Position, direction: MovePayload, deltaSeconds: number, bounds: Bounds, speed: number = PLAYER_SPEED): Position
{
	const length = Math.hypot(direction.x, direction.y);

	if ((length === 0) || (deltaSeconds <= 0))
	{
		return({ x: position.x, y: position.y });
	}

	const distance = speed * deltaSeconds;

	return({
		x: clamp(position.x + ((direction.x / length) * distance), 0, bounds.width),
		y: clamp(position.y + ((direction.y / length) * distance), 0, bounds.height)
	});
}

/**
 * Picks a spawn position inside the bounds
 *
 * @param bounds Area to spawn in
 * @param random Returns a number in [0, 1), like Math.random
 * @return A position inside the bounds
 */
export function spawnPosition(bounds: Bounds, random: () => number): Position
{
	return({
		x: random() * bounds.width,
		y: random() * bounds.height
	});
}

/**
 * Limits a value to a range
 *
 * @param value Value to limit
 * @param min Lowest allowed value
 * @param max Highest allowed value
 * @return The value, or the nearest end of the range
 */
function clamp(value: number, min: number, max: number): number
{
	return(Math.min(Math.max(value, min), max));
}
