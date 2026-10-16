import { icons as gameIcons } from '@iconify-json/game-icons';
import { icons as phosphorIcons } from '@iconify-json/ph';
import { getIconData, iconToHTML, iconToSVG } from '@iconify/utils';
import fs from 'fs';
import path from 'path';
import { defineConfig, loadEnv, type Plugin } from 'vite';

import { CATALOG_FILE, catalogText, extractMessages, PAGES, PARTIALS_FOLDER, PSEUDO_CATALOG_FILE, pseudoCatalog, SOURCE_FOLDERS, writeCatalog } from '../shared/scripts/extractMessages.ts';

/**
 * The repository's root folder
 */
const ROOT = path.resolve(import.meta.dirname, '..');

/**
 * A comment that includes a partial, e.g. <!-- include footer.html -->, with the indentation before it.
 * A partial's name has no folder, so an include can only reach PARTIALS_FOLDER
 */
const INCLUDE_PATTERN = /^([ \t]*)<!--\s*include\s+([\w.-]+)\s*-->/gm;

/**
 * Lets the pages share pieces of HTML, such as the login screen and the footer: each
 * <!-- include <name> --> comment is replaced with that file from client/partials, indented to match,
 * before Vite reads the page (so the partials' %VITE_...% variables are filled in). A partial can't
 * include another. The dev server reloads the page when a partial changes
 *
 * @return The plugin
 */
function htmlPartials(): Plugin
{
	const folder = path.join(ROOT, PARTIALS_FOLDER);

	/**
	 * A page with its partials included
	 *
	 * @param html The page
	 * @return The page with each include comment replaced
	 */
	function includePartials(html: string): string
	{
		return(html.replace(INCLUDE_PATTERN, (_comment, indent: string, name: string) =>
		{
			const file = path.join(folder, name);

			if (!fs.existsSync(file))
			{
				throw new Error(`A page includes ${name}, which isn't in ${PARTIALS_FOLDER}`);
			}

			return(fs.readFileSync(file, 'utf8')
				.replace(/\r?\n$/, '')
				.split(/\r?\n/)
				.map((line) => ((line === '') ? line : `${indent}${line}`))
				.join('\n'));
		}));
	}

	return({
		name: 'kiln-html-partials',
		transformIndexHtml: {
			order: 'pre',
			handler: includePartials
		},
		configureServer(server)
		{
			server.watcher.on('change', (file) =>
			{
				if (path.resolve(file).startsWith(`${folder}${path.sep}`))
				{
					server.ws.send({ type: 'full-reload' });
				}
			});
		}
	});
}

/**
 * The icon sets the pages can use, by the prefix of their icons' names: ph is Phosphor
 * (https://phosphoricons.com, MIT; use its Regular icons, the names without a weight such as -bold or
 * -fill) and game-icons is game-icons.net (https://game-icons.net, CC BY 3.0, credited in the footer)
 */
const ICON_SETS: Record<string, typeof phosphorIcons> = {
	'ph': phosphorIcons,
	'game-icons': gameIcons
};

/**
 * A comment that puts an icon in a page, e.g. <!-- icon ph:floppy-disk -->
 */
const ICON_PATTERN = /<!--\s*icon\s+([\w-]+:[\w-]+)\s*-->/g;

/**
 * What code imports an icon's SVG markup from, followed by the icon's name, e.g.
 * import trashIcon from 'virtual:icon/ph:trash'
 */
const ICON_MODULE_PREFIX = 'virtual:icon/';

/**
 * An icon's SVG markup, sized to the text around it and hidden from screen readers
 *
 * @param name The icon's name, e.g. ph:floppy-disk
 * @return The markup
 */
function iconSvg(name: string): string
{
	const separator = name.indexOf(':');
	const set = ((separator > 0) ? ICON_SETS[name.slice(0, separator)] : undefined);
	const icon = ((set === undefined) ? null : getIconData(set, name.slice(separator + 1)));

	if (icon === null)
	{
		throw new Error(`There is no icon named ${name}; the names start with the prefix of one of the ICON_SETS in client/vite.config.ts`);
	}

	const { attributes, body } = iconToSVG(icon, { height: '1em' });

	return(iconToHTML(body, {
		...attributes,
		'class': 'icon',
		'aria-hidden': 'true'
	}));
}

/**
 * Puts icons in the pages and code as SVG markup when they are served and built, so only the icons
 * used are in the pages and bundles. A page marks an icon with a comment such as
 * <!-- icon ph:floppy-disk -->, and code imports one from virtual:icon/<name>
 *
 * @return The plugin
 */
function icons(): Plugin
{
	return({
		name: 'kiln-icons',
		transformIndexHtml: {
			order: 'pre',
			handler(html)
			{
				return(html.replace(ICON_PATTERN, (_comment, name: string) => iconSvg(name)));
			}
		},
		resolveId(id)
		{
			return(id.startsWith(ICON_MODULE_PREFIX) ? `\0${id}` : undefined);
		},
		load(id)
		{
			if (!id.startsWith(`\0${ICON_MODULE_PREFIX}`))
			{
				return(undefined);
			}

			return(`export default ${JSON.stringify(iconSvg(id.slice(ICON_MODULE_PREFIX.length + 1)))};`);
		}
	});
}

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
	const sources = [...SOURCE_FOLDERS, ...PAGES, PARTIALS_FOLDER].map((entry) => path.join(ROOT, entry));

	/**
	 * Extracts the messages and writes the catalogs that changed
	 *
	 * @param warn Reports problems with the messages
	 */
	function update(warn: (message: string) => void): void
	{
		const { catalog, problems } = extractMessages(ROOT);

		if (problems.length > 0)
		{
			warn(`The message catalogs weren't updated:\n${problems.map((problem) => `  ${problem}`).join('\n')}`);
			return;
		}

		writeCatalog(ROOT, CATALOG_FILE, catalogText(catalog));
		writeCatalog(ROOT, PSEUDO_CATALOG_FILE, catalogText(pseudoCatalog(catalog)));
	}

	/**
	 * Whether a file can hold messages: TypeScript in a source folder, a page, or a partial
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
		plugins: [htmlPartials(), icons(), messageCatalogs(), stripDescriptions()],
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
				// The game, the world editor and the licenses (see src/pages.ts)
				input: {
					main: path.resolve(import.meta.dirname, 'index.html'),
					edit: path.resolve(import.meta.dirname, 'edit.html'),
					license: path.resolve(import.meta.dirname, 'license.html')
				}
			}
		}
	});
});
