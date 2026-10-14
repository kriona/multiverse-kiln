/**
 * Validators for client message payloads
 *
 * Each one must accept exactly the matching interface in /shared; `satisfies` makes the compiler check that.
 * Handlers parse with safeParse and drop a payload that fails, so one bad message doesn't disconnect the client.
 * Unknown keys are stripped rather than rejected
 */
import { z } from 'zod';
import type { MovePayload } from '@multiverse-kiln/shared';

const direction = z.literal([-1, 0, 1]);

/**
 * MovePayload: a direction on each axis
 */
export const movePayload = z.object({
	x: direction,
	y: direction
}) satisfies z.ZodType<MovePayload>;

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
