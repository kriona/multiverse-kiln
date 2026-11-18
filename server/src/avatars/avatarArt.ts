/**
 * The avatar art the engine ships (shared/assets/avatars/), read from disk, and composing an avatar's
 * layers (avatarPicture() in /shared) into a PNG with sharp
 *
 * Each file's version is a hash of its contents, so an avatar's hash changes when a file is drawn again.
 * Files are read once and kept, and read again when their size or time changes, so art added while the
 * server runs shows without restarting it
 */
import { createHash } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp, { type OverlayOptions } from 'sharp';
import { AVATAR_HEIGHT, AVATAR_WIDTH, type AvatarLayer } from '@multiverse-kiln/shared';

/**
 * The shared package's avatar art folder: next to its built code (dist/index.js)
 */
export const AVATARS_FOLDER = path.resolve(path.dirname(fileURLToPath(import.meta.resolve('@multiverse-kiln/shared'))), '../assets/avatars');

/**
 * The folder art is read from: AVATARS_FOLDER, but for tests
 */
let artFolder = AVATARS_FOLDER;

/**
 * Reads art from another folder, for tests that make their own
 *
 * @param folder The folder, or undefined for AVATARS_FOLDER
 */
export function useArtFolder(folder: string | undefined): void
{
	artFolder = (folder ?? AVATARS_FOLDER);
	files.clear();
}

/**
 * The version of a file that can't be read
 */
const MISSING_VERSION = 'missing';

/**
 * A file read from the art folder
 */
interface ArtFile
{
	/**
	 * Its size and when it was last changed, as read, to tell when it changes
	 */
	size: number;
	changedMs: number;

	/**
	 * Its contents, or null when it can't be read
	 */
	contents: Buffer | null;

	/**
	 * A hash of its contents, or MISSING_VERSION
	 */
	version: string;
}

/**
 * The files read so far, by their path relative to AVATARS_FOLDER
 */
const files = new Map<string, ArtFile>();

/**
 * Reads a file of the art folder, or the copy kept when it hasn't changed
 *
 * @param file Its path, relative to AVATARS_FOLDER
 * @return The file; contents null when it isn't there or isn't inside the folder
 */
async function readArtFile(file: string): Promise<ArtFile>
{
	const fullPath = path.resolve(artFolder, file);
	const missing: ArtFile = {
		size: -1,
		changedMs: -1,
		contents: null,
		version: MISSING_VERSION
	};

	if (!fullPath.startsWith(artFolder + path.sep))
	{
		return(missing);
	}

	try
	{
		const stats = await fs.stat(fullPath);
		const kept = files.get(file);

		if (kept && (kept.size === stats.size) && (kept.changedMs === stats.mtimeMs))
		{
			return(kept);
		}

		const contents = await fs.readFile(fullPath);
		const read: ArtFile = {
			size: stats.size,
			changedMs: stats.mtimeMs,
			contents,
			version: createHash('sha256')
				.update(contents)
				.digest('hex')
				.slice(0, 16)
		};

		files.set(file, read);
		return(read);
	}
	catch
	{
		files.delete(file);
		return(missing);
	}
}

/**
 * The versions of the files some layers draw
 *
 * @param layers The layers
 * @return Each file's version, by its path relative to AVATARS_FOLDER
 */
export async function fileVersionsOf(layers: readonly AvatarLayer[]): Promise<Map<string, string>>
{
	const paths = [...new Set(layers.map((layer) => layer.file))];
	const read = await Promise.all(paths.map((file) => readArtFile(file)));

	return(new Map(paths.map((file, index) => [file, read[index].version])));
}

/**
 * Composes an avatar's layers into a PNG the size of an avatar, each over the ones before it. A layer
 * whose file can't be read is left out and logged
 *
 * @param layers The layers, from the first drawn to the last
 * @return The PNG
 */
export async function composeLayers(layers: readonly AvatarLayer[]): Promise<Buffer>
{
	const inputs: OverlayOptions[] = [];

	for (const layer of layers)
	{
		const { contents } = await readArtFile(layer.file);

		if (contents === null)
		{
			console.error('Avatar art file', layer.file, 'is in the manifest but can\'t be read');
			continue;
		}

		inputs.push({
			input: (layer.flipped
				? await sharp(contents)
					.flop()
					.png()
					.toBuffer()
				: contents),
			left: Math.round(layer.x),
			top: Math.round(layer.y)
		});
	}

	return(sharp({
		create: {
			width: AVATAR_WIDTH,
			height: AVATAR_HEIGHT,
			channels: 4,
			background: {
				r: 0,
				g: 0,
				b: 0,
				alpha: 0
			}
		}
	})
		.composite(inputs)
		.png({ compressionLevel: 9 })
		.toBuffer());
}
