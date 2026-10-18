import { MAX_UNIVERSES_PER_CREATOR, MIN_UNIVERSES_PER_CREATOR, type SiteSettings } from '@multiverse-kiln/shared';

import { t } from '../localization';
import type { AdminApi } from '../network/adminApi';
import { describeEditorError } from '../network/editorApi';
import { ChangeTracker } from './changeTracker';
import { getElement, showMessage } from './dom';
import { reportFieldError, setFieldError } from './fieldErrors';
import { formMessages } from './formMessages';

/**
 * The admin page's form: settings for the whole site, such as whether players can create universes
 */
export class SiteSettingsForm
{
	private readonly loading = getElement('site-settings-loading', HTMLElement);
	private readonly loadError = getElement('site-settings-load-error', HTMLElement);
	private readonly form = getElement('site-settings-form', HTMLFormElement);
	private readonly universeCreation = getElement('site-universe-creation', HTMLInputElement);
	private readonly universesPerCreator = getElement('site-universes-per-creator', HTMLInputElement);
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

		this.universesPerCreator.addEventListener('input', () =>
		{
			setFieldError(this.universesPerCreator, undefined);
			this.saved.textContent = '';
		});

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
		this.loading.hidden = true;
		this.form.hidden = false;
		this.changes.markSaved();
	}

	/**
	 * Saves the settings as the form shows them
	 */
	private async save(): Promise<void>
	{
		const universesPerCreator = Number(this.universesPerCreator.value);

		if (!Number.isInteger(universesPerCreator) || (universesPerCreator < MIN_UNIVERSES_PER_CREATOR) || (universesPerCreator > MAX_UNIVERSES_PER_CREATOR) || (this.universesPerCreator.value.trim() === ''))
		{
			reportFieldError(this.universesPerCreator, t(formMessages.wholeNumber, {
				min: MIN_UNIVERSES_PER_CREATOR,
				max: MAX_UNIVERSES_PER_CREATOR
			}));
			return;
		}

		const settings: SiteSettings = {
			universeCreationEnabled: this.universeCreation.checked,
			universesPerCreator
		};

		this.saveButton.disabled = true;
		showMessage(this.error, undefined);

		try
		{
			await this.api.saveSiteSettings(settings);
			this.changes.markSaved();
			this.saved.textContent = t(formMessages.saved);
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
}
