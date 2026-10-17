import { formatPf1eMoney, parsePf1eMoney, PF1E_COIN_ABBREVIATIONS, PF1E_MAX_COINS, type Pf1eCoin, type Pf1eCoinAbbreviations, type Pf1eMoney } from '@multiverse-kiln/shared';

import { t } from '../localization';
import { reportFieldError, setFieldError } from './fieldErrors';

/**
 * Each coin's abbreviation in the player's language
 *
 * @return The abbreviations, by coin
 */
function coinAbbreviations(): Record<Pf1eCoin, string>
{
	return({
		pp: t(PF1E_COIN_ABBREVIATIONS.pp),
		gp: t(PF1E_COIN_ABBREVIATIONS.gp),
		sp: t(PF1E_COIN_ABBREVIATIONS.sp),
		cp: t(PF1E_COIN_ABBREVIATIONS.cp)
	});
}

/**
 * The abbreviations a money field reads: the player's language's, and English's too, so "gp" works
 * in every language
 *
 * @return The abbreviations, by coin
 */
function acceptedAbbreviations(): Pf1eCoinAbbreviations
{
	const local = coinAbbreviations();

	return({
		pp: [local.pp, PF1E_COIN_ABBREVIATIONS.pp.defaultMessage],
		gp: [local.gp, PF1E_COIN_ABBREVIATIONS.gp.defaultMessage],
		sp: [local.sp, PF1E_COIN_ABBREVIATIONS.sp.defaultMessage],
		cp: [local.cp, PF1E_COIN_ABBREVIATIONS.cp.defaultMessage]
	});
}

/**
 * Writes an amount of money as a money field shows it, e.g. "1pp 302gp 4444sp 10cp"
 *
 * @param money The coins
 * @return The amount, with the coins' abbreviations in the player's language
 */
export function formatMoney(money: Pf1eMoney): string
{
	return(formatPf1eMoney(money, coinAbbreviations()));
}

/**
 * Reads a money field (see Field: Money in STRUCTURE-OVERVIEW.md). When it can't be read, shows what is
 * wrong under it and takes the player there
 *
 * @param field The field, which needs an ID
 * @return The coins, or undefined when the field shows a problem
 */
export function readMoneyField(field: HTMLInputElement): Pf1eMoney | undefined
{
	const result = parsePf1eMoney(field.value, acceptedAbbreviations());

	if ('money' in result)
	{
		setFieldError(field, undefined);
		return(result.money);
	}

	const abbreviations = coinAbbreviations();

	reportFieldError(field, ((result.error === 'tooMuch')
		? t({
			id: 'form.money.tooManyCoins',
			defaultMessage: 'That\'s more than {max, number} pieces of one coin.',
			description: 'Shown under a money field when the number typed for one coin, such as gold pieces, is too large; {max} is the most pieces of one coin there can be'
		}, {
			max: PF1E_MAX_COINS
		})
		: t({
			id: 'form.money.format',
			defaultMessage: 'Write amounts of coins, like {example}.',
			description: 'Shown under a money field when what was typed isn\'t amounts of coins; {example} is an amount in the coins\' abbreviations, e.g. 1pp 2gp 2sp 4cp'
		}, {
			example: `1${abbreviations.pp} 2${abbreviations.gp} 2${abbreviations.sp} 4${abbreviations.cp}`
		})));

	return(undefined);
}
