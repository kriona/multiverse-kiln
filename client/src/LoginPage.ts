import { EMAIL_CODE_LIFETIME_MINUTES, LOGIN_PROVIDER_NAMES, MAX_EMAIL_LENGTH, PASSWORD_RESET_PARAMETER, MAX_USERNAME_LENGTH, MAX_PASSWORD_LENGTH, MAX_PLAYER_NAME_LENGTH, MIN_USERNAME_LENGTH, MIN_PASSWORD_LENGTH, type AuthField, type LoginProvider } from '@multiverse-kiln/shared';

import { currentLocale, t } from './localization';
import { authFieldOf, type AuthApi } from './network/authApi';
import { EditorApiError } from './network/editorApi';
import { announceLogin } from './network/sessionBroadcast';
import { readNextPage, readPageParameter, rememberLoginAddress } from './pages';
import { forgetAccountName } from './ui/accountMenu';
import { announce } from './ui/announcer';
import { getElement, setPageTitle, showMessage, showScreen, type ScreenName } from './ui/dom';
import { clearFieldErrors, reportFieldError, setFieldError } from './ui/fieldErrors';

/**
 * What an emailed code is for on this page
 */
type CodePurpose = 'register' | 'resetPassword' | 'linkLogin';

/**
 * What a code typed on the email screen is for: linking asks for no address, since it goes to the
 * account the provider login matched
 */
type EmailPurpose = Exclude<CodePurpose, 'linkLogin'>;

/**
 * A provider login waiting to be linked to the account with its email address
 */
interface PendingLink
{
	provider: LoginProvider;
	email: string;
	hasPassword: boolean;
}

/**
 * A form on the page: its error text, the button that submits it, and the fields the server's
 * refusals can be about
 */
interface PageForm
{
	form: HTMLFormElement;
	error: HTMLElement;
	submit: HTMLButtonElement;
	fields: Partial<Record<AuthField, HTMLInputElement>>;
}

/**
 * Finds one of the page's forms
 *
 * @param name The form's screen, which names its elements: <name>-form, <name>-error and <name>-submit
 * @param fields The form's fields, by the name the server gives them
 * @return The form
 */
function findForm(name: ScreenName, fields: Partial<Record<AuthField, HTMLInputElement>>): PageForm
{
	return({
		form: getElement(`${name}-form`, HTMLFormElement),
		error: getElement(`${name}-error`, HTMLElement),
		submit: getElement(`${name}-submit`, HTMLButtonElement),
		fields
	});
}

/**
 * Runs the login page (login.html): logging in with Google or Discord or to a local account, creating
 * one, and resetting a forgotten password (see Login, Register local account and Forgot your password in
 * STRUCTURE-OVERVIEW.md)
 *
 * Creating an account and resetting a password each email a code: the player types their address, then
 * the code, then the rest. Google and Discord send the browser back to this page, which finishes the
 * login, or asks for a username for a new account, or for the password of the account with the same
 * address (or a code sent to it) to link them. Once logged in, the page tells the browser's other tabs
 * and goes back to the page that sent the player here (readNextPage())
 */
export class LoginPage
{
	private readonly providerLogins = getElement('provider-logins', HTMLElement);
	private readonly providerButtons: Readonly<Record<LoginProvider, HTMLButtonElement>> = {
		google: getElement('login-google', HTMLButtonElement),
		discord: getElement('login-discord', HTMLButtonElement)
	};

	private readonly loginEmail = getElement('login-email', HTMLInputElement);
	private readonly loginPassword = getElement('login-password', HTMLInputElement);
	private readonly loginRemember = getElement('login-remember', HTMLInputElement);
	private readonly loginForm = findForm('login', { email: this.loginEmail, password: this.loginPassword });

	private readonly emailHeading = getElement('email-heading', HTMLElement);
	private readonly emailIntro = getElement('email-intro', HTMLElement);
	private readonly emailProvidersHint = getElement('email-providers-hint', HTMLElement);
	private readonly emailAddress = getElement('email-address', HTMLInputElement);
	private readonly emailForm = findForm('email', { email: this.emailAddress });

	private readonly codeIntro = getElement('code-intro', HTMLElement);
	private readonly codeInput = getElement('code-input', HTMLInputElement);
	private readonly codeStatus = getElement('code-status', HTMLElement);
	private readonly codeResend = getElement('code-resend', HTMLButtonElement);
	private readonly codeForm = findForm('code', { code: this.codeInput });

