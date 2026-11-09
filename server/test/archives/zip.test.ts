import assert from 'assert';
import { createHash, randomBytes } from 'crypto';

import { readZip, zipArchive, zipFile, ZipError } from '../../src/archives/zip.js';

const MODIFIED = new Date(2026, 10, 8, 13, 59, 30);

/**
 * The compression method of deflated files
 */
const DEFLATED = 8;

describe('zip archives', () =>
{
	it('reads back the files it writes, deflated, stored and given in pieces', async () =>
	{
		const image = randomBytes(5000);
		const pieces = Array.from({ length: 200 }, (_value, index) => `{"piece":${index}},`);
		const archive = zipArchive([
			await zipFile('universe.json', ['{"name":"Kilnhaven"}']),
			await zipFile('areas/cave.json', pieces),
			await zipFile('tilesets/moss.png', [image], false)
		], MODIFIED);
		const files = await readZip(archive, 1000000);

		assert.deepStrictEqual([...files.keys()], ['universe.json', 'areas/cave.json', 'tilesets/moss.png']);
		assert.strictEqual(files.get('universe.json')?.toString('utf8'), '{"name":"Kilnhaven"}');
		assert.strictEqual(files.get('areas/cave.json')?.toString('utf8'), pieces.join(''));
		assert.ok(files.get('tilesets/moss.png')?.equals(image));
	});

	it('deflates what repeats into much less', async () =>
	{
		const file = await zipFile('cells.json', [JSON.stringify(Array.from({ length: 10000 }, () => 3))]);

		assert.ok(file.data.length < (file.size / 20), `${file.data.length} of ${file.size} bytes`);
	});

	it('keeps names in any alphabet', async () =>
	{
		const archive = zipArchive([await zipFile('Ünïcödé/Кilnhaven.json', ['{}'])], MODIFIED);

		assert.deepStrictEqual([...(await readZip(archive, 100)).keys()], ['Ünïcödé/Кilnhaven.json']);
	});

	it('writes an empty archive', async () =>
	{
		assert.deepStrictEqual((await readZip(zipArchive([], MODIFIED), 100)).size, 0);
	});

	it('refuses what isn\'t an archive', async () =>
	{
		await assert.rejects(readZip(Buffer.from('{"format":"universe-export"}'), 100), ZipError);
		await assert.rejects(readZip(Buffer.alloc(0), 100), ZipError);
	});

	it('refuses a damaged file', async () =>
	{
		const archive = zipArchive([await zipFile('tilesets/moss.png', [randomBytes(100)], false)], MODIFIED);

		// The stored content starts after the 30-byte local header and the 17-byte name
		archive[30 + 17 + 10] ^= 0xFF;

		await assert.rejects(readZip(archive, 1000), ZipError);
	});

	it('refuses an archive holding more than allowed once inflated', async () =>
	{
		const archive = zipArchive([await zipFile('bomb.json', [Buffer.alloc(1000000)])], MODIFIED);

		assert.ok(archive.length < 5000);
		await assert.rejects(readZip(archive, 999999), ZipError);
		assert.strictEqual((await readZip(archive, 1000000)).get('bomb.json')?.length, 1000000);
	});

	it('refuses two files with one name, or listed at one place in the archive', async () =>
	{
		const twice = zipArchive([await zipFile('a.json', ['{}']), await zipFile('a.json', ['[]'])], MODIFIED);
		const overlapping = zipArchive([await zipFile('a.json', ['{}']), await zipFile('b.json', ['[]'])], MODIFIED);

		// The list of files starts where the end record (the last 22 bytes) says; b.json's entry follows
		// a.json's 46-byte header and 6-byte name, and its local header's offset is 42 bytes into it
		const listStart = overlapping.readUInt32LE(overlapping.length - 22 + 16);

		overlapping.writeUInt32LE(0, listStart + 46 + 6 + 42);

		await assert.rejects(readZip(twice, 1000), /twice/);
		await assert.rejects(readZip(overlapping, 1000), /overlaps/);
	});

	it('refuses a file whose deflated data is much larger than its content, before inflating it', async () =>
	{
		// Empty stored blocks, each 5 bytes, inflate to nothing but take zlib's time to work through
		const blocks = Buffer.alloc(5000);

		for (let start = 0; start < blocks.length; start += 5)
		{
			blocks.set([((start === (blocks.length - 5)) ? 0x01 : 0x00), 0x00, 0x00, 0xFF, 0xFF], start);
		}

		const empty = zipArchive([{ name: 'empty.json', method: DEFLATED, crc: 0, size: 0, sha256: createHash('sha256').digest(), data: blocks }], MODIFIED);
		const random = randomBytes(100000);
		const incompressible = zipArchive([await zipFile('noise.bin', [random])], MODIFIED);

		await assert.rejects(readZip(empty, 1000), /damaged/);
		assert.ok((await readZip(incompressible, 100000)).get('noise.bin')?.equals(random));
	});
});
