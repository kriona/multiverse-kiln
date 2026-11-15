import { DEV_SUSPICIOUS_COOKIE } from '@multiverse-kiln/shared';
import type { Request } from 'express';

import { isDevToolsEnabled } from '../devTools.js';
import { readCookie } from '../http/cookies.js';

/**
 * Whether a browser asked to act suspicious, for testing bot checks on a local development server: the
 * login page's dev toggle sets DEV_SUSPICIOUS_COOKIE. Such a browser is asked for a check at every login
 * and email code, as the admin setting that checks every request would, and isn't known to any account
 * (knownBrowserHash()), so a developer's own browser is asked too. Only while dev tools are on
 * (isDevToolsEnabled()), which they never are in production
 *
 * @param request The request
 * @param env Environment variables to read
 * @return Whether the browser acts suspicious
 */
export function isDevSuspicious(request: Request, env: NodeJS.ProcessEnv = process.env): boolean
{
	return(isDevToolsEnabled(env) && (readCookie(request.headers.cookie, DEV_SUSPICIOUS_COOKIE) === '1'));
}
