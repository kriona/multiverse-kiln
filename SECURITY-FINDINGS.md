# Security findings: authentication, sessions and access control

A static review of the server's auth code as it stands in the working tree on `phase-14` (commit `193048e` plus the uncommitted changes), on 2026-10-29. It covers `server/src/auth/`, `server/src/http/auth.ts`, `authCommon.ts`, `twoFactorAuth.ts`, `providerAuth.ts`, `accountDeletion.ts`, `cookies.ts`, `clientNetwork.ts` and `admin.ts`, the logic modules behind them (email codes, TOTP, sessions, networks), the repositories they call (`playerRepo.ts`, `emailCodeRepo.ts`, `rateLimitRepo.ts`, `sessionRepo.ts`, `twoFactorRepo.ts`), and the login page's `next` redirect.

This combines two separate reviews of the same code. Findings both reported are merged into one. Findings are ranked most severe first, and the six categories reviewed are summarized at the end, each with its verdict.

---

## 1. The unsigned provider start cookie lets a stolen session link a provider without re-authenticating

- **Status:** Fixed. The start cookie carries a keyed hash (`encodeProviderStart()` and `readProviderStart()` in `providerAuth.ts`), and `server/test/providerAuth.test.ts` checks that a changed cookie is refused.
- **Vulnerability Title:** CWE-565: Reliance on Cookies without Validation and Integrity Checking (leads to CWE-306: Missing Authentication for Critical Function)
- **Severity:** High
- **Affected File / Line:** `server/src/http/providerAuth.ts:318` (cookie written as plain base64url JSON), `:210` `readProviderStart()` (read back with no integrity check), `:443` (the callback trusts `start.playerId`)
- **Background:** Linking Google or Discord from the profile asks for the password (and the 2FA code when it's on) through `confirmLink()`. Without that check, someone who gets a session once can link their own provider login and keep getting in, past 2FA (finding 5) and past the victim changing their password, since neither a password change nor a reset removes provider logins. The start cookie lets an attacker skip `confirmLink()`.
- **Attack Scenario:**
	1. The attacker has a victim's session cookie (a shared computer, a later XSS bug, malware).
	2. In their own browser, holding that session, they call `POST AUTH_PROVIDER_START_PATH` with `link: null`. This is an ordinary login start, so `confirmLink()` never runs. The answer sets `__Host-kiln-provider-start` and returns the Google authorization URL.
	3. They decode the cookie (base64url JSON), change `"playerId": null` to the victim's player ID (from `GET AUTH_SESSION_PATH`), re-encode it and put it back. `HttpOnly` stops page scripts, not the person who owns the browser or uses curl.
	4. They log in to Google with their own account, and the login page posts `code` + `state` to the callback. The state matches, `session.playerId === start.playerId` holds, and `linkToSession()` links the attacker's Google login to the victim's account.
	5. From then on, the attacker logs in with Google. Provider logins skip local 2FA (finding 5) and outlive the victim's password change or reset. The "provider linked" email is the victim's only warning.
- **Secure Remediation Code:** MAC the cookie with the server's key, so the server only trusts a start it wrote itself. Add a kind to `KeyedHashKind` in `server/src/auth/keyedHashes.ts`:

```ts
export type KeyedHashKind = 'address' | 'emailCode' | 'network' | 'recoveryCode' | 'account' | 'providerStart';
```

In `server/src/http/providerAuth.ts`, import `keyedHash` next to `hashAddress, hashesMatch`, and write and read the cookie through these functions:

```ts
/**
 * The start cookie's value: the start as base64url JSON, then a keyed hash of it, so the server
 * reads back only a start it wrote
 *
 * @param start What the login started with
 * @return The cookie's value
 */
function encodeProviderStart(start: ProviderStart): string
{
	const body = Buffer.from(JSON.stringify(start)).toString('base64url');

	return(`${body}.${keyedHash('providerStart', body).toString('base64url')}`);
}

/**
 * Reads the start cookie
 *
 * @param request The request
 * @return What the login started with, or undefined when the browser has no start cookie, or it is
 * unreadable or wasn't written by this server
 */
function readProviderStart(request: Request): ProviderStart | undefined
{
	const value = readCookie(request.headers.cookie, PROVIDER_START_COOKIE);
	const [body, mac, extra] = (value ?? '').split('.');

	if (!body || !mac || (extra !== undefined) || !hashesMatch(keyedHash('providerStart', body), Buffer.from(mac, 'base64url')))
	{
		return(undefined);
	}

	try
	{
		const parsed = providerStart.safeParse(JSON.parse(Buffer.from(body, 'base64url').toString('utf8')));

		return((parsed.success ? parsed.data : undefined));
	}
	catch
	{
		return(undefined);
	}
}
```

```ts
	setCookie(response, PROVIDER_START_COOKIE, encodeProviderStart(start), PROVIDER_START_LIFETIME_MS);
```

The MAC covers the whole start, including `codeVerifier`, `rememberMe` and `provider`. Another option is to keep the start in the database under the hash of a random token, the way pending provider logins are kept. Add a test that changes `playerId` in a real start cookie and expects the callback to refuse it.

---

## 3. Changing the email address needs only the session

- **Status:** Fixed. `emailChangeRoute()` asks for the password, or for an account without one, a code sent to its current address (purpose `confirmEmailChange`, entered before the new address's code, which takes the same continuation token), and the 2FA code even from a trusted browser. It logs out every other session. Tests are in `server/test/auth.test.ts`.

- **Vulnerability Title:** CWE-620: Unverified Password Change (here, a change of the recovery address, which then allows a password reset)
- **Severity:** Medium (High for accounts without 2FA)
- **Affected File / Line:** `server/src/http/auth.ts:403` (the `changeEmail` code request), `:844` `emailChangeRoute()`
- **Attack Scenario:**
	1. The attacker holds a session for an account without 2FA.
	2. They ask for a `changeEmail` code for an address they control, enter it, and call `emailChangeRoute`. Neither step asks for the current password.
	3. They ask for a password reset to the new address and set a new password. The reset ends every other session, so the victim is logged out. The old address gets an "email changed" notice, but the victim has no way to undo the change.
	4. The email change itself also leaves the account's other sessions logged in, so a victim who notices still has no immediate way to end them.
- **Secure Remediation Code:** Ask for the password (or, for an account without one, a code sent to the current address) and the 2FA code before the change, and end the other sessions afterward. Sending a code to the old address as well would also work. In `shared/src/accounts.ts`:

```ts
export interface EmailChangeRequest
{
	email: string;
	locale: string;

	/**
	 * The account's current password, or null when it has none
	 */
	currentPassword: string | null;

	/**
	 * The authenticator or recovery code, when the account has 2FA
	 */
	twoFactorCode: string | null;
}
```

In `emailChangeRoute()`, after the session check and before the transaction (`checkAccountPassword` is exported from `twoFactorAuth.ts` and counts against the login limits):

```ts
	if ((await findPasswordHash(session.playerId)) !== null)
	{
		const problem = await checkAccountPassword(request, response, session.playerId, (body.data.currentPassword ?? ''), now);

		if (problem)
		{
			sendRefusal(response, problem);
			return;
		}
	}
```

Inside the transaction, after `lockContinuation`:

```ts
		const check = await checkSecondFactor(request, response, session.playerId, body.data.twoFactorCode, now, executor, { trustedBrowserSkips: false });

		if ((check.kind === 'wrong') || (check.kind === 'refused'))
		{
			return(check.refusal);
		}
```

After `saveEmail`:

```ts
		const ended = await deletePlayerSessions(session.playerId, executor, session.sessionId);
```

Then call `connectedSessions.end(ended)` once the transaction commits, the way `passwordChangeRoute` does. For an account without a password, a code sent to the current address works in place of the password, the way `confirmLink()` uses one.

---

## 4. The client address trusts X-Real-IP first, which may be spoofable

- **Status:** Fixed in code; the setting is still to be confirmed on the host. `clientNetwork.ts` trusts only the header `CLIENT_ADDRESS_HEADER` names, and from X-Forwarded-For only the entry `TRUSTED_PROXY_HOPS` places from the end. Unset, it uses the connection's address, and the server won't start on Colyseus Cloud without it. Choosing the value for the host and checking it once deployed is the TODO at the end of `PLAN.md`.

- **Vulnerability Title:** CWE-348: Use of Less Trusted Source
- **Severity:** Medium (depends on the proxy's configuration, which the code can't check)
- **Affected File / Line:** `server/src/http/clientNetwork.ts:45` `proxiedAddress()`
- **Attack Scenario:**
	1. On Colyseus Cloud, `proxiedAddress()` uses `X-Real-IP` when it is present, and only falls back to the last entry of `X-Forwarded-For`.
	2. If Cloud's proxy appends to `X-Forwarded-For` but doesn't set or overwrite `X-Real-IP` (nginx sets it only with an explicit `proxy_set_header X-Real-IP`), the header comes straight from the client.
	3. The attacker sends a random `X-Real-IP` on every request. Each request then counts as a new network, which disables every per-network limit: logins (30 an hour), code sends, code guesses and the network part of the 2FA limit. Credential stuffing across many accounts then runs into nothing but the 10-per-address limit.
- **Secure Remediation Code:** Trust exactly one header, one the proxy is confirmed to overwrite. Check this against a Cloud deployment, for example by sending a forged `X-Real-IP` and logging what arrives. If `X-Forwarded-For` is the one the proxy appends to:

```ts
/**
 * The client address Colyseus Cloud's proxy forwards: the last entry of X-Forwarded-For, which the
 * proxy adds. Earlier entries, and X-Real-IP, can come from the client
 *
 * @param request The request
 * @return The address, or undefined when the proxy sent no header
 */
function proxiedAddress(request: Request): string | undefined
{
	return(request.get('x-forwarded-for')
		?.split(',')
		.pop()
		?.trim());
}
```

Add a test that sends both headers with `COLYSEUS_CLOUD` set and checks which one wins.

---

## 5. Provider logins skip the account's 2FA

- **Status:** Fixed. A provider login to an account with 2FA, from a browser it doesn't trust, answers `{ outcome: 'twoFactor' }` and waits for the authenticator or recovery code at `AUTH_TWO_FACTOR_LOGIN_PATH`, the same step as a password login (`providerAuth.ts`, tested in `server/test/providerAuth.test.ts`).

- **Vulnerability Title:** CWE-308: Use of Single-factor Authentication
- **Severity:** Low as a design choice on its own, High combined with finding 1
- **Affected File / Line:** `server/src/http/providerAuth.ts:519-525` (an account's linked provider login starts a session straight away)
- **Attack Scenario:**
	1. An account has 2FA on and a linked Google login, either added honestly or through finding 1.
	2. Anyone who can log in to that Google account (a phished Google password on a Google account without its own 2FA) gets a session here, with no authenticator code asked for.
	3. The account's 2FA protects only the password path. The 2FA setup text says Google and Discord "ask for their own", but they only do when the player has set it up there.
- **Secure Remediation Code:** When the account has 2FA and the browser isn't trusted, send the provider login through the same pending 2FA step as a password login. This needs a `twoFactor` outcome added to `ProviderCallbackPayload`, and the login page sending it to the existing 2FA form:

```ts
		if (playerId !== undefined)
		{
			if (await needsSecondFactor(request, playerId, now, executor))
			{
				await savePendingTwoFactorLogin({
					continuationHash: hashToken(token),
					playerId,
					rememberMe,
					expiresAt: new Date(now.getTime() + CONTINUATION_LIFETIME_MS)
				}, executor);

				return({ outcome: 'twoFactor' });
			}

			await startSession(response, playerId, rememberMe, executor);
			await recordEvent(request, playerId, 'loggedIn', now, executor);
			return({ outcome: 'loggedIn' });
		}
```

```ts
	if (payload.outcome === 'twoFactor')
	{
		setCookie(response, TWO_FACTOR_LOGIN_COOKIE, token, CONTINUATION_LIFETIME_MS);
	}
	else if (payload.outcome !== 'loggedIn')
	{
		setCookie(response, PROVIDER_LOGIN_COOKIE, token, CONTINUATION_LIFETIME_MS);
	}
```

If skipping 2FA is kept on purpose, write the trade-off down in `STRUCTURE-OVERVIEW.md` and fix finding 1 regardless.

---

## 6. Unauthenticated requests make the server run Argon2 and the breach check before any limit

- **Status:** Fixed. `registerRoute()` and `passwordResetRoute()` check that the browser entered a code (`codeWasEntered()` in `auth.ts`) before the breach check and the hash, and the transaction checks again. Tested in `server/test/auth.test.ts`.

- **Vulnerability Title:** CWE-770: Allocation of Resources Without Limits or Throttling
- **Severity:** Low
- **Affected File / Line:** `server/src/http/auth.ts:643` `registerRoute()` and `:755` `passwordResetRoute()` (the breach check runs before them, then `hashPassword` at `:667` and `:777`)
- **Attack Scenario:**
	1. The attacker sends many `register` or `passwordReset` requests with a made-up `__Host-kiln-continue` cookie (any 43 base64url characters pass `isTokenForm`) and a 15-character password.
	2. Before the continuation token is looked up, each request makes an outbound HaveIBeenPwned request, and then an Argon2id hash (19 MiB, about 50 ms of CPU).
	3. No per-network limit applies, so a modest number of concurrent requests ties up the server's memory and CPU, and its HIBP quota or goodwill.
- **Secure Remediation Code:** Look up the continuation first (an indexed select), and do the expensive work only for a browser that really entered a code. In `passwordResetRoute()`:

```ts
	const problem = (checkPasswordLength(password)
		?? ((continuationHash === undefined) ? { status: 403, message: authMessages.enterCodeFirst } : undefined));

	if (problem)
	{
		sendRefusal(response, problem);
		return;
	}

	const now = new Date();

	if (!(await inTransaction((executor) => lockContinuation('resetPassword', continuationHash as Buffer, now, executor))))
	{
		sendRefusal(response, {
			status: 403,
			message: authMessages.enterCodeFirst
		});
		return;
	}

	const breached = await checkBreachedPassword(password);

	if (breached)
	{
		sendRefusal(response, breached);
		return;
	}

	const passwordHash = await hashPassword(password);
```

The transaction that follows still locks the continuation and checks it again. Do the same in `registerRoute()`.

---

## 7. Anyone can lock someone out of password login

- **Status:** Fixed. Every login gives the browser a signed cookie (`server/src/auth/knownBrowsers.ts`) that doesn't name the account and keeps nothing on the server. At login, a browser whose cookie was made for the address's account counts its own 10 tries an hour (`browserLoginAttempt`) in place of the address's, so others' guesses can't lock it out. Tested in `server/test/auth.test.ts`.

- **Vulnerability Title:** CWE-645: Overly Restrictive Account Lockout Mechanism
- **Severity:** Low
- **Affected File / Line:** `server/src/http/auth.ts:272-283` (`addressLoginAttempt`, `MAX_LOGIN_ATTEMPTS_PER_ADDRESS_HOUR`, 10 an hour), shared with `accountPasswordLimits()` in `server/src/http/authCommon.ts`
- **Attack Scenario:**
	1. The attacker knows the victim's email address.
	2. They send 10 wrong logins for it an hour, from any number of networks.
	3. The victim can't log in with their password while this keeps up. Wrong passwords typed while logged in (changing the password or 2FA, deleting the account) count against the same limit, so someone holding a session can also lock the player's other browsers out.

This is a common trade-off, and finding 4 makes it cheaper, since the per-network limit doesn't slow the attacker down.
- **Secure Remediation Code:** Let a browser that has logged in to the account before bypass the per-address limit, while other networks stay blocked. For example, give each browser a long-lived device cookie (like the trusted browser cookie) on a successful login, and skip `addressLoginAttempt` when the cookie names this account:

```ts
	const knownDevice = await isKnownLoginDevice(request, email, now);
	const attempt = await inTransaction((executor) => takeAttempt([
		{
			kind: 'networkLoginAttempt',
			subjectHash: clientNetworkHash(request),
			limit: MAX_LOGIN_ATTEMPTS_PER_NETWORK_HOUR
		},
		{
			kind: 'addressLoginAttempt',
			subjectHash: (knownDevice ? null : hashAddress(email)),
			limit: MAX_LOGIN_ATTEMPTS_PER_ADDRESS_HOUR
		}
	], now, executor));
```

`isKnownLoginDevice()` is new: it checks a device cookie's token hash against a table of devices that have logged in to the account. The 10-per-hour limit still covers every other browser. The same device cookie can drive the new-login email in finding 10.

---

## 8. Sessions survive some security changes

- **Status:** Fixed, apart from removing provider logins. Turning 2FA on logs out every other session (`enableRoute()`), as changing the password and email address do. Logging in again ends the session the browser's old cookie names (`startSession()`). A password reset also stops trusting every browser the account trusted. Tested in `server/test/auth.test.ts` and `twoFactor.test.ts`. The profile still has no way to remove a linked provider login, which a password change or reset leaves in place.

- **Vulnerability Title:** CWE-613: Insufficient Session Expiration
- **Severity:** Low
- **Affected File / Line:** `server/src/auth/sessions.ts:95` `startSession()`; `server/src/http/twoFactorAuth.ts:619` (enabling 2FA); `server/src/http/auth.ts:844` (email change, see finding 3)
- **Attack Scenario:**
	1. A player suspects their account is compromised and turns on 2FA. `enableRoute()` leaves every other session logged in, so an attacker's stolen session keeps working.
	2. Logging in again in a browser that's already logged in gives it a new cookie, but leaves the old session on the server for up to 30 days with "Remember me". The browser no longer has that token, so it only matters if the token was already stolen, but then it keeps working.
	3. A password change or reset ends the sessions, but leaves trusted browsers and linked provider logins in place, and both keep giving access.
- **Secure Remediation Code:** In `enableRoute()`, after `enableAuthenticator`:

```ts
		const ended = await deletePlayerSessions(playerId, executor, session.sessionId);
```

Then call `connectedSessions.end(ended)` once the transaction commits. In `startSession()`, end the session the browser's old cookie names:

```ts
export async function startSession(response: Response, playerId: string, rememberMe: boolean, executor?: Executor, previousCookieHeader?: string): Promise<string>
{
	const previous = readCookie(previousCookieHeader, SESSION_COOKIE);

	if ((previous !== undefined) && isTokenForm(previous))
	{
		await deleteSessionByTokenHash(hashToken(previous), executor);
	}

	const token = createToken();
	const session = await createSession(playerId, hashToken(token), rememberMe, executor);

	setCookie(response, SESSION_COOKIE, token, (rememberMe ? SESSION_LIFETIMES.remembered.totalMs : undefined));

	return(session.id);
}
```

`deleteSessionByTokenHash()` is a new `sessionRepo` function. In the password reset, also call `deleteTrustedBrowsers(playerId, executor)`, and list the account's provider logins on the profile so the player can remove them.

---

## 9. A provider-only account can be deleted by typing its username

- **Status:** Fixed. An account without a password also enters a code sent to its address (purpose `deleteAccount`, sent only to the logged-in account's own address and entered by this browser) before `accountDeletion.ts` deletes it. An account with neither a password nor an address still confirms with the username alone. Tested in `server/test/accountDeletion.test.ts`.

- **Vulnerability Title:** CWE-306: Missing Authentication for Critical Function
- **Severity:** Low
- **Affected File / Line:** `server/src/http/accountDeletion.ts:123`
- **Attack Scenario:**
	1. The attacker has a session for an account that logs in only with Google or Discord.
	2. They post the deletion request with the username, which the session itself shows them.
	3. The account and its universes are deleted.
- **Secure Remediation Code:** For an account without a password, ask for a fresh code sent to its address (purpose `deleteAccount`, entered by this browser), the same way `confirmLink()` uses a `linkLogin` code. A fresh provider login would be an equally strong check.

```ts
	else
	{
		const continuationHash = cookieTokenHash(request, CONTINUATION_COOKIE);
		const code = ((continuationHash === undefined) ? undefined : await inTransaction((executor) => lockContinuation('deleteAccount', continuationHash, now, executor)));

		if (!code || (code.playerId !== playerId))
		{
			sendRefusal(response, {
				status: 403,
				message: authMessages.enterCodeFirst
			});
			return;
		}
	}
```

Add `deleteAccount` to `EMAIL_CODE_PURPOSES`. Delete the code inside the deletion's transaction.

---

## 10. Informational

- **TOTP guessing has an hourly limit but no daily one.** Ten tries an hour per account (`MAX_TWO_FACTOR_ATTEMPTS_PER_ACCOUNT_HOUR`) allow about 240 guesses a day once the password is known, a success chance of about 0.07% a day with the usual ±1 step window. Small, but steady. `twoFactorFailed` events are already recorded: email the player after a few of them, or add a daily cap.
- **No email for a new login.** The site emails the player when the password, email address or 2FA changes, a provider is linked or a recovery code is used, but not when the account is logged in to from a new browser. `SECURITY-PRACTICES.md` section 3 lists new logins among the security events to email about. A login with a stolen password on an account without 2FA goes unnoticed until the attacker changes something. Email the account when a login starts a session from a browser that hasn't logged in to it before (a long-lived cookie, like the trusted browser one, or the device cookie from finding 7), saying when, and how to change the password.
- **The Google ID token is decoded without checking its signature** (`providers.ts`, `createGoogleClient`). That's acceptable here, because the token comes straight from Google's token endpoint over TLS, in exchange for a code and the client secret. Keep it that way: never accept an ID token the browser sends.

---

## Category summary

### 1. Credential handling and storage
No vulnerabilities found in Credential Handling & Storage.
- Passwords are hashed with Argon2id at OWASP's settings and rehashed when the settings change (`passwords.ts`). New passwords need 15 characters, and the breach check sends only a 5-character hash prefix and pads the answer.
- Session, continuation and trust tokens are stored as SHA-256 hashes. Codes, addresses and networks are stored as HMACs under `AUTH_HMAC_KEY`. Hashes are compared with `timingSafeEqual` (`hashesMatch`), and the OAuth state is compared through hashes of equal length.
- TOTP secrets are encrypted with AES-GCM, bound to the account's ID.
- No secrets are hard-coded. Every key comes from an environment variable, and the server refuses to start without the keys it needs.

### 2. Session management
Findings 3 and 8 (sessions kept after security changes).
- Tokens are 256-bit `randomBytes`, held in `__Host-` cookies that are `HttpOnly`, `Secure` and `SameSite=Strict`.
- Logout deletes the session on the server and ends its sockets.
- Every login issues a new token, so there's no session fixation.
- Room `onAuth` checks the session on every connection.
- Cross-site requests: writes and WebSockets check the Origin, bodies are JSON only, and auth routes send `Cache-Control: no-store`.

### 3. Authentication bypass and logic flaws
Findings 1, 2, 5 and 9, plus 3.
- The 2FA step is bound to the browser that gave the password (continuation cookie), counts wrong codes per login, and can't be replayed (`lastUsedStep`). The authenticator row is locked during checks, recovery codes have 50 bits each, and a wrong code still counts against the limit.
- Email codes have about 30 bits each, are bound to the purpose and the account, and the follow-up step is tied to the browser that entered the code. Changing or resetting the password, or changing the email address, ends every code sent for the account, so a reset sent to an old address can't undo the change.
- OAuth uses PKCE and a state held in a cookie, so a callback from another browser fails. Because of finding 1, that cookie needs integrity protection too.
- An email match alone never links a provider login, and only verified provider emails are accepted.
- `readNextPage()` in `client/src/pages.ts` rejects `//`, `/\` and other origins, so the login page's `next` redirect can't send players to another site.
- Character, group and profile routes check that the resource is the player's.

### 4. Injection
No vulnerabilities found in Injection Vectors.
- Every query goes through Drizzle with bound parameters.
- The raw `sql` fragments in the auth repositories (`lower(${players.email}) = lower(${email})`, the advisory lock) interpolate parameters, not strings.
- `sql.raw` appears only with constants in schema check constraints.
- Request bodies are parsed with zod, with length limits.
- No auth input reaches a shell, and `innerHTML` is given only the built-in icons.

### 5. Information disclosure (user enumeration)
No vulnerabilities found in Information Disclosure.
- A wrong password and a missing account get the same 401 message, and take about as long (`checkPasswordForMissingAccount` runs a dummy hash).
- Code requests answer 204 whether or not an account exists, and emails go out after the answer, so timing doesn't tell either.
- "Another account already uses that address" is shown only after the player proves they control the address.
- The provider callback says whether an account has a password or 2FA, but only to someone who controls that verified address at the provider.

### 6. Rate limiting and brute force
Findings 4, 6 and 7, and the TOTP note in 10.
- Login, code send, code guess and 2FA limits exist per network and per address or account, and email codes have 5 guesses each and a daily cap per address.
- Each limit is counted inside an advisory-locked transaction, so concurrent requests can't race past it.
- Re-asked passwords count against the login limits of the network and the account's address (`accountPasswordLimits()` in `authCommon.ts`).

## Priorities

1. Finding 1 is fixed. Fix finding 2 first: it is an open admin write that has to be closed before players use the site.
2. Findings 1, 3, 5, 6, 7 and 9 are fixed, and finding 8 apart from removing provider logins. Finding 4 is fixed in code, and its setting is confirmed once the game server's host is chosen (the TODO in `PLAN.md`).
3. What's left is the informational notes in finding 10.
