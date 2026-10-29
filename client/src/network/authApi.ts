import type { Client } from '@colyseus/sdk';
import { AUTH_CODE_CHECK_PATH, AUTH_CODE_PATH, AUTH_LOGIN_PATH, AUTH_LOGOUT_PATH, AUTH_PASSWORD_RESET_PATH, AUTH_PROVIDER_CALLBACK_PATH, AUTH_PROVIDER_LINK_PATH, AUTH_PROVIDER_REGISTER_PATH, AUTH_PROVIDER_START_PATH, AUTH_PROVIDERS_PATH, AUTH_REGISTER_PATH, AUTH_SESSION_PATH, type AuthField, type EmailCodeCheckRequest, type EmailCodeRequest, type LoginProvider, type LoginRequest, type PasswordResetRequest, type ProviderCallbackPayload, type ProviderCallbackRequest, type ProviderLinkRequest, type ProviderRegisterRequest, type ProvidersPayload, type ProviderStartPayload, type ProviderStartRequest, type RegisterRequest, type SessionPayload, type SessionPlayer } from '@multiverse-kiln/shared';

import { EditorApiError, sendRequest } from './editorApi';

/**
 * The auth routes (see shared/src/accounts.ts), for one browser
 *
 * The server answers logins with the session cookie, which the browser then sends with every request
 * and room connection. Every method throws EditorApiError when the server refuses the request; its
 * message says why, in the player's language, and authFieldOf() which field it is about
 */
export class AuthApi
{
	/**
	 * @param client Client for the server
	 */
	constructor(private readonly client: Client)
	{
	}

	/**
	 * Who the browser is logged in as
	 *
	 * @return The player, or null when it isn't logged in
	 */
	async getSession(): Promise<SessionPlayer | null>
	{
		return((await sendRequest<SessionPayload>(this.client, 'GET', AUTH_SESSION_PATH)).player);
	}

	/**
	 * Logs in to a local account
	 *
	 * @param login The address, password and whether to remember the browser
	 */
	async logIn(login: LoginRequest): Promise<void>
	{
		await sendRequest(this.client, 'POST', AUTH_LOGIN_PATH, login);
	}

	/**
	 * Logs the browser out, which logs out all of its windows
	 */
	async logOut(): Promise<void>
	{
		await sendRequest(this.client, 'POST', AUTH_LOGOUT_PATH);
	}

	/**
	 * Asks for a code to be emailed. The server answers the same whether or not one is sent
	 *
	 * @param request What the code is for, and the address
	 */
	async sendCode(request: EmailCodeRequest): Promise<void>
	{
		await sendRequest(this.client, 'POST', AUTH_CODE_PATH, request);
	}

	/**
	 * Enters a code, which lets this browser take the next step
	 *
	 * @param request What the code is for, the address and the code as typed
	 */
	async checkCode(request: EmailCodeCheckRequest): Promise<void>
	{
		await sendRequest(this.client, 'POST', AUTH_CODE_CHECK_PATH, request);
	}

	/**
	 * Creates a local account, once its code has been entered, and logs the browser in
	 *
	 * @param request The account
	 */
	async register(request: RegisterRequest): Promise<void>
	{
		await sendRequest(this.client, 'POST', AUTH_REGISTER_PATH, request);
	}

	/**
	 * Sets a new password, once the reset code has been entered, and logs the browser in
	 *
	 * @param request The password
	 */
	async resetPassword(request: PasswordResetRequest): Promise<void>
	{
		await sendRequest(this.client, 'POST', AUTH_PASSWORD_RESET_PATH, request);
	}

	/**
	 * The login providers the site offers
	 *
	 * @return The providers
	 */
	async getProviders(): Promise<LoginProvider[]>
	{
		return((await sendRequest<ProvidersPayload>(this.client, 'GET', AUTH_PROVIDERS_PATH)).providers);
	}

	/**
	 * Starts logging in with a provider
	 *
	 * @param request The provider, and whether to remember the browser
	 * @return The provider's page to send the browser to
	 */
	async startProviderLogin(request: ProviderStartRequest): Promise<string>
	{
		return((await sendRequest<ProviderStartPayload>(this.client, 'POST', AUTH_PROVIDER_START_PATH, request)).url);
	}

	/**
	 * Finishes logging in with a provider, with what it sent the browser back with
	 *
	 * @param request The code and state from the page's address
	 * @return Whether the browser is logged in, or the step the player takes next
	 */
	async finishProviderLogin(request: ProviderCallbackRequest): Promise<ProviderCallbackPayload>
	{
		return(await sendRequest<ProviderCallbackPayload>(this.client, 'POST', AUTH_PROVIDER_CALLBACK_PATH, request));
	}

	/**
	 * Creates an account for the provider login this browser came back with, and logs the browser in
	 *
	 * @param request The account's username and name
	 */
	async registerWithProvider(request: ProviderRegisterRequest): Promise<void>
	{
		await sendRequest(this.client, 'POST', AUTH_PROVIDER_REGISTER_PATH, request);
	}

	/**
	 * Links the provider login this browser came back with to the account with its email address, and
	 * logs the browser in
	 *
	 * @param request The account's password, or null once a code sent to its address has been entered
	 */
	async linkProvider(request: ProviderLinkRequest): Promise<void>
	{
		await sendRequest(this.client, 'POST', AUTH_PROVIDER_LINK_PATH, request);
	}
}

/**
 * The field a refused auth request is about
 *
 * @param error What an AuthApi method threw
 * @return The field, or undefined when the refusal isn't about one
 */
export function authFieldOf(error: unknown): AuthField | undefined
{
	if (!(error instanceof EditorApiError) || (typeof error.data !== 'object') || (error.data === null) || !('field' in error.data))
	{
		return(undefined);
	}

	const field = error.data.field;

	return((((field === 'email') || (field === 'password') || (field === 'username') || (field === 'displayName') || (field === 'code')) ? field : undefined));
}
