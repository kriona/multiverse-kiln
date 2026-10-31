# Security Policy

Thank you for helping keep Multiverse Kiln and its players safe.

## Supported versions

Multiverse Kiln is in active development and has no numbered releases yet - only the latest code on the `main` branch is supported. Once there are releases, this section will list which ones get security fixes.

## Reporting a vulnerability

**Please don't report security problems in public issues, pull requests or discussions.**

Report them privately through GitHub instead:

1. Go to the repository's [Security tab](https://github.com/kriona/multiverse-kiln/security).
2. Click **Report a vulnerability**.
3. Fill in the form.

Please include as much detail as you can:

- What the problem is and what an attacker could do with it.
- The parts of the code involved (file paths, routes, line numbers, room or message types).
- Steps to reproduce it, if applicable.
- The commit you tested against, if known.
- Ideas you have for fixing it, if any.

## What to expect

This is a small project. I'm a very passionate developer, and a security-conscious one at that, but I'm just 1 developer and I may be sick or on vacation or otherwise unavailable. As such:

- **Most of the time** I will be able to respond within a couple of days.
- You should not have to wait longer than **2 weeks** to hear from me.
- Please give a me reasonable amount of time (e.g., up to **90 days**) to deploy a fix before disclosing the problem publicly.
	- I will drop everything to fix security issues, so it should only take this long in extreme cases.
- Once a fix is out, I will publish a security advisory, crediting you unless you'd rather stay anonymous.

## Scope

In scope:

- The code in this repository: the client (`client/`), the server (`server/`) and the shared package (`shared/`).
- Its configuration and build: Docker setup, migrations, GitHub workflows and the scripts in this repository.
- Any official deployment of Multiverse Kiln (once there is one).

Examples of what we especially want to hear about include:

- Authentication and session flaws.
- A player reading or changing another player's data or a universe they can't edit.
- A client changing game state the server should decide.
- Injection (SQL, XSS, HTML).
- Secrets exposed in the repository.
- Gaps in the origin and CORS checks.

Out of scope:

- Vulnerabilities in third-party dependencies (Colyseus, Phaser, Drizzle and so on) that don't affect Multiverse Kiln. Please report those to the dependency's maintainers.
	- If one does affect Multiverse Kiln, we'd like to know.
- Problems that only exist in someone else's fork or deployment because of how they configured it.
- Denial of service through sheer volume of traffic, and reports from automated scanners with no demonstrated impact.
- Social engineering, phishing and physical attacks.

## Testing guidelines

- Test against your own local copy (see `README.md` for setting it up), not anyone else's deployment.
- Only use accounts you own or have permission to use. Don't access, change or delete other people's data.
- Don't degrade the service for others, and don't send spam through the email features.
- Stop and report as soon as you've confirmed a problem, without going further than needed. There's no need to create a working exploit in order for an issue to be taken seriously.

We won't pursue or support legal action against anyone who finds and reports a vulnerability in good faith within these guidelines.