	private readonly registerEmail = getElement('register-email', HTMLInputElement);
	private readonly registerUsername = getElement('register-username', HTMLInputElement);
	private readonly registerName = getElement('register-name', HTMLInputElement);
	private readonly registerPassword = getElement('register-password', HTMLInputElement);
	private readonly registerRemember = getElement('register-remember', HTMLInputElement);
	private readonly registerForm = findForm('register', { username: this.registerUsername, displayName: this.registerName, password: this.registerPassword });

	private readonly resetEmail = getElement('reset-email', HTMLInputElement);
	private readonly resetPassword = getElement('reset-password', HTMLInputElement);
	private readonly resetRemember = getElement('reset-remember', HTMLInputElement);
	private readonly resetForm = findForm('reset', { password: this.resetPassword });

	private readonly providerRegisterIntro = getElement('provider-register-intro', HTMLElement);
	private readonly providerRegisterUsername = getElement('provider-register-username', HTMLInputElement);
	private readonly providerRegisterName = getElement('provider-register-name', HTMLInputElement);
	private readonly providerRegisterForm = findForm('provider-register', { username: this.providerRegisterUsername, displayName: this.providerRegisterName });

	private readonly providerLinkIntro = getElement('provider-link-intro', HTMLElement);
	private readonly providerLinkEmail = getElement('provider-link-email', HTMLInputElement);
	private readonly providerLinkPasswordField = getElement('provider-link-password-field', HTMLElement);
	private readonly providerLinkPassword = getElement('provider-link-password', HTMLInputElement);
	private readonly providerLinkCode = getElement('provider-link-code', HTMLButtonElement);
	private readonly providerLinkForm = findForm('provider-link', { password: this.providerLinkPassword });

	/**
	 * What the code being asked for is for
	 */
	private purpose: CodePurpose = 'register';

	/**
	 * The providers the site offers
	 */
	private providers: LoginProvider[] = [];

	/**
	 * The provider login waiting to be linked, while the link screen or its code screen shows
	 */
	private pendingLink: PendingLink | undefined;

	/**
	 * The address the code was sent to, which creating the account sends again
	 */
	private email = '';

	/**
	 * @param api The auth routes
	 */
	constructor(private readonly api: AuthApi)
	{
		const numbers = new Intl.NumberFormat(currentLocale());

		for (const prefix of ['register', 'provider-register'])
		{
			getElement(`${prefix}-username-min`, HTMLElement).textContent = numbers.format(MIN_USERNAME_LENGTH);
			getElement(`${prefix}-username-max`, HTMLElement).textContent = numbers.format(MAX_USERNAME_LENGTH);
		}

		for (const id of ['register-password-min', 'reset-password-min'])
		{
			getElement(id, HTMLElement).textContent = numbers.format(MIN_PASSWORD_LENGTH);
		}

		for (const field of [this.loginEmail, this.emailAddress])
		{
			field.maxLength = MAX_EMAIL_LENGTH;
		}

		// No minLength: the browser would explain it in its own language, and the server's message is in the page's
		for (const field of [this.registerPassword, this.resetPassword])
		{
			field.maxLength = MAX_PASSWORD_LENGTH;
		}

		for (const field of [this.registerUsername, this.providerRegisterUsername])
		{
			field.maxLength = MAX_USERNAME_LENGTH;
		}

		for (const field of [this.registerName, this.providerRegisterName])
		{
			field.maxLength = MAX_PLAYER_NAME_LENGTH;
		}

		for (const field of [this.loginEmail, this.loginPassword, this.emailAddress, this.codeInput, this.registerUsername, this.registerName, this.registerPassword, this.resetPassword, this.providerRegisterUsername, this.providerRegisterName, this.providerLinkPassword])
		{
			field.addEventListener('input', () =>
			{
				setFieldError(field, undefined);
			});
		}

		this.onSubmit(this.loginForm, () => this.logIn());
		this.onSubmit(this.emailForm, () => this.sendCode());
		this.onSubmit(this.codeForm, () => this.checkCode());
		this.onSubmit(this.registerForm, () => this.register());
		this.onSubmit(this.resetForm, () => this.saveNewPassword());
		this.onSubmit(this.providerRegisterForm, () => this.registerWithProvider());
		this.onSubmit(this.providerLinkForm, () => this.linkWithPassword());

		for (const [provider, button] of Object.entries(this.providerButtons) as [LoginProvider, HTMLButtonElement][])
		{
			button.addEventListener('click', () =>
			{
				void this.startProviderLogin(provider);
			});
		}

		this.providerLinkCode.addEventListener('click', () =>
		{
			void this.sendLinkCode();
		});

		// A provider login waits only a few minutes, so going back starts over
		for (const id of ['provider-register-back', 'provider-link-back'])
		{
			getElement(id, HTMLButtonElement).addEventListener('click', () =>
			{
				this.pendingLink = undefined;
				this.showLogin();
			});
		}

		getElement('login-register', HTMLButtonElement).addEventListener('click', () =>
		{
			this.askForEmail('register');
		});

		getElement('login-forgot', HTMLButtonElement).addEventListener('click', () =>
		{
			this.askForEmail('resetPassword');
		});

		getElement('email-back', HTMLButtonElement).addEventListener('click', () =>
		{
			this.showLogin();
		});

		// The code's next step expires, so each step after the email goes back to ask for a new code
		for (const id of ['code-back', 'register-back', 'reset-back'])
		{
			getElement(id, HTMLButtonElement).addEventListener('click', () =>
			{
				if (this.purpose === 'linkLogin')
				{
					this.showProviderLink();
				}
				else
				{
					this.askForEmail(this.purpose);
				}
			});
		}

		this.codeResend.addEventListener('click', () =>
		{
			void this.resendCode();
		});
	}

