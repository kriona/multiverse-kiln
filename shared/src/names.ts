/**
 * Which names players may take, for themselves and their characters: names that pass as the game's staff
 * are kept back
 *
 * Names are compared in a reduced form, so the usual disguises don't get past: capitals, accents, letters
 * from other alphabets that look like Latin ones, full-width letters, leetspeak ("4dm1n"), separators and
 * invisible characters ("a.d.m.i.n"), repeated letters ("aadmin") and decorations of digits or symbols
 * ("Admin_123"). Words are found at spaces, punctuation and changes of case, so "TheAdmin" is caught but
 * "Quarterstaff" and "Observer" aren't
 */
import { defineMessages } from './localization.js';

/**
 * Text about names that both the client and the server show (see shared/src/localization.ts)
 */
export const NAME_MESSAGES = defineMessages({
	reserved: {
		id: 'name.reserved',
		defaultMessage: 'That name could be mistaken for the game\'s staff. Choose another.',
		description: 'Why a player or character name was refused: it contains a word such as "admin" or "moderator" that would let someone pass as the people running the game'
	}
});

/**
 * Words a name can't contain as a word of its own, in reduced form (see reduceWord)
 */
const RESERVED_WORDS = [
	'admin',
	'administrator',
	'moderator',
	'mod',
	'staff',
	'system',
	'server',
	'official',
	'support',
	'developer',
	'sysop'
];

/**
 * Words a name can't contain anywhere, even run together with other words, in reduced form. Only words
 * long and unusual enough not to turn up inside ordinary names
 */
const RESERVED_PHRASES = [
	'multiversekiln',
	'gamemaster',
	'administrator'
];

/**
 * Letters from other alphabets that look like Latin letters, and Latin letters that NFKD doesn't take
 * apart, by the letter they pass for
 */
const LOOKALIKES: Record<string, string> = {
	'а': 'a',
	'е': 'e',
	'о': 'o',
	'р': 'p',
	'с': 'c',
	'у': 'y',
	'х': 'x',
	'і': 'i',
	'ј': 'j',
	'ѕ': 's',
	'ԁ': 'd',
	'м': 'm',
	'т': 't',
	'α': 'a',
	'ε': 'e',
	'ι': 'i',
	'κ': 'k',
	'ν': 'v',
	'ο': 'o',
	'ρ': 'p',
	'τ': 't',
	'ı': 'i',
	'ł': 'l',
	'ø': 'o',
	'đ': 'd',
	'ß': 'ss'
};

/**
 * Digits and symbols that stand in for letters, and letters easily mistaken for each other, by the one
 * letter they all reduce to
 */
const FOLDED: Record<string, string> = {
	'0': 'o',
	'1': 'i',
	'l': 'i',
	'!': 'i',
	'|': 'i',
	'3': 'e',
	'4': 'a',
	'@': 'a',
	'5': 's',
	'$': 's',
	'7': 't',
	'+': 't',
	'8': 'b',
	'9': 'g'
};

const reservedWords = new Set(RESERVED_WORDS.map(reduceWord));
const reservedPhrases = RESERVED_PHRASES.map(reduceWord);

/**
 * Whether a name is kept back because it could pass as the game's staff
 *
 * @param name The name, as typed
 * @return True when the name can't be taken
 */
export function isReservedName(name: string): boolean
{
	const words = splitWords(name);
	const joined = reduceWord(words.join(''));

	if (reservedWords.has(joined) || reservedPhrases.some((phrase) => joined.includes(phrase)))
	{
		return(true);
	}

	// A word with digits added to it ("Admin123") is checked without them too
	return(words.some((word) => (reservedWords.has(reduceWord(word)) || reservedWords.has(reduceWord(word.replace(/\p{N}/gu, ''))))));
}

/**
 * Splits a name into its words, each in lowercase plain letters, digits and the symbols that stand in
 * for letters
 *
 * @param name The name
 * @return The words, in order
 */
function splitWords(name: string): string[]
{
	const plain = name
		.normalize('NFKC')
		.replace(/(\p{Ll})(\p{Lu})/gu, '$1 $2')
		.normalize('NFKD')
		.replace(/[\p{M}\p{Cf}]/gu, '')
		.toLowerCase();
	const unmasked = [...plain]
		.map((character) => (LOOKALIKES[character] ?? character))
		.join('');

	return(unmasked
		.split(/[^\p{L}\p{N}@$!|+]+/u)
		.filter((word) => (word !== '')));
}

/**
 * A word in the form names are compared in: stand-ins and look-alike letters made the same, and letters
 * repeated in a row made one
 *
 * @param word The word, lowercase
 * @return The reduced word
 */
function reduceWord(word: string): string
{
	return([...word]
		.map((character) => (FOLDED[character] ?? character))
		.join('')
		.replace(/(.)\1+/gu, '$1'));
}
