import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { catalogProblems, defineMessages, isLocalizedMessage, localize, matchLocale, messageArguments, PSEUDO_LOCALE, pseudoMessage, SOURCE_LOCALE, Translator } from '@multiverse-kiln/shared';

/**
 * Where the English catalog and the translations are
 */
const LOCALES_FOLDER = path.resolve(import.meta.dirname, '..', '..', '..', 'shared', 'locales');

const messages = defineMessages({
	saved: {
		id: 'test.saved',
		defaultMessage: 'Saved',
		description: 'A test message with no arguments'
	},
	playingAs: {
		id: 'test.playingAs',
		defaultMessage: 'Playing as {name}',
		description: 'A test message with an argument'
	},
	zones: {
		id: 'test.zones',
		defaultMessage: '{count, plural, one {# zone} other {# zones}}',
		description: 'A test message with a plural'
	}
});

/**
 * Runs code with console.error silenced, for code that reports a problem it recovers from
 *
 * @param run The code
 * @return What it returns
 */
function withoutErrorLog<T>(run: () => T): T
{
	const log = console.error;

	console.error = () => undefined;

	try
	{
		return(run());
	}
	finally
	{
		console.error = log;
	}
}

describe('localization (shared)', () =>
{
	describe('matchLocale', () =>
	{
		it('takes the first wanted language that is available, ignoring capitals', () =>
		{
			assert.strictEqual(matchLocale(['de', 'FR', 'en'], ['en', 'fr']), 'fr');
		});

		it('matches a language with or without its region', () =>
		{
			assert.strictEqual(matchLocale(['fr-CA'], ['en', 'fr']), 'fr');
			assert.strictEqual(matchLocale(['pt'], ['en', 'pt-BR']), 'pt-BR');
		});

		it('falls back to the source language', () =>
		{
			assert.strictEqual(matchLocale(['de', 'ja'], ['en', 'fr']), SOURCE_LOCALE);
			assert.strictEqual(matchLocale([], ['en', 'fr']), SOURCE_LOCALE);
		});
	});

	describe('Translator', () =>
	{
		it('shows a message without a translation in English, with its arguments and plurals', () =>
		{
			const translator = new Translator(SOURCE_LOCALE);

			assert.strictEqual(translator.format(messages.playingAs, { name: 'Ada' }), 'Playing as Ada');
			assert.strictEqual(translator.format(messages.zones, { count: 1 }), '1 zone');
			assert.strictEqual(translator.format(messages.zones, { count: 3 }), '3 zones');
		});

		it('uses a translation when there is one', () =>
		{
			const translator = new Translator('fr', { 'test.playingAs': 'Vous jouez {name}' });

			assert.strictEqual(translator.format(messages.playingAs, { name: 'Ada' }), 'Vous jouez Ada');
			assert.strictEqual(translator.format(messages.saved), 'Saved');
		});

		it('shows English in place of a translation that can\'t be read', () =>
		{
			const translator = new Translator('fr', { 'test.playingAs': 'Vous jouez {name' });

			assert.strictEqual(withoutErrorLog(() => translator.format(messages.playingAs, { name: 'Ada' })), 'Playing as Ada');
		});

		it('shows a message sent by the server with its values', () =>
		{
			const sent = localize(messages.zones, { count: 2 });

			assert.strictEqual(new Translator(SOURCE_LOCALE).format(sent, sent.values), '2 zones');
		});

		it('keeps objects given as arguments, e.g. elements on a page', () =>
		{
			const element = { kind: 'element' };

			assert.deepStrictEqual(new Translator(SOURCE_LOCALE).formatToParts(messages.playingAs, { name: element }), ['Playing as ', element]);
		});

	});

	describe('pseudoMessage', () =>
	{
		it('accents the vowels of a message\'s text, lengthens it and brackets it, but leaves its arguments alone', () =>
		{
			const translator = new Translator(PSEUDO_LOCALE, Object.fromEntries(Object.values(messages).map((message) => [message.id, pseudoMessage(message.defaultMessage)])));

			assert.strictEqual(translator.format(messages.saved), '[Såvéd ~~]');
			assert.strictEqual(translator.format(messages.playingAs, { name: 'Ada' }), '[Plåyîng ås Ada ~~~]');
			assert.strictEqual(translator.format(messages.zones, { count: 1 }), '[1 zöné ~~]');
			assert.strictEqual(translator.format(messages.zones, { count: 3 }), '[3 zönés ~~]');
		});

		it('pads a long message with words, so it wraps like a longer translation', () =>
		{
			// 30 letters with no vowels to accent, so 9 padding characters: a word of 5 and a word of 4
			assert.strictEqual(pseudoMessage('bcdfg hjklm npqrs tvwxz bcdfg hjklm'), '[bcdfg hjklm npqrs tvwxz bcdfg hjklm ~~~~~ ~~~~]');
		});

		it('keeps a message\'s arguments, so it passes the translation checks', () =>
		{
			const english = Object.fromEntries(Object.values(messages).map((message) => [message.id, message]));
			const pseudo = Object.fromEntries(Object.values(messages).map((message) => [message.id, pseudoMessage(message.defaultMessage)]));

			assert.deepStrictEqual(catalogProblems(english, pseudo), []);
		});
	});

	describe('isLocalizedMessage', () =>
	{
		it('accepts a message with or without values, and nothing else', () =>
		{
			assert.strictEqual(isLocalizedMessage(localize(messages.saved)), true);
			assert.strictEqual(isLocalizedMessage(localize(messages.zones, { count: 2 })), true);
			assert.strictEqual(isLocalizedMessage('Something went wrong'), false);
			assert.strictEqual(isLocalizedMessage({ id: 'test.saved' }), false);
			assert.strictEqual(isLocalizedMessage({ id: 'test.zones', defaultMessage: '{count}', values: { count: {} } }), false);
		});
	});

	describe('messageArguments', () =>
	{
		it('lists the arguments and tags a message uses, including inside plurals', () =>
		{
			assert.deepStrictEqual(messageArguments('{count, plural, one {# zone in {universe}} other {<b>#</b> zones}}'), ['<b>', 'count', 'universe']);
			assert.deepStrictEqual(messageArguments('Saved'), []);
		});
	});

	describe('catalogProblems', () =>
	{
		const english = {
			'test.playingAs': { defaultMessage: 'Playing as {name}' },
			'test.saved': { defaultMessage: 'Saved' }
		};

		it('accepts translations that keep their English\'s arguments', () =>
		{
			assert.deepStrictEqual(catalogProblems(english, { 'test.playingAs': 'Vous jouez {name}', 'test.saved': 'Enregistré' }), []);
		});

		it('reports translations of messages that don\'t exist, that can\'t be read, or whose arguments differ', () =>
		{
			const problems = catalogProblems(english, {
				'test.gone': 'Parti',
				'test.saved': 'Enregistré {',
				'test.playingAs': 'Vous jouez {player}'
			});

			assert.strictEqual(problems.length, 3);
			assert.ok(problems[0].startsWith('test.gone: '));
			assert.ok(problems[1].startsWith('test.saved: could not be read'));
			assert.strictEqual(problems[2], 'test.playingAs: uses player instead of name');
		});
	});

	describe('the translations in shared/locales', () =>
	{
		it('each keep the English catalog\'s messages and arguments', () =>
		{
			const english = JSON.parse(fs.readFileSync(path.join(LOCALES_FOLDER, `${SOURCE_LOCALE}.json`), 'utf8')) as Record<string, { defaultMessage: string }>;

			// The pseudo-language's catalog is left out: the dev server makes it, and it isn't committed
			const translations = fs.readdirSync(LOCALES_FOLDER).filter((name) => (name.endsWith('.json') && ![`${SOURCE_LOCALE}.json`, `${PSEUDO_LOCALE}.json`].includes(name)));

			for (const file of translations)
			{
				const catalog = JSON.parse(fs.readFileSync(path.join(LOCALES_FOLDER, file), 'utf8')) as Record<string, string>;

				assert.deepStrictEqual(catalogProblems(english, catalog), [], file);
			}
		});
	});
});
