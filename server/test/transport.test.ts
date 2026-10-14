import assert from 'assert';
import http from 'http';
import https from 'https';
import os from 'os';
import path from 'path';
import type { WebSocketTransport } from 'colyseus';

import { createTransport, firstDnsName } from '../src/transport.js';

// A path that doesn't exist, for the missing-file cases
const missingFile = path.join(os.tmpdir(), 'multiverse-kiln-missing-cert.pem');

/**
 * Asserts that a transport serves plain HTTP (the Colyseus Cloud and test cases)
 *
 * @param transport Transport to check
 */
function assertPlainHttp(transport: WebSocketTransport): void
{
	assert.ok(transport.server instanceof http.Server);
	assert.ok(!(transport.server instanceof https.Server));
}

describe('createTransport', () =>
{
	it('refuses to run without a certificate outside Colyseus Cloud and tests', () =>
	{
		assert.throws(() => createTransport({ env: { NODE_ENV: 'development' } }), /HTTPS is required/);
		assert.throws(() => createTransport({ env: { NODE_ENV: 'production' } }), /HTTPS is required/);
		assert.throws(() => createTransport({ env: {} }), /HTTPS is required/);
	});

	it('treats empty certificate settings as unset', () =>
	{
		assert.throws(() => createTransport({ env: { NODE_ENV: 'production', SSL_KEY_FILE: '', SSL_CERT_FILE: '' } }), /HTTPS is required/);
	});

	it('requires both the key and the certificate', () =>
	{
		assert.throws(() => createTransport({ env: { SSL_KEY_FILE: missingFile } }), /must both be set/);
		assert.throws(() => createTransport({ env: { SSL_CERT_FILE: missingFile } }), /must both be set/);
	});

	it('rejects a half-configured certificate on Colyseus Cloud too', () =>
	{
		assert.throws(() => createTransport({ env: { COLYSEUS_CLOUD: '1', SSL_KEY_FILE: missingFile } }), /must both be set/);
	});

	it('reports a missing certificate file', () =>
	{
		assert.throws(() => createTransport({ env: { SSL_KEY_FILE: missingFile, SSL_CERT_FILE: missingFile } }), /SSL_KEY_FILE file not found/);
	});

	it('serves plain HTTP on Colyseus Cloud, where its proxy terminates TLS', () =>
	{
		assertPlainHttp(createTransport({ env: { COLYSEUS_CLOUD: '1', NODE_ENV: 'production' } }));
	});

	it('serves plain HTTP in tests', () =>
	{
		assertPlainHttp(createTransport({ env: { NODE_ENV: 'test' } }));
	});
});

describe('firstDnsName', () =>
{
	it('returns the first DNS name', () =>
	{
		assert.strictEqual(firstDnsName('DNS:www.multiversekiln-dev.com, DNS:localhost, IP Address:127.0.0.1'), 'www.multiversekiln-dev.com');
	});

	it('skips entries that are not DNS names', () =>
	{
		assert.strictEqual(firstDnsName('IP Address:127.0.0.1, DNS:localhost'), 'localhost');
	});

	it('returns undefined when there is no DNS name', () =>
	{
		assert.strictEqual(firstDnsName('IP Address:127.0.0.1'), undefined);
		assert.strictEqual(firstDnsName(''), undefined);
		assert.strictEqual(firstDnsName(undefined), undefined);
	});
});
