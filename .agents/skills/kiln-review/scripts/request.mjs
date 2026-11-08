// Sends one HTTP request to the dev server as one of the review's accounts, and prints the answer's status
// and body. Run from the repository root, trusting the mkcert CA:
//
//   node --use-system-ca .agents/skills/kiln-review/scripts/request.mjs <sessions file> <account> <METHOD> <path> ['<JSON body>']
//
// <account> is owner, editor, player or outsider, from the run's .sessions.json, or none to send no
// session. <path> is written without its leading /, such as editor/universes, since Git Bash turns an
// argument starting with / into a Windows path. The session token is sent in a Cookie header and never
// printed
import { readFileSync } from 'node:fs';

/**
 * The session cookie's name (SESSION_COOKIE in server/src/http/cookies.ts)
 */
const SESSION_COOKIE = '__Host-kiln-session';

/**
 * Sends the request the command line describes, and prints what came back
 *
 * @return {Promise<number>} The process's exit code
 */
async function main()
{
	const [sessionsFile, account, method, path, body] = process.argv.slice(2);

	if (!sessionsFile || !account || !method || !path || /^[A-Za-z]:/.test(path))
	{
		console.error('Usage: node --use-system-ca .agents/skills/kiln-review/scripts/request.mjs <sessions file> <owner|editor|player|outsider|none> <METHOD> <path without its leading /> [\'<JSON body>\']');
		return(1);
	}

	const sessions = JSON.parse(readFileSync(sessionsFile, 'utf8'));
	const headers = {};

	if (account !== 'none')
	{
		const session = sessions.accounts?.[account];

		if (!session?.token)
		{
			console.error('The sessions file has no account called ' + account + '.');
			return(1);
		}

		headers.cookie = SESSION_COOKIE + '=' + session.token;
	}

	if (body !== undefined)
	{
		headers['content-type'] = 'application/json';
	}

	const response = await fetch(sessions.serverUrl + '/' + path.replace(/^\/+/, ''), {
		method: method.toUpperCase(),
		headers,
		body
	});
	const text = await response.text();

	console.log(response.status + ' ' + response.statusText);

	try
	{
		console.log(JSON.stringify(JSON.parse(text), null, '\t'));
	}
	catch
	{
		console.log(text);
	}

	return(0);
}

process.exitCode = await main();
