import assert from 'assert';
import { randomBytes } from 'crypto';

import { readZip, zipArchive, zipFile, ZipError } from '../../src/archives/zip.js';

const MODIFIED = new Date(2026, 10, 8, 13, 59, 30);

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
});
