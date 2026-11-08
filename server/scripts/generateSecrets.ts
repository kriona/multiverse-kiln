/**
 * Makes the root .env and server/.env for local development from their .env.example files, with a new
 * secret in place of each replace-me. Run it with npm run secrets -w server
 *
 * A file that already exists is left alone: its new version is written next to it as .env.generated
 * (git-ignored, like every .env.*), to copy settings from. A value both files share (a database
 * password, the storage keys) is the same in both of the files written
 */
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * A file to make from its example, and the secret each of its settings takes
 */
interface SecretsFile
{
	path: string;
	examplePath: string;
	secrets: Record<string, string>;
}

const PLACEHOLDER = 'replace-me';
const GENERATED_SUFFIX = '.generated';

/**
 * Makes a secret of letters and digits only, for settings that go in a connection string or the
 * storage's request signatures, where /, + and = would break them
 * @return 24 random bytes in hex
 */
function hexSecret(): string
{
	return(randomBytes(24).toString('hex'));
}

/**
 * Makes a secret key for the server's keyed hashes and encryption
 * @return 32 random bytes in base64
 */
function base64Secret(): string
{
	return(randomBytes(32).toString('base64'));
}

/**
 * Fills in an example file's placeholders with the file's secrets, keeping everything else as it is
 * @param file the file to make
 * @return the file's text
 * @throws Error when the example has a placeholder this script has no secret for, or lacks a setting it has one for
 */
function fillExample(file: SecretsFile): string
{
	const example = readFileSync(file.examplePath, 'utf8');
	const lineEnding = (example.includes('\r\n') ? '\r\n' : '\n');
	const unused = new Set(Object.keys(file.secrets));
	const lines = example
		.split(/\r?\n/)
		.map((line) =>
		{
			const name = /^([A-Z0-9_]+)=/.exec(line)?.[1];
			if ((name === undefined) || !line.includes(PLACEHOLDER))
			{
				return(line);
			}

			const secret = file.secrets[name];
			if (secret === undefined)
			{
				throw new Error(`${displayPath(file.examplePath)} has a ${PLACEHOLDER} for ${name}, which this script doesn't make a secret for`);
			}

			unused.delete(name);
			return(line.replace(PLACEHOLDER, () => (secret)));
		});

	if (unused.size > 0)
	{
		throw new Error(`${displayPath(file.examplePath)} has no ${PLACEHOLDER} for ${[...unused].join(', ')}`);
	}

	return(lines.join(lineEnding));
}

/**
 * Writes a file unless it already exists, in which case the text goes next to it instead
 * @param path the file to write
 * @param text its contents
 * @return the path written: the file itself, or the file with .generated added
 */
function writeUnlessExists(path: string, text: string): string
{
	try
	{
		writeFileSync(path, text, { flag: 'wx' });
		return(path);
	}
	catch (error)
	{
		if ((error as NodeJS.ErrnoException).code !== 'EEXIST')
		{
			throw error;
		}
	}

	const generatedPath = `${path}${GENERATED_SUFFIX}`;
	writeFileSync(generatedPath, text);
	return(generatedPath);
}

/**
 * Shows a path relative to the repository's root, as the README writes them
 * @param path an absolute path
 * @return the path from the root, with forward slashes
 */
function displayPath(path: string): string
{
	return(relative(repositoryRoot, path).replaceAll('\\', '/'));
}

const repositoryRoot = join(import.meta.dirname, '..', '..');
const appPassword = hexSecret();
const migratorPassword = hexSecret();
const storageAccessKeyId = hexSecret();
const storageSecretAccessKey = hexSecret();

const files: SecretsFile[] = [
	{
		path: join(repositoryRoot, '.env'),
		examplePath: join(repositoryRoot, '.env.example'),
		secrets: {
			POSTGRES_PASSWORD: hexSecret(),
			KILN_MIGRATOR_PASSWORD: migratorPassword,
			KILN_APP_PASSWORD: appPassword,
			STORAGE_ACCESS_KEY_ID: storageAccessKeyId,
			STORAGE_SECRET_ACCESS_KEY: storageSecretAccessKey
		}
	},
	{
		path: join(repositoryRoot, 'server', '.env'),
		examplePath: join(repositoryRoot, 'server', '.env.example'),
		secrets: {
			DATABASE_URL: appPassword,
			MIGRATION_DATABASE_URL: migratorPassword,
			TEST_DATABASE_URL: appPassword,
			TEST_MIGRATION_DATABASE_URL: migratorPassword,
			AUTH_HMAC_KEY: base64Secret(),
			TOTP_ENCRYPTION_KEY: base64Secret(),
			STORAGE_ACCESS_KEY_ID: storageAccessKeyId,
			STORAGE_SECRET_ACCESS_KEY: storageSecretAccessKey
		}
	}
];

// Every example is read before anything is written, so a problem with one leaves no files half made
const texts = files.map((file) => (fillExample(file)));
const written = files.map((file, index) => (writeUnlessExists(file.path, texts[index])));

let keptExisting = false;
files.forEach((file, index) =>
{
	if (written[index] === file.path)
	{
		console.log(`Wrote ${displayPath(file.path)}`);
	}
	else
	{
		keptExisting = true;
		console.log(`${displayPath(file.path)} already exists, so it's unchanged: wrote ${displayPath(written[index])} instead`);
	}
});

if (keptExisting)
{
	console.log('');
	console.log(`Copy the settings you need from the ${GENERATED_SUFFIX} files, then delete them. The files written share their`);
	console.log('database passwords and storage keys, so take each shared setting into both files or neither.');
}

console.log('');
console.log('Database passwords only take effect when Postgres\'s data volume is first created (see README.md),');
console.log('and new storage keys once the storage container is recreated: docker compose up -d storage');
