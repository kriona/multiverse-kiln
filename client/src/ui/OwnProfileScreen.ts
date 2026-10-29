import { LOGIN_PROVIDER_NAMES, MAX_LOCATION_LENGTH, MAX_PLAYER_NAME_LENGTH, MAX_PROFILE_LANGUAGES, MAX_PRONOUNS_LENGTH, MAX_SOCIAL_USERNAME_LENGTH, MAX_USERNAME_LENGTH, MIN_USERNAME_LENGTH, PROFILE_LANGUAGES, SOCIAL_SITES, type OwnProfileCharacter, type OwnProfilePayload, type ProfileField, type ProfileLanguage, type ProfileUpdateRequest, type SocialSite } from '@multiverse-kiln/shared';

import { availableLocales, chooseLocale, currentLocale, formatList, t } from '../localization';
import type { AuthApi } from '../network/authApi';
import { describeEditorError, EditorApiError } from '../network/editorApi';
import { profileFieldOf, type ProfileApi } from '../network/profileApi';
import { playerPageUrl } from '../pages';
import { showAccountName } from './accountMenu';
import { ChangeTracker } from './changeTracker';
import type { CharacterSheetDialog } from './CharacterSheetDialog';
import { ChipCombobox } from './ChipCombobox';
import type { ComboboxChoice } from './ComboboxList';
import { getElement, setPageTitle, showMessage, showScreen } from './dom';
import { EmailChangeDialog } from './EmailChangeDialog';
import { clearFieldErrors, reportFieldError, setFieldError } from './fieldErrors';
import { formMessages } from './formMessages';
import { languageName } from './languagePicker';
import { PasswordChangeDialog } from './PasswordChangeDialog';
import { characterLabel, showProfileCharacters } from './profileCharacters';
import { SearchSelect } from './SearchSelect';
import { timeZoneChoices } from './timeZones';
import { showToast } from './toast';

/**
 * The languages a profile can say the player knows, each named in itself, with its name in the page's
 * language after it when that differs, sorted by name
 *
 * @return The choices
 */
function profileLanguageChoices(): ComboboxChoice[]
{
	const current = currentLocale();
	const pageNames = new Intl.DisplayNames([current], { type: 'language' });

	return(PROFILE_LANGUAGES
		.map((language) =>
		{
			const name = languageName(language);
			const pageName = pageNames.of(language);

			return({
				value: language,
				name,
				lang: language,
				detail: (((pageName === undefined) || (pageName === name)) ? undefined : pageName)
			});
		})
		.sort((first, second) => first.name.localeCompare(second.name, current)));
}

/**
 * The player's own profile (the profile screen of profile.html): what others see about them, which they
 * change and save, how they log in, and all of their characters, each of which they can show or hide
 * when the profile doesn't show them all
 */
export class OwnProfileScreen
{
	private readonly viewLink = getElement('profile-view-link', HTMLAnchorElement);
	private readonly form = getElement('profile-form', HTMLFormElement);
	private readonly username = getElement('profile-username', HTMLInputElement);
	private readonly displayName = getElement('profile-name', HTMLInputElement);
	private readonly pronouns = getElement('profile-pronouns', HTMLInputElement);
	private readonly location = getElement('profile-location', HTMLInputElement);
	private readonly timeZone = new SearchSelect({
		searchId: 'profile-time-zone',
		listboxId: 'profile-time-zone-options',
		choices: [{
			value: '',
			name: t({
				id: 'profile.noTimeZone',
				defaultMessage: 'Not shown',
				description: 'The first choice of time zone on the player\'s own profile page, which shows no time zone to other players'
			})
		}, ...timeZoneChoices(currentLocale())],
		onChange: () =>
		{
			this.changes.check();
		}
	});
	private readonly languages = new ChipCombobox({
		searchId: 'profile-languages-search',
		listboxId: 'profile-languages-options',
		chosenId: 'profile-languages-chosen',
		choices: profileLanguageChoices(),
		max: MAX_PROFILE_LANGUAGES,
		tooMany: t({
			id: 'profile.languagesTooMany',
			defaultMessage: 'You can choose up to {max, plural, one {# language} other {# languages}}.',
			description: 'Shown under the field for choosing the languages the player knows, on their own profile page, when they try to choose more than {max}, a number'
		}, {
			max: MAX_PROFILE_LANGUAGES
		}),
		onChange: () =>
		{
			this.changes.check();
		}
	});
	private readonly locale = getElement('profile-locale', HTMLSelectElement);
	private readonly socials: Readonly<Record<SocialSite, HTMLInputElement>> = {
		discord: getElement('profile-discord', HTMLInputElement),
		facebook: getElement('profile-facebook', HTMLInputElement),
		instagram: getElement('profile-instagram', HTMLInputElement),
		tiktok: getElement('profile-tiktok', HTMLInputElement)
	};
	private readonly showCharacters = getElement('profile-show-characters', HTMLInputElement);
	private readonly error = getElement('profile-error', HTMLElement);
	private readonly saved = getElement('profile-saved', HTMLElement);
	private readonly saveButton = getElement('profile-save', HTMLButtonElement);
	private readonly email = getElement('profile-email', HTMLElement);
	private readonly changeEmailButton = getElement('profile-change-email', HTMLButtonElement);
	private readonly passwordState = getElement('profile-password-state', HTMLElement);
	private readonly changePasswordButton = getElement('profile-change-password', HTMLButtonElement);
	private readonly providers = getElement('profile-providers', HTMLElement);
	private readonly characterList = getElement('profile-character-list', HTMLElement);
	private readonly noCharacters = getElement('profile-character-none', HTMLElement);
	private readonly characterError = getElement('profile-character-error', HTMLElement);
	private readonly changes = new ChangeTracker({
		root: this.form,
		state: () => [this.timeZone.value, this.languages.values],
		status: this.saved
	});
	private readonly emailDialog: EmailChangeDialog;
	private readonly passwordDialog: PasswordChangeDialog;