	/**
	 * Offers the providers the site has, then finishes a login with one when it sent the browser back,
	 * or shows the login screen (or the forgot password screen, when the address asks for it)
	 *
	 * @param providerReturn What a provider sent the browser back with (takeProviderReturn()), if it did
	 */
	async start(providerReturn: URLSearchParams | undefined): Promise<void>
	{
		try
		{
			this.providers = await this.api.getProviders();
		}
		catch (error)
		{
			// Logging in with an email address still works
			console.error('Could not list the login providers:', error);
		}

		this.providerLogins.hidden = (this.providers.length === 0);

		for (const [provider, button] of Object.entries(this.providerButtons) as [LoginProvider, HTMLButtonElement][])
		{
			button.hidden = !this.providers.includes(provider);
		}

		if (providerReturn)
		{
			await this.finishProviderLogin(providerReturn);
		}
		else if (readPageParameter(PASSWORD_RESET_PARAMETER) !== undefined)
		{
			// Emails that tell of a change to the account link here, for someone who didn't make it
			this.askForEmail('resetPassword');
		}
		else
		{
			this.showLogin();
		}
	}

	/**
	 * Shows the login screen, with the address typed on another screen, if any
	 */
	showLogin(): void
	{
		if ((this.loginEmail.value === '') && (this.emailAddress.value !== ''))
		{
			this.loginEmail.value = this.emailAddress.value;
		}

		this.show('login', this.loginForm);
		(((this.loginEmail.value === '') ? this.loginEmail : this.loginPassword)).focus();
	}

	/**
	 * Runs a form's action when it is submitted, with its button disabled until the action finishes
	 *
	 * @param form The form
	 * @param action What submitting does
	 */
	private onSubmit(form: PageForm, action: () => Promise<void>): void
	{
		form.form.addEventListener('submit', (event) =>
		{
			event.preventDefault();

			if (form.submit.disabled)
			{
				return;
			}

			form.submit.disabled = true;
			showMessage(form.error, undefined);

			action()
				.catch((error: unknown) =>
				{
					this.showError(form, error);
				})
				.finally(() =>
				{
					form.submit.disabled = false;
				});
		});
	}

	/**
	 * Shows one of the page's screens, its heading as the browser tab's title, and clears its errors
	 *
	 * @param screen The screen
	 * @param form Its form
	 */
	private show(screen: ScreenName, form: PageForm): void
	{
		clearFieldErrors(form.form);
		showMessage(form.error, undefined);
		showScreen(screen);
		setPageTitle(form.form.querySelector('h1')?.textContent ?? undefined);
	}

