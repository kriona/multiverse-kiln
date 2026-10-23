import { DEFAULT_WALK_SECONDS, IMPASSABLE_WALK_SECONDS } from '@multiverse-kiln/shared';

import type { GridStep } from './movement.js';

/**
 * How many squares a diagonal step counts as: PF1E counts every second diagonal as two squares, so
 * each one averages one and a half
 */
const DIAGONAL_SQUARES = 1.5;

/**
 * Real milliseconds within which steps by different members count as taken at the same time. Longer
 * than a step takes on any tile a player can cross at a walk, so two members walking side by side
 * keep overlapping
 */
export const SIMULTANEOUS_STEP_MS = 500;

/**
 * Seconds of game time a step took
 *
 * @param step The step, from one cell to a neighboring one
 * @param walkSeconds The walk seconds of the cell stepped into. A cell that can't be entered counts as
 * taking DEFAULT_WALK_SECONDS, as movement gives it full speed when a player steps back to the center
 * of a cell that became impassable under them
 * @return The seconds
 */
export function stepSeconds(step: GridStep, walkSeconds: number): number
{
	const isDiagonal = ((step.from.column !== step.to.column) && (step.from.row !== step.to.row));
	const squares = (isDiagonal ? DIAGONAL_SQUARES : 1);
	const seconds = ((walkSeconds === IMPASSABLE_WALK_SECONDS) ? DEFAULT_WALK_SECONDS : walkSeconds);

	return(seconds * squares);
}

/**
 * A group's game clock: how many seconds of game time have passed since its world began
 *
 * The whole group shares one time. Standing still passes no time, and each step a member finishes
 * moves the clock on, for everyone in the group, including members standing still. Members walking at
 * the same time don't pass the time twice: a step is left out when a step by another member was
 * counted less than SIMULTANEOUS_STEP_MS before it, so while several members walk, one member's steps
 * keep the time. When that member stops, another's steps take over once the window has passed
 */
export class GroupClock
{
	/**
	 * The member whose step was counted last, and when, in real milliseconds
	 */
	private lastCounted: { memberId: string; atMilliseconds: number } | undefined;

	/**
	 * @param currentSeconds The clock's time
	 */
	constructor(private currentSeconds: number)
	{
	}

	/**
	 * The clock's time
	 *
	 * @return Seconds of game time since the group's world began
	 */
	get seconds(): number
	{
		return(this.currentSeconds);
	}

	/**
	 * Records a step a member finished, moving the clock on unless another member's step at the same
	 * time already has
	 *
	 * @param memberId The member's character ID
	 * @param seconds The game time the step took (stepSeconds)
	 * @param nowMilliseconds When the step finished, in real milliseconds on any steady clock
	 * @return Whether the clock moved on
	 */
	walk(memberId: string, seconds: number, nowMilliseconds: number): boolean
	{
		const last = this.lastCounted;

		if (last && (last.memberId !== memberId) && ((nowMilliseconds - last.atMilliseconds) < SIMULTANEOUS_STEP_MS))
		{
			return(false);
		}

		this.currentSeconds += seconds;
		this.lastCounted = { memberId, atMilliseconds: nowMilliseconds };

		return(true);
	}

	/**
	 * Passes time for the whole group at once, such as a combat that has ended
	 *
	 * @param seconds How much time passes
	 */
	pass(seconds: number): void
	{
		this.currentSeconds += seconds;
	}
}
