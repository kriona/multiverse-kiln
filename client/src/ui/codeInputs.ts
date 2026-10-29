import { EMAIL_CODE_ALPHABET, EMAIL_CODE_LENGTH, RECOVERY_CODE_LENGTH, TWO_FACTOR_CODE_LENGTH } from '@multiverse-kiln/shared';

/**
 * What a code field takes: a code emailed to the player, a code from their authenticator app, or either
 * an authenticator code or one of their recovery codes
 */
type CodeKind = 'email' | 'authenticator' | 'twoFactor';

/**
 * The most characters each kind of code has, not counting dashes: a field of either kind takes a
 * recovery code, the longer
 */
const MAX_CHARACTERS: Readonly<Record<CodeKind, number>> = {
	email: EMAIL_CODE_LENGTH,
	authenticator: TWO_FACTOR_CODE_LENGTH,
	twoFactor: RECOVERY_CODE_LENGTH
};

/**
 * The characters each kind of field drops as they are typed or pasted, so the rest line up with the
 * cells drawn for them. A field that takes a recovery code keeps a dash, as recovery codes are shown
 * with one, and it draws no cells once one is typed
 */
const SEPARATORS: Readonly<Record<CodeKind, RegExp>> = {
	email: /[\s-]/g,
	authenticator: /[\s-]/g,
	twoFactor: /\s/g
};

/**
 * How typed characters that look like a code's characters are read, as the server reads them
 */
const LOOKALIKES: Readonly<Record<string, string>> = {
	O: '0',
	I: '1',
	L: '1'
};

/**
 * The fields that have submitted their form by themselves since they were last emptied with
 * resetCodeInput(). A field submits by itself only once, so a wrong code waits for the player to fix it
 */
const autoSubmitted = new WeakSet<HTMLInputElement>();

/**
 * Starts each code field on the page (input[data-code="email" | "authenticator" | "twoFactor"]): it
 * drops spaces (and dashes, but for a recovery code's) as they are typed, so each character sits in its
 * cell, takes no more than a code, and pasting also drops the periods copied around a code. A field
 * marked data-auto-submit submits its form once the code is complete. Give that only to a field that is
 * the whole of its step, not one that sits beside a password
 *
 * The page's styles draw a field as one cell for each of the code's characters
 */
export function startCodeInputs(): void
{
	for (const input of document.querySelectorAll<HTMLInputElement>('input[data-code]'))
	{
		const kind = readKind(input);

		// Room for a recovery code's dash
		input.maxLength = (MAX_CHARACTERS[kind] + ((kind === 'twoFactor') ? 1 : 0));

		input.addEventListener('paste', (event) =>
		{
			const text = event.clipboardData?.getData('text');

			if (text === undefined)
			{
				return;
			}

			event.preventDefault();

			const start = (input.selectionStart ?? input.value.length);
			const end = (input.selectionEnd ?? input.value.length);
			const room = (input.maxLength - (input.value.length - (end - start)));

			input.setRangeText(cleanPastedCode(text, SEPARATORS[kind]).slice(0, Math.max(0, room)), start, end, 'end');
			input.dispatchEvent(new Event('input', { bubbles: true }));
		});

		input.addEventListener('input', () =>
		{
			dropSeparators(input, SEPARATORS[kind]);
			limitCode(input, MAX_CHARACTERS[kind]);

			// A recovery code is longer than the cells drawn for an authenticator code
			input.classList.toggle('code-long', ((kind === 'twoFactor') && (significantCharacters(input.value).length > TWO_FACTOR_CODE_LENGTH)));

			if (input.hasAttribute('data-auto-submit') && !autoSubmitted.has(input) && isCompleteCode(kind, input.value))
			{
				autoSubmitted.add(input);
				input.form?.requestSubmit();
			}
		});
	}
}

/**
 * Empties a code field for a new code, letting it submit its form by itself again
 *
 * @param input The field
 */
export function resetCodeInput(input: HTMLInputElement): void
{
	input.value = '';
	input.classList.remove('code-long');
	autoSubmitted.delete(input);
}

/**
 * What a code field takes, from its data-code attribute
 *
 * @param input The field
 * @return The kind of code
 */
function readKind(input: HTMLInputElement): CodeKind
{
	const kind = input.dataset.code;

	if ((kind !== 'email') && (kind !== 'authenticator') && (kind !== 'twoFactor'))
	{
		throw new Error(`Code field ${input.id} has an unknown data-code: ${kind}`);
	}

	return(kind);
}

/**
 * Drops the characters a field doesn't keep from what it holds, keeping the caret where it was among
 * the rest
 *
 * @param input The field
 * @param separators The characters it drops
 */
function dropSeparators(input: HTMLInputElement, separators: RegExp): void
{
	const caret = (input.selectionStart ?? input.value.length);
	const before = input.value.slice(0, caret).replace(separators, '');
	const after = input.value.slice(caret).replace(separators, '');

	if ((before.length + after.length) !== input.value.length)
	{
		input.value = `${before}${after}`;
		input.setSelectionRange(before.length, before.length);
	}
}

/**
 * Cuts what a field holds after its code's last character, so dashes typed between characters can't
 * make room for more
 *
 * @param input The field
 * @param maxCharacters The most characters the code has, not counting dashes
 */
function limitCode(input: HTMLInputElement, maxCharacters: number): void
{
	let characters = 0;

	for (let i = 0; i < input.value.length; i++)
	{
		if (!/[\s-]/.test(input.value[i]) && (++characters > maxCharacters))
		{
			input.value = input.value.slice(0, i);
			return;
		}
	}
}

/**
 * Pasted text without the characters the field drops, or the periods copied around a code, such as
 * from the end of a sentence
 *
 * @param text The pasted text
 * @param separators The characters the field drops
 * @return The text to put in the field
 */
function cleanPastedCode(text: string, separators: RegExp): string
{
	return(text
		.replace(separators, '')
		.replace(/^\.+|\.+$/g, ''));
}

/**
 * The characters of a code as typed that count: case, spaces and dashes don't
 *
 * @param typed What the player typed
 * @return The characters, in capitals
 */
function significantCharacters(typed: string): string
{
	return(typed.toUpperCase().replace(/[\s-]/g, ''));
}

/**
 * Whether what was typed is a whole code of EMAIL_CODE_ALPHABET's characters, read as the server reads it
 *
 * @param typed What the player typed
 * @param length How many characters the code has
 * @return Whether it is
 */
function isAlphabetCode(typed: string, length: number): boolean
{
	const code = [...significantCharacters(typed)].map((character) => (LOOKALIKES[character] ?? character));

	return((code.length === length) && code.every((character) => EMAIL_CODE_ALPHABET.includes(character)));
}

/**
 * Whether what was typed is a whole code of a kind
 *
 * @param kind The kind of code
 * @param typed What the player typed
 * @return Whether it is
 */
function isCompleteCode(kind: CodeKind, typed: string): boolean
{
	const authenticator = new RegExp(`^[0-9]{${TWO_FACTOR_CODE_LENGTH}}$`).test(significantCharacters(typed));

	if (kind === 'email')
	{
		return(isAlphabetCode(typed, EMAIL_CODE_LENGTH));
	}

	if (kind === 'authenticator')
	{
		return(authenticator);
	}

	return((authenticator || isAlphabetCode(typed, RECOVERY_CODE_LENGTH)));
}
