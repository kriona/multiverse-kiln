import { isPrivacyContact, isSiteSocialUrl, MAX_CHARACTER_DELETION_DAYS, MAX_EMAIL_LENGTH, MAX_SITE_SOCIAL_URL_LENGTH, MAX_UNIVERSES_PER_CREATOR, MIN_UNIVERSES_PER_CREATOR, SITE_SOCIAL_SITES, type SiteSettings, type SiteSocialLinks, type SiteSocialSite } from '@multiverse-kiln/shared';

import { t } from '../localization';
import type { AdminApi } from '../network/adminApi';
import { describeEditorError } from '../network/editorApi';
import { ChangeTracker } from './changeTracker';
import { getElement, showMessage } from './dom';
import { reportFieldError, setFieldError } from './fieldErrors';
import { formMessages } from './formMessages';
import { SOCIAL_SITE_NAMES } from './socialSites';
import { showToast } from './toast';

/**
 * The admin page's form: settings for the whole site, such as whether players can create universes,
 * how long last rites wait before deleting a character, the social sites the footer links to and the
 * privacy policy's contact
 */
export class SiteSettingsForm
{
	private readonly loading = getElement('site-settings-loading', HTMLElement);
	private readonly loadError = getElement('site-settings-load-error', HTMLElement);
	private readonly form = getElement('site-settings-form', HTMLFormElement);
	private readonly universeCreation = getElement('site-universe-creation', HTMLInputElement);
	private readonly universesPerCreator = getElement('site-universes-per-creator', HTMLInputElement);
	private readonly characterDeletionDays = getElement('site-character-deletion-days', HTMLInputElement);
	private readonly socials: Readonly<Record<SiteSocialSite, HTMLInputElement>> = {
		discord: getElement('site-social-discord', HTMLInputElement),
		facebook: getElement('site-social-facebook', HTMLInputElement),
		instagram: getElement('site-social-instagram', HTMLInputElement),
		tiktok: getElement('site-social-tiktok', HTMLInputElement),
		x: getElement('site-social-x', HTMLInputElement),
		youtube: getElement('site-social-youtube', HTMLInputElement)
	};
	private readonly privacyContact = getElement('site-privacy-contact', HTMLInputElement);
	private readonly error = getElement('site-settings-error', HTMLElement);
	private readonly saved = getElement('site-settings-saved', HTMLElement);
	private readonly saveButton = getElement('site-settings-save', HTMLButtonElement);

	/**
	 * Whether the form has changes that haven't been saved
	 */
	private readonly changes = new ChangeTracker({
		root: this.form,
		status: this.saved
	});

	/**
	 * @param api The admin page's API
	 */
	constructor(private readonly api: AdminApi)
	{
		this.universesPerCreator.min = String(MIN_UNIVERSES_PER_CREATOR);
		this.universesPerCreator.max = String(MAX_UNIVERSES_PER_CREATOR);
		this.characterDeletionDays.min = '0';
		this.characterDeletionDays.max = String(MAX_CHARACTER_DELETION_DAYS);

		for (const field of Object.values(this.socials))
		{
			field.maxLength = MAX_SITE_SOCIAL_URL_LENGTH;
		}

		this.privacyContact.maxLength = MAX_EMAIL_LENGTH;

		for (const field of [this.universesPerCreator, this.characterDeletionDays, ...Object.values(this.socials), this.privacyContact])
		{
			field.addEventListener('input', () =>
			{
				setFieldError(field, undefined);
				this.saved.textContent = '';
			});
		}

		this.universeCreation.addEventListener('change', () =>
		{
			this.saved.textContent = '';
		});

		this.form.addEventListener('submit', (event) =>
		{
			event.preventDefault();
			void this.save();
		});
	}

