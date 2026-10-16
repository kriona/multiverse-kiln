import { DEFAULT_TILE_NAMES, type EditorTile, type Ruleset } from '@multiverse-kiln/shared';

import { t } from '../localization';

/**
 * A tile's name as the player reads it: the universe's name for it, or a default tile's name in the
 * player's language
 *
 * @param tile The tile
 * @param ruleset The universe's ruleset
 * @return The name
 */
export function tileName(tile: Pick<EditorTile, 'key' | 'name'>, ruleset: Ruleset): string
{
	if (tile.name !== null)
	{
		return(tile.name);
	}

	const message = ((tile.key === null) ? undefined : DEFAULT_TILE_NAMES[ruleset][tile.key]);

	return(((message === undefined) ? (tile.key ?? '') : t(message)));
}
