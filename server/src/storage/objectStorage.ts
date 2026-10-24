/**
 * Object storage for uploaded files, such as tile graphics: any S3-compatible service, set up by the
 * STORAGE_* environment variables (see server/.env.example). Locally, the SeaweedFS container in
 * docker-compose.yml
 *
 * The only module that talks to the storage service
 */
import { CreateBucketCommand, DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, NoSuchKey, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

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
 * Deletes a stored file, if there is one
 *
 * @param key Its key
 */
export async function deleteObject(key: string): Promise<void>
{
	const { client, bucket } = storage();

	await client.send(new DeleteObjectCommand({
		Bucket: bucket,
		Key: key
	}));
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
