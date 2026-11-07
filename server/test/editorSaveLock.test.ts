import assert from 'assert';
import type { EditableUniverseDetails, EditorRole } from '@multiverse-kiln/shared';

import { setUniverseRole } from '../src/db/universeEditorRepo.js';
import { findEditableUniverse } from '../src/db/universeRepo.js';
import { liveVersion } from '../src/db/universeVersions.js';
import { saveChanges, type SaveOutcome } from '../src/http/editorChanges.js';
import { saveChangesRequest } from '../src/http/editorPayloads.js';
import { universeAccessChanges, type StageChange } from '../src/players/universeAccess.js';
import { createUniverse, logIn, saveAll, send, type Editor } from './editorRequests.js';
import { getTestServer } from './testServer.js';

describe('Saving after another save took the universe\'s lock', () =>
{
	let ada: Editor;
	let grace: Editor;
	let universeId: string;

	/**
	 * The universe's live version as a request reads it before it waits for the universe's lock
	 *
	 * @return The universe
	 */
	async function readBeforeLock(): Promise<EditableUniverseDetails>
	{
		const universe = await findEditableUniverse(liveVersion(universeId));

		assert.ok(universe);

		return(universe);
	}

	/**
	 * Saves Grace's changes to the live version from a request that read the universe before another save
	 * committed, as one does that waited for the universe's lock
	 *
	 * @param universe The universe as the request read it
	 * @param role Grace's role, as the request read it
	 * @param changes The changes, as the request sends them
	 * @return How the save went
	 */
	async function saveFromStaleRead(universe: EditableUniverseDetails, role: EditorRole, changes: unknown[]): Promise<SaveOutcome>
	{
		const parsed = saveChangesRequest[universe.ruleset].parse({ changes });

		return(saveChanges({
			playerId: grace.playerId,
			universe,
			version: liveVersion(universeId),
			role,
			languages: [],
			serverAdmin: false
		}, parsed.changes));
	}

	before(async () =>
	{
		await getTestServer();
	});

	beforeEach(async () =>
	{
		ada = await logIn('Ada');
		grace = await logIn('Grace');
		universeId = await createUniverse(ada);
	});

	it('refuses a universe setting another editor saved in the meantime, and keeps theirs', async () =>
	{
		await setUniverseRole(universeId, grace.playerId, 'creator');

		const stale = await readBeforeLock();

		await saveAll(ada, universeId, [{
			kind: 'universe',
			update: { shortDescription: 'Ada\'s' },
			loaded: { shortDescription: stale.shortDescription }
		}]);

		const outcome = await saveFromStaleRead(stale, 'creator', [{
			kind: 'universe',
			update: { shortDescription: 'Grace\'s' },
			loaded: { shortDescription: stale.shortDescription }
		}]);

		assert.strictEqual(outcome.saved, false);
		assert.strictEqual(outcome.refusal.refusal.status, 409);
		assert.deepStrictEqual(outcome.refusal.conflicts?.map((conflict) => conflict.subject), ['settings']);

		const saved = (await send<{ shortDescription: string }>(ada, 'GET', `/${universeId}`)).body;

		assert.strictEqual(saved.shortDescription, 'Ada\'s');
	});

	it('tells the rooms nothing of the stage when the save doesn\'t change it', async () =>
	{
		await setUniverseRole(universeId, grace.playerId, 'builder');

		const stale = await readBeforeLock();
		const stages: StageChange[] = [];

		await saveAll(ada, universeId, [{ kind: 'universe', update: { stage: 'prologue' } }]);

		const stop = universeAccessChanges.onStageChanged((change) =>
		{
			stages.push(change);
		});

		try
		{
			const outcome = await saveFromStaleRead(stale, 'builder', [{ kind: 'createArea', ref: 'new:area', area: { name: 'Cave' } }]);

			assert.strictEqual(outcome.saved, true);
		}
		finally
		{
			stop();
		}

		assert.deepStrictEqual(stages, []);

		const saved = (await send<{ stage: string }>(ada, 'GET', `/${universeId}`)).body;

		assert.strictEqual(saved.stage, 'prologue');
	});
});
