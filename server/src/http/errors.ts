/**
 * Error answers: why the server refused a request, as a message the client shows in the player's
 * language (an ErrorPayload)
 */
import type { Response } from 'express';
import type { z } from 'zod';
import { defineMessages, localize, type ErrorPayload, type MessageDescriptor, type MessageValues } from '@multiverse-kiln/shared';

import { describeInvalidPayload } from '../rooms/payloads.js';

/**
 * Reasons more than one route gives (see shared/src/localization.ts)
 */
export const errorMessages = defineMessages({
	invalidRequest: {
		id: 'error.invalidRequest',
		defaultMessage: 'The request isn\'t valid ({problem}).',
		description: 'Why the server refused a request the page should never send; {problem} is a technical description in English'
	},
	unreadableBody: {
		id: 'error.unreadableBody',
		defaultMessage: 'The request could not be read.',
		description: 'Why the server refused a request whose contents were damaged or too large'
	},
	somethingWentWrong: {
		id: 'error.somethingWentWrong',
		defaultMessage: 'Something went wrong on the server.',
		description: 'Why a request failed when the server had an unexpected problem'
	},
	noSuchUniverse: {
		id: 'error.noSuchUniverse',
		defaultMessage: 'The universe doesn\'t exist, or you can\'t see it.',
		description: 'Why a request about a universe failed: it was deleted, or the player has no access to it'
	},
	noSuchArea: {
		id: 'error.noSuchArea',
		defaultMessage: 'The area doesn\'t exist.',
		description: 'Why a request about an area failed: it was deleted, perhaps by another editor'
	},
	roleNotAllowed: {
		id: 'error.roleNotAllowed',
		defaultMessage: 'Your role in this universe doesn\'t allow that.',
		description: 'Why an editor change was refused: the player\'s role, such as beta tester, can\'t make it'
	},
	universeNameTaken: {
		id: 'error.universeNameTaken',
		defaultMessage: 'Another universe already has that name, or one too much like it.',
		description: 'Why a universe wasn\'t made or renamed: universe names must be unique, and names that could be mistaken for each other count as the same, such as ones that differ only in capitals, accents, spaces or punctuation, letters from another alphabet that look the same, or "1" for "i"'
	}
});

/**
 * Why a request is refused, decided where the response isn't at hand, such as inside a transaction
 */
export interface Refusal
{
	/**
	 * The HTTP status, e.g. 409
	 */
	status: number;

	message: MessageDescriptor;
	values?: MessageValues;
}

/**
 * Answers a request with an error
 *
 * @param response The response
 * @param status The HTTP status, e.g. 404
 * @param message Why the request was refused
 * @param values The message's arguments' values
 */
export function sendError(response: Response, status: number, message: MessageDescriptor, values?: MessageValues): void
{
	const payload: ErrorPayload = { error: localize(message, values) };

	response.status(status).json(payload);
}

/**
 * Answers a request whose body, query or path failed validation with 400
 *
 * @param response The response
 * @param error The validation error
 */
export function sendInvalidRequest(response: Response, error: z.ZodError): void
{
	sendError(response, 400, errorMessages.invalidRequest, { problem: describeInvalidPayload(error) });
}
