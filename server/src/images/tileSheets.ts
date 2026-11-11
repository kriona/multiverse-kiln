/**
 * Checks and cleans uploaded tile graphics before they are stored
 */
import sharp, { type Metadata } from 'sharp';
import { MAX_TILE_GRAPHIC_BYTES, TILE_GRAPHIC_SIZES, type TileGraphicFormat } from '@multiverse-kiln/shared';

/**
 * What became of an uploaded tile graphic: its PNG, re-encoded, or why it was refused
 */
export type TileSheetResult =
	| { ok: true; png: Buffer }
	| { ok: false; problem: 'tooLarge' | 'notPng' | 'wrongSize' };

/**
 * The eight bytes every PNG starts with
 */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * The bytes a PNG chunk has besides its data: its length, type and CRC
 */
const PNG_CHUNK_OVERHEAD = 12;

/**
 * The PNG chunks an upload keeps before it is decoded: the ones its pixels need. Every other chunk, such as
 * text, ICC profiles and Exif, is dropped first, since libpng inflates compressed chunks while it reads the
 * header, and a few hundred KB of them can inflate to hundreds of MB
 */
const PNG_IMAGE_CHUNKS = new Set(['IHDR', 'PLTE', 'tRNS', 'IDAT', 'IEND']);

/**
 * Copies a PNG keeping only its PNG_IMAGE_CHUNKS, up to and including its IEND chunk
 *
 * @param upload The uploaded bytes
 * @return The PNG with only its image chunks, or null when it isn't a whole PNG: it has no PNG
 * signature, a chunk runs past its end, it has no IEND chunk, or it has a critical chunk that isn't an
 * image chunk, which a decoder must refuse
 */
export function pngImageChunks(upload: Buffer): Buffer | null
{
	if (!upload.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE))
	{
		return(null);
	}

	const kept: Buffer[] = [PNG_SIGNATURE];
	let offset = PNG_SIGNATURE.length;

	while ((offset + PNG_CHUNK_OVERHEAD) <= upload.length)
	{
		const end = offset + PNG_CHUNK_OVERHEAD + upload.readUInt32BE(offset);
		const type = upload.toString('latin1', offset + 4, offset + 8);
		// A critical chunk's type starts with an upper case letter: bit 5 of its first byte is clear
		const critical = ((upload[offset + 4] & 0x20) === 0);

		if (end > upload.length)
		{
			return(null);
		}

		if (PNG_IMAGE_CHUNKS.has(type))
		{
			kept.push(upload.subarray(offset, end));
		}
		else if (critical)
		{
			return(null);
		}

		if (type === 'IEND')
		{
			return(Buffer.concat(kept));
		}

		offset = end;
	}

	return(null);
}

/**
 * Checks that an upload is a PNG of a sheet in a format, that format's size (TILE_GRAPHIC_SIZES) and at
 * most MAX_TILE_GRAPHIC_BYTES, and re-encodes it. Only the chunks its pixels need are decoded, only once
 * its header gives the format's size, and
 * re-encoding keeps only the pixels: metadata (such as where a photo was taken), extra chunks and anything
 * hidden after the image are dropped
 *
 * @param upload The uploaded bytes
 * @param format The sheet's format
 * @return The re-encoded PNG, or the problem
 */
export async function prepareTileSheet(upload: Buffer, format: TileGraphicFormat): Promise<TileSheetResult>
{
	const { width, height } = TILE_GRAPHIC_SIZES[format];

	if (upload.length > MAX_TILE_GRAPHIC_BYTES)
	{
		return({ ok: false, problem: 'tooLarge' });
	}

	const imageChunks = pngImageChunks(upload);

	if (imageChunks === null)
	{
		return({ ok: false, problem: 'notPng' });
	}

	let metadata: Metadata;

	// Reading the metadata only reads the header, so it needs no pixel limit, and an image larger than the
	// sheet is refused for its size rather than as a file that couldn't be read
	try
	{
		metadata = await sharp(imageChunks, {
			limitInputPixels: false,
			failOn: 'error'
		})
			.metadata();
	}
	catch
	{
		return({ ok: false, problem: 'notPng' });
	}

	if (metadata.format !== 'png')
	{
		return({ ok: false, problem: 'notPng' });
	}

	if ((metadata.width !== width) || (metadata.height !== height))
	{
		return({ ok: false, problem: 'wrongSize' });
	}

	// A sheet's worth of pixels is all a valid upload has, so the decoder never reads more than that
	try
	{
		return({
			ok: true,
			png: await sharp(imageChunks, {
				limitInputPixels: width * height,
				failOn: 'error'
			})
				.ensureAlpha()
				.png({ compressionLevel: 9 })
				.toBuffer()
		});
	}
	catch
	{
		return({ ok: false, problem: 'notPng' });
	}
}
