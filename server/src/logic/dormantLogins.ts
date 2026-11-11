/**
 * Which password logins need a code emailed to the account first (see Login in STRUCTURE-OVERVIEW.md)
 */
import { DORMANT_LOGIN_DAYS } from '@multiverse-kiln/shared';

const DAY_MS = (24 * 60 * 60 * 1000);

/**
 * What a login checks about the account it logs in to
 */
export interface LoginAccount
{
	/**
	 * When the account last logged in, or null when it never has
	 */
	lastLoginAt: Date | null;

	createdAt: Date;
	hasTwoFactor: boolean;
}

/**
 * Whether logging in to an account with its password also needs a code emailed to it: the account has
 * no 2FA, which would check it's the owner already, and hasn't logged in for DORMANT_LOGIN_DAYS. An
 * account that never logged in counts from when it was made
 *
 * @param account The account
 * @param now The time now
 * @return Whether it does
 */
export function needsLoginEmailCode(account: LoginAccount, now: Date): boolean
{
	if (account.hasTwoFactor)
	{
		return(false);
	}

	const lastActive = (account.lastLoginAt ?? account.createdAt);

	return((now.getTime() - lastActive.getTime()) >= (DORMANT_LOGIN_DAYS * DAY_MS));
}