	/**
	 * Each field the server can refuse, by the name it gives it
	 */
	private readonly fields: Readonly<Partial<Record<ProfileField, HTMLInputElement | HTMLSelectElement>>> = {
		username: this.username,
		displayName: this.displayName,
		pronouns: this.pronouns,
		location: this.location,
		timeZone: this.timeZone.field,
		locale: this.locale,
		...this.socials
	};

	/**
	 * The profile as last loaded or saved
	 */
	private profile: OwnProfilePayload | undefined;

	/**
	 * @param api The profile routes
	 * @param authApi The auth routes, which change the email address and password
	 * @param sheet The character sheet dialog, for the player's characters
	 */
	constructor(private readonly api: ProfileApi, authApi: AuthApi, private readonly sheet: CharacterSheetDialog)
	{
		const numbers = new Intl.NumberFormat(currentLocale());

		getElement('profile-username-min', HTMLElement).textContent = numbers.format(MIN_USERNAME_LENGTH);
		getElement('profile-username-max', HTMLElement).textContent = numbers.format(MAX_USERNAME_LENGTH);
		this.username.maxLength = MAX_USERNAME_LENGTH;
		this.displayName.maxLength = MAX_PLAYER_NAME_LENGTH;
		this.pronouns.maxLength = MAX_PRONOUNS_LENGTH;
		this.location.maxLength = MAX_LOCATION_LENGTH;

		for (const field of Object.values(this.socials))
		{
			// One more, for a leading @, which the server drops
			field.maxLength = (MAX_SOCIAL_USERNAME_LENGTH + 1);
		}


		for (const field of Object.values(this.fields))
		{
			field.addEventListener('input', () =>
			{
				setFieldError(field, undefined);
				this.saved.textContent = '';
			});
		}

		this.showCharacters.addEventListener('change', () =>
		{
			this.saved.textContent = '';
			this.showVisibilityChoices();
		});

		this.form.addEventListener('submit', (event) =>
		{
			event.preventDefault();
			void this.save();
		});

		this.emailDialog = new EmailChangeDialog(authApi, (email) =>
		{
			if (this.profile)
			{
				this.profile.email = email;
				this.showAccount(this.profile);
			}

			showToast(t({
				id: 'profile.emailChanged',
				defaultMessage: 'Email address changed. We\'ve told both addresses.',
				description: 'Shown once the player has changed their email address from their profile'
			}), {
				kind: 'success'
			});
		});
		this.passwordDialog = new PasswordChangeDialog(authApi);

		this.changeEmailButton.addEventListener('click', () =>
		{
			this.emailDialog.open((this.profile?.email ?? null));
		});

		this.changePasswordButton.addEventListener('click', () =>
		{
			this.passwordDialog.open((this.profile?.email ?? null));
		});
	}

	/**
	 * Loads the player's profile and shows it
	 */
	async load(): Promise<void>
	{
		const profile = await this.api.getOwnProfile();

		this.profile = profile;
		this.fillForm(profile);
		this.showAccount(profile);
		this.showCharacterList(profile.characters);
		setPageTitle(document.title);
		showScreen('profile');
	}

