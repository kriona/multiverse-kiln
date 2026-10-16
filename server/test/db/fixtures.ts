import { findDefaultTileIds } from '../../src/db/tileRepo.js';
import { createUniverse } from '../../src/db/universeRepo.js';
import { createZone } from '../../src/db/zoneRepo.js';

/**
 * Adds a Pathfinder 1E universe with no zones
 *
 * @param name The universe's name
 * @return The universe's ID
 */
export async function addUniverse(name: string = 'Test Universe'): Promise<string>
{
	return(createUniverse({ name, ruleset: 'pf1e' }));
}

/**
 * Adds an outdoor zone of grass to a universe, five columns by three rows around the center
 *
 * @param universeId The universe's ID
 * @param name The zone's name
 * @return The zone's ID
 */
export async function addZone(universeId: string, name: string = 'Test Zone'): Promise<string>
{
	const grass = (await findDefaultTileIds('pf1e')).get('grass');

	if (grass === undefined)
	{
		throw new Error('The default tiles are missing from the test database');
	}

	return(createZone({
		universeId,
		name,
		indoors: false,
		defaultTileId: grass,
		bounds: { minColumn: -2, minRow: -1, maxColumn: 2, maxRow: 1 }
	}));
}
