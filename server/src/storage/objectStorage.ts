/**
 * Object storage for uploaded files, such as tile graphics: any S3-compatible service, set up by the
 * STORAGE_* environment variables (see server/.env.example). Locally, the SeaweedFS container in
 * docker-compose.yml
 *
 * The only module that talks to the storage service
 */
import { CreateBucketCommand, DeleteObjectsCommand, GetObjectCommand, HeadBucketCommand, NoSuchKey, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

/**
 * The storage service's settings
 */
interface StorageSettings
{
	client: S3Client;
	bucket: string;
}

let settings: StorageSettings | undefined;

/**
 * How long connecting to the storage service may take. The S3 client's own defaults have no timeouts,
 * so it would wait forever on a storage service that stops answering, holding the request that needed it
 */
const STORAGE_CONNECTION_TIMEOUT_MS = 3000;

/**
 * How long a storage request may take from sending it to the response's headers. The files stored
 * are small (tile graphics are at most MAX_TILE_GRAPHIC_BYTES), so this is generous
 */
const STORAGE_REQUEST_TIMEOUT_MS = 10000;

/**
 * How long a storage request's connection may go without sending or receiving anything, which also
 * covers reading the response's body. The S3 client tries a request three times, so a storage service
 * that accepts connections and never answers fails it after about 12 seconds. Kept under 6 seconds:
 * the HTTP handler watches the socket from the start for shorter timeouts, but starts watching longer
 * ones only 3 seconds in, and not at all once the response's headers have arrived
 */
const STORAGE_SOCKET_TIMEOUT_MS = 4000;

/**
 * The most keys one DeleteObjects request may name
 */
const MAX_KEYS_PER_DELETE = 1000;

/**
 * The storage service's settings, read from the environment the first time they are needed, so the
 * server runs without storage until something is uploaded or served
 *
 * @return The settings
 * @throws Error when STORAGE_BUCKET, STORAGE_ACCESS_KEY_ID or STORAGE_SECRET_ACCESS_KEY is unset
 */
function storage(): StorageSettings
{
	if (settings)
	{
		return(settings);
	}

	const bucket = process.env.STORAGE_BUCKET;
	const accessKeyId = process.env.STORAGE_ACCESS_KEY_ID;
	const secretAccessKey = process.env.STORAGE_SECRET_ACCESS_KEY;

	if (!bucket || !accessKeyId || !secretAccessKey)
	{
		throw new Error('STORAGE_BUCKET, STORAGE_ACCESS_KEY_ID and STORAGE_SECRET_ACCESS_KEY must be set. See server/.env.example');
	}

	settings = {
		bucket,
		client: new S3Client({
			endpoint: (process.env.STORAGE_ENDPOINT || undefined),
			region: (process.env.STORAGE_REGION || 'auto'),
			forcePathStyle: (process.env.STORAGE_FORCE_PATH_STYLE === 'true'),
			credentials: {
				accessKeyId,
				secretAccessKey
			},
			requestHandler: {
				connectionTimeout: STORAGE_CONNECTION_TIMEOUT_MS,
				requestTimeout: STORAGE_REQUEST_TIMEOUT_MS,
				throwOnRequestTimeout: true,
				socketTimeout: STORAGE_SOCKET_TIMEOUT_MS
			}
		})
	};

	return(settings);
}

/**
 * Stores a file, replacing any file with the same key
 *
 * @param key Where it goes, e.g. tile-graphics/<universe ID>/<graphic ID>.png
 * @param body The file
 * @param contentType Its media type, e.g. image/png
 */
export async function putObject(key: string, body: Buffer, contentType: string): Promise<void>
{
	const { client, bucket } = storage();

	await client.send(new PutObjectCommand({
		Bucket: bucket,
		Key: key,
		Body: body,
		ContentType: contentType
	}));
}

/**
 * Reads a stored file
 *
 * @param key Its key
 * @return The file, or undefined when nothing is stored under the key
 */
export async function getObject(key: string): Promise<Buffer | undefined>
{
	const { client, bucket } = storage();

	try
	{
		const response = await client.send(new GetObjectCommand({
			Bucket: bucket,
			Key: key
		}));
		const bytes = await response.Body?.transformToByteArray();

		return(((bytes === undefined) ? undefined : Buffer.from(bytes)));
	}
	catch (error)
	{
		if (error instanceof NoSuchKey)
		{
			return(undefined);
		}

		throw error;
	}
}

/**
 * Deletes stored files, up to MAX_KEYS_PER_DELETE in each request. A key with nothing stored under it
 * counts as deleted. Files that can't be deleted are logged rather than failing: callers delete the
 * files of rows already gone, and nothing serves a file without its row
 *
 * @param keys Their keys
 */
export async function deleteObjects(keys: readonly string[]): Promise<void>
{
	for (let start = 0; start < keys.length; start += MAX_KEYS_PER_DELETE)
	{
		const batch = keys.slice(start, (start + MAX_KEYS_PER_DELETE));

		try
		{
			const { client, bucket } = storage();
			const result = await client.send(new DeleteObjectsCommand({
				Bucket: bucket,
				Delete: {
					Objects: batch.map((key) => ({ Key: key })),
					Quiet: true
				}
			}));

			for (const failure of (result.Errors ?? []))
			{
				console.error(`Could not delete the stored file ${failure.Key}: ${failure.Code} ${failure.Message}`);
			}
		}
		catch (error)
		{
			console.error(`Could not delete the stored files ${batch.join(', ')}:`, error);
		}
	}
}

/**
 * Creates the bucket if it doesn't exist yet: for local development and the tests. In production the
 * bucket is made with the storage service's own tools
 */
export async function ensureBucket(): Promise<void>
{
	const { client, bucket } = storage();

	try
	{
		await client.send(new HeadBucketCommand({ Bucket: bucket }));
	}
	catch
	{
		await client.send(new CreateBucketCommand({ Bucket: bucket }));
	}
}
