import { UNIVERSE_VERSIONS, type UniverseVersionName } from '@multiverse-kiln/shared';

import { readPlayerValue, rememberPlayerValue } from '../../rememberedValues';

/**
 * The key the version of a universe the player last chose to edit is kept under, for the logged-in
 * player, so it is forgotten when the browser logs out
 *
 * @param universeId The universe's ID
 * @return The key
 */
function versionKey(universeId: string): string
{
	return(`editorVersion.${universeId}`);
}

/**
 * The version of a universe the player last chose to edit in this browser: by choosing it beside their
 * role, or by starting, applying, discarding or importing into the draft, which opens a version
 *
 * @param universeId The universe's ID
 * @return The version, or undefined when they haven't chosen one, or the browser didn't keep it
 */
export function rememberedVersion(universeId: string): UniverseVersionName | undefined
{
	const remembered = readPlayerValue(versionKey(universeId));

	return(UNIVERSE_VERSIONS.find((version) => (version === remembered)));
}

/**
 * Remembers the version of a universe the player chose to edit, so the editor opens it next time, or
 * forgets it
 *
 * @param universeId The universe's ID
 * @param version The version, or null to forget it
 */
export function rememberVersion(universeId: string, version: UniverseVersionName | null): void
{
	rememberPlayerValue(versionKey(universeId), version);
}
