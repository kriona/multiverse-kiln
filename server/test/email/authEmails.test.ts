import assert from 'assert';
import { SITE_NAME } from '@multiverse-kiln/shared';

import { accountCreatedEmail, emailChangedEmail, emailCodeEmail, passwordChangedEmail } from '../../src/email/authEmails.js';
import { emailTranslator } from '../../src/email/emailLocales.js';
import { sendEmail, setEmailSender, type Email } from '../../src/email/mailer.js';

describe('authEmails', () =>
{
	it('sends a code in the text and the HTML, with how long it lasts', () =>
	{
		const email = emailCodeEmail('register', 'AB3X9Z', 'en');

		assert.strictEqual(email.subject, `Your code to create an account on ${SITE_NAME}`);
		assert.match(email.text, /^Enter this code on .+ to create your account:\r\n\r\nAB3X9Z\r\n\r\nThe code works once, for 15 minutes\.\r\n\r\nIf you didn't ask/);
		assert.match(email.html, />AB3X9Z</);
		assert.match(email.html, /<html lang="en">/);
	});

	it('says what each code is for', () =>
	{
		assert.match(emailCodeEmail('resetPassword', 'AB3X9Z', 'en').subject, /reset your password/);
		assert.match(emailCodeEmail('changeEmail', 'AB3X9Z', 'en').subject, /change your email address/);
	});

	it('writes the notices', () =>
	{
		assert.strictEqual(accountCreatedEmail('en').subject, `Welcome to ${SITE_NAME}`);
		assert.match(passwordChangedEmail('en').text, /every browser logged in to it was logged out/);
		assert.match(emailChangedEmail({ address: 'new' }, 'en').text, /This is now the email address/);
	});

	it('escapes text in the HTML, but not in the plain text', () =>
	{
		const email = emailChangedEmail({
			address: 'old',
			newAddress: '"<b>"@example.com'
		}, 'en');

		assert.match(email.text, /changed to "<b>"@example\.com\./);
		assert.match(email.html, /changed to &quot;&lt;b&gt;&quot;@example\.com\./);
		assert.doesNotMatch(email.html, /<b>/);
	});

	it('writes in the recipient\'s language, or the closest there is', () =>
	{
		assert.strictEqual(emailTranslator('en-x-pirate').locale, 'en-x-pirate');
		assert.strictEqual(emailTranslator('EN-X-PIRATE').locale, 'en-x-pirate');
		assert.strictEqual(emailTranslator('fr-CA').locale, 'en');
		assert.match(emailCodeEmail('register', 'AB3X9Z', 'en-x-pirate').html, /<html lang="en-x-pirate">/);
		assert.notStrictEqual(emailCodeEmail('register', 'AB3X9Z', 'en-x-pirate').subject, emailCodeEmail('register', 'AB3X9Z', 'en').subject);
	});
});

describe('mailer', () =>
{
	afterEach(() =>
	{
		setEmailSender(undefined);
	});

	it('hands emails to the sender', async () =>
	{
		const sent: Email[] = [];

		setEmailSender((email) =>
		{
			sent.push(email);
			return(Promise.resolve());
		});

		await sendEmail({
			to: 'ada@example.com',
			...accountCreatedEmail('en')
		});

		assert.strictEqual(sent.length, 1);
		assert.strictEqual(sent[0].to, 'ada@example.com');
	});
});
