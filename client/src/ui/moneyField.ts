import { COIN_ABBREVIATIONS, emptyMoney, MAX_COINS, moneyText, parseMoney, RULESET_COINS, type Coin, type CoinAbbreviations, type Money, type Ruleset } from '@multiverse-kiln/shared';

import { t } from '../localization';
import { reportFieldError, setFieldError } from './fieldErrors';

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
 * Each of a ruleset's coins' abbreviation in the player's language
 *
 * @param ruleset The universe's ruleset
 * @return The abbreviations, by coin
 */
function coinAbbreviations(ruleset: Ruleset): Partial<Record<Coin, string>>
{
	return(Object.fromEntries(RULESET_COINS[ruleset].map((coin) => [coin, t(COIN_ABBREVIATIONS[coin])])));
}

/**
 * The abbreviations a money field reads: the player's language's, and English's too, so "gp" works
 * in every language
 *
 * @param ruleset The universe's ruleset
 * @return The abbreviations, by coin
 */
function acceptedAbbreviations(ruleset: Ruleset): CoinAbbreviations
{
	return(Object.fromEntries(RULESET_COINS[ruleset].map((coin) => [coin, [t(COIN_ABBREVIATIONS[coin]), COIN_ABBREVIATIONS[coin].defaultMessage]])));
}

/**
 * Writes an amount of money as a money field shows it, e.g. "1pp 302gp 4444sp 10cp" or "250cr"
 *
 * @param money The coins
 * @param ruleset The universe's ruleset
 * @return The amount, with the coins' abbreviations in the player's language
 */
export function formatMoney(money: Money, ruleset: Ruleset): string
{
	return(moneyText(money, ruleset, coinAbbreviations(ruleset)));
}

/**
 * An amount that shows how to write money in a ruleset, e.g. "1pp 2gp 2sp 4cp"
 *
 * @param ruleset The universe's ruleset
 * @return The amount, with the coins' abbreviations in the player's language
 */
export function exampleMoney(ruleset: Ruleset): string
{
	return(formatMoney(EXAMPLE_AMOUNTS[ruleset], ruleset));
}

/**
 * Reads a money field (see Field: Money in STRUCTURE-OVERVIEW.md). When it can't be read, shows what is
 * wrong under it and takes the player there
 *
 * @param field The field, which needs an ID
 * @param ruleset The universe's ruleset, whose coins the field holds
 * @return The coins, or undefined when the field shows a problem
 */
export function readMoneyField(field: HTMLInputElement, ruleset: Ruleset): Money | undefined
{
	const result = parseMoney(field.value, ruleset, acceptedAbbreviations(ruleset));

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
			example: exampleMoney(ruleset)
		})));

	return(undefined);
}
