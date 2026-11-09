/**
 * Zip archives, as PKWARE's APPNOTE describes them without Zip64: making them in memory, and reading
 * them back. Files are deflated and inflated by Node's zlib on its thread pool, so a large file doesn't
 * hold up the event loop the rooms run on
 */
import { createHash } from 'crypto';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { promisify } from 'util';
import zlib from 'zlib';

const inflateRaw = promisify(zlib.inflateRaw);

const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const END_SIGNATURE = 0x06054b50;
const LOCAL_HEADER_SIZE = 30;
const CENTRAL_HEADER_SIZE = 46;
const END_SIZE = 22;

/**
 * The longest comment the end of an archive can have, which reading looks back past for its signature
 */
const MAX_COMMENT_LENGTH = 0xFFFF;

/**
 * The zip version needed to read the files: 2.0, which brought deflate
 */
const ZIP_VERSION = 20;

/**
 * The general purpose flag saying a file's name is UTF-8
 */
const UTF8_FLAG = 0x0800;

/**
 * The general purpose flag saying a file is encrypted
 */
const ENCRYPTED_FLAG = 0x0001;

const STORED = 0;
const DEFLATED = 8;

/**
 * The largest size, offset or count of files a field holds without Zip64
 */
const MAX_FIELD = 0xFFFFFFFF;
const MAX_FILES = 0xFFFF;

/**
 * A file ready to go into an archive
 */
export interface ZipFile
{
	name: string;

	/**
	 * STORED or DEFLATED
	 */
	method: number;

	/**
	 * The CRC-32 of its content
	 */
	crc: number;

	/**
	 * Its content's length
	 */
	size: number;

	/**
	 * The SHA-256 of its content, which, unlike the CRC-32, can't be matched by other content made for it
	 */
	sha256: Buffer;

	/**
	 * Its content, as method leaves it
	 */
	data: Buffer;
}

/**
 * An archive that can't be read: not a zip archive, damaged, or using what reading doesn't support
 * (Zip64, encryption, methods other than stored and deflated), or larger than allowed once inflated
 */
export class ZipError extends Error
{
	/**
	 * @param message What is wrong with it, for the server's log
	 */
	constructor(message: string)
	{
		super(message);
		this.name = 'ZipError';
	}
}

/**
 * Makes a file for an archive from its content, given in pieces so a large file needn't be held whole
 * before it is deflated
 *
 * @param name Its path in the archive, with / between folders
 * @param pieces Its content, in order
 * @param compress Whether to deflate it; content that is compressed already, such as a PNG, is stored
 * @return The file
 * @throws RangeError when the content is too large for an archive without Zip64
 */
export async function zipFile(name: string, pieces: Iterable<string | Buffer> | AsyncIterable<string | Buffer>, compress: boolean = true): Promise<ZipFile>
{
	let crc = 0;
	let size = 0;
	const sha256 = createHash('sha256');
	const output: Buffer[] = [];

	/**
	 * The content as buffers, counted as it passes
	 *
	 * @return The buffers
	 */
	async function* counted(): AsyncGenerator<Buffer>
	{
		for await (const piece of pieces)
		{
			const buffer = ((typeof piece === 'string') ? Buffer.from(piece, 'utf8') : piece);

			crc = zlib.crc32(buffer, crc);
			sha256.update(buffer);
			size += buffer.length;
			yield buffer;
		}
	}

	/**
	 * Keeps what comes out of the deflater, or the content itself when it is stored
	 *
	 * @param source The buffers
	 */
	async function collect(source: AsyncIterable<Buffer>): Promise<void>
	{
		for await (const buffer of source)
		{
			output.push(buffer);
		}
	}

	if (compress)
	{
		await pipeline(Readable.from(counted()), zlib.createDeflateRaw(), collect);
	}
	else
	{
		await collect(counted());
	}

	const data = Buffer.concat(output);

	if ((size > MAX_FIELD) || (data.length > MAX_FIELD))
	{
		throw new RangeError(`${name} is too large for a zip archive`);
	}

	return({
		name,
		method: (compress ? DEFLATED : STORED),
		crc,
		size,
		sha256: sha256.digest(),
		data
	});
}

/**
 * Makes an archive of files, in the order given
 *
 * @param files The files, each with a name of its own
 * @param modified When the files were last changed, written in the computer's time zone as zip does
 * @return The archive
 * @throws RangeError when there are too many files, or they are too large, for an archive without Zip64
 */
