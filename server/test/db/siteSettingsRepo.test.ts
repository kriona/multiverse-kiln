import assert from 'assert';

import { DEFAULT_SITE_SETTINGS, MAX_AREAS_PER_UNIVERSE, MAX_CHARACTER_DELETION_DAYS, MAX_CHARACTERS_PER_UNIVERSE, MAX_SITE_SOCIAL_URL_LENGTH, MAX_UNIVERSES_PER_CREATOR, MIN_AREAS_PER_UNIVERSE, MIN_CHARACTERS_PER_UNIVERSE, MIN_UNIVERSES_PER_CREATOR, type SiteSettings } from '@multiverse-kiln/shared';

import { adminDb, inAdminTransaction } from '../../src/db/adminClient.js';
import { pool } from '../../src/db/client.js';
import { findSiteSettings, lockSiteSettings, saveSiteSettings } from '../../src/db/siteSettingsRepo.js';
import { waitUntil } from '../waitUntil.js';

const closed: SiteSettings = {
	universeCreationEnabled: false,
	universesPerCreator: 12,
	areasPerUniverse: 40,
	charactersPerUniverse: 6,
	characterDeletionDays: 0,
	botCheckEveryRequest: true,
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
		await saveSiteSettings(closed, adminDb);
		assert.deepStrictEqual(await findSiteSettings(), closed);

		await saveSiteSettings(DEFAULT_SITE_SETTINGS, adminDb);
		assert.deepStrictEqual(await findSiteSettings(), DEFAULT_SITE_SETTINGS);
	});

	it('makes saves take turns, each reading what the one before saved', async () =>
	{
		let release: () => void = () => undefined;
		const released = new Promise<void>((resolve) =>
		{
			release = resolve;
		});
		let firstSaved: () => void = () => undefined;
		const saved = new Promise<void>((resolve) =>
		{
			firstSaved = resolve;
		});
		const first = inAdminTransaction(async (transaction) =>
		{
			await lockSiteSettings(transaction);
			await saveSiteSettings(closed, transaction);
			firstSaved();
			await released;
		});

		await saved;

		const second = inAdminTransaction((transaction) => lockSiteSettings(transaction));

		// The second waits for the lock before it reads, so it must see the first's save once that commits.
		// Asked through the server's pool: both of the admin role's connections are in the transactions
		await waitUntil(async () =>
		{
			const result = await pool.query<{ waiting: number }>('SELECT count(*)::int AS waiting FROM pg_locks WHERE locktype = \'advisory\' AND NOT granted AND database = (SELECT oid FROM pg_database WHERE datname = current_database())');

			return((result.rows[0].waiting > 0));
		});
		release();
		await first;
		assert.deepStrictEqual(await second, closed);
	});

	it('refuses a limit the database doesn\'t allow', async () =>
	{
		for (const universesPerCreator of [MIN_UNIVERSES_PER_CREATOR - 1, MAX_UNIVERSES_PER_CREATOR + 1])
		{
			await assert.rejects(saveSiteSettings({
				...closed,
				universesPerCreator
			}, adminDb));
		}

		for (const areasPerUniverse of [MIN_AREAS_PER_UNIVERSE - 1, MAX_AREAS_PER_UNIVERSE + 1])
		{
			await assert.rejects(saveSiteSettings({
				...closed,
				areasPerUniverse
			}, adminDb));
		}

		for (const charactersPerUniverse of [MIN_CHARACTERS_PER_UNIVERSE - 1, MAX_CHARACTERS_PER_UNIVERSE + 1])
		{
			await assert.rejects(saveSiteSettings({
				...closed,
				charactersPerUniverse
			}, adminDb));
		}

		for (const characterDeletionDays of [-1, MAX_CHARACTER_DELETION_DAYS + 1])
		{
			await assert.rejects(saveSiteSettings({
				...closed,
				characterDeletionDays
			}, adminDb));
		}

		await assert.rejects(saveSiteSettings({
			...closed,
			socials: {
				...closed.socials,
				x: `https://x.com/${'a'.repeat(MAX_SITE_SOCIAL_URL_LENGTH)}`
			}
		}, adminDb));
	});
});