	/**
	 * Shows why the server refused a form: under the field it is about, or under the form
	 *
	 * @param form The form
	 * @param error What the request threw
	 */
	private showError(form: PageForm, error: unknown): void
	{
		const name = authFieldOf(error);
		const field = ((name !== undefined) ? form.fields[name] : undefined);

		if (!(error instanceof EditorApiError))
		{
			console.error('An auth request failed:', error);
			showMessage(form.error, t({
				id: 'login.unreachable',
				defaultMessage: 'Could not reach the server. Check your connection and try again.',
				description: 'Shown under a form on the login page when the server couldn\'t be reached'
			}));
			return;
		}

		if (field)
		{
			reportFieldError(field, error.message);
		}
		else
		{
			showMessage(form.error, error.message);
		}
	}

	/**
	 * Goes back to the page that sent the player here, once logged in, telling the browser's other tabs
	 */
	private finishLogin(): void
	{
		forgetAccountName();
		announceLogin();
		window.location.replace(readNextPage());
	}

	/**
	 * Logs in with the address and password typed
	 */
	private async logIn(): Promise<void>
	{
		await this.api.logIn({
			email: this.loginEmail.value.trim(),
			password: this.loginPassword.value,
			rememberMe: this.loginRemember.checked
		});
		this.finishLogin();
	}

	/**
	 * Sends the browser to a provider to log in, keeping this page's address for when it comes back
	 *
	 * @param provider The provider
	 */
	private async startProviderLogin(provider: LoginProvider): Promise<void>
	{
		const buttons = Object.values(this.providerButtons);

		for (const button of buttons)
		{
			button.disabled = true;
		}

		showMessage(this.loginForm.error, undefined);

		try
		{
			const url = await this.api.startProviderLogin({
				provider,
				rememberMe: this.loginRemember.checked
			});

			rememberLoginAddress();
			window.location.assign(url);
		}
		catch (error)
		{
			this.showError(this.loginForm, error);

			for (const button of buttons)
			{
				button.disabled = false;
			}
		}
	}

	/**
	 * Finishes a login with the code a provider sent the browser back with, then logs in or shows the
	 * next step. A refusal shows on the login screen
	 *
	 * @param providerReturn The provider's query string parameters
	 */
	private async finishProviderLogin(providerReturn: URLSearchParams): Promise<void>
	{
		const code = providerReturn.get('code');
		const state = providerReturn.get('state');

		if ((code === null) || (state === null))
		{
			// The player turned the provider down, or it reported an error
			this.showLogin();
			showMessage(this.loginForm.error, t({
				id: 'login.providerCanceled',
				defaultMessage: 'Logging in with Google or Discord was canceled. Try again, or use your email address.',
				description: 'Shown on the login screen when Google or Discord sends the player back without logging them in, such as when they chose not to allow it'
			}));
			return;
		}

		let result: Awaited<ReturnType<AuthApi['finishProviderLogin']>>;

		try
		{
			result = await this.api.finishProviderLogin({ code, state });
		}
		catch (error)
		{
			this.showLogin();
			this.showError(this.loginForm, error);
			return;
		}

		if (result.outcome === 'loggedIn')
		{
			this.finishLogin();
		}
		else if (result.outcome === 'register')
		{
			this.providerRegisterIntro.textContent = t({
				id: 'login.providerRegisterIntro',
				defaultMessage: 'You\'re logging in with {provider} as {email}, which is new here. Choose how other players find and see you to create your account.',
				description: 'On the screen where a new account\'s username and name are chosen after logging in with Google or Discord; {provider} is Google or Discord, and {email} the address it gave'
			}, {
				provider: LOGIN_PROVIDER_NAMES[result.provider],
				email: result.email
			});
			this.providerRegisterUsername.value = '';
			this.providerRegisterName.value = result.displayName;
			this.show('provider-register', this.providerRegisterForm);
			this.providerRegisterUsername.focus();
		}
		else
		{
			this.pendingLink = {
				provider: result.provider,
				email: result.email,
				hasPassword: result.hasPassword
			};
			this.showProviderLink();
		}
	}

