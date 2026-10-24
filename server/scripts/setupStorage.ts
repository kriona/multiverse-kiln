/**
 * Creates the local object storage's bucket (STORAGE_BUCKET in server/.env) if it doesn't exist yet.
 * start.bat runs it after starting the storage container; run it by hand with npm run storage:setup -w server
 *
 * In production the bucket is made with the storage service's own tools
 */
import { ensureBucket } from '../src/storage/objectStorage.js';

// The storage container takes a moment to accept requests after it starts
const ATTEMPTS = 30;
const WAIT_MS = 1000;

for (let attempt = 1; ; attempt++)
{
	try
	{
		await ensureBucket();
		console.log(`Storage bucket ${process.env.STORAGE_BUCKET} is ready`);
		break;
	}
	catch (error)
	{
		if (attempt >= ATTEMPTS)
		{
			throw error;
		}

		await new Promise((resolve) =>
		{
			setTimeout(resolve, WAIT_MS);
		});
	}
}