	/**
	 * Reloads the player's characters, such as after one is given their last rites from their sheet
	 */
	async reloadCharacters(): Promise<void>
	{
		try
		{
			const profile = await this.api.getOwnProfile();

			this.showCharacterList(profile.characters);
		}
		catch (error)
		{
			showMessage(this.characterError, describeEditorError(error, {
				id: 'profile.charactersFailed',
				defaultMessage: 'Could not list your characters.',
				description: 'Shown on the player\'s own profile page when their characters couldn\'t be loaded again'
			}));
		}
	}

	/**
	 * Fills the language choice: the browser's language, then each language there is a translation
	 * for, named in itself, and the one the profile has if there is no translation for it
	 *
	 * @param chosen The language the profile has, or null
	 */
	private fillLocales(chosen: string | null): void
	{
		const current = currentLocale();
		const locales = [...new Set([...availableLocales(), ...((chosen === null) ? [] : [chosen])])]
			.map((locale) => ({ locale, name: languageName(locale) }))
			.sort((first, second) => first.name.localeCompare(second.name, current));
		const browser = new Option(t({
			id: 'profile.browserLanguage',
			defaultMessage: 'Your browser\'s language',
			description: 'The first choice of language on the player\'s own profile page, which leaves the pages in whatever language the browser asks for'
		}), '');

		this.locale.replaceChildren(browser, ...locales.map(({ locale, name }) =>
		{
			const option = new Option(name, locale);

			// Each name is in its own language, so translation tools leave it alone
			option.translate = false;
			option.lang = locale;

			return(option);
		}));
		this.locale.value = (chosen ?? '');
	}

	/**
	 * Shows the profile in the form
	 *
	 * @param profile The profile
	 */
	private fillForm(profile: OwnProfilePayload): void
	{
		this.username.value = profile.username;
		this.displayName.value = profile.displayName;
		this.pronouns.value = (profile.pronouns ?? '');
		this.location.value = (profile.location ?? '');
		this.timeZone.value = (profile.timeZone ?? '');
		this.languages.values = profile.languages;
		this.fillLocales(profile.locale);

		for (const site of SOCIAL_SITES)
		{
			this.socials[site].value = (profile.socials[site] ?? '');
		}

		this.showCharacters.checked = profile.showCharacters;
		this.viewLink.href = playerPageUrl(profile.username);
		clearFieldErrors(this.form);
		showMessage(this.error, undefined);
		this.changes.markSaved();
	}

	/**
	 * Shows how the player logs in: their email address, whether they have a password, and their
	 * linked Google and Discord logins
	 *
	 * @param profile The profile
	 */
	private showAccount(profile: OwnProfilePayload): void
	{
		this.email.textContent = (profile.email ?? t({
			id: 'profile.noEmail',
			defaultMessage: 'None',
			description: 'Shown on the player\'s own profile page in place of their email address, or of their linked logins, when they have none'
		}));
		this.passwordState.textContent = (profile.hasPassword
			? t({
				id: 'profile.hasPassword',
				defaultMessage: 'Set',
				description: 'Shown on the player\'s own profile page in place of their password, which is never shown, when the account has one'
			})
			: t({
				id: 'profile.noPassword',
				defaultMessage: 'None: you log in with Google or Discord. To add a password, log out and use "Forgot your password?" on the login page.',
				description: 'Shown on the player\'s own profile page in place of their password when the account has none, since it logs in only with Google or Discord'
			}));
		this.changePasswordButton.hidden = !profile.hasPassword;
		this.providers.textContent = ((profile.providers.length === 0)
			? t({
				id: 'profile.noEmail',
				defaultMessage: 'None',
				description: 'Shown on the player\'s own profile page in place of their email address, or of their linked logins, when they have none'
			})
			: formatList(profile.providers.map((provider) => LOGIN_PROVIDER_NAMES[provider]), 'conjunction'));
	}

	/**
	 * Lists the player's characters by universe. Each opens their sheet, and has a choice of whether
	 * the profile shows them, for when it doesn't show them all
	 *
	 * @param characters The characters
	 */
	private showCharacterList(characters: readonly OwnProfileCharacter[]): void
	{
		showMessage(this.characterError, undefined);
		showProfileCharacters(this.characterList, characters, (character) => this.renderCharacter(character));
		this.noCharacters.hidden = (characters.length > 0);
		this.showVisibilityChoices();
	}

