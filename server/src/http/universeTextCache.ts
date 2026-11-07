/**
 * The text a universe's rooms leave to the client to look up by ID (UniverseTextPayload), kept for each
 * universe and language once it is built. A text change makes every room of the universe tell its
 * clients to fetch it again at once, so without it a universe's players would each have it built
 */
import { createHash } from 'node:crypto';
import { chooseUniverseLanguage, type UniverseTextPayload } from '@multiverse-kiln/shared';

import { areaChanges, type AreaChanges } from '../world/areaChanges.js';
import type { UniverseLanguages } from './universeTextTranslator.js';

/**
 * How long text is kept, in milliseconds. A change to it is told (an AreaChange of kind text) and
 * forgets it at once; this only limits how long text changed some other way, as by hand, is shown
 */
const KEPT_TEXT_MS = 60 * 1000;

/**
 * Most pieces of text kept at once, for a universe in a language; past it the oldest is forgotten
 */
const MAX_KEPT_TEXTS = 500;

/**
 * A universe's text in a language, as the response sends it
 */
export interface BuiltUniverseText
{
	/**
	 * The JSON of the text
	 */
	body: string;

	/**
	 * The ETag that goes with it: its hash, so it changes exactly when the text does
	 */
	etag: string;
}

/**
 * Text kept, or being built
 */
interface KeptText
{
	universeId: string;
	text: Promise<BuiltUniverseText>;
	expiresAt: number;
}

/**
 * Keeps each universe's text in each language, built once for every request that asks for it while it
 * is kept, including requests that come while it is being built
 */
export class UniverseTextCache
{
	private readonly kept = new Map<string, KeptText>();

	/**
	 * @param changes The world's changes, which say when a universe's text changes
	 */
	constructor(changes: AreaChanges)
	{
		changes.onChange((change) =>
		{
			if ((change.kind === 'text') || (change.kind === 'universeDeleted') || (change.kind === 'universeDisabled'))
			{
				this.forget(change.universeId);
			}
		});
	}

	/**
	 * A universe's text in the language a request is answered in, built when it isn't kept
	 *
	 * @param universe The universe and its languages
	 * @param requested The languages asked for, most wanted first (requestLanguages())
	 * @param build Builds the text in those languages
	 * @return The text, and its ETag
	 */
	get(universe: UniverseLanguages, requested: readonly string[], build: () => Promise<UniverseTextPayload>): Promise<BuiltUniverseText>
	{
		// The text depends only on the universe's languages and which of them the request is answered in
		const language = chooseUniverseLanguage(requested, universe.sourceLanguage, universe.translationLanguages);
		const key = [universe.id, universe.sourceLanguage, universe.translationLanguages.join(','), (language ?? '')].join('\n');
		const now = Date.now();
		const found = this.kept.get(key);

		if (found && (found.expiresAt > now))
		{
			return(found.text);
		}

		const kept: KeptText = {
			universeId: universe.id,
			text: build().then((payload): BuiltUniverseText =>
			{
				const body = JSON.stringify(payload);

				return({
					body,
					etag: `"${createHash('sha256').update(body).digest('base64url')}"`
				});
			}),
			expiresAt: (now + KEPT_TEXT_MS)
		};

		// Text that couldn't be built is built again for the next request
		kept.text.catch(() =>
		{
			if (this.kept.get(key) === kept)
			{
				this.kept.delete(key);
			}
		});

		this.kept.delete(key);
		this.kept.set(key, kept);

		// The map keeps the order text was added in, so the first is the oldest
		for (const oldest of [...this.kept.keys()].slice(0, Math.max(this.kept.size - MAX_KEPT_TEXTS, 0)))
		{
			this.kept.delete(oldest);
		}

		return(kept.text);
	}

	/**
	 * Forgets a universe's text in every language, as when it changes. Requests already waiting for text
	 * being built get it; the next request builds it again
	 *
	 * @param universeId The universe's ID
	 */
	forget(universeId: string): void
	{
		for (const [key, kept] of this.kept)
		{
			if (kept.universeId === universeId)
			{
				this.kept.delete(key);
			}
		}
	}
}

/**
 * The server's universe text, kept for GET UNIVERSES_PATH/:key/text
 */
export const universeTextCache = new UniverseTextCache(areaChanges);
