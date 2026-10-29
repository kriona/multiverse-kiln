/**
 * Google and Discord logins through OAuth 2.0 with PKCE (see Login in STRUCTURE-OVERVIEW.md), using
 * arctic. A provider is offered once its client ID and secret are set; each is told to send the browser
 * back to the login page (PROVIDER_RETURN_PATH under SITE_URL), which hands the code to the server
 */
import { ArcticFetchError, decodeIdToken, Discord, Google, OAuth2RequestError } from 'arctic';
import { z } from 'zod';
import { LOGIN_PROVIDER_NAMES, LOGIN_PROVIDERS, MAX_PLAYER_NAME_LENGTH, PROVIDER_RETURN_PATH, type LoginProvider } from '@multiverse-kiln/shared';

/**
 * The player a provider logged in, as it describes them
 */
export interface ProviderUser
{
	/**
	 * The provider's ID for the player, which never changes
	 */
	providerUserId: string;

	/**
	 * Their email address, or null when the provider has none for them
	 */
	email: string | null;

	/**
	 * Whether the provider checked that the player can read the address's email
	 */
	emailVerified: boolean;

	/**
	 * The provider's name for them, at most MAX_PLAYER_NAME_LENGTH characters, and empty when it has none
	 */
	displayName: string;
}

/**
 * One provider's side of a login
 */
export interface ProviderClient
{
	/**
	 * The provider's page that asks the player to log in
	 *
	 * @param state The value the provider sends back with the code, to match the browser that started
	 * @param codeVerifier The PKCE secret, whose hash goes in the address
	 * @return The page's address
	 */
	authorizationUrl(state: string, codeVerifier: string): URL;

	/**
	 * Trades the code the provider sent back for the player it logged in
	 *
	 * @param code The code
	 * @param codeVerifier The PKCE secret the login started with
	 * @return The player
	 * @throws ProviderLoginError when the provider refuses the code or can't be reached
	 */
	fetchUser(code: string, codeVerifier: string): Promise<ProviderUser>;
}

/**
 * Thrown when a provider refuses a code (it is wrong, used or expired), or doesn't answer properly
 */
export class ProviderLoginError extends Error
{
	/**
	 * @param reason Whether the provider refused the code, or couldn't be reached or answered strangely
	 * @param cause What went wrong
	 */
	constructor(readonly reason: 'refused' | 'unavailable', cause: unknown)
	{
		super(`The provider ${(reason === 'refused') ? 'refused the login' : 'could not be reached'}`, { cause });
		this.name = 'ProviderLoginError';
	}
}

/**
 * The claims of a Google ID token that a login uses
 */
const googleClaims = z.object({
	sub: z.string().min(1),
	email: z.string().optional(),
	email_verified: z.boolean().optional(),
	name: z.string().optional()
});

/**
 * The fields of Discord's user that a login uses
 */
const discordUser = z.object({
	id: z.string().min(1),
	username: z.string(),
	global_name: z.string().nullish(),
	email: z.string().nullish(),
	verified: z.boolean().optional()
});

/**
 * Where Discord describes the user an access token is for
 */
const DISCORD_USER_URL = 'https://discord.com/api/users/@me';

let clients: Map<LoginProvider, ProviderClient> | undefined;
let replacements: Partial<Record<LoginProvider, ProviderClient>> | undefined;

/**
 * A provider's name for a player, cut to the longest name a player can have
 *
 * @param name The name, if the provider has one
 * @return The name, trimmed, or empty
 */
function providerDisplayName(name: string | null | undefined): string
{
	return([...(name ?? '').trim()].slice(0, MAX_PLAYER_NAME_LENGTH).join('').trim());
}

/**
 * Runs a request to a provider, turning its failures into ProviderLoginErrors
 *
 * @param request The request
 * @return What it returns
 */
async function askProvider<T>(request: () => Promise<T>): Promise<T>
{
	try
	{
		return(await request());
	}
	catch (error)
	{
		if (error instanceof OAuth2RequestError)
		{
			throw new ProviderLoginError('refused', error);
		}

		if ((error instanceof ArcticFetchError) || (error instanceof z.ZodError) || (error instanceof SyntaxError))
		{
			throw new ProviderLoginError('unavailable', error);
		}

		throw error;
	}
}

/**
 * Makes Google's client. Its ID token comes straight from Google over TLS, so its claims are read
 * without checking its signature
 *
 * @param clientId The OAuth client's ID
 * @param clientSecret Its secret
 * @param redirectUri Where Google sends the browser back to
 * @return The client
 */
