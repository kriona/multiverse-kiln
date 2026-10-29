/**
 * Checks passwords against HaveIBeenPwned's list of passwords seen in data breaches, with its
 * k-anonymity range API: only the first 5 characters of the password's SHA-1 hash leave the server,
 * and the answer lists every breached hash starting with them
 */
import { createHash } from 'crypto';

const RANGE_URL = 'https://api.pwnedpasswords.com/range/';

/**
 * How long to wait for an answer, in milliseconds
 */
const TIMEOUT_MS = 3000;

/**
 * What the check found: whether the password is breached, or 'unknown' when the service couldn't be asked
 */
export type PwnedCheck = boolean | 'unknown';

/**
 * Checks whether a password has been seen in a data breach
 *
 * The answer is padded with made-up hashes (Add-Padding), so its size doesn't hint at which range was
 * asked for. The padding hashes have a count of 0
 *
 * @param password The password
 * @param fetchRange Fetches the range; tests replace it
 * @return Whether it is breached, or 'unknown' when the service didn't answer, so registering isn't
 * blocked while it is down
 */
export async function checkPwnedPassword(password: string, fetchRange: typeof fetch = fetch): Promise<PwnedCheck>
{
	const sha1 = createHash('sha1')
		.update(password)
		.digest('hex')
		.toUpperCase();
	const prefix = sha1.slice(0, 5);
	const suffix = sha1.slice(5);
	let body: string;

	try
	{
		const response = await fetchRange(`${RANGE_URL}${prefix}`, {
			headers: {
				'Add-Padding': 'true'
			},
			signal: AbortSignal.timeout(TIMEOUT_MS)
		});

		if (!response.ok)
		{
			console.error('The breached password check answered', response.status);
			return('unknown');
		}

		body = await response.text();
	}
	catch (error)
	{
		console.error('The breached password check failed:', error);
		return('unknown');
	}

	for (const line of body.split('\n'))
	{
		const [lineSuffix, count] = line.trim().split(':');

		if ((lineSuffix === suffix) && (Number(count) > 0))
		{
			return(true);
		}
	}

	return(false);
}
