import assert from 'assert';

import { DEFAULT_SITE_SETTINGS, MAX_CHARACTER_DELETION_DAYS, MAX_SITE_SOCIAL_URL_LENGTH, MAX_UNIVERSES_PER_CREATOR, MIN_UNIVERSES_PER_CREATOR, type SiteSettings } from '@multiverse-kiln/shared';

import { findSiteSettings, saveSiteSettings } from '../../src/db/siteSettingsRepo.js';

const closed: SiteSettings = {
	universeCreationEnabled: false,
	universesPerCreator: 12,
	characterDeletionDays: 0,
	socials: {
		discord: 'https://discord.gg/example',
		facebook: 'https://www.facebook.com/example',
		instagram: 'https://www.instagram.com/example/',
		tiktok: 'https://www.tiktok.com/@example',
		x: 'https://x.com/example',
		youtube: 'https://www.youtube.com/@example'
	},
	privacyContact: 'privacy@example.com'
};

describe('siteSettingsRepo', () =>
{
	it('gives the defaults to a site that has never saved settings', async () =>
	{
		assert.deepStrictEqual(await findSiteSettings(), DEFAULT_SITE_SETTINGS);
	});

	it('saves settings, and replaces them when saved again', async () =>
	{
		await saveSiteSettings(closed);
		assert.deepStrictEqual(await findSiteSettings(), closed);

		await saveSiteSettings(DEFAULT_SITE_SETTINGS);
		assert.deepStrictEqual(await findSiteSettings(), DEFAULT_SITE_SETTINGS);
	});

	it('refuses a limit the database doesn\'t allow', async () =>
	{
		for (const universesPerCreator of [MIN_UNIVERSES_PER_CREATOR - 1, MAX_UNIVERSES_PER_CREATOR + 1])
		{
			await assert.rejects(saveSiteSettings({
				...closed,
				universesPerCreator
			}));
		}

		for (const characterDeletionDays of [-1, MAX_CHARACTER_DELETION_DAYS + 1])
		{
			await assert.rejects(saveSiteSettings({
				...closed,
				characterDeletionDays
			}));
		}

		await assert.rejects(saveSiteSettings({
			...closed,
			socials: {
				...closed.socials,
				x: `https://x.com/${'a'.repeat(MAX_SITE_SOCIAL_URL_LENGTH)}`
			}
		}));
	});
});
