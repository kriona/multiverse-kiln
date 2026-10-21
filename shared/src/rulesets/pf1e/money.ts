/**
 * Pathfinder 1E's coins, and the money changer that turns them into others (shared/src/money.ts reads
 * and writes amounts of them)
 *
 * The coins are Open Game Content from the Pathfinder Roleplaying Game Core Rulebook, used under the Open
 * Game License 1.0a (client/license.html)
 */
import { defineMessages, type MessageDescriptor } from '../../localization.js';

/**
 * The coins, most valuable first
 */
export const PF1E_COINS = ['pp', 'gp', 'sp', 'cp'] as const;

export type Pf1eCoin = typeof PF1E_COINS[number];

/**
 * What each coin is worth in copper pieces
 */
export const PF1E_COIN_VALUES: Record<Pf1eCoin, number> = {
	pp: 1000,
	gp: 100,
	sp: 10,
	cp: 1
};

/**
 * An amount of money: how many pieces of each coin
 */
export type Pf1eMoney = Record<Pf1eCoin, number>;

/**
 * Each coin's abbreviation, written after an amount: "2gp"
 */
export const PF1E_COIN_ABBREVIATIONS: Record<Pf1eCoin, MessageDescriptor> = defineMessages({
	pp: {
		id: 'pf1e.coin.pp',
		defaultMessage: 'pp',
		description: 'Abbreviation of platinum pieces, the most valuable coin in Pathfinder, written after a number with no space: "1pp". Players type it into money fields, so keep it short and without spaces or digits'
	},
	gp: {
		id: 'pf1e.coin.gp',
		defaultMessage: 'gp',
		description: 'Abbreviation of gold pieces, the coin prices are given in in Pathfinder, written after a number with no space: "2gp". Players type it into money fields, so keep it short and without spaces or digits'
	},
	sp: {
		id: 'pf1e.coin.sp',
		defaultMessage: 'sp',
		description: 'Abbreviation of silver pieces, a coin in Pathfinder worth a tenth of a gold piece, written after a number with no space: "2sp". Players type it into money fields, so keep it short and without spaces or digits'
	},
	cp: {
		id: 'pf1e.coin.cp',
		defaultMessage: 'cp',
		description: 'Abbreviation of copper pieces, the least valuable coin in Pathfinder, written after a number with no space: "4cp". Players type it into money fields, so keep it short and without spaces or digits'
	}
});

/**
 * No money
 *
 * @return A new amount with no pieces of any coin
 */
export function emptyPf1eMoney(): Pf1eMoney
{
	return({
		pp: 0,
		gp: 0,
		sp: 0,
		cp: 0
	});
}

/**
 * What an amount is worth, for comparing prices
 *
 * @param money The coins
 * @return Their worth in copper pieces
 */
export function pf1eMoneyValue(money: Pf1eMoney): number
{
	return(PF1E_COINS.reduce((total, coin) => (total + (money[coin] * PF1E_COIN_VALUES[coin])), 0));
}

/**
 * What a money changer gives for an amount: the same worth in as few coins as possible, so
 * 1pp 302gp 4444sp 10cp becomes 75pp 6gp 5sp
 *
 * @param money The coins handed over
 * @return A new amount of the same worth
 */
export function changePf1eMoney(money: Pf1eMoney): Pf1eMoney
{
	const changed = emptyPf1eMoney();
	let left = pf1eMoneyValue(money);

	for (const coin of PF1E_COINS)
	{
		changed[coin] = Math.floor(left / PF1E_COIN_VALUES[coin]);
		left -= changed[coin] * PF1E_COIN_VALUES[coin];
	}
	return(changed);
}