	/**
	 * One of the player's characters in the list
	 *
	 * @param character The character
	 * @return The list item
	 */
	private renderCharacter(character: OwnProfileCharacter): HTMLLIElement
	{
		const item = document.createElement('li');
		const button = document.createElement('button');
		const visibility = document.createElement('label');
		const checkbox = document.createElement('input');

		item.className = 'profile-character';
		button.type = 'button';
		button.className = 'profile-character-choice';
		button.append(...characterLabel(character));
		button.addEventListener('click', () =>
		{
			void this.sheet.open(character.universe.id, character.id, character.name);
		});

		checkbox.type = 'checkbox';
		checkbox.checked = character.visibleOnProfile;
		checkbox.addEventListener('change', () =>
		{
			void this.setVisibility(character, checkbox);
		});
		visibility.className = 'checkbox profile-character-visibility';
		visibility.append(checkbox, t({
			id: 'profile.characterVisible',
			defaultMessage: 'Show on my profile',
			description: 'Checkbox beside each of the player\'s characters on their own profile page, shown when Show my characters is unchecked: whether other players see this character'
		}));
		item.append(button, visibility);

		return(item);
	}

	/**
	 * Shows each character's visibility choice while the form says the profile doesn't show them all
	 */
	private showVisibilityChoices(): void
	{
		for (const choice of this.characterList.querySelectorAll<HTMLElement>('.profile-character-visibility'))
		{
			choice.hidden = this.showCharacters.checked;
		}
	}

	/**
	 * Saves whether the profile shows a character, putting the checkbox back if it can't
	 *
	 * @param character The character
	 * @param checkbox Its checkbox
	 */
	private async setVisibility(character: OwnProfileCharacter, checkbox: HTMLInputElement): Promise<void>
	{
		const visible = checkbox.checked;

		checkbox.disabled = true;
		showMessage(this.characterError, undefined);

		try
		{
			await this.api.setCharacterVisibility(character.id, visible);
			character.visibleOnProfile = visible;
		}
		catch (error)
		{
			checkbox.checked = !visible;
			showMessage(this.characterError, describeEditorError(error, {
				id: 'profile.characterVisibilityFailed',
				defaultMessage: 'Could not change whether your profile shows {name}.',
				description: 'Shown on the player\'s own profile page when showing or hiding one of their characters failed; {name} is the character\'s name'
			}, {
				name: character.name
			}));
		}
		finally
		{
			checkbox.disabled = false;
		}
	}

	/**
	 * The form's profile, as the server takes it
	 *
	 * @return The profile, with null for each field left blank
	 */
	private readForm(): ProfileUpdateRequest
	{
		const optional = (field: HTMLInputElement | HTMLSelectElement): string | null => ((field.value.trim() === '') ? null : field.value.trim());

		return({
			username: this.username.value.trim(),
			displayName: this.displayName.value.trim(),
			pronouns: optional(this.pronouns),
			location: optional(this.location),
			timeZone: ((this.timeZone.value === '') ? null : this.timeZone.value),
			languages: this.languages.values as ProfileLanguage[],
			locale: optional(this.locale),
			socials: {
				discord: optional(this.socials.discord),
				facebook: optional(this.socials.facebook),
				instagram: optional(this.socials.instagram),
				tiktok: optional(this.socials.tiktok)
			},
			showCharacters: this.showCharacters.checked
		});
	}

	/**
	 * Saves the profile as the form shows it. A new language reloads the page in it
	 */
	private async save(): Promise<void>
	{
		if (this.saveButton.disabled)
		{
			return;
		}

		const profile = this.readForm();

		for (const [field, value] of [[this.username, profile.username], [this.displayName, profile.displayName]] as const)
		{
			if (value === '')
			{
				reportFieldError(field, t(formMessages.invalidText));
				return;
			}
		}

		this.saveButton.disabled = true;
		showMessage(this.error, undefined);

		try
		{
			await this.api.saveProfile(profile);
		}
		catch (error)
		{
			const field = profileFieldOf(error);
			const input = ((field === undefined) ? undefined : this.fields[field]);

			if (input && (error instanceof EditorApiError))
			{
				reportFieldError(input, error.message);
			}
			else
			{
				showMessage(this.error, describeEditorError(error, {
					id: 'profile.saveFailed',
					defaultMessage: 'Could not save your profile.',
					description: 'Shown on the player\'s own profile page when the profile couldn\'t be saved'
				}));
			}

			return;
		}
		finally
		{
			this.saveButton.disabled = false;
		}

		const previousLocale = (this.profile?.locale ?? null);

		if (this.profile)
		{
			Object.assign(this.profile, profile);
		}

		this.viewLink.href = playerPageUrl(profile.username);
		showAccountName(profile.displayName);
		this.changes.markSaved();

		if ((profile.locale !== null) && (profile.locale !== previousLocale))
		{
			chooseLocale(profile.locale);
			return;
		}

		this.saved.textContent = t(formMessages.saved);
		showToast(t(formMessages.savedToast), {
			kind: 'success',
			announce: false
		});
	}
}