	/**
	 * Shows the screen that links the waiting provider login to the account with its address: with the
	 * account's password when it has one, or with a code sent to the address
	 */
	private showProviderLink(): void
	{
		const link = this.pendingLink;

		if (!link)
		{
			this.showLogin();
			return;
		}

		const values = {
			provider: LOGIN_PROVIDER_NAMES[link.provider],
			email: link.email
		};

		this.providerLinkIntro.textContent = (link.hasPassword
			? t({
				id: 'login.linkIntro',
				defaultMessage: 'You already have an account here with {email}. Log in to it once to link your {provider} login, and you can use either from then on.',
				description: 'On the screen that links a Google or Discord login to the account with the same email address, when that account has a password; {provider} is Google or Discord, and {email} the address'
			}, values)
			: t({
				id: 'login.linkIntroCode',
				defaultMessage: 'You already have an account here with {email}. We\'ll email it a code to link your {provider} login, and you can use either from then on.',
				description: 'On the screen that links a Google or Discord login to the account with the same email address, when that account has no password, so only an emailed code links it; {provider} is Google or Discord, and {email} the address'
			}, values));
		this.providerLinkEmail.value = link.email;
		this.providerLinkPassword.value = '';
		this.providerLinkPassword.required = link.hasPassword;
		this.providerLinkPasswordField.hidden = !link.hasPassword;
		this.providerLinkForm.submit.hidden = !link.hasPassword;
		this.providerLinkCode.classList.toggle('secondary', link.hasPassword);
		this.show('provider-link', this.providerLinkForm);
		((link.hasPassword ? this.providerLinkPassword : this.providerLinkCode)).focus();
	}

	/**
	 * Creates an account for the provider login, with the username and name typed, and logs in
	 */
	private async registerWithProvider(): Promise<void>
	{
		await this.api.registerWithProvider({
			username: this.providerRegisterUsername.value.trim(),
			displayName: this.providerRegisterName.value.trim(),
			locale: currentLocale()
		});
		this.finishLogin();
	}

	/**
	 * Links the provider login to the account with the password typed, and logs in
	 */
	private async linkWithPassword(): Promise<void>
	{
		await this.api.linkProvider({
			password: this.providerLinkPassword.value,
			locale: currentLocale()
		});
		this.finishLogin();
	}

	/**
	 * Emails a code to the account the provider login would be linked to, then asks for it
	 */
	private async sendLinkCode(): Promise<void>
	{
		const link = this.pendingLink;

		if (!link)
		{
			return;
		}

		this.providerLinkCode.disabled = true;
		showMessage(this.providerLinkForm.error, undefined);

		try
		{
			await this.api.sendCode({
				purpose: 'linkLogin',
				email: link.email,
				locale: currentLocale()
			});
			this.purpose = 'linkLogin';
			this.email = link.email;
			this.askForCode();
		}
		catch (error)
		{
			this.showError(this.providerLinkForm, error);
		}
		finally
		{
			this.providerLinkCode.disabled = false;
		}
	}

	/**
	 * Asks for the address to email a code to
	 *
	 * @param purpose What the code is for
	 */
	private askForEmail(purpose: EmailPurpose): void
	{
		this.purpose = purpose;

		if ((this.emailAddress.value === '') && (this.loginEmail.value !== ''))
		{
			this.emailAddress.value = this.loginEmail.value;
		}

		if (purpose === 'register')
		{
			this.emailHeading.textContent = t({
				id: 'login.registerHeading',
				defaultMessage: 'Create an account',
				description: 'Heading of the screen that asks for the email address of a new account, and the browser tab\'s title while it shows'
			});
			this.emailIntro.textContent = t({
				id: 'login.registerIntro',
				defaultMessage: 'Enter your email address, and we\'ll send you a code to check it\'s yours.',
				description: 'On the screen that asks for the email address of a new account'
			});
		}
		else
		{
			this.emailHeading.textContent = t({
				id: 'login.resetHeading',
				defaultMessage: 'Reset your password',
				description: 'Heading of the screen that asks for the email address of an account whose password was forgotten, and the browser tab\'s title while it shows'
			});
			this.emailIntro.textContent = t({
				id: 'login.resetEmailIntro',
				defaultMessage: 'Enter your account\'s email address, and we\'ll send you a code to choose a new password.',
				description: 'On the screen that asks for the email address of an account whose password was forgotten'
			});
		}

		this.emailProvidersHint.hidden = ((purpose !== 'register') || (this.providers.length === 0));
		this.show('email', this.emailForm);
		this.emailAddress.focus();
	}

