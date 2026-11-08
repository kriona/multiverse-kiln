import assert from 'assert';

import { pool } from '../../src/db/client.js';

describe('schema', () =>
{
	it('indexes the referencing columns of every foreign key', async () =>
	{
		// Deleting or changing a referenced row looks up the rows referring to it, which scans the whole
		// referencing table unless an index leads with the foreign key's columns. A partial index only
		// serves that lookup when its condition is that the leading column isn't null
		const result = await pool.query<{ foreignKey: string }>(`
			SELECT format('%s(%s) -> %s', constraints.conrelid::regclass, string_agg(attributes.attname, ', ' ORDER BY keys.position), constraints.confrelid::regclass) AS "foreignKey"
			FROM pg_constraint constraints
			CROSS JOIN LATERAL unnest(constraints.conkey) WITH ORDINALITY AS keys(attnum, position)
			JOIN pg_attribute attributes ON attributes.attrelid = constraints.conrelid AND attributes.attnum = keys.attnum
			WHERE constraints.contype = 'f'
				AND constraints.connamespace = 'public'::regnamespace
				AND NOT EXISTS (
					SELECT 1
					FROM pg_index indexes
					WHERE indexes.indrelid = constraints.conrelid
						AND (indexes.indkey::int2[])[0:cardinality(constraints.conkey) - 1] @> constraints.conkey
						AND (indexes.indkey::int2[])[0:cardinality(constraints.conkey) - 1] <@ constraints.conkey
						AND (
							indexes.indpred IS NULL
							OR pg_get_expr(indexes.indpred, indexes.indrelid) = format('(%I IS NOT NULL)', (
								SELECT attname
								FROM pg_attribute
								WHERE attrelid = indexes.indrelid
									AND attnum = indexes.indkey[0]
							))
						)
				)
			GROUP BY constraints.oid, constraints.conrelid, constraints.confrelid
			ORDER BY 1`);

		assert.deepStrictEqual(result.rows.map((row) => row.foreignKey), []);
	});
});
