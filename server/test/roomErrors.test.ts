import assert from 'assert';
import { ErrorCode, ServerError } from 'colyseus';

import { unexplainedRoomError, withoutErrorDetails } from '../src/rooms/roomErrors.js';
import { loggedErrors } from './loggedErrors.js';

describe('withoutErrorDetails', () =>
{
	it('returns what the step returns', async () =>
	{
		assert.strictEqual(await withoutErrorDetails('Testing', ErrorCode.MATCHMAKE_UNHANDLED, () => Promise.resolve(42)), 42);
	});

	it('passes on a ServerError, which is made to be sent to the client', async () =>
	{
		const refusal = new ServerError(ErrorCode.AUTH_FAILED, 'Not allowed');
		const logged = await loggedErrors(() => assert.rejects(withoutErrorDetails('Testing', ErrorCode.MATCHMAKE_UNHANDLED, () => Promise.reject(refusal)), (error) => (error === refusal)));

		assert.deepStrictEqual(logged, []);
	});

	it('logs any other error with the step, and gives the client only a fixed message and the code', async () =>
	{
		const failure = new Error('Failed query: select * from groups where id = $1\nparams: 7d1c1f8e');

		for (const code of [ErrorCode.MATCHMAKE_UNHANDLED, ErrorCode.APPLICATION_ERROR])
		{
			const logged = await loggedErrors(() => assert.rejects(withoutErrorDetails('Creating a game room', code, () => Promise.reject(failure)), (error) =>
			{
				assert.ok(error instanceof ServerError);
				assert.deepStrictEqual([error.code, error.message], [code, unexplainedRoomError().message]);

				return(true);
			}));

			assert.strictEqual(logged.length, 1);
			assert.match(logged[0], /^Creating a game room failed: Error: Failed query: select \* from groups/);
		}
	});
});