	/**
	 * Emails a code to the address typed, then asks for it
	 */
	private async sendCode(): Promise<void>
	{
		const email = this.emailAddress.value.trim();

		await this.api.sendCode({
			purpose: this.purpose,
			email,
			locale: currentLocale()
		});

		this.email = email;
		this.askForCode();
	}

	/**
	 * Asks for the code that was emailed
	 */
	private askForCode(): void
	{
		const values = {
			email: this.email,
			minutes: EMAIL_CODE_LIFETIME_MINUTES
		};

		if (this.purpose === 'register')
		{
			this.codeIntro.textContent = t({
				id: 'login.codeSentRegister',
				defaultMessage: 'We\'ve emailed {email}. Enter the code from the email. It works once, for {minutes, plural, one {# minute} other {# minutes}}.',
				description: 'On the screen for the emailed code when creating an account; {email} is the address it was sent to'
			}, values);
		}
		else if (this.purpose === 'resetPassword')
		{
			// The server answers the same whether or not the address has an account, so the page can't say a code was sent
			this.codeIntro.textContent = t({
				id: 'login.codeSentReset',
				defaultMessage: 'If {email} belongs to an account, we\'ve emailed it a code. Enter the code from the email. It works once, for {minutes, plural, one {# minute} other {# minutes}}.',
				description: 'On the screen for the emailed code when resetting a password; {email} is the address typed. The page can\'t say whether the address has an account, so it can\'t say a code was sent'
			}, values);
		}
		else
		{
			this.codeIntro.textContent = t({
				id: 'login.codeSentLink',
				defaultMessage: 'We\'ve emailed {email}. Enter the code from the email to link your login. It works once, for {minutes, plural, one {# minute} other {# minutes}}.',
				description: 'On the screen for the emailed code when linking a Google or Discord login to the account with the same email address; {email} is the address it was sent to'
			}, values);
		}

		this.codeInput.value = '';
		this.codeStatus.textContent = '';
		this.show('code', this.codeForm);
		announce(this.codeIntro.textContent);
		this.codeInput.focus();
	}

	/**
	 * Emails another code to the same address
	 */
	private async resendCode(): Promise<void>
	{
		this.codeResend.disabled = true;
		this.codeStatus.textContent = '';
		showMessage(this.codeForm.error, undefined);

		try
		{
			await this.api.sendCode({
				purpose: this.purpose,
				email: this.email,
				locale: currentLocale()
			});
			this.codeStatus.textContent = t({
				id: 'login.codeResent',
				defaultMessage: 'Sent a new code. The one before no longer works.',
				description: 'Shown under the code field after another code was emailed'
			});
		}
		catch (error)
		{
			this.showError(this.codeForm, error);
		}
		finally
		{
			this.codeResend.disabled = false;
		}
	}

	/**
	 * Checks the code typed, then asks for the rest of the new account or the new password, or links the
	 * provider login and logs in
	 */
	private async checkCode(): Promise<void>
	{
		await this.api.checkCode({
			purpose: this.purpose,
			email: this.email,
			code: this.codeInput.value
		});

		if (this.purpose === 'register')
		{
			this.registerEmail.value = this.email;
			this.show('register', this.registerForm);
			this.registerUsername.focus();
		}
		else if (this.purpose === 'linkLogin')
		{
			await this.api.linkProvider({
				password: null,
				locale: currentLocale()
			});
			this.finishLogin();
		}
		else
		{
			this.resetEmail.value = this.email;
			this.show('reset', this.resetForm);
			this.resetPassword.focus();
		}
	}

	/**
	 * Creates the account and logs in
	 */
	private async register(): Promise<void>
	{
		await this.api.register({
			email: this.email,
			password: this.registerPassword.value,
			username: this.registerUsername.value.trim(),
			displayName: this.registerName.value.trim(),
			rememberMe: this.registerRemember.checked,
			locale: currentLocale()
		});
		this.finishLogin();
	}

	/**
	 * Saves the new password and logs in
	 */
	private async saveNewPassword(): Promise<void>
	{
		await this.api.resetPassword({
			password: this.resetPassword.value,
			rememberMe: this.resetRemember.checked,
			locale: currentLocale()
		});
		this.finishLogin();
	}
}