export function zipArchive(files: readonly ZipFile[], modified: Date): Buffer
{
	if (files.length > MAX_FILES)
	{
		throw new RangeError('Too many files for a zip archive');
	}

	const time = ((modified.getHours() << 11) | (modified.getMinutes() << 5) | Math.floor(modified.getSeconds() / 2));
	const date = (((Math.max(modified.getFullYear(), 1980) - 1980) << 9) | ((modified.getMonth() + 1) << 5) | modified.getDate());
	const parts: Buffer[] = [];
	const central: Buffer[] = [];
	let offset = 0;

	for (const file of files)
	{
		const name = Buffer.from(file.name, 'utf8');
		const local = Buffer.alloc(LOCAL_HEADER_SIZE);
		const header = Buffer.alloc(CENTRAL_HEADER_SIZE);

		local.writeUInt32LE(LOCAL_HEADER_SIGNATURE, 0);
		local.writeUInt16LE(ZIP_VERSION, 4);
		local.writeUInt16LE(UTF8_FLAG, 6);
		local.writeUInt16LE(file.method, 8);
		local.writeUInt16LE(time, 10);
		local.writeUInt16LE(date, 12);
		local.writeUInt32LE(file.crc, 14);
		local.writeUInt32LE(file.data.length, 18);
		local.writeUInt32LE(file.size, 22);
		local.writeUInt16LE(name.length, 26);
		local.writeUInt16LE(0, 28);

		header.writeUInt32LE(CENTRAL_HEADER_SIGNATURE, 0);
		header.writeUInt16LE(ZIP_VERSION, 4);
		header.writeUInt16LE(ZIP_VERSION, 6);
		header.writeUInt16LE(UTF8_FLAG, 8);
		header.writeUInt16LE(file.method, 10);
		header.writeUInt16LE(time, 12);
		header.writeUInt16LE(date, 14);
		header.writeUInt32LE(file.crc, 16);
		header.writeUInt32LE(file.data.length, 20);
		header.writeUInt32LE(file.size, 24);
		header.writeUInt16LE(name.length, 28);
		header.writeUInt32LE(offset, 42);

		parts.push(local, name, file.data);
		central.push(header, name);
		offset += (local.length + name.length + file.data.length);

		if (offset > MAX_FIELD)
		{
			throw new RangeError('The files are too large for a zip archive');
		}
	}

	const centralSize = central.reduce((total, part) => (total + part.length), 0);
	const end = Buffer.alloc(END_SIZE);

	end.writeUInt32LE(END_SIGNATURE, 0);
	end.writeUInt16LE(files.length, 8);
	end.writeUInt16LE(files.length, 10);
	end.writeUInt32LE(centralSize, 12);
	end.writeUInt32LE(offset, 16);

	return(Buffer.concat([...parts, ...central, end]));
}

/**
 * A file listed in an archive's list of files
 */
interface ZipEntry
{
	name: string;

	/**
	 * STORED or DEFLATED
	 */
	method: number;

	/**
	 * The CRC-32 of its content
	 */
	crc: number;

	/**
	 * Its content's length
	 */
	size: number;

	/**
	 * Where its local header starts
	 */
	headerStart: number;

	/**
	 * Where its data starts and ends, after its local header
	 */
	dataStart: number;
	dataEnd: number;
}

/**
 * The most bytes a file's deflated data may take, a little more than its content: a deflater stores what
 * doesn't compress, and even one that doesn't adds at most an eighth. Data that is larger inflates to
 * little but still takes zlib's time to work through, so it is refused before being inflated
 *
 * @param size The file's content's length
 * @return The most bytes its data may take
 */
function mostDeflatedBytes(size: number): number
{
	return(size + Math.ceil(size / 8) + 64);
}

/**
 * Reads the files of an archive, leaving out folders. Every file is checked before any is inflated: no
 * two may share a name or overlap in the archive, and none may take much more than its content, so the
 * work of inflating them is bounded by the archive's length and maxSize
 *
 * @param archive The archive
 * @param maxSize The most bytes its files may hold in all once inflated, so a small archive can't
 * inflate into more memory than the server has
 * @return Each file's content, by its path in the archive
 * @throws ZipError when the archive can't be read, or holds more than maxSize
 */
export async function readZip(archive: Buffer, maxSize: number): Promise<Map<string, Buffer>>
{
	const entries = readEntries(archive, maxSize);
	const files = new Map<string, Buffer>();
	let remaining = maxSize;

	for (const entry of entries)
	{
		const data = await readFileData(archive, entry, remaining);

		if ((data.length !== entry.size) || (zlib.crc32(data) !== entry.crc))
		{
			throw new ZipError(`${entry.name} is damaged`);
		}

		remaining -= data.length;
		files.set(entry.name, data);
	}

	return(files);
}

/**
 * Reads and checks an archive's list of files, leaving out folders
 *
 * @param archive The archive
 * @param maxSize The most bytes its files may hold in all once inflated
 * @return Its files, in the order the list gives them
 * @throws ZipError when the list can't be read, its files share a name or overlap, one takes much more
 * than its content, or they hold more than maxSize
 */
