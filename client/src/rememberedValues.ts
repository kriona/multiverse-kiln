/**
 * Values the browser keeps between pages, such as what the server last answered, so a page can show it at
 * once while it asks again. The browser may refuse to keep anything (blocked or full storage, some private
 * windows), so each read can come back empty and each write can be lost; a page still works without them,
 * only waiting for the server
 *
 * Values that belong to the logged-in player (readPlayerValue(), rememberPlayerValue()) are kept apart
 * from the site's and the browser's, under PLAYER_KEY_PREFIX, so they can all be forgotten at once:
 * forgetPlayerValues() runs when the browser logs out, logs in, or finds it is no longer logged in. Closing
 * the browser runs nothing, so they also expire when the session would (rememberPlayerSession()): nothing
 * reads them after that, and the next page forgets them as soon as the server says the session has ended
 */

/**
 * The start of every storage key that holds a value of the logged-in player's.
 * public/remembered-account.js reads two of them itself
 */
const PLAYER_KEY_PREFIX = 'kiln-player.';

/**
 * Where the browser keeps when the session ends if it isn't used again, as milliseconds since 1970
 */
const PLAYER_EXPIRY_KEY = `${PLAYER_KEY_PREFIX}expiresAt`;

/**
 * Where each storage keeps the ID of the player its values belong to. A tab's own storage can outlast
 * a logout in another tab, so its values are only read while its player is the one the browser
 * remembers
 */
const PLAYER_OWNER_KEY = `${PLAYER_KEY_PREFIX}owner`;

/**
 * Which of the browser's storage a value is kept in: 'local' lasts between visits and is shared by
 * the browser's tabs, and 'session' is the tab's own and goes when the tab closes
 */
export type RememberedStorage = 'local' | 'session';

/**
 * The text remembered under a key
 *
 * @param key The storage key
 * @return The text, or null when there is none, or the browser won't keep it
 */
export function readRemembered(key: string): string | null
{
	try
	{
		return(localStorage.getItem(key));
	}
	catch
	{
		return(null);
	}
}

/**
 * Remembers text under a key for later pages, or forgets it
 *
 * @param key The storage key
 * @param value The text, or null to forget it
 */
export function remember(key: string, value: string | null): void
{
	try
	{
		if (value === null)
		{
			localStorage.removeItem(key);
		}
		else
		{
			localStorage.setItem(key, value);
		}
	}
	catch
	{
		// Without storage, later pages wait for the server instead
	}
}

/**
 * The value remembered as JSON under a key. Anything on the same origin can write to the browser's
 * storage, so the value is only returned once the check accepts it
 *
 * @param key The storage key
 * @param check Returns the value when it's valid, or null when it isn't
 * @return The value, or null when there is none, it isn't valid, or the browser won't keep it
 */
export function readRememberedJson<T>(key: string, check: (value: unknown) => T | null): T | null
{
	const text = readRemembered(key);

	if (text === null)
	{
		return(null);
	}

	let value: unknown;

	try
	{
		value = JSON.parse(text);
	}
	catch
	{
		return(null);
	}

	return(check(value));
}

/**
 * Remembers a value as JSON under a key for later pages, or forgets it
 *
 * @param key The storage key
 * @param value The value, or null to forget it
 */
export function rememberJson(key: string, value: unknown): void
{
	remember(key, ((value === null) ? null : JSON.stringify(value)));
}

/**
 * The storage key that holds a value of the logged-in player's, such as to match a storage event
 *
 * @param key The value's key, without PLAYER_KEY_PREFIX
 * @return The storage key
 */
export function playerStorageKey(key: string): string
{
	return(`${PLAYER_KEY_PREFIX}${key}`);
}

/**
 * A value of the logged-in player's, while the session it was remembered with may still be going. A
 * session past its time is only treated as ended here, not forgotten: a window left open keeps it going
 * on the server, so the server's next answer decides (rememberPlayerSession() or forgetPlayerValues()). A
 * tab's own values are forgotten once they belong to another player
 *
 * @param key The value's key, without PLAYER_KEY_PREFIX
 * @param where Which storage it's kept in
 * @return The value, or null when there is none, the session may have ended, or the browser won't keep it
 */
export function readPlayerValue(key: string, where: RememberedStorage = 'local'): string | null
{
	try
	{
		const expiresAt = Number(localStorage.getItem(PLAYER_EXPIRY_KEY));

		if (!(expiresAt > Date.now()))
		{
			return(null);
		}

		const storage = storageOf(where);

		if (storage.getItem(PLAYER_OWNER_KEY) !== localStorage.getItem(PLAYER_OWNER_KEY))
		{
			forgetStoredPlayerValues(storage);
			return(null);
		}

		return(storage.getItem(playerStorageKey(key)));
	}
	catch
	{
		return(null);
	}
}

/**
 * Remembers a value of the logged-in player's for later pages, or forgets it. Nothing is remembered
 * before rememberPlayerSession() has said whose values they are
 *
 * @param key The value's key, without PLAYER_KEY_PREFIX
 * @param value The value, or null to forget it
 * @param where Which storage to keep it in
 */
export function rememberPlayerValue(key: string, value: string | null, where: RememberedStorage = 'local'): void
{
	try
	{
		const storage = storageOf(where);
		const owner = localStorage.getItem(PLAYER_OWNER_KEY);

		if (value === null)
		{
			storage.removeItem(playerStorageKey(key));
		}
		else if (owner !== null)
		{
			storage.setItem(PLAYER_OWNER_KEY, owner);
			storage.setItem(playerStorageKey(key), value);
		}
	}
	catch
	{
		// Without storage, later pages wait for the server instead
	}
}

/**
 * Remembers whose values the browser keeps, and when their session ends if it isn't used again, after
 * which the values are forgotten. Pages call it whenever the server says the browser is logged in, since
 * each use makes the session last longer. Another player's values are forgotten first
 *
 * @param playerId The logged-in player's ID
 * @param expiresInMs How long until their session ends, in milliseconds (SessionPlayer.sessionExpiresInMs)
 */
export function rememberPlayerSession(playerId: string, expiresInMs: number): void
{
	try
	{
		if (localStorage.getItem(PLAYER_OWNER_KEY) !== playerId)
		{
			forgetPlayerValues();
		}

		localStorage.setItem(PLAYER_OWNER_KEY, playerId);
		localStorage.setItem(PLAYER_EXPIRY_KEY, String(Date.now() + expiresInMs));
	}
	catch
	{
		// Without storage, there are no values to expire
	}
}

/**
 * Forgets every value of the logged-in player's, in this tab's storage and in the storage the browser's
 * tabs share. Another tab's own storage is forgotten when the session room tells that tab, or else when
 * it next reads it and finds it belongs to no one or to another player
 */
export function forgetPlayerValues(): void
{
	for (const where of ['local', 'session'] as const)
	{
		try
		{
			forgetStoredPlayerValues(storageOf(where));
		}
		catch
		{
			// Storage that can't be reached holds nothing to forget
		}
	}
}

/**
 * Forgets every value of the logged-in player's in one storage
 *
 * @param storage The storage
 */
function forgetStoredPlayerValues(storage: Storage): void
{
	const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index))
		.filter((key): key is string => ((key !== null) && key.startsWith(PLAYER_KEY_PREFIX)));

	for (const key of keys)
	{
		storage.removeItem(key);
	}
}

/**
 * The browser's storage of a kind
 *
 * @param where Which storage
 * @return The storage, which throws when the browser won't keep anything
 */
function storageOf(where: RememberedStorage): Storage
{
	return(((where === 'local') ? localStorage : sessionStorage));
}
