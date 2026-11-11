/**
 * Makes the root .env and server/.env for local development from their .env.example files, with a new
 * secret in place of each replace-me. Run it with npm run secrets -w server
 *
 * A file that already exists is left alone: its new version is written next to it as .env.generated
 * (git-ignored, like every .env.*), to copy settings from. A value both files share (a database
 * password, the storage keys) is the same in both, and is taken from an existing file when one has it,
 * since Postgres and the storage container already use it
 */
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parseEnv } from 'node:util';

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

/**
 * Reads the settings of a .env file that may already exist
 * @param path the file
 * @return its settings, or undefined when there is no such file
 */
function readExisting(path: string): Record<string, string | undefined> | undefined
{
	try
	{
		return(parseEnv(readFileSync(path, 'utf8')));
	}
	catch (error)
	{
		if ((error as NodeJS.ErrnoException).code === 'ENOENT')
		{
			return(undefined);
		}

		throw error;
	}
}

/**
 * The password in a connection string
 * @param url the connection string, if the file has one
 * @return its password, or undefined when it has none or isn't a URL
 */
function urlPassword(url: string | undefined): string | undefined
{
	if (!URL.canParse(url ?? ''))
	{
		return(undefined);
	}

	return(decodeURIComponent(new URL(url ?? '').password));
}

/**
 * A secret both files share: the first existing file's value that is filled in, so it keeps matching
 * what Postgres and the storage container use (noted in reusedShared), or a new one when neither has it
 * @param existing the setting's value in each existing file, the root .env's first
 * @return the secret
 */
function sharedSecret(...existing: (string | undefined)[]): string
{
	const value = existing.find((candidate) => ((candidate !== undefined) && (candidate !== '') && !candidate.includes(PLACEHOLDER)));

	if (value !== undefined)
	{
		reusedShared = true;
		return(value);
	}

	return(hexSecret());
}

const repositoryRoot = join(import.meta.dirname, '..', '..');
const rootPath = join(repositoryRoot, '.env');
const serverPath = join(repositoryRoot, 'server', '.env');
const existingRoot = readExisting(rootPath);
const existingServer = readExisting(serverPath);

/**
 * Whether any shared secret came from an existing file
 */
let reusedShared = false;

const appPassword = sharedSecret(existingRoot?.KILN_APP_PASSWORD, urlPassword(existingServer?.DATABASE_URL));
const adminPassword = sharedSecret(existingRoot?.KILN_ADMIN_PASSWORD, urlPassword(existingServer?.ADMIN_DATABASE_URL));
const migratorPassword = sharedSecret(existingRoot?.KILN_MIGRATOR_PASSWORD, urlPassword(existingServer?.MIGRATION_DATABASE_URL));
const storageAccessKeyId = sharedSecret(existingRoot?.STORAGE_ACCESS_KEY_ID, existingServer?.STORAGE_ACCESS_KEY_ID);
const storageSecretAccessKey = sharedSecret(existingRoot?.STORAGE_SECRET_ACCESS_KEY, existingServer?.STORAGE_SECRET_ACCESS_KEY);

const files: SecretsFile[] = [
	{
		path: rootPath,
		examplePath: join(repositoryRoot, '.env.example'),
		secrets: {
			POSTGRES_PASSWORD: hexSecret(),
			KILN_MIGRATOR_PASSWORD: migratorPassword,
			KILN_APP_PASSWORD: appPassword,
			KILN_ADMIN_PASSWORD: adminPassword,
			STORAGE_ACCESS_KEY_ID: storageAccessKeyId,
			STORAGE_SECRET_ACCESS_KEY: storageSecretAccessKey
		}
	},
	{
		path: serverPath,
		examplePath: join(repositoryRoot, 'server', '.env.example'),
		secrets: {
			DATABASE_URL: encodeURIComponent(appPassword),
			ADMIN_DATABASE_URL: encodeURIComponent(adminPassword),
			MIGRATION_DATABASE_URL: encodeURIComponent(migratorPassword),
			TEST_DATABASE_URL: encodeURIComponent(appPassword),
			TEST_ADMIN_DATABASE_URL: encodeURIComponent(adminPassword),
			TEST_MIGRATION_DATABASE_URL: encodeURIComponent(migratorPassword),
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

if (reusedShared)
{
	console.log('');
	console.log('The database passwords and storage keys set in the existing files were kept, so both files agree.');
}

if (keptExisting)
{
	console.log('');
	console.log(`Copy the settings you need from the ${GENERATED_SUFFIX} files, then delete them.`);
}

console.log('');
console.log('Database passwords only take effect when Postgres\'s data volume is first created (see README.md),');
console.log('and new storage keys once the storage container is recreated: docker compose up -d storage');
