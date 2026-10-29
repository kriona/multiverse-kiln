/**
 * Validators for client message payloads and room options
 *
 * Each one must accept exactly the matching interface in /shared; `satisfies` makes the compiler check that.
 * Handlers parse with safeParse and drop a payload that fails, so one bad message doesn't disconnect the client.
 * Unknown keys are stripped rather than rejected
 */
import { z } from 'zod';
import { DISALLOWED_TEXT_CHARACTERS, MAX_CHAT_MESSAGE_LENGTH, type ChatPayload, type ChooseCharacterPayload, type ControlPayload, type GameJoinOptions, type LobbyJoinOptions, type MovePayload } from '@multiverse-kiln/shared';

const direction = z.literal([-1, 0, 1]);

/**
 * Text a player typed for others to see: trimmed, not empty, and free of disallowed characters
 *
 * @param maxLength Most characters allowed after trimming
 * @return The validator
 */
export function displayText(maxLength: number): z.ZodString
{
	return(z.string().trim().min(1).max(maxLength).refine((text) => !DISALLOWED_TEXT_CHARACTERS.test(text), 'Contains disallowed characters'));
}

/**
 * MovePayload: a direction on each axis
 */
export const movePayload = z.object({
	x: direction,
	y: direction
}) satisfies z.ZodType<MovePayload>;

/**
 * ChatPayload: one line of chat
 */
export const chatPayload = z.object({
	text: displayText(MAX_CHAT_MESSAGE_LENGTH)
}) satisfies z.ZodType<ChatPayload>;

/**
 * ChooseCharacterPayload: a character's ID
 */
export const chooseCharacterPayload = z.object({
	characterId: z.uuid()
}) satisfies z.ZodType<ChooseCharacterPayload>;

/**
 * ControlPayload: a character's ID
 */
export const controlPayload = z.object({
	characterId: z.uuid()
}) satisfies z.ZodType<ControlPayload>;

/**
 * Options a universe's lobby is created and joined with: which universe
 */
export const roomOptions = z.object({
	universeId: z.uuid()
}) satisfies z.ZodType<LobbyJoinOptions>;

/**
 * Options a group's game room is created and joined with: which group, and which character the window plays
 */
export const gameJoinOptions = z.object({
	groupId: z.uuid(),
	characterId: z.uuid()
}) satisfies z.ZodType<GameJoinOptions>;

/**
 * Summarizes why a payload failed validation, for logging
 *
 * Lists each field and zod's message. Zod's messages describe the expected value and the received type,
 * never the received value, so the summary contains no client-supplied text
 *
 * @param error The validation error
 * @return One line, e.g. "x: Invalid option: expected one of -1|0|1"
 */
export function describeInvalidPayload(error: z.ZodError): string
{
	return(error.issues.map((issue) => `${(issue.path.length > 0) ? issue.path.join('.') : '(payload)'}: ${issue.message}`).join('; '));
}
