/**
 * Deleting a universe from its editor's Universe tab (see Deleting a universe in STRUCTURE-OVERVIEW.md)
 *
 * - GET  EDITOR_UNIVERSES_PATH/:universeId/deletion answers UniverseDeletionPayload: what deleting the
 *   universe deletes, and how the player confirms it (canDeleteUniverse())
 * - POST EDITOR_UNIVERSES_PATH/:universeId/deletion takes UniverseDeleteRequest and deletes the universe
 *   as one of its creators, answering 204, or 409 when the site's admins kept its creators from deleting it
 * - POST ADMIN_UNIVERSES_PATH/:universeId/deletion takes UniverseDeleteRequest and deletes the universe as
 *   a server admin, recording it as an admin event, answering 204, or 404 when there is no such universe
 *
 * Both deleting routes answer 400, 403 or 429 with the field at fault when the password or a code is
 * wrong, as deleting an account does
 */
import { defineMessages, type MessageDescriptor } from './localization.js';

/**
 * The path under a universe's editor route (EDITOR_UNIVERSES_PATH/:universeId) and its admin route
 * (ADMIN_UNIVERSES_PATH/:universeId) that deletes it
 */
export const UNIVERSE_DELETION_PATH = '/deletion';

/**
 * Response of GET EDITOR_UNIVERSES_PATH/:universeId/deletion
 */
export interface UniverseDeletionPayload
{
	/**
	 * How many characters players have made in the universe, every one of which is deleted with it
	 */
	characters: number;

	/**
	 * How many players those characters belong to
	 */
	players: number;

	/**
	 * How many groups play in the universe, which disband
	 */
	groups: number;

	/**
	 * How many others have a role in the universe, who lose it and are emailed that it was deleted
	 */
	editors: number;

	/**
	 * Whether the site's admins disabled the universe and kept its creators from deleting it, so only a
	 * server admin may
	 */
	deletionPrevented: boolean;

	/**
	 * Whether the player deletes it as a server admin (deletesUniverseAsAdmin()), through
	 * ADMIN_UNIVERSES_PATH/:universeId/deletion, which records it
	 */
	asAdmin: boolean;

	/**
	 * The player's address, which tells password managers which account the password is for, and which
	 * an account without a password is sent the code at; null when the account has none
	 */
	email: string | null;

	/**
	 * Whether the player's account has a password, which deleting asks for; an account without one
	 * confirms with its username, and a code emailed to its address when it has one
	 */
	hasPassword: boolean;

	/**
	 * Whether deleting asks for the player's authenticator or recovery code too
	 */
	twoFactor: boolean;
}

/**
 * Body of POST EDITOR_UNIVERSES_PATH/:universeId/deletion and POST ADMIN_UNIVERSES_PATH/:universeId/deletion
 */
export interface UniverseDeleteRequest
{
	/**
	 * The player's password, or null for an account without one
	 */
	password: string | null;

	/**
	 * An authenticator or recovery code when the account has 2FA; otherwise null
	 */
	twoFactorCode: string | null;

	/**
	 * The player's username, typed to confirm, for an account without a password; otherwise null. An
	 * account without a password that has an address also enters a code sent to it first (purpose
	 * 'deleteUniverse')
	 */
	username: string | null;

	/**
	 * The language the request's emails are written in when the player hasn't chosen one
	 */
	locale: string;
}

/**
 * Why a universe's creators can't delete it, shown on the editor's Universe tab under Delete Universe
 * and given by the server when it refuses
 */
export const UNIVERSE_DELETION_PREVENTED: MessageDescriptor = defineMessages({
	deletionPrevented: {
		id: 'universe.deletionPrevented',
		defaultMessage: 'The site\'s admins disabled this universe and kept its creators from deleting it.',
		description: 'In the first dialog deleting a universe, in place of what deleting it deletes, and the reason deleting a universe was refused: a server admin disabled the universe and kept its creators from deleting it'
	}
}).deletionPrevented;
