/**
 * Signing a universe's export, and checking the signature of a file being imported (see Exporting a
 * universe in STRUCTURE-OVERVIEW.md). The archive's UNIVERSE_EXPORT_SIGNATURE (an ExportSignature) holds
 * keyed hashes made with the server's AUTH_HMAC_KEY: one of where the export is from, which holds while
 * other files are changed, and one of every other file's SHA-256, so only this site can make either and
 * an import can tell an export made here, unchanged, from one changed since or made elsewhere
 */
import { createHash } from 'crypto';
import { MAX_AREAS_PER_UNIVERSE, MAX_UPLOADED_TILE_GRAPHICS, UNIVERSE_EXPORT_SIGNATURE, type ExportSignature, type UniverseImportSignature } from '@multiverse-kiln/shared';
import { setImmediate as yieldToEventLoop } from 'timers/promises';
import { z } from 'zod';

import { zipFile, type ZipFile } from '../archives/zip.js';
import { hashesMatch, keyedHash } from '../auth/keyedHashes.js';

/**
 * Where an export says it is from, as its UniverseExport has it
 */
export interface ExportOrigin
{
	exportedAt: string;
	exportedBy: {
		username: string;
		displayName: string;
	};
	universe: {
		id: string;
		version: string;
		name: string;
	};
}

/**
 * The most bytes UNIVERSE_EXPORT_SIGNATURE is read from: many times what the most files an export can
 * have take in it
 */
const MAX_SIGNATURE_BYTES = 1024 * 1024;

/**
 * The most files an export signs: its areas' and tilesets' files, and the few others
 */
const MAX_SIGNED_FILES = (MAX_AREAS_PER_UNIVERSE + MAX_UPLOADED_TILE_GRAPHICS + 16);

/**
 * The files operating systems add to a folder they show, which zipping the folder an export was
 * extracted into takes along. An import never reads them, so they don't count as changes
 */
const SYSTEM_FILES = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini']);

/**
 * The folder macOS's Finder adds to every zip archive it makes, holding the files' metadata, which an
 * import never reads
 */
export const MACOS_METADATA_FOLDER = '__MACOSX/';

/**
 * An archive's UNIVERSE_EXPORT_SIGNATURE, as an import reads it
 */
const exportSignature = z.object({
	origin: z.base64().max(64),
	files: z.record(z.string().max(200), z.string().regex(/^[0-9a-f]{64}$/)),
	contents: z.base64().max(64)
});

/**
 * Makes an export's UNIVERSE_EXPORT_SIGNATURE
 *
 * @param origin Where the export is from, as its UniverseExport says
 * @param files Every other file in the archive
 * @return The signature's file, ready for the archive
 */
export async function signExport(origin: ExportOrigin, files: readonly ZipFile[]): Promise<ZipFile>
{
	const hashes: Record<string, string> = {};

	for (const file of files)
	{
		hashes[file.name] = file.sha256.toString('hex');
	}

	const signature: ExportSignature = {
		origin: keyedHash('exportOrigin', originText(origin)).toString('base64'),
		files: hashes,
		contents: keyedHash('exportContents', contentsText(hashes)).toString('base64')
	};

	return(zipFile(UNIVERSE_EXPORT_SIGNATURE, [`${JSON.stringify(signature, null, '\t')}\n`]));
}

/**
 * What the signature of a file being imported says of it
 *
 * @param origin Where the file says it is from, as its UniverseExport has it
 * @param files The file's files, by their paths in the export
 * @return Whether this site signed where it is from, and whether its files are as they were signed
 */
export async function checkExportSignature(origin: ExportOrigin, files: ReadonlyMap<string, Buffer>): Promise<UniverseImportSignature>
{
	const signature = readSignature(files.get(UNIVERSE_EXPORT_SIGNATURE));

	if (!signature || !hashesMatch(Buffer.from(signature.origin, 'base64'), keyedHash('exportOrigin', originText(origin))))
	{
		return('unconfirmed');
	}

	return((await contentsIntact(signature, files)) ? 'intact' : 'changed');
}

/**
 * Reads an archive's UNIVERSE_EXPORT_SIGNATURE
 *
 * @param file Its content, or undefined when the archive has none
 * @return The signature, or undefined when there is none or it can't be read
 */
function readSignature(file: Buffer | undefined): ExportSignature | undefined
{
	if (!file || (file.length > MAX_SIGNATURE_BYTES))
	{
		return(undefined);
	}

	try
	{
		const parsed = exportSignature.safeParse(JSON.parse(file.toString('utf8')));

		return((parsed.success && (Object.keys(parsed.data.files).length <= MAX_SIGNED_FILES)) ? parsed.data : undefined);
	}
	catch
	{
		return(undefined);
	}
}

/**
 * Whether a file's files are as the export signed them: the list of them is this site's, each one it
 * lists has the SHA-256 it gives, and there are no others apart from those an import never reads
 *
 * @param signature The file's signature, whose origin is this site's
 * @param files The file's files, by their paths in the export
 * @return Whether they are
 */
async function contentsIntact(signature: ExportSignature, files: ReadonlyMap<string, Buffer>): Promise<boolean>
{
	if (!hashesMatch(Buffer.from(signature.contents, 'base64'), keyedHash('exportContents', contentsText(signature.files))))
	{
		return(false);
	}

	for (const path of files.keys())
	{
		if ((path !== UNIVERSE_EXPORT_SIGNATURE) && !Object.hasOwn(signature.files, path) && !neverRead(path))
		{
			return(false);
		}
	}

	for (const [path, hash] of Object.entries(signature.files))
	{
		const content = files.get(path);

		if (!content)
		{
			return(false);
		}

		// Each file is hashed in one go, so other requests and the rooms' ticks run between them
		await yieldToEventLoop();

		if (createHash('sha256').update(content).digest('hex') !== hash)
		{
			return(false);
		}
	}

	return(true);
}

/**
 * Whether a file in an archive is one an import never reads, which an operating system adds
 *
 * @param path Its path in the export
 * @return Whether it is
 */
function neverRead(path: string): boolean
{
	return(path.startsWith(MACOS_METADATA_FOLDER) || SYSTEM_FILES.has(path.slice(path.lastIndexOf('/') + 1)));
}

/**
 * The text an export's origin signature is the keyed hash of
 *
 * @param origin Where the export is from
 * @return The text
 */
function originText(origin: ExportOrigin): string
{
	const { universe, exportedAt, exportedBy } = origin;

	return(JSON.stringify([universe.id, universe.version, universe.name, exportedAt, exportedBy.username, exportedBy.displayName]));
}

/**
 * The text an export's contents signature is the keyed hash of: its files' paths and SHA-256s, in the
 * order of their paths
 *
 * @param hashes Each file's SHA-256, by its path
 * @return The text
 */
function contentsText(hashes: Record<string, string>): string
{
	const entries = Object.entries(hashes)
		.sort(([a], [b]) => ((a < b) ? -1 : ((a > b) ? 1 : 0)));

	return(JSON.stringify(entries));
}
