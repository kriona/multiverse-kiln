/**
 * What the auth routes share (auth.ts, and providerAuth.ts for provider logins): refusals and the
 * messages they give, checks of what players choose, auth events and the tokens in cookies
 */
import type { Request, Response } from 'express';
import { defineMessages, isReservedName, localize, MAX_USERNAME_LENGTH, MIN_USERNAME_LENGTH, NAME_MESSAGES, USERNAME_PATTERN, type AuthErrorPayload, type AuthField, type MessageDescriptor, type MessageValues, type ProfileErrorPayload, type ProfileField } from '@multiverse-kiln/shared';

import { hashToken, isTokenForm } from '../auth/tokens.js';
import { recordAuthEvent, type AuthEventKind } from '../db/authEventRepo.js';
import type { Executor } from '../db/client.js';
import type { SendDecision } from '../logic/emailCodes.js';
import { clientNetworkHash } from './clientNetwork.js';
import { readCookie } from './cookies.js';

/**
 * Reasons the auth routes give in more than one place (see shared/src/localization.ts)
 */
export const authMessages = defineMessages({
	tooManyAttempts: {
		id: 'error.auth.tooManyAttempts',
		defaultMessage: 'Too many tries. Try again in {minutes, plural, one {# minute} other {# minutes}}.',
		description: 'Why a login wasn\'t tried, an email code wasn\'t sent, or a code wasn\'t checked: too many were tried or asked for from this network or for this address in the past hour, or a code was sent to the address less than a minute ago'
	},
	enterCodeFirst: {
		id: 'error.auth.enterCodeFirst',
		defaultMessage: 'Enter the code from the email first, or ask for a new one if it has been more than a few minutes.',
		description: 'Why creating an account, choosing a new password, changing an email address or linking a Google or Discord login with an email code was refused: this browser hasn\'t entered the email code, or entered it too long ago'
	},
	emailMismatch: {
		id: 'error.auth.emailMismatch',
		defaultMessage: 'That isn\'t the address the code was sent to.',
		description: 'Shown under the email field when creating an account or changing an email address: the address typed differs from the one the code was sent to'
	},
	emailForm: {
		id: 'error.auth.emailForm',
		defaultMessage: 'Enter an email address, like name@example.com.',
		description: 'Shown under an email field when what was typed isn\'t an email address'
	},
	passwordLength: {
		id: 'error.auth.passwordLength',
		defaultMessage: 'Use a password of {min} to {max} characters.',
		description: 'Shown under a new password field when the password is too short or too long; {min} and {max} are numbers'
	},
	passwordBreached: {
		id: 'error.auth.passwordBreached',
		defaultMessage: 'This password has turned up in a data breach, so attackers try it. Choose another.',
		description: 'Shown under a new password field when the password is on HaveIBeenPwned\'s list of passwords leaked in data breaches'
	},
	emailTaken: {
		id: 'error.auth.emailTaken',
		defaultMessage: 'Another account already uses that address.',
		description: 'Why an account wasn\'t created, or its email address wasn\'t changed: the address belongs to another account. Only shown after the player proved they can read that address\'s email, or logged in with Google or Discord'
	},
	usernameTaken: {
		id: 'error.auth.usernameTaken',
		defaultMessage: 'Another account already has that username. Choose another.',
		description: 'Shown under the username field when creating an account: usernames are unique, ignoring capitals'
	}
});

/**
 * Why a request is refused, decided inside a transaction where the response isn't at hand, and the
 * field of the form it is about (an auth route's AuthField, or the profile's ProfileField)
 */
export interface AuthRefusal<Field extends string = AuthField>
{
	status: number;
	message: MessageDescriptor;
	values?: MessageValues;
	field?: Field;
}

/**
 * Answers a request with an error, and the field it is about
 *
 * @param response The response
 * @param refusal Why the request was refused
 */
export function sendRefusal<Field extends AuthField | ProfileField>(response: Response, refusal: AuthRefusal<Field>): void
{
	const payload: AuthErrorPayload | ProfileErrorPayload = { error: localize(refusal.message, refusal.values) };

	if (refusal.field !== undefined)
	{
		payload.field = refusal.field;
	}

	response.status(refusal.status).json(payload);
}

/**
 * The refusal for an attempt over a rate limit, saying how long to wait
 *
 * @param decision The limit's decision
 * @param now The time now
 * @param response The response, which gets a Retry-After header
 * @return The refusal
 */
export function tooManyAttempts(decision: SendDecision & { allowed: false }, now: Date, response: Response): AuthRefusal
{
	const seconds = Math.max(1, Math.ceil((decision.retryAt.getTime() - now.getTime()) / 1000));

	response.set('Retry-After', String(seconds));

	return({
		status: 429,
		message: authMessages.tooManyAttempts,
		values: {
			minutes: Math.ceil(seconds / 60)
		}
	});
}

/**
 * Checks a new username's form
 *
 * @param username The username, trimmed
 * @return The refusal when it can't be taken
 */
export function checkUsername(username: string): AuthRefusal<'username'> | undefined
{
	if ((username.length < MIN_USERNAME_LENGTH) || (username.length > MAX_USERNAME_LENGTH) || !USERNAME_PATTERN.test(username))
	{
		return({
			status: 400,
			message: {
				id: 'error.auth.usernameForm',
				defaultMessage: 'Use {min} to {max} letters (a to z), digits and underscores.',
				description: 'Shown under the username field when the username has other characters, or is too short or too long; {min} and {max} are numbers'
			},
			values: {
				min: MIN_USERNAME_LENGTH,
				max: MAX_USERNAME_LENGTH
			},
			field: 'username'
		});
	}

	if (isReservedName(username))
	{
		return({
			status: 400,
			message: NAME_MESSAGES.reserved,
			field: 'username'
		});
	}

	return(undefined);
}

/**
 * Checks a new account's display name
 *
 * @param displayName The name, as displayText() reads it
 * @return The refusal when it is reserved
 */
export function checkDisplayName(displayName: string): AuthRefusal<'displayName'> | undefined
{
	if (!isReservedName(displayName))
	{
		return(undefined);
	}

	return({
		status: 400,
		message: NAME_MESSAGES.reserved,
		field: 'displayName'
	});
}

/**
 * Records an auth event for a request
 *
 * @param request The request
 * @param playerId The account, or null when it isn't known
 * @param kind What happened
 * @param now When
 * @param executor The database, or a transaction
 */
export async function recordEvent(request: Request, playerId: string | null, kind: AuthEventKind, now: Date, executor?: Executor): Promise<void>
{
	await recordAuthEvent({
		playerId,
		kind,
		networkHash: clientNetworkHash(request),
		occurredAt: now
	}, executor);
}

/**
 * The token a browser holds in a cookie, such as the one that lets it take the next step after entering
 * an email code
 *
 * @param request The request
 * @param cookieName The cookie
 * @return The token's hash, or undefined when the browser has none
 */
export function cookieTokenHash(request: Request, cookieName: string): Buffer | undefined
{
	const token = readCookie(request.headers.cookie, cookieName);

	return((((token !== undefined) && isTokenForm(token)) ? hashToken(token) : undefined));
}
