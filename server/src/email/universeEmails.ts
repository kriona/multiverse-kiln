/**
 * The emails sent about a player's place in a universe: the notice sent when someone gives them a role
 * in one. Each is written in its recipient's language
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
				defaultMessage: '{role, select, creator {As a creator you can change everything about the universe, including who else works on it.} builder {As a builder you can change the universe\'s world: its tiles, areas, maps and links.} beta_tester {As a beta tester you can play the universe before it opens to everyone.} other {As a translator you can translate the universe\'s text into the languages you were given.}}',
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