	/**
	 * Loads the settings and shows them in the form
	 */
	async load(): Promise<void>
	{
		let settings: SiteSettings;

		try
		{
			settings = await this.api.getSiteSettings();
		}
		catch (error)
		{
			this.loading.hidden = true;
			showMessage(this.loadError, describeEditorError(error, {
				id: 'admin.loadFailed',
				defaultMessage: 'Could not load the site settings.',
				description: 'Shown on the site settings page when the settings couldn\'t be loaded'
			}));
			return;
		}

		this.universeCreation.checked = settings.universeCreationEnabled;
		this.universesPerCreator.value = String(settings.universesPerCreator);
		this.characterDeletionDays.value = String(settings.characterDeletionDays);

		for (const site of SITE_SOCIAL_SITES)
		{
			this.socials[site].value = (settings.socials[site] ?? '');
		}

		this.privacyContact.value = (settings.privacyContact ?? '');

		this.loading.hidden = true;
		this.form.hidden = false;
		this.changes.markSaved();
	}

	/**
	 * Saves the settings as the form shows them
	 */
	private async save(): Promise<void>
	{
		const universesPerCreator = readWholeNumber(this.universesPerCreator, MIN_UNIVERSES_PER_CREATOR, MAX_UNIVERSES_PER_CREATOR);

		if (universesPerCreator === undefined)
		{
			return;
		}

		const characterDeletionDays = readWholeNumber(this.characterDeletionDays, 0, MAX_CHARACTER_DELETION_DAYS);

		if (characterDeletionDays === undefined)
		{
			return;
		}

		const socials = this.readSocials();

		if (socials === undefined)
		{
			return;
		}

		const privacyContact = this.privacyContact.value.trim();

		if ((privacyContact !== '') && !isPrivacyContact(privacyContact))
		{
			reportFieldError(this.privacyContact, t({
				id: 'admin.privacyContactInvalid',
				defaultMessage: 'Enter an email address, such as privacy@example.com.',
				description: 'Shown under the privacy contact field on the site settings page when what was typed isn\'t an email address'
			}));
			return;
		}

		const settings: SiteSettings = {
			universeCreationEnabled: this.universeCreation.checked,
			universesPerCreator,
			characterDeletionDays,
			socials,
			privacyContact: ((privacyContact === '') ? null : privacyContact)
		};

		this.saveButton.disabled = true;
		showMessage(this.error, undefined);

		try
		{
			await this.api.saveSiteSettings(settings);
			this.changes.markSaved();
			this.saved.textContent = t(formMessages.saved);
			showToast(t(formMessages.savedToast), {
				kind: 'success',
				announce: false
			});
		}
		catch (error)
		{
			showMessage(this.error, describeEditorError(error, {
				id: 'admin.saveFailed',
				defaultMessage: 'Could not save the site settings.',
				description: 'Shown on the site settings page when the settings couldn\'t be stored'
			}));
		}
		finally
		{
			this.saveButton.disabled = false;
		}
	}

	/**
	 * Reads the links to the site's social pages. When one isn't a link to its site, shows what is wrong
	 * under it and takes the player there
	 *
	 * @return The links, or undefined when a field shows a problem
	 */
	private readSocials(): SiteSocialLinks | undefined
	{
		const socials: Partial<SiteSocialLinks> = {};

		for (const site of SITE_SOCIAL_SITES)
		{
			const field = this.socials[site];
			const url = field.value.trim();

			if ((url !== '') && !isSiteSocialUrl(site, url))
			{
				reportFieldError(field, t({
					id: 'admin.socialUrlInvalid',
					defaultMessage: 'Enter a link to {site} that starts with https://.',
					description: 'Shown under a social site\'s field on the site settings page when what was typed isn\'t a link to that site; {site} is the site\'s name, such as Discord or Facebook'
				}, { site: SOCIAL_SITE_NAMES[site] }));
				return(undefined);
			}

			socials[site] = ((url === '') ? null : url);
		}

		return(socials as SiteSocialLinks);
	}
}

/**
 * Reads a field that takes a whole number in a range. When it holds anything else, shows what is
 * wrong under it and takes the player there
 *
 * @param field The field
 * @param min The smallest number allowed
 * @param max The largest number allowed
 * @return The number, or undefined when the field shows a problem
 */
function readWholeNumber(field: HTMLInputElement, min: number, max: number): number | undefined
{
	const value = Number(field.value);

	if (!Number.isInteger(value) || (value < min) || (value > max) || (field.value.trim() === ''))
	{
		reportFieldError(field, t(formMessages.wholeNumber, {
			min,
			max
		}));
		return(undefined);
	}

	return(value);
}
