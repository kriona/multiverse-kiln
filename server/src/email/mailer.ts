/**
 * Sends email over SMTP (SMTP_URL), from EMAIL_FROM with the site's name. Locally that is Mailpit
 * (docker-compose.yml), which catches every email; tests replace the sender with setEmailSender()
 */
import { createTransport } from 'nodemailer';
import { SITE_NAME } from '@multiverse-kiln/shared';

/**
 * What an email says, in its recipient's language
 */
export interface EmailContent
{
	subject: string;
	text: string;
	html: string;
}

/**
 * An email to send
 */
export interface Email extends EmailContent
{
	to: string;
}

/**
 * Sends an email, resolving once it has been handed to the mail server
 */
export type EmailSender = (email: Email) => Promise<void>;

/**
 * Hosts that are this machine, where a plain SMTP connection never crosses a network
 */
const LOOPBACK_HOSTS = ['127.0.0.1', 'localhost', '[::1]'];

let sender: EmailSender | undefined;

/**
 * Reads a required setting
 *
 * @param name The environment variable
 * @return Its value
 */
function requireSetting(name: string): string
{
	const value = process.env[name];

	if (!value)
	{
		throw new Error(`${name} is not set. See server/.env.example`);
	}

	return(value);
}

/**
 * Makes the sender for SMTP_URL. A plain smtp:// URL to another machine must upgrade to TLS
 * (STARTTLS), so passwords and codes never cross a network unencrypted
 *
 * @return The sender
 */
function createSmtpSender(): EmailSender
{
	const url = requireSetting('SMTP_URL');
	const from = {
		name: SITE_NAME,
		address: requireSetting('EMAIL_FROM')
	};
	const parsed = new URL(url);
	const transport = createTransport({
		url,
		requireTLS: ((parsed.protocol === 'smtp:') && !LOOPBACK_HOSTS.includes(parsed.hostname))
	});

	return(async (email) =>
	{
		await transport.sendMail({
			from,
			...email
		});
	});
}

/**
 * Sends an email
 *
 * @param email The email
 */
export async function sendEmail(email: Email): Promise<void>
{
	sender ??= createSmtpSender();

	await sender(email);
}

/**
 * Replaces how email is sent, for tests
 *
 * @param replacement The sender to use, or undefined to go back to SMTP_URL
 */
export function setEmailSender(replacement: EmailSender | undefined): void
{
	sender = replacement;
}
