import assert from 'assert';
import { MAX_PLAYER_NAME_LENGTH } from '@multiverse-kiln/shared';

import { providerDisplayName } from '../../src/auth/providers.js';
import { displayText } from '../../src/rooms/payloads.js';

/**
 * Characters a name can't have, written as code points so they can be seen in the source
 */
const RIGHT_TO_LEFT_MARK = String.fromCodePoint(0x200F);
const RIGHT_TO_LEFT_OVERRIDE = String.fromCodePoint(0x202E);
const POP_DIRECTIONAL_FORMATTING = String.fromCodePoint(0x202C);
const LINE_SEPARATOR = String.fromCodePoint(0x2028);
const PARAGRAPH_SEPARATOR = String.fromCodePoint(0x2029);
const BELL = String.fromCodePoint(0x07);

/**
 * David in Hebrew, written right to left
 */
const DAVID = String.fromCodePoint(0x05D3, 0x05D5, 0x05D3);

const DRAGON = String.fromCodePoint(0x1F409);

describe('providerDisplayName', () =>
{
	const registerName = displayText(MAX_PLAYER_NAME_LENGTH);

	it('suggests names the register route accepts', () =>
	{
		const names = [
			'Ada Lovelace',
			`${DAVID}${RIGHT_TO_LEFT_MARK} Cohen`,
			`${RIGHT_TO_LEFT_OVERRIDE}evilName${POP_DIRECTIONAL_FORMATTING}`,
			`Line\nbreak${LINE_SEPARATOR}and${PARAGRAPH_SEPARATOR}more`,
			`Bell${BELL} `,
			`Dragon Rider ${DRAGON.repeat(8)}`,
			'x'.repeat(MAX_PLAYER_NAME_LENGTH + 5)
		];

		for (const name of names)
		{
			const suggested = providerDisplayName(name);

			assert.ok(registerName.safeParse(suggested).success, `${JSON.stringify(name)} suggests ${JSON.stringify(suggested)}`);
		}
	});

	it('takes out the characters a name can\'t have, keeping the words around a line break apart', () =>
	{
		assert.strictEqual(providerDisplayName(`${DAVID}${RIGHT_TO_LEFT_MARK} Cohen`), `${DAVID} Cohen`);
		assert.strictEqual(providerDisplayName('Ada\nLovelace'), 'Ada Lovelace');
		assert.strictEqual(providerDisplayName(`${RIGHT_TO_LEFT_MARK} Ada \t`), 'Ada');
	});

	it('cuts a name to the longest a player can have, by whole characters', () =>
	{
		assert.strictEqual(providerDisplayName('x'.repeat(MAX_PLAYER_NAME_LENGTH + 5)), 'x'.repeat(MAX_PLAYER_NAME_LENGTH));
		assert.strictEqual([...providerDisplayName(DRAGON.repeat(MAX_PLAYER_NAME_LENGTH + 1))].length, MAX_PLAYER_NAME_LENGTH);
	});

	it('is empty when the provider has no name, or only characters a name can\'t have', () =>
	{
		assert.strictEqual(providerDisplayName(undefined), '');
		assert.strictEqual(providerDisplayName(null), '');
		assert.strictEqual(providerDisplayName(`${RIGHT_TO_LEFT_MARK}${BELL}`), '');
	});
});
