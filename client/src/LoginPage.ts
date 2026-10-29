import { EMAIL_CODE_LIFETIME_MINUTES, MAX_EMAIL_LENGTH, MAX_USERNAME_LENGTH, MAX_PASSWORD_LENGTH, MAX_PLAYER_NAME_LENGTH, MIN_USERNAME_LENGTH, MIN_PASSWORD_LENGTH, type AuthField } from '@multiverse-kiln/shared';

import { currentLocale, t } from './localization';
import { authFieldOf, type AuthApi } from './network/authApi';
import { EditorApiError } from './network/editorApi';
import { announceLogin } from './network/sessionBroadcast';
import { readNextPage } from './pages';
import { announce } from './ui/announcer';
import { getElement, setPageTitle, showMessage, showScreen, type ScreenName } from './ui/dom';
import { clearFieldErrors, reportFieldError, setFieldError } from './ui/fieldErrors';

/**
 * What an emailed code is for on this page
 */
type CodePurpose = 'register' | 'resetPassword';

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
 * Runs the login page (login.html): logging in to a local account, creating one, and resetting a
 * forgotten password (see Login, Register local account and Forgot your password in STRUCTURE-OVERVIEW.md)
 *
 * Creating an account and resetting a password each email a code: the player types their address, then
 * the code, then the rest. Once logged in, the page tells the browser's other tabs and goes back to the
 * page that sent the player here (readNextPage())
 */
export class LoginPage
{
	private readonly loginEmail = getElement('login-email', HTMLInputElement);
	private readonly loginPassword = getElement('login-password', HTMLInputElement);
	private readonly loginRemember = getElement('login-remember', HTMLInputElement);
	private readonly loginForm = findForm('login', { email: this.loginEmail, password: this.loginPassword });

	private readonly emailHeading = getElement('email-heading', HTMLElement);
	private readonly emailIntro = getElement('email-intro', HTMLElement);
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

	/**
	 * What the code being asked for is for
	 */
	private purpose: CodePurpose = 'register';

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

		getElement('register-username-min', HTMLElement).textContent = numbers.format(MIN_USERNAME_LENGTH);
		getElement('register-username-max', HTMLElement).textContent = numbers.format(MAX_USERNAME_LENGTH);

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

		this.registerUsername.maxLength = MAX_USERNAME_LENGTH;
		this.registerName.maxLength = MAX_PLAYER_NAME_LENGTH;

		for (const field of [this.loginEmail, this.loginPassword, this.emailAddress, this.codeInput, this.registerUsername, this.registerName, this.registerPassword, this.resetPassword])
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
				this.askForEmail(this.purpose);
			});
		}

		this.codeResend.addEventListener('click', () =>
		{
			void this.resendCode();
		});
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
	 * Asks for the address to email a code to
	 *
	 * @param purpose What the code is for
	 */
	private askForEmail(purpose: CodePurpose): void
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
		// The server answers the same whether or not the address has an account, so the page can't say a code was sent
		this.codeIntro.textContent = ((this.purpose === 'register')
			? t({
				id: 'login.codeSentRegister',
				defaultMessage: 'We\'ve emailed {email}. Enter the code from the email. It works once, for {minutes, plural, one {# minute} other {# minutes}}.',
				description: 'On the screen for the emailed code when creating an account; {email} is the address it was sent to'
			}, {
				email: this.email,
				minutes: EMAIL_CODE_LIFETIME_MINUTES
			})
			: t({
				id: 'login.codeSentReset',
				defaultMessage: 'If {email} belongs to an account, we\'ve emailed it a code. Enter the code from the email. It works once, for {minutes, plural, one {# minute} other {# minutes}}.',
				description: 'On the screen for the emailed code when resetting a password; {email} is the address typed. The page can\'t say whether the address has an account, so it can\'t say a code was sent'
			}, {
				email: this.email,
				minutes: EMAIL_CODE_LIFETIME_MINUTES
			}));
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
	 * Checks the code typed, then asks for the rest of the new account, or the new password
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