function createGoogleClient(clientId: string, clientSecret: string, redirectUri: string): ProviderClient
{
	const google = new Google(clientId, clientSecret, redirectUri);

	return({
		authorizationUrl: (state, codeVerifier) => google.createAuthorizationURL(state, codeVerifier, ['openid', 'email', 'profile']),
		fetchUser: (code, codeVerifier) => askProvider(async () =>
		{
			const tokens = await google.validateAuthorizationCode(code, codeVerifier);
			const claims = googleClaims.parse(decodeIdToken(tokens.idToken()));

			return({
				providerUserId: claims.sub,
				email: (claims.email ?? null),
				emailVerified: (claims.email_verified === true),
				displayName: providerDisplayName(claims.name)
			});
		})
	});
}

/**
 * Makes Discord's client
 *
 * @param clientId The OAuth client's ID
 * @param clientSecret Its secret
 * @param redirectUri Where Discord sends the browser back to
 * @return The client
 */
function createDiscordClient(clientId: string, clientSecret: string, redirectUri: string): ProviderClient
{
	const discord = new Discord(clientId, clientSecret, redirectUri);

	return({
		authorizationUrl: (state, codeVerifier) => discord.createAuthorizationURL(state, codeVerifier, ['identify', 'email']),
		fetchUser: (code, codeVerifier) => askProvider(async () =>
		{
			const tokens = await discord.validateAuthorizationCode(code, codeVerifier);
			let response: Response;

			try
			{
				response = await fetch(DISCORD_USER_URL, {
					headers: {
						Authorization: `Bearer ${tokens.accessToken()}`
					}
				});
			}
			catch (error)
			{
				throw new ProviderLoginError('unavailable', error);
			}

			if (!response.ok)
			{
				throw new ProviderLoginError('unavailable', new Error(`Discord answered ${response.status}`));
			}

			const user = discordUser.parse(await response.json());

			return({
				providerUserId: user.id,
				email: (user.email ?? null),
				emailVerified: (user.verified === true),
				displayName: providerDisplayName(user.global_name ?? user.username)
			});
		})
	});
}

/**
 * Makes the clients of the providers whose ID and secret are set
 *
 * @return The clients
 */
function createClients(): Map<LoginProvider, ProviderClient>
{
	const created = new Map<LoginProvider, ProviderClient>();
	const factories: Record<LoginProvider, typeof createGoogleClient> = {
		google: createGoogleClient,
		discord: createDiscordClient
	};

	for (const provider of LOGIN_PROVIDERS)
	{
		const prefix = provider.toUpperCase();
		const clientId = process.env[`${prefix}_CLIENT_ID`];
		const clientSecret = process.env[`${prefix}_CLIENT_SECRET`];

		if (!clientId && !clientSecret)
		{
			continue;
		}

		if (!clientId || !clientSecret)
		{
			throw new Error(`Set both ${prefix}_CLIENT_ID and ${prefix}_CLIENT_SECRET, or neither. See server/.env.example`);
		}

		const siteUrl = process.env.SITE_URL;

		if (!siteUrl)
		{
			throw new Error(`SITE_URL is not set, and ${LOGIN_PROVIDER_NAMES[provider]} logins need it. See server/.env.example`);
		}

		created.set(provider, factories[provider](clientId, clientSecret, new URL(PROVIDER_RETURN_PATH, siteUrl).toString()));
	}

	return(created);
}

/**
 * A provider's client, if the site offers it
 *
 * @param provider The provider
 * @return Its client, or undefined when its ID and secret aren't set
 */
export function providerClient(provider: LoginProvider): ProviderClient | undefined
{
	if (replacements)
	{
		return(replacements[provider]);
	}

	clients ??= createClients();

	return(clients.get(provider));
}

/**
 * The providers the site offers
 *
 * @return Them, in LOGIN_PROVIDERS's order
 */
export function enabledProviders(): LoginProvider[]
{
	return(LOGIN_PROVIDERS.filter((provider) => (providerClient(provider) !== undefined)));
}

/**
 * Replaces the providers' clients, for tests: only the providers given are offered
 *
 * @param replacement The clients, or undefined to use the real ones again
 */
export function setProviderClients(replacement: Partial<Record<LoginProvider, ProviderClient>> | undefined): void
{
	replacements = replacement;
}
