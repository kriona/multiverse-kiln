import { X509Certificate } from 'crypto';
import fs from 'fs';
import https from 'https';
import { type BeforeUpgradeHandler, WebSocketTransport } from 'colyseus';

/**
 * Options for createTransport
 */
export interface CreateTransportOptions
{
	// Runs before each WebSocket upgrade; return a Response to reject the connection
	beforeUpgrade?: BeforeUpgradeHandler;

	// Environment variables to read (defaults to process.env)
	env?: NodeJS.ProcessEnv;
}

/**
 * Creates the server transport, refusing to run without HTTPS
 *
 * - SSL_KEY_FILE and SSL_CERT_FILE set: serves HTTPS/WSS directly (local development, self-hosting)
 * - On Colyseus Cloud: plain HTTP transport. @colyseus/tools binds it to a local Unix socket
 *   behind Cloud's proxy, which terminates TLS, so players still connect over HTTPS/WSS
 * - NODE_ENV=test: plain HTTP transport, because the test harness connects over plain ws://
 *
 * Anything else throws, so the server never serves plain HTTP to players
 *
 * @param options Upgrade check and environment
 * @return WebSocket transport, over HTTPS when a certificate is configured
 */
export function createTransport(options: CreateTransportOptions = {}): WebSocketTransport
{
	const env = (options.env ?? process.env);
	const beforeUpgrade = options.beforeUpgrade;
	const keyFile = env.SSL_KEY_FILE;
	const certFile = env.SSL_CERT_FILE;

	if (keyFile || certFile)
	{
		if (!keyFile || !certFile)
		{
			throw new Error('SSL_KEY_FILE and SSL_CERT_FILE must both be set');
		}

		const key = readCertificateFile(keyFile, 'SSL_KEY_FILE');
		const cert = readCertificateFile(certFile, 'SSL_CERT_FILE');
		const server = https.createServer({ key, cert });
		const hostname = (firstDnsName(new X509Certificate(cert).subjectAltName) ?? 'localhost');

		// Colyseus always logs "Listening on http://localhost:<port>", whatever the transport serves
		server.on('listening', () =>
		{
			const address = server.address();
			const port = (((address !== null) && (typeof address === 'object')) ? address.port : '?');

			console.info(`HTTPS/WSS: open https://${hostname}:${port} (ignore Colyseus's "Listening on http://" line)`);
		});

		return(new WebSocketTransport({ server, beforeUpgrade }));
	}

	if ((env.COLYSEUS_CLOUD !== undefined) || (env.NODE_ENV === 'test'))
	{
		// Without a server option, the transport creates a plain http.Server (Colyseus's default)
		return(new WebSocketTransport({ beforeUpgrade }));
	}

	throw new Error('HTTPS is required: set SSL_KEY_FILE and SSL_CERT_FILE. For local development, see "Create a local HTTPS certificate" in README.md');
}

/**
 * Finds the first DNS name in a certificate's subject alternative names
 *
 * For an mkcert certificate that's the first hostname passed to mkcert, the dev hostname
 *
 * @param subjectAltName The certificate's subjectAltName, e.g. "DNS:example.com, IP Address:127.0.0.1"
 * @return The first DNS name, or undefined when there is none
 */
export function firstDnsName(subjectAltName: string | undefined): string | undefined
{
	const match = /(?:^|,\s*)DNS:([^,\s]+)/.exec(subjectAltName ?? '');

	return(match?.[1]);
}

/**
 * Reads a certificate or key file, explaining how to create it when missing
 *
 * @param file Path to the file, relative to the working directory
 * @param variableName Environment variable the path came from, named in the error message
 * @return File contents
 */
function readCertificateFile(file: string, variableName: string): Buffer
{
	if (!fs.existsSync(file))
	{
		throw new Error(`${variableName} file not found: ${file} (resolved from ${process.cwd()}). Generate a local certificate with mkcert; see "Create a local HTTPS certificate" in README.md`);
	}

	return(fs.readFileSync(file));
}
