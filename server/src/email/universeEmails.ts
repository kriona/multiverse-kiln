/**
 * The emails sent about a player's place in a universe: the notices sent when someone gives them a role
 * in one, and when a universe they have a role in is deleted. Each is written in its recipient's language
 */
import { SITE_NAME, UNIVERSE_ROLE_NAMES, type UniverseRole } from '@multiverse-kiln/shared';

import { sitePageUrl } from '../siteUrl.js';
import { layOut } from './emailLayout.js';
import { emailTranslator } from './emailLocales.js';
import type { EmailContent } from './mailer.js';

/**
 * The world editor's page, followed by the universe's ID
 */
const EDIT_PAGE_PATH = '/edit';

/**
 * A universe's page, followed by its slug
 */
const UNIVERSE_PAGE_PATH = '/universe';

/**
 * Who gave a player a role in a universe, and which
 */
export interface RoleGiven
{
	/**
	 * The name of the player who gave it
	 */
	giverName: string;

	universeId: string;
	universeName: string;
	universeSlug: string;
	role: UniverseRole;
}

/**
 * Who deleted a universe
 */
export interface UniverseDeleted
{
	/**
	 * The name of the player who deleted it, or null when a server admin did, as an admin: an admin isn't
	 * named to the universe's editors
	 */
	deleterName: string | null;

	universeName: string;
}

/**
 * The email sent to each of a universe's editors, other than the player who deleted it, when it is deleted
 *
 * @param deleted Who deleted which universe
 * @param name The recipient's display name
 * @param locale The language the recipient reads
 * @return The email
 */
export function universeDeletedEmail(deleted: UniverseDeleted, name: string, locale: string): EmailContent
{
	const translator = emailTranslator(locale);
	const values = {
		siteName: SITE_NAME,
		universe: deleted.universeName
	};

	return(layOut(translator, {
		subject: translator.format({
			id: 'email.universeDeleted.subject',
			defaultMessage: '{universe} was deleted on {siteName}',
			description: 'Subject of the email sent to a universe\'s editors (everyone with a role in it, such as builder or beta tester) when it is deleted; {universe} is the universe\'s name and {siteName} the site\'s name'
		}, values),
		recipientName: name,
		paragraphs: [
			((deleted.deleterName === null)
				? translator.format({
					id: 'email.universeDeleted.byAdmin',
					defaultMessage: 'The site\'s admins deleted the universe {universe} on {siteName}, with its world and every character in it.',
					description: 'First paragraph of the email sent to a universe\'s editors when one of the site\'s admins deleted it; {universe} is the universe\'s name and {siteName} the site\'s name'
				}, values)
				: translator.format({
					id: 'email.universeDeleted.body',
					defaultMessage: '{deleter} deleted the universe {universe} on {siteName}, with its world and every character in it.',
					description: 'First paragraph of the email sent to a universe\'s editors when one of its creators deleted it; {deleter} is the name of the creator who deleted it, {universe} the universe\'s name and {siteName} the site\'s name'
				}, {
					...values,
					deleter: deleted.deleterName
				})),
			translator.format({
				id: 'email.universeDeleted.role',
				defaultMessage: 'Your role in it went with it. It can\'t be brought back.',
				description: 'Last paragraph of the email sent to a universe\'s editors when it is deleted: the recipient no longer has a role (such as builder) in it'
			})
		]
	}));
}

/**
 * The email sent when a player is given a role in a universe. A beta tester's links to the universe's
 * page, where they can enter it, and every other role's to the world editor
 *
 * @param given Who gave the role, in which universe, and which role
 * @param name The recipient's display name
 * @param locale The language the recipient reads
 * @return The email
 */
export function roleGivenEmail(given: RoleGiven, name: string, locale: string): EmailContent
{
	const translator = emailTranslator(locale);
	const values = {
		siteName: SITE_NAME,
		universe: given.universeName
	};
	const playing = (given.role === 'beta_tester');

	return(layOut(translator, {
		subject: translator.format({
			id: 'email.roleGiven.subject',
			defaultMessage: 'You have a role in {universe} on {siteName}',
			description: 'Subject of the email sent when a player is made one of a universe\'s editors (given a role in it, such as builder or beta tester); {universe} is the universe\'s name and {siteName} the site\'s name'
		}, values),
		recipientName: name,
		paragraphs: [
			translator.format({
				id: 'email.roleGiven.body',
				defaultMessage: '{giver} gave you the role of {role} in the universe {universe} on {siteName}.',
				description: 'First paragraph of the email sent when a player is given a role in a universe; {giver} is the name of the player who gave it, {role} the role\'s name (creator, builder, beta tester or translator), {universe} the universe\'s name and {siteName} the site\'s name'
			}, {
				...values,
				giver: given.giverName,
				role: translator.format(UNIVERSE_ROLE_NAMES[given.role])
			}),
			translator.format({
				id: 'email.roleGiven.whatItAllows',
				defaultMessage: '{role, select, creator {As a creator you can change everything about the universe, including who else works on it.} builder {As a builder you can change the universe\'s world: its tiles, items, areas and links.} beta_tester {As a beta tester you can play the universe before it opens to everyone.} other {As a translator you can translate the universe\'s text into the languages you were given.}}',
				description: 'Second paragraph of the email sent when a player is given a role in a universe, saying what the role lets them do; {role} chooses the sentence and isn\'t shown'
			}, {
				role: given.role
			}),
			translator.format({
				id: 'email.roleGiven.leave',
				defaultMessage: 'If you don\'t want the role, you can leave the universe on its editor\'s Editors tab.',
				description: 'Last paragraph of the email sent when a player is given a role in a universe, for someone who doesn\'t want it'
			})
		],
		action: (playing
			? {
				label: translator.format({
					id: 'email.action.visitUniverse',
					defaultMessage: 'Go to {universe}',
					description: 'Link at the end of the email sent when a player is made a beta tester of a universe; opens the universe\'s page, where they can enter it. {universe} is the universe\'s name'
				}, values),
				url: sitePageUrl(`${UNIVERSE_PAGE_PATH}/${encodeURIComponent(given.universeSlug)}`)
			}
			: {
				label: translator.format({
					id: 'email.action.openEditor',
					defaultMessage: 'Open the editor of {universe}',
					description: 'Link at the end of the email sent when a player is given a role in a universe other than beta tester; opens the universe\'s world editor. {universe} is the universe\'s name'
				}, values),
				url: sitePageUrl(`${EDIT_PAGE_PATH}/${encodeURIComponent(given.universeId)}`)
			})
	}));
}
