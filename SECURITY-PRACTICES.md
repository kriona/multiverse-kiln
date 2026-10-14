# Security Practices

Best practices for setting up and securing a website with logins, roughly in setup order. Notes marked **This project** apply to Multiverse Kiln (Colyseus + Postgres + Phaser).

## 1. Passwords and credentials

- **Consider not storing passwords at all.** OAuth/OIDC login ("Sign in with Google/Discord/Steam"), passkeys (WebAuthn), or a managed provider (Auth0, Clerk, Supabase Auth, Cognito) removes a lot of risk. For a game, Discord and Google login are common and well received.
- **If you do store passwords,** hash them with **Argon2id** (or bcrypt with cost 12 or higher). Never use plain SHA/MD5, and never encrypt passwords so they can be decrypted.
- Require at least 8 characters (15 or more is better) and allow long passphrases. Don't impose composition rules like "must have a symbol" (NIST 800-63B advice).
- Check new passwords against known breached passwords (the HaveIBeenPwned k-anonymity API).
- Don't force periodic password changes. Require a change only when there's evidence of a compromise.
- Offer **2FA** (TOTP or passkeys) early. Adding it later is harder.

## 2. Sessions and tokens

- Generate session IDs or tokens with a cryptographically secure random source.
- For a browser session cookie, set `HttpOnly`, `Secure`, `SameSite=Lax` (or `Strict`) and a narrow `Path`, and use the `__Host-` prefix if you can.
- **Rotate the session ID on login** and on privilege changes, which prevents session fixation.
- Expire sessions both after idle time and after an absolute lifetime. Logout must invalidate the session on the server, not just delete the cookie.
- If you use JWTs, keep them short-lived (minutes) with a refresh token you can revoke. Pin the algorithm (reject `alg: none`) and check `exp`, `iss` and `aud`. Don't put secrets or personal data in the payload, since anyone can read it.
- Don't store tokens in `localStorage` when an HttpOnly cookie would work, because any XSS can read `localStorage`.
- **This project:** Colyseus `onAuth` should check the token on every room join. Treat the WebSocket connection as untrusted until that check passes.

## 3. Login, signup and recovery flows

- **Rate-limit** login, signup, password reset and 2FA attempts per IP and per account. Add increasing delays or a CAPTCHA after repeated failures rather than hard lockouts, which attackers can use to lock real users out.
- **Use generic error messages:** "Invalid email or password". Also give the same response to "If that email exists, we sent a link" on reset and signup, so attackers can't find out which emails have accounts.
- Password reset tokens should be random, single-use, expire within about 15-60 minutes, be stored hashed, and be invalidated once the password changes. When a password changes, end the user's other sessions.
- Verify the email address before enabling anything sensitive.
- Email the user about security events: password changed, new login, 2FA disabled.

## 4. Transport and headers

- Use HTTPS everywhere, with no HTTP fallback (**this project** already enforces this). Add **HSTS** in production (`max-age` of at least 1 year, `includeSubDomains`).
- Add a **Content-Security-Policy**. Start strict (`default-src 'self'`) and loosen it only where needed, such as `connect-src` for the `wss://` server.
- Send `X-Content-Type-Options: nosniff` (done in **this project**), `Referrer-Policy: strict-origin-when-cross-origin`, and `frame-ancestors 'none'` in the CSP to stop clickjacking.
- Use a strict CORS allowlist and an Origin check on WebSockets (both done in **this project**).

## 5. Input, output and data access

- Validate every input on the server against a schema (zod, valibot, or similar). Never trust the client, which the architecture rules in `CLAUDE.md` already require.
- Use parameterized queries only. Drizzle handles this, as long as you avoid building `sql.raw` strings from user input.
- Encode output for its context to prevent XSS. Avoid `innerHTML` with user data, and be careful with player names and chat rendered in Phaser DOM elements.
- **Check authorization on every request,** not just authentication. "Is this user allowed to touch *this* object?" is the bug behind most real breaches (IDOR).
- Protect against CSRF if you use cookie auth: `SameSite` cookies plus a CSRF token or an Origin/`Sec-Fetch-Site` check on state-changing requests.

## 6. Secrets and configuration

- Keep secrets in environment variables or a secret manager, and never commit them. Add a secret scanner such as gitleaks or GitHub secret scanning.
- Use different secrets for dev and prod, and make sure you can rotate them without downtime.
- Give the database user only the access it needs: the app's DB role shouldn't be able to drop tables, and migrations run under a separate role.

## 7. Dependencies and supply chain

- Commit the lockfile, run `npm audit` and turn on Dependabot or Renovate.
- Keep the dependency count low, and check new packages before adding them (maintainers, download counts, install scripts).
- Pin CI actions and container images.

## 8. Logging, monitoring and abuse

- Log authentication events (logins, failures, resets, 2FA changes) with timestamp, IP and user ID. **Never log passwords, tokens, or full session IDs.**
- Set up alerts for spikes in failed logins (credential stuffing) and for errors.
- For a game: rate-limit messages per client in each room, cap message sizes, and disconnect clients that flood the server.

## 9. Privacy and accounts

- Collect as little personal data as you can. If there's no need for a real name or birthday, don't ask for one.
- Provide account deletion and data export. GDPR and CCPA can apply even to hobby projects with EU or California users.
- Have a privacy policy, plus a plan for minors if kids might play (COPPA in the US).
- Back up the database and test restoring it. Neon has point-in-time restore, but confirm the retention period.

## 10. Process

- Use the **OWASP ASVS** (Application Security Verification Standard) Level 1 as a checklist, and the **OWASP Cheat Sheet Series** for implementation details (Authentication, Session Management, Password Storage).
- Write tests for auth edge cases: expired token, token for a deleted user, the wrong user's resource ID, and a replayed reset link.
- Publish a `security.txt` or contact address so people can report vulnerabilities.

## Recommendation for this project

Use OAuth (Discord/Google) or a managed auth provider so the server never stores passwords. Then issue a short-lived signed token that Colyseus checks in `onAuth`, and load the player profile from Postgres at that point, which fits the existing database rules. That leaves sections 2 and 5 as most of what needs to be built in-house.
