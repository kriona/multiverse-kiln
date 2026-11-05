import { acceptedCoinAbbreviations, COIN_ABBREVIATIONS, COIN_NAMES, defineMessages, emptyMoney, MAX_COINS, moneyPieces, moneyText, parseMoney, RULESET_COINS, shownCoinAbbreviations, type Coin, type CoinAbbreviations, type Money, type Ruleset, type UniverseCoinAbbreviations, type UniverseCoinNames } from '@multiverse-kiln/shared';

import { capitalized, t } from '../localization';
import { reportFieldError, setFieldError } from './fieldErrors';

/**
 * What is wrong with an abbreviation a universe gives a coin, or with its translation
 */
export const coinAbbreviationMessages = defineMessages({
	invalid: {
		id: 'form.coinAbbreviation.invalid',
		defaultMessage: 'Write up to {max, number} characters, without spaces, digits or commas.',
		description: 'Shown under a coin\'s abbreviation on the editor\'s Ruleset tab, or under its translation on the Translations tab, when it can\'t be written after an amount, like the gp in 2gp; {max} is the most characters it may have'
	}
});

/**
 * An amount for each ruleset that shows how to write money: one of each coin, more of the cheap ones
 */
const EXAMPLE_AMOUNTS: Record<Ruleset, Money> = {
	pf1e: {
		...emptyMoney(),
		pp: 1,
		gp: 2,
		sp: 2,
		cp: 4
	},
	sf1e: {
		...emptyMoney(),
		cr: 250
	}
};

/**
 * The engine's abbreviation of a coin in the player's language
 *
 * @param coin The coin
 * @return The abbreviation, e.g. "gp"
 */
export function engineCoinAbbreviation(coin: Coin): string
{
	return(t(COIN_ABBREVIATIONS[coin]));
}

/**
 * The engine's name of a coin in the player's language
 *
 * @param coin The coin
 * @return The name as it reads mid-sentence, e.g. "gold pieces"
 */
export function engineCoinName(coin: Coin): string
{
	return(t(COIN_NAMES[coin]));
}

/**
 * Each of a ruleset's coins' abbreviation as the player sees it: the universe's, or the engine's in the
 * player's language
 *
 * @param ruleset The universe's ruleset
 * @param universeAbbreviations The abbreviations the universe gives its coins, in the language shown
 * @return The abbreviations, by coin
 */
function coinAbbreviations(ruleset: Ruleset, universeAbbreviations: UniverseCoinAbbreviations): Partial<Record<Coin, string>>
{
	return(shownCoinAbbreviations(ruleset, universeAbbreviations, engineCoinAbbreviation));
}

/**
 * The abbreviations a money field reads: each coin's as the player sees it, then the engine's in the
 * player's language and in English, so "gp" works in every language, unless another coin is shown with it
 *
 * @param ruleset The universe's ruleset
 * @param universeAbbreviations The abbreviations the universe gives its coins, in the language shown
 * @return The abbreviations, by coin
 */
function acceptedAbbreviations(ruleset: Ruleset, universeAbbreviations: UniverseCoinAbbreviations): CoinAbbreviations
{
	const engine: CoinAbbreviations = Object.fromEntries(RULESET_COINS[ruleset].map((coin) => [coin, [engineCoinAbbreviation(coin), COIN_ABBREVIATIONS[coin].defaultMessage]]));

	return(acceptedCoinAbbreviations(ruleset, coinAbbreviations(ruleset, universeAbbreviations), engine));
}

/**
 * Writes an amount of money as a money field shows it, e.g. "1pp 302gp 4444sp 10cp" or "250cr"
 *
 * @param money The coins
 * @param ruleset The universe's ruleset
 * @param universeAbbreviations The abbreviations the universe gives its coins, in the language shown
 * @return The amount, with the universe's abbreviations and the engine's in the player's language
 */
export function formatMoney(money: Money, ruleset: Ruleset, universeAbbreviations: UniverseCoinAbbreviations): string
{
	return(moneyText(money, ruleset, coinAbbreviations(ruleset, universeAbbreviations)));
}

/**
 * Shows an amount of money the way formatMoney() writes it, with each coin's abbreviation marked with
 * the coin's name as a label, which the browser shows when the pointer rests on it
 *
 * @param money The coins
 * @param ruleset The universe's ruleset
 * @param universeNames The names the universe gives its coins, in the language shown
 * @param universeAbbreviations The abbreviations the universe gives its coins, in the language shown
 * @return The amount, e.g. 2<abbr title="Gold pieces">gp</abbr>
 */
export function moneyElement(money: Money, ruleset: Ruleset, universeNames: UniverseCoinNames, universeAbbreviations: UniverseCoinAbbreviations): HTMLElement
{
	const element = document.createElement('span');
	const abbreviations = coinAbbreviations(ruleset, universeAbbreviations);

	moneyPieces(money, ruleset).forEach(([coin, count], index) =>
	{
		const abbreviation = document.createElement('abbr');

		abbreviation.title = capitalized(universeNames[coin] ?? engineCoinName(coin));
		abbreviation.textContent = (abbreviations[coin] ?? '');
		element.append(((index === 0) ? '' : ' '), String(count), abbreviation);
	});

	return(element);
}

/**
 * An amount that shows how to write money in a ruleset, e.g. "1pp 2gp 2sp 4cp"
 *
 * @param ruleset The universe's ruleset
 * @param universeAbbreviations The abbreviations the universe gives its coins, in the language shown
 * @return The amount, with the universe's abbreviations and the engine's in the player's language
 */
export function exampleMoney(ruleset: Ruleset, universeAbbreviations: UniverseCoinAbbreviations): string
{
	return(formatMoney(EXAMPLE_AMOUNTS[ruleset], ruleset, universeAbbreviations));
}

/**
 * Reads a money field (see Field: Money in STRUCTURE-OVERVIEW.md). When it can't be read, shows what is
 * wrong under it and takes the player there
 *
 * @param field The field, which needs an ID
 * @param ruleset The universe's ruleset, whose coins the field holds
 * @param universeAbbreviations The abbreviations the universe gives its coins, in the language shown
 * @return The coins, or undefined when the field shows a problem
 */
export function readMoneyField(field: HTMLInputElement, ruleset: Ruleset, universeAbbreviations: UniverseCoinAbbreviations): Money | undefined
{
	const result = parseMoney(field.value, ruleset, acceptedAbbreviations(ruleset, universeAbbreviations));

	if ('money' in result)
	{
		setFieldError(field, undefined);
		return(result.money);
	}

	reportFieldError(field, ((result.error === 'tooMuch')
		? t({
			id: 'form.money.tooManyCoins',
			defaultMessage: 'That\'s more than {max, number} pieces of one coin.',
			description: 'Shown under a money field when the number typed for one coin, such as gold pieces, is too large; {max} is the most pieces of one coin there can be'
		}, {
			max: MAX_COINS
		})
		: t({
			id: 'form.money.format',
			defaultMessage: 'Write amounts of coins, like {example}.',
			description: 'Shown under a money field when what was typed isn\'t amounts of coins; {example} is an amount in the coins\' abbreviations, e.g. 1pp 2gp 2sp 4cp or 250cr'
		}, {
			example: exampleMoney(ruleset, universeAbbreviations)
		})));

	return(undefined);
}
