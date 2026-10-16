import fs from 'fs';
import path from 'path';
import { defineConfig, loadEnv, type Plugin } from 'vite';

import { CATALOG_FILE, catalogText, extractMessages, PAGES, PSEUDO_CATALOG_FILE, pseudoCatalog, SOURCE_FOLDERS, writeCatalog } from '../shared/scripts/extractMessages.ts';

/**
 * Removes the descriptions for translators (data-translation-context and data-translation-context-<attribute>) from
 * the pages as they are served and built. The extractor reads them from the source files, and nothing
 * on the page uses them
 *
 * @return The plugin
 */
function stripDescriptions(): Plugin
{
	return({
		name: 'kiln-strip-descriptions',
		transformIndexHtml(html)
		{
			return(html.replace(/\s+data-translation-context(-[\w-]+)?="[^"]*"/g, ''));
		}
	});
}

/**
 * How long the dev server waits after the last change to a file before extracting the messages again,
 * in milliseconds, so saving several files at once extracts them once
 */
const MESSAGE_UPDATE_DELAY_MS = 200;

/**
 * Keeps the message catalogs current while the dev server runs: shared/locales/en.json, and the
 * pseudo-language's catalog the page loads with ?locale=en-XA. Both are made again whenever a file
 * with messages changes, which reloads a page showing the pseudo-language. A change with a problem,
 * such as a message still being typed, is reported and the last good catalogs are kept
 *
 * @return The plugin
 */
function messageCatalogs(): Plugin
{
	const root = path.resolve(import.meta.dirname, '..');
	const sources = [...SOURCE_FOLDERS, ...PAGES].map((entry) => path.join(root, entry));

	/**
	 * Extracts the messages and writes the catalogs that changed
	 *
	 * @param warn Reports problems with the messages
	 */
	function update(warn: (message: string) => void): void
	{
		const { catalog, problems } = extractMessages(root);

		if (problems.length > 0)
		{
			warn(`The message catalogs weren't updated:\n${problems.map((problem) => `  ${problem}`).join('\n')}`);
			return;
		}

		writeCatalog(root, CATALOG_FILE, catalogText(catalog));
		writeCatalog(root, PSEUDO_CATALOG_FILE, catalogText(pseudoCatalog(catalog)));
	}

	/**
	 * Whether a file can hold messages: TypeScript in a source folder, or one of the pages
	 *
	 * @param file The file's full path
	 * @return Whether it can
	 */
	function holdsMessages(file: string): boolean
	{
		const resolved = path.resolve(file);

		return(/\.(ts|html)$/.test(resolved) && sources.some((source) => ((resolved === source) || resolved.startsWith(`${source}${path.sep}`))));
	}

	return({
		name: 'kiln-message-catalogs',
		apply: 'serve',
		configureServer(server)
		{
			const warn = (message: string): void =>
			{
				server.config.logger.warn(message, { timestamp: true });
			};
			let timer: NodeJS.Timeout | undefined;

			update(warn);

			// The client's own files are watched already; the server's and shared code's are added
			server.watcher.add(sources);
			server.watcher.on('all', (_event, file) =>
			{
				if (holdsMessages(file))
				{
					clearTimeout(timer);
					timer = setTimeout(() =>
					{
						update(warn);
					}, MESSAGE_UPDATE_DELAY_MS);
				}
			});
		}
	});
}

/**
 * Reads a certificate or key file for the dev server, explaining how to create it when missing
 *
 * @param file Path to the file, relative to the client folder, or undefined when not configured
 * @param variableName Environment variable the path came from, named in the error message
 * @return File contents
 */
function readCertificateFile(file: string | undefined, variableName: string): Buffer
{
	if (!file)
	{
		throw new Error(`${variableName} is not set in client/.env. The dev server requires HTTPS; see "Create a local HTTPS certificate" in README.md`);
	}

	if (!fs.existsSync(file))
	{
		throw new Error(`${variableName} file not found: ${file} (resolved from ${process.cwd()}). Generate a local certificate with mkcert; see "Create a local HTTPS certificate" in README.md`);
	}

	return(fs.readFileSync(file));
}

/**
 * Checks that the source code URL is set, since the page links to it from every build
 *
 * Running a modified version of the game for players requires offering them its source (AGPL section 13),
 * so a fork sets this to its own repository
 *
 * @param url Value of VITE_SOURCE_URL
 */
function requireSourceUrl(url: string | undefined): void
{
	if (!url)
	{
		throw new Error('VITE_SOURCE_URL is not set in client/.env. Set it to the repository players can get this version\'s source code from; see client/.env.example');
	}
}

export default defineConfig(({ command, mode }) =>
{
	// Load all variables (not just VITE_*) so DEV_HOST stays out of the client bundle
	const env = loadEnv(mode, process.cwd(), '');
	const devHost = (env.DEV_HOST || undefined);

	// Every page links to it as %VITE_SOURCE_URL%
	requireSourceUrl(env.VITE_SOURCE_URL);

	// The dev server always uses HTTPS; production builds don't need a certificate
	const https = ((command === 'serve') ? {
		key: readCertificateFile(env.DEV_SSL_KEY_FILE, 'DEV_SSL_KEY_FILE'),
		cert: readCertificateFile(env.DEV_SSL_CERT_FILE, 'DEV_SSL_CERT_FILE')
	} : undefined);

	return({
		plugins: [messageCatalogs(), stripDescriptions()],
		server: {
			// Bind to the dev hostname (127.0.0.1 via hosts file); the default "localhost" may bind IPv6 only
			host: devHost,
			port: Number(env.DEV_PORT || 5173),
			strictPort: true,
			allowedHosts: (devHost ? [devHost] : []),
			https
		},
		build: {
			target: 'es2022',
			rolldownOptions: {
				// The game, and the world editor (see src/pages.ts)
				input: {
					main: path.resolve(import.meta.dirname, 'index.html'),
					edit: path.resolve(import.meta.dirname, 'edit.html')
				}
			}
		}
	});
});
