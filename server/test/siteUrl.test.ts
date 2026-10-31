import assert from 'assert';

import { parseSiteUrl, sitePageUrl } from '../src/siteUrl.js';
import { testSiteUrl } from './setup.js';

describe('parseSiteUrl', () =>
{
	it('takes an https:// origin, with or without a trailing slash or a port', () =>
	{
		assert.strictEqual(parseSiteUrl('https://www.example.com'), 'https://www.example.com');
		assert.strictEqual(parseSiteUrl('https://www.example.com/'), 'https://www.example.com');
		assert.strictEqual(parseSiteUrl('https://www.multiversekiln-dev.com:5173'), 'https://www.multiversekiln-dev.com:5173');
	});

	it('refuses a missing address, plain http, and anything after the host', () =>
	{
		for (const value of [undefined, '', 'www.example.com', 'http://www.example.com', 'https://www.example.com/play', 'https://www.example.com/?a=1', 'https://www.example.com/#top', 'https://user:secret@www.example.com'])
		{
			assert.throws(() => parseSiteUrl(value), Error, String(value));
		}
	});
});

describe('sitePageUrl', () =>
{
	it('puts a page under SITE_URL', () =>
	{
		assert.strictEqual(sitePageUrl('/login?reset'), `${testSiteUrl}/login?reset`);
	});
});
