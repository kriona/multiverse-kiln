import { announce } from './announcer';
import { setFieldError, setFieldSuccess } from './fieldErrors';

/**
 * What checking a username found
 *
 * - found: the username is fine, with what the check found for it (such as the player who has it) and
 *   what to say under the field
 * - problem: why the username won't do
 * - undefined: the check couldn't tell, such as when the server couldn't be reached; nothing is said,
 *   and submitting the form finds out
 */
export type UsernameCheck<T> =
	| { found: T; message: string }
	| { problem: string }
	| undefined;

/**
 * How a UsernameLookup checks what is typed
 */
export interface UsernameLookupOptions<T>
{
	/**
	 * Asks whether a username is fine, such as whether a new account could take it or whether a player
	 * has it
	 *
	 * @param username The username typed, trimmed
	 * @return What the check found; a check that throws is taken as one that couldn't tell
	 */
	check(username: string): Promise<UsernameCheck<T>>;

	/**
	 * How long a pause in typing lasts before the username is checked, in milliseconds
	 */
	delayMs?: number;
}

/**
 * How long a pause in typing lasts before a username is checked, unless the options say otherwise
 */
const DEFAULT_DELAY_MS = 2000;

/**
 * How long a check waits for its answer before showing a spinner in the field
 */
const SPINNER_DELAY_MS = 200;

/**
 * A username field checked as the player types (see Register local account in STRUCTURE-OVERVIEW.md):
 * when they leave the field or pause typing, the username is checked, and the
 * line under the field says what was found or why it won't do, which screen readers read out. Each
 * username is checked once, since the server may limit how often it is asked; typing it again shows
 * the same answer. The field needs a message line of its own (a field-message-slot, see setFieldError())
 */
export class UsernameLookup<T>
{
	/**
	 * What each username checked found, by username
	 */
	private readonly checks = new Map<string, Exclude<UsernameCheck<T>, undefined>>();

	/**
	 * The check being made, by username
	 */
	private readonly pending = new Map<string, Promise<UsernameCheck<T>>>();

	private timer: number | undefined;

	/**
	 * @param field The username field, which needs an ID
	 * @param options How to check what is typed
	 */
	constructor(private readonly field: HTMLInputElement, private readonly options: UsernameLookupOptions<T>)
	{
		field.addEventListener('input', () =>
		{
			setFieldError(field, undefined);
			window.clearTimeout(this.timer);
			this.timer = window.setTimeout(() =>
			{
				void this.showCheck();
			}, (options.delayMs ?? DEFAULT_DELAY_MS));
		});
		field.addEventListener('blur', () =>
		{
			window.clearTimeout(this.timer);
			void this.showCheck();
		});
	}

	/**
	 * What the check of the username typed found, if it has been checked and is fine
	 *
	 * @return What was found, or undefined
	 */
	get found(): T | undefined
	{
		const check = this.checks.get(this.username());

		return(((check !== undefined) && ('found' in check)) ? check.found : undefined);
	}

	/**
	 * Checks the username typed now, unless it has been already, and shows what was found
	 *
	 * @return What the check found, or undefined when the field is empty or the check couldn't tell
	 */
	async lookUp(): Promise<UsernameCheck<T>>
	{
		window.clearTimeout(this.timer);

		return(this.showCheck());
	}

	/**
	 * Forgets every username checked and clears the field's message, for when the form opens again
	 */
	reset(): void
	{
		window.clearTimeout(this.timer);
		this.checks.clear();
		setFieldError(this.field, undefined);
	}

	/**
	 * The username typed
	 *
	 * @return It, trimmed
	 */
	private username(): string
	{
		return(this.field.value.trim());
	}

	/**
	 * Checks the username typed, unless it has been already, and shows under the field what was found,
	 * if the player hasn't typed on while it was checked
	 *
	 * @return What the check found
	 */
	private async showCheck(): Promise<UsernameCheck<T>>
	{
		const username = this.username();

		// A field on a screen that has closed isn't checked
		if ((username === '') || (this.field.closest('[hidden]') !== null))
		{
			return(undefined);
		}

		const check = await this.check(username);

		if ((check !== undefined) && (this.username() === username))
		{
			this.show(check);
		}

		return(check);
	}

	/**
	 * What a username's check found, asking only for a username not checked before
	 *
	 * @param username The username
	 * @return What it found
	 */
	private async check(username: string): Promise<UsernameCheck<T>>
	{
		const known = this.checks.get(username);

		if (known !== undefined)
		{
			return(known);
		}

		const waiting = this.pending.get(username);

		if (waiting)
		{
			return(waiting);
		}

		// A quick answer doesn't flash the spinner
		const spinnerTimer = window.setTimeout(() =>
		{
			this.field.classList.add('field-checking');
		}, SPINNER_DELAY_MS);
		const asking = this.options.check(username);

		this.pending.set(username, asking);

		try
		{
			const check = await asking;

			if (check !== undefined)
			{
				this.checks.set(username, check);
			}

			return(check);
		}
		catch (error)
		{
			console.error('A username check failed:', error);
			return(undefined);
		}
		finally
		{
			this.pending.delete(username);
			window.clearTimeout(spinnerTimer);

			if (this.pending.size === 0)
			{
				this.field.classList.remove('field-checking');
			}
		}
	}

	/**
	 * Shows under the field what a check found, and reads it out
	 *
	 * @param check What it found
	 */
	private show(check: Exclude<UsernameCheck<T>, undefined>): void
	{
		if ('found' in check)
		{
			setFieldSuccess(this.field, check.message);
		}
		else
		{
			setFieldError(this.field, check.problem);
			announce(check.problem);
		}
	}
}
