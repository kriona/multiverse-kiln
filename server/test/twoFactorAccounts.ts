/**
 * Accounts with 2FA for tests, and the authenticator codes their app would show
 */
import { randomBytes } from 'crypto';

import { keyedHash } from '../src/auth/keyedHashes.js';
import { encryptTotpSecret } from '../src/auth/totpSecrets.js';
import { enableAuthenticator, replaceRecoveryCodes, saveAuthenticatorSetup } from '../src/db/twoFactorRepo.js';
import { formatRecoveryCode, recoveryCodeFromBytes, RECOVERY_CODE_LENGTH, TOTP_SECRET_BYTES, totpCode, totpStep } from '../src/logic/twoFactor.js';

/**
 * What a test knows of an account's 2FA
 */
export interface TestAuthenticator
{
	secret: Buffer;

	/**
	 * The recovery codes, as shown to the player
	 */
	recoveryCodes: string[];
}

/**
 * Turns on 2FA for an account, as setting it up from the profile would
 *
 * @param playerId The account
 * @return The authenticator's secret and the recovery codes
 */
export async function turnOnTwoFactor(playerId: string): Promise<TestAuthenticator>
{
	const secret = randomBytes(TOTP_SECRET_BYTES);
	const codes = [0, 1, 2].map(() => recoveryCodeFromBytes(randomBytes(RECOVERY_CODE_LENGTH)));
	const now = new Date();

	await saveAuthenticatorSetup(playerId, encryptTotpSecret(secret, playerId), now);
	// As if a code from a minute ago had been used, so every code from now on works
	await enableAuthenticator(playerId, (totpStep(now) - 2), now);
	await replaceRecoveryCodes(playerId, codes.map((code) => keyedHash('recoveryCode', code)));

	return({
		secret,
		recoveryCodes: codes.map(formatRecoveryCode)
	});
}

/**
 * The code an authenticator app shows
 *
 * @param secret The app's secret
 * @param stepsAhead How many 30-second steps after now, for a second code within the same step (a code works once)
 * @return The code
 */
export function authenticatorCode(secret: Uint8Array, stepsAhead: number = 0): string
{
	return(totpCode(secret, (totpStep(new Date()) + stepsAhead)));
}
