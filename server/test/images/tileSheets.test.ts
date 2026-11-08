import assert from 'assert';
import { crc32, deflateSync } from 'node:zlib';
import { TILE_GRAPHIC_SIZES } from '@multiverse-kiln/shared';
import sharp from 'sharp';

import { pngImageChunks, prepareTileSheet } from '../../src/images/tileSheets.js';

/**
 * Builds one PNG chunk with its length and CRC
 *
 * @param type The chunk's four-letter type
 * @param data The chunk's data
 * @return The chunk's bytes
 */
function pngChunk(type: string, data: Buffer): Buffer
{
	const length = Buffer.alloc(4);
	const typeBytes = Buffer.from(type, 'latin1');
	const crc = Buffer.alloc(4);

	length.writeUInt32BE(data.length);
	crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])) >>> 0);

	return(Buffer.concat([length, typeBytes, data, crc]));
}

/**
 * Lists a PNG's chunk types in order
 *
 * @param png The PNG's bytes
 * @return Each chunk's type
 */
function chunkTypes(png: Buffer): string[]
{
	const types: string[] = [];
	let offset = 8;

	while (offset < png.length)
	{
		types.push(png.toString('latin1', offset + 4, offset + 8));
		offset += 12 + png.readUInt32BE(offset);
	}

	return(types);
}

/**
 * A Dual-Grid sheet's PNG filled with one color, as sharp writes it
 *
 * @param alpha The color's opacity, from 0 to 1
 * @return The PNG's bytes
 */
async function sheetPng(alpha: number = 1): Promise<Buffer>
{
	return(await sharp({
		create: {
			...TILE_GRAPHIC_SIZES.dualGrid,
			channels: 4,
			background: { r: 40, g: 140, b: 60, alpha }
		}
	})
		.png()
		.toBuffer());
}

/**
 * Puts chunks into a PNG after its IHDR chunk, which follows the 8-byte signature and is 25 bytes long
 *
 * @param png The PNG's bytes
 * @param chunks The chunks to add
 * @return The PNG with the chunks added
 */
function withChunksAfterHeader(png: Buffer, chunks: Buffer[]): Buffer
{
	return(Buffer.concat([png.subarray(0, 33), ...chunks, png.subarray(33)]));
}

describe('tile sheet uploads', () =>
{
	it('drops text, color profile and Exif chunks and anything after the image before decoding it', async () =>
	{
		const base = await sheetPng();
		// Each inflates to 16 MB, which libpng would inflate while reading the header
		const compressed = deflateSync(Buffer.alloc(16 * 1048576, 0x61), { level: 9 });
		const upload = Buffer.concat([
			withChunksAfterHeader(base, [
				pngChunk('zTXt', Buffer.concat([Buffer.from('Comment\0\0', 'latin1'), compressed])),
				pngChunk('iTXt', Buffer.concat([Buffer.from('XML:com.adobe.xmp\0\x01\0\0\0', 'latin1'), compressed])),
				pngChunk('iCCP', Buffer.concat([Buffer.from('Profile\0\0', 'latin1'), compressed])),
				pngChunk('tEXt', Buffer.from('Author\0Someone', 'latin1')),
				pngChunk('eXIf', Buffer.from('MM\0*', 'latin1'))
			]),
			Buffer.from('hidden after the image')
		]);

		const kept = pngImageChunks(upload);

		assert.ok(kept);
		assert.deepStrictEqual(chunkTypes(kept), ['IHDR', 'IDAT', 'IEND']);
		assert.deepStrictEqual(kept, pngImageChunks(base));

		const prepared = await prepareTileSheet(upload, 'dualGrid');

		assert.ok(prepared.ok, JSON.stringify(prepared));
		assert.deepStrictEqual((await sharp(prepared.png).raw().toBuffer()), (await sharp(base).raw().toBuffer()));
	});

	it('keeps a palette and its transparency', async () =>
	{
		const palette = await sharp(await sheetPng(0.5))
			.png({ palette: true })
			.toBuffer();

		const kept = pngImageChunks(palette);

		assert.ok(kept);
		assert.deepStrictEqual(chunkTypes(kept), ['IHDR', 'PLTE', 'tRNS', 'IDAT', 'IEND']);

		const prepared = await prepareTileSheet(palette, 'dualGrid');

		assert.ok(prepared.ok, JSON.stringify(prepared));
		assert.deepStrictEqual((await sharp(prepared.png).raw().toBuffer()), (await sharp(palette).ensureAlpha().raw().toBuffer()));
	});

	it('refuses uploads that aren\'t whole PNGs, or that have critical chunks it doesn\'t know', async () =>
	{
		const base = await sheetPng();
		const unknownCritical = withChunksAfterHeader(base, [pngChunk('ABCD', Buffer.alloc(4))]);
		const runsPastTheEnd = withChunksAfterHeader(base.subarray(0, 33), [pngChunk('IDAT', Buffer.alloc(64)).subarray(0, 40)]);
		const noEnd = base.subarray(0, base.length - 12);

		for (const upload of [Buffer.alloc(0), Buffer.from('not an image'), base.subarray(1), unknownCritical, runsPastTheEnd, noEnd])
		{
			assert.strictEqual(pngImageChunks(upload), null, upload.subarray(0, 40).toString('hex'));
			assert.deepStrictEqual((await prepareTileSheet(upload, 'dualGrid')), { ok: false, problem: 'notPng' });
		}
	});
});
