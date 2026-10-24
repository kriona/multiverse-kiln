/**
 * Checks and cleans uploaded tile graphics before they are stored
 */
import sharp, { type Metadata } from 'sharp';
import { MAX_TILE_GRAPHIC_BYTES, TILE_GRAPHIC_SIZE } from '@multiverse-kiln/shared';

/**
 * What became of an uploaded tile graphic: its PNG, re-encoded, or why it was refused
 */
export type TileSheetResult =
	| { ok: true; png: Buffer }
	| { ok: false; problem: 'tooLarge' | 'notPng' | 'wrongSize' };

/**
 * Checks that an upload is a PNG of a Dual-Grid sheet, TILE_GRAPHIC_SIZE pixels square and at most
 * MAX_TILE_GRAPHIC_BYTES, and re-encodes it. Re-encoding keeps only the pixels: metadata (such as where a
 * photo was taken), extra chunks and anything hidden after the image are dropped
 *
 * @param upload The uploaded bytes
 * @return The re-encoded PNG, or the problem
 */
export async function prepareTileSheet(upload: Buffer): Promise<TileSheetResult>
{
	if (upload.length > MAX_TILE_GRAPHIC_BYTES)
	{
		return({ ok: false, problem: 'tooLarge' });
	}

	// A sheet's worth of pixels is all a valid upload has, so a larger image is refused before it is decoded
	const image = sharp(upload, {
		limitInputPixels: TILE_GRAPHIC_SIZE * TILE_GRAPHIC_SIZE,
		failOn: 'error'
	});
	let metadata: Metadata;

	try
	{
		metadata = await image.metadata();
	}
	catch
	{
		return({ ok: false, problem: 'notPng' });
	}

	if (metadata.format !== 'png')
	{
		return({ ok: false, problem: 'notPng' });
	}

	if ((metadata.width !== TILE_GRAPHIC_SIZE) || (metadata.height !== TILE_GRAPHIC_SIZE))
	{
		return({ ok: false, problem: 'wrongSize' });
	}

	try
	{
		return({
			ok: true,
			png: await image
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