function readEntries(archive: Buffer, maxSize: number): ZipEntry[]
{
	const end = findEnd(archive);
	const count = archive.readUInt16LE(end + 10);
	const listStart = archive.readUInt32LE(end + 16);
	const entries: ZipEntry[] = [];
	const names = new Set<string>();
	let position = listStart;
	let total = 0;

	if ((count === MAX_FILES) || (listStart === MAX_FIELD))
	{
		throw new ZipError('Zip64 archives aren\'t supported');
	}

	for (let index = 0; index < count; index++)
	{
		if ((position + CENTRAL_HEADER_SIZE > archive.length) || (archive.readUInt32LE(position) !== CENTRAL_HEADER_SIGNATURE))
		{
			throw new ZipError('The archive\'s list of files is damaged');
		}

		const flags = archive.readUInt16LE(position + 8);
		const method = archive.readUInt16LE(position + 10);
		const crc = archive.readUInt32LE(position + 16);
		const compressedSize = archive.readUInt32LE(position + 20);
		const size = archive.readUInt32LE(position + 24);
		const nameLength = archive.readUInt16LE(position + 28);
		const extraLength = archive.readUInt16LE(position + 30);
		const commentLength = archive.readUInt16LE(position + 32);
		const localOffset = archive.readUInt32LE(position + 42);
		const name = archive.toString('utf8', (position + CENTRAL_HEADER_SIZE), (position + CENTRAL_HEADER_SIZE + nameLength));

		position += (CENTRAL_HEADER_SIZE + nameLength + extraLength + commentLength);

		if (name.endsWith('/'))
		{
			continue;
		}

		if ((compressedSize === MAX_FIELD) || (size === MAX_FIELD) || (localOffset === MAX_FIELD))
		{
			throw new ZipError('Zip64 archives aren\'t supported');
		}

		if ((flags & ENCRYPTED_FLAG) !== 0)
		{
			throw new ZipError(`${name} is encrypted`);
		}

		if ((method !== STORED) && (method !== DEFLATED))
		{
			throw new ZipError(`${name} is compressed in a way that isn't supported`);
		}

		if (names.has(name))
		{
			throw new ZipError(`${name} is in the archive twice`);
		}

		total += size;

		if (total > maxSize)
		{
			throw new ZipError('The archive holds more than allowed');
		}

		if (compressedSize > mostDeflatedBytes(size))
		{
			throw new ZipError(`${name} is damaged`);
		}

		const dataStart = findFileData(archive, localOffset, name);
		const dataEnd = (dataStart + compressedSize);

		if (dataEnd > listStart)
		{
			throw new ZipError(`${name} is damaged`);
		}

		names.add(name);
		entries.push({
			name,
			method,
			crc,
			size,
			headerStart: localOffset,
			dataStart,
			dataEnd
		});
	}

	const byPlace = [...entries]
		.sort((a, b) => (a.headerStart - b.headerStart));

	for (let index = 1; index < byPlace.length; index++)
	{
		if (byPlace[index].headerStart < byPlace[index - 1].dataEnd)
		{
			throw new ZipError(`${byPlace[index].name} overlaps another file in the archive`);
		}
	}

	return(entries);
}

/**
 * Finds the end of an archive's list of files, which comes last, before a comment of up to
 * MAX_COMMENT_LENGTH bytes
 *
 * @param archive The archive
 * @return Where the end record starts
 * @throws ZipError when there is none
 */
function findEnd(archive: Buffer): number
{
	const earliest = Math.max(0, (archive.length - END_SIZE - MAX_COMMENT_LENGTH));

	for (let position = (archive.length - END_SIZE); position >= earliest; position--)
	{
		if (archive.readUInt32LE(position) === END_SIGNATURE)
		{
			return(position);
		}
	}

	throw new ZipError('Not a zip archive');
}

/**
 * Where a file's data starts, after its local header
 *
 * @param archive The archive
 * @param offset Where its local header starts
 * @param name Its path in the archive, for errors
 * @return Where its data starts
 * @throws ZipError when there is no local header there
 */
function findFileData(archive: Buffer, offset: number, name: string): number
{
	if ((offset + LOCAL_HEADER_SIZE > archive.length) || (archive.readUInt32LE(offset) !== LOCAL_HEADER_SIGNATURE))
	{
		throw new ZipError(`${name} is damaged`);
	}

	return(offset + LOCAL_HEADER_SIZE + archive.readUInt16LE(offset + 26) + archive.readUInt16LE(offset + 28));
}

/**
 * One file's content
 *
 * @param archive The archive
 * @param entry The file, as the list of files gives it
 * @param maxSize The most bytes it may inflate to
 * @return Its content
 * @throws ZipError when it can't be read
 */
async function readFileData(archive: Buffer, entry: ZipEntry, maxSize: number): Promise<Buffer>
{
	const data = archive.subarray(entry.dataStart, entry.dataEnd);

	if (entry.method === STORED)
	{
		return(data);
	}

	try
	{
		return(await inflateRaw(data, { maxOutputLength: Math.max(maxSize, 1) }));
	}
	catch
	{
		throw new ZipError(`${entry.name} is damaged, or holds more than allowed`);
	}
}
