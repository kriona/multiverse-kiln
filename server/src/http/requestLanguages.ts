/**
 * The languages a request asks for universe text in (see Localization in STRUCTURE-OVERVIEW.md): the
 * language on the player's profile, then the languages the client sends in Accept-Language, which the
 * pages set to the language the player chose with the picker, then the browser's
 */
import type { Request } from 'express';
import { MAX_LOCALE_LENGTH } from '@multiverse-kiln/shared';

import { resolveSession } from '../auth/sessions.js';

/**
 * Most languages read from an Accept-Language header
 */
const MAX_ACCEPTED_LANGUAGES = 10;

/**
 * The profile language of each request's player, once a route has found the session (null for a
 * player who hasn't chosen one), so requestLanguages() doesn't look it up again
 */
const profileLocales = new WeakMap<Request, string | null>();

/**
 * Remembers the profile language of a request's player, found with their session
 *
 * @param request The request
 * @param locale The language on their profile, or null when they haven't chosen one
 */
export function rememberProfileLocale(request: Request, locale: string | null): void
{
	profileLocales.set(request, locale);
}

/**
 * The languages an Accept-Language header names, most wanted first: by quality, then in the order
 * given. Tags that aren't language tags, the * wildcard and those of quality 0 are left out
 *
 * @param header The header, e.g. "fr-CA,fr;q=0.9,en;q=0.8"
 * @return The languages in canonical form, e.g. ["fr-CA", "fr", "en"]
 */
export function acceptedLanguages(header: string | undefined): string[]
{
	if (header === undefined)
	{
		return([]);
	}

	const languages: { tag: string; quality: number }[] = [];

	for (const part of header.split(',').slice(0, (MAX_ACCEPTED_LANGUAGES * 2)))
	{
		const [tag, ...parameters] = part.split(';').map((piece) => piece.trim());
		const qualityParameter = parameters.find((parameter) => parameter.startsWith('q='));
		const quality = ((qualityParameter === undefined) ? 1 : Number(qualityParameter.slice(2)));
		const canonical = canonicalTag(tag);

		if ((canonical !== undefined) && Number.isFinite(quality) && (quality > 0))
		{
			languages.push({ tag: canonical, quality });
		}
	}

	return(languages
		.map((language, index) => ({ ...language, index }))
		.sort((first, second) => ((second.quality - first.quality) || (first.index - second.index)))
		.map(({ tag }) => tag)
		.slice(0, MAX_ACCEPTED_LANGUAGES));
}

/**
 * A language tag in its canonical form
 *
 * @param tag The tag as sent
 * @return The canonical tag, or undefined for something that isn't one (or is the * wildcard)
 */
function canonicalTag(tag: string): string | undefined
{
	if ((tag === '') || (tag === '*') || (tag.length > MAX_LOCALE_LENGTH))
	{
		return(undefined);
	}

	try
	{
		return(Intl.getCanonicalLocales(tag)[0]);
	}
	catch
	{
		return(undefined);
	}
}

/**
 * The languages a request asks for universe text in, most wanted first: its player's profile language,
 * when the browser is logged in and they have chosen one, then those in its Accept-Language header
 *
 * @param request The request
 * @return The languages, which may be empty
 */
export async function requestLanguages(request: Request): Promise<string[]>
{
	let profileLocale = profileLocales.get(request);

	if (profileLocale === undefined)
	{
		profileLocale = ((await resolveSession(request.headers.cookie))?.locale ?? null);
		profileLocales.set(request, profileLocale);
	}

	const accepted = acceptedLanguages(request.headers['accept-language']);

	return(((profileLocale === null) ? accepted : [profileLocale, ...accepted]));
}
