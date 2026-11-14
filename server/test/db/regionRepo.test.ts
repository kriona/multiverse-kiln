import assert from 'assert';

import { listRegionBuilderIds, setRegionAssignments } from '../../src/db/regionRepo.js';
import { regions } from '../../src/db/schema.js';
import { inTransaction } from '../../src/db/transactions.js';
import { findDraftOrigins, startDraft } from '../../src/db/universeDraftRepo.js';
import { setUniverseRole } from '../../src/db/universeEditorRepo.js';
import { addPlayableUniverse, testLobbyRegionId, testRegionId } from './fixtures.js';
import { addPlayer } from '../players.js';

describe('regionRepo', () =>
{
	describe('listRegionBuilderIds', () =>
	{
		it('lists the builders assigned to a region in the order they were assigned, and the draft copy\'s live region\'s', async () =>
		{
			const { universeId } = await addPlayableUniverse();
			const regionId = await testRegionId(universeId);
			const bea = (await addPlayer('Bea')).id;
			const carl = (await addPlayer('Carl')).id;

			await setUniverseRole(universeId, bea, 'builder');
			await setUniverseRole(universeId, carl, 'builder');
			await setRegionAssignments(universeId, regionId, [carl]);
			await setRegionAssignments(universeId, regionId, [carl, bea]);
			await inTransaction((transaction) => startDraft(universeId, transaction));

			const origins = await inTransaction((transaction) => findDraftOrigins<string>(regions, universeId, transaction));
			const draftRegionId = [...origins].find(([, originId]) => (originId === regionId))?.[0];

			assert.ok(draftRegionId);
			assert.deepStrictEqual(await listRegionBuilderIds(regionId), [carl, bea]);
			assert.deepStrictEqual(await listRegionBuilderIds(draftRegionId), [carl, bea]);
			assert.deepStrictEqual(await listRegionBuilderIds(await testLobbyRegionId(universeId)), []);
		});
	});
});
