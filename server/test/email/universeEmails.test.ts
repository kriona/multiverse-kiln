import assert from 'assert';
import { SITE_NAME } from '@multiverse-kiln/shared';

import { roleGivenEmail, type RoleGiven } from '../../src/email/universeEmails.js';
import { testSiteUrl } from '../setup.js';

/**
 * A role given in a universe whose name needs escaping in HTML
 *
 * @param role The role
 * @return Who gave it, where and which
 */
function given(role: RoleGiven['role']): RoleGiven
{
	return({
		giverName: 'Ada',
		universeId: '00000000-0000-4000-8000-000000000001',
		universeName: 'Tom & Jerry',
		universeSlug: 'tom-and-jerry',
		role
	});
}

describe('universeEmails', () =>
{
	it('says who gave which role in which universe, and what it allows', () =>
	{
		const email = roleGivenEmail(given('builder'), 'Grace', 'en');

		assert.strictEqual(email.subject, `You have a role in Tom & Jerry on ${SITE_NAME}`);
		assert.match(email.text, new RegExp(`^Hi Grace,\\r\\n\\r\\nAda gave you the role of builder in the universe Tom & Jerry on ${SITE_NAME}\\.\\r\\n\\r\\nAs a builder you can change the universe's world`));
		assert.match(roleGivenEmail(given('translator'), 'Grace', 'en').text, /As a translator you can translate/);
		assert.ok(email.html.includes('Tom &amp; Jerry'));
		assert.ok(!email.html.includes('Tom & Jerry'));
	});

	it('links a beta tester to the universe\'s page and every other role to the editor', () =>
	{
		const editor = `${testSiteUrl}/edit/00000000-0000-4000-8000-000000000001`;
		const page = `${testSiteUrl}/universe/tom-and-jerry`;

		for (const role of ['creator', 'builder', 'translator'] as const)
		{
			assert.ok(roleGivenEmail(given(role), 'Grace', 'en').text.includes(`Open the editor of Tom & Jerry:\r\n${editor}\r\n`), role);
		}

		assert.ok(roleGivenEmail(given('beta_tester'), 'Grace', 'en').text.includes(`Go to Tom & Jerry:\r\n${page}\r\n`));
		assert.match(roleGivenEmail(given('beta_tester'), 'Grace', 'en').text, /role of beta tester/);
	});
});
