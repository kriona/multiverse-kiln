import fs from 'fs';
import { defineConfig, loadEnv } from 'vite';

/**
 * Reads a certificate or key file for the dev server, explaining how to create it when missing
 *
 * @param file Path to the file, relative to the client folder, or undefined when not configured
 * @param variableName Environment variable the path came from, named in the error message
 * @return File contents
 */
function readCertificateFile(file: string | undefined, variableName: string): Buffer
{
	if (!file)
	{
		throw new Error(`${variableName} is not set in client/.env. The dev server requires HTTPS; see "Create a local HTTPS certificate" in README.md`);
	}

	if (!fs.existsSync(file))
	{
		throw new Error(`${variableName} file not found: ${file} (resolved from ${process.cwd()}). Generate a local certificate with mkcert; see "Create a local HTTPS certificate" in README.md`);
	}

	return(fs.readFileSync(file));
}

export default defineConfig(({ command, mode }) =>
{
	// Load all variables (not just VITE_*) so DEV_HOST stays out of the client bundle
	const env = loadEnv(mode, process.cwd(), '');
	const devHost = (env.DEV_HOST || undefined);

	// The dev server always uses HTTPS; production builds don't need a certificate
	const https = ((command === 'serve') ? {
		key: readCertificateFile(env.DEV_SSL_KEY_FILE, 'DEV_SSL_KEY_FILE'),
		cert: readCertificateFile(env.DEV_SSL_CERT_FILE, 'DEV_SSL_CERT_FILE')
	} : undefined);

	return({
		server: {
			// Bind to the dev hostname (127.0.0.1 via hosts file); the default "localhost" may bind IPv6 only
			host: devHost,
			port: Number(env.DEV_PORT || 5173),
			strictPort: true,
			allowedHosts: (devHost ? [devHost] : []),
			https
		},
		build: {
			target: 'es2022'
		}
	});
});
