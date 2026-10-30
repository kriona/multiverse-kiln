import type { Client } from '@colyseus/sdk';
import { AUTH_ACCOUNT_DELETE_PATH, AUTH_CODE_CHECK_PATH, AUTH_CODE_PATH, AUTH_EMAIL_CHANGE_PATH, AUTH_LOGIN_PATH, AUTH_LOGOUT_PATH, AUTH_PASSWORD_CHANGE_PATH, AUTH_PASSWORD_RESET_PATH, AUTH_PROVIDER_CALLBACK_PATH, AUTH_PROVIDER_LINK_PATH, AUTH_PROVIDER_REGISTER_PATH, AUTH_PROVIDER_START_PATH, AUTH_PROVIDERS_PATH, AUTH_RECOVERY_CODES_PATH, AUTH_REGISTER_PATH, AUTH_SESSION_PATH, AUTH_TRUSTED_BROWSERS_FORGET_PATH, AUTH_TWO_FACTOR_DISABLE_PATH, AUTH_TWO_FACTOR_ENABLE_PATH, AUTH_TWO_FACTOR_LOGIN_PATH, AUTH_TWO_FACTOR_SETUP_PATH, AUTH_USERNAME_CHECK_PATH, type AccountDeleteRequest, type AuthField, type EmailChangeRequest, type EmailCodeCheckPayload, type EmailCodeCheckRequest, type EmailCodeRequest, type LoginPayload, type LoginProvider, type LoginRequest, type PasswordChangeRequest, type PasswordResetRequest, type ProviderCallbackPayload, type ProviderCallbackRequest, type ProviderLinkRequest, type ProviderRegisterRequest, type ProvidersPayload, type ProviderStartPayload, type ProviderStartRequest, type RecoveryCodesPayload, type RecoveryCodesRequest, type RegisterRequest, type SessionPayload, type SessionPlayer, type TwoFactorDisableRequest, type TwoFactorEnableRequest, type TwoFactorLoginRequest, type TwoFactorSetupPayload, type TwoFactorSetupRequest, type UsernameCheckRequest } from '@multiverse-kiln/shared';

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
	 * @return Whether the browser is logged in, or the login waits for the account's authenticator code
	 */
	async logIn(login: LoginRequest): Promise<LoginPayload['outcome']>
	{
		return((await sendRequest<LoginPayload>(this.client, 'POST', AUTH_LOGIN_PATH, login)).outcome);
	}

	/**
	 * Finishes a login that waits for the account's authenticator or recovery code
	 *
	 * @param request The code, and whether to trust the browser
	 */
	async finishTwoFactorLogin(request: TwoFactorLoginRequest): Promise<void>
	{
		await sendRequest(this.client, 'POST', AUTH_TWO_FACTOR_LOGIN_PATH, request);
	}

	/**
	 * Starts turning on 2FA for the logged-in account
	 *
	 * @param request The account's password
	 * @return The secret for the authenticator app
	 */
	async setUpTwoFactor(request: TwoFactorSetupRequest): Promise<TwoFactorSetupPayload>
	{
		return(await sendRequest<TwoFactorSetupPayload>(this.client, 'POST', AUTH_TWO_FACTOR_SETUP_PATH, request));
	}

	/**
	 * Turns on 2FA, with a code from the authenticator app just set up
	 *
	 * @param request The code
	 * @return The account's recovery codes
	 */
	async enableTwoFactor(request: TwoFactorEnableRequest): Promise<string[]>
	{
		return((await sendRequest<RecoveryCodesPayload>(this.client, 'POST', AUTH_TWO_FACTOR_ENABLE_PATH, request)).recoveryCodes);
	}

	/**
	 * Turns off 2FA
	 *
	 * @param request The password, and an authenticator or recovery code
	 */
	async disableTwoFactor(request: TwoFactorDisableRequest): Promise<void>
	{
		await sendRequest(this.client, 'POST', AUTH_TWO_FACTOR_DISABLE_PATH, request);
	}

	/**
	 * Replaces the account's recovery codes
	 *
	 * @param request The password, and an authenticator or recovery code
	 * @return The new codes
	 */
	async replaceRecoveryCodes(request: RecoveryCodesRequest): Promise<string[]>
	{
		return((await sendRequest<RecoveryCodesPayload>(this.client, 'POST', AUTH_RECOVERY_CODES_PATH, request)).recoveryCodes);
	}

	/**
	 * Stops trusting every browser the account trusted to skip the authenticator code
	 */
	async forgetTrustedBrowsers(): Promise<void>
	{
		await sendRequest(this.client, 'POST', AUTH_TRUSTED_BROWSERS_FORGET_PATH);
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
	 * @return Whether the next step needs the account's authenticator or recovery code too
	 */
	async checkCode(request: EmailCodeCheckRequest): Promise<boolean>
	{
		return((await sendRequest<EmailCodeCheckPayload>(this.client, 'POST', AUTH_CODE_CHECK_PATH, request)).twoFactor);
	}

	/**
	 * Checks whether a new account could take a username, from a browser creating one
	 *
	 * @param request The username
	 * @throws EditorApiError saying why it can't, such as another account having it
	 */
	async checkUsername(request: UsernameCheckRequest): Promise<void>
	{
		await sendRequest(this.client, 'POST', AUTH_USERNAME_CHECK_PATH, request);
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
	 * Changes the logged-in account's email address, once the code sent to the new address has been entered
	 *
	 * @param request The new address
	 */
	async changeEmail(request: EmailChangeRequest): Promise<void>
	{
		await sendRequest(this.client, 'POST', AUTH_EMAIL_CHANGE_PATH, request);
	}

	/**
	 * Changes the logged-in account's password, logging out every other browser
	 *
	 * @param request The current password and the new one
	 */
	async changePassword(request: PasswordChangeRequest): Promise<void>
	{
		await sendRequest(this.client, 'POST', AUTH_PASSWORD_CHANGE_PATH, request);
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

	/**
	 * Deletes the logged-in account, logging out every browser logged in to it
	 *
	 * @param request How the player confirms, and what becomes of each universe they are the only creator of
	 */
	async deleteAccount(request: AccountDeleteRequest): Promise<void>
	{
		await sendRequest(this.client, 'POST', AUTH_ACCOUNT_DELETE_PATH, request);
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

	return((((field === 'email') || (field === 'password') || (field === 'currentPassword') || (field === 'username') || (field === 'displayName') || (field === 'code') || (field === 'twoFactorCode')) ? field : undefined));
}
