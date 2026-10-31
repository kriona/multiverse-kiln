import assert from 'assert';
import type { Request } from 'express';

import { clientNetwork, parseClientAddressSource, type ClientAddressSource } from '../src/http/clientNetwork.js';

const CONNECTION: ClientAddressSource = { header: undefined };
const REAL_IP: ClientAddressSource = { header: 'x-real-ip' };

/**
 * Reading X-Forwarded-For behind a number of proxies
 *
 * @param proxyHops How many proxies add an entry
 * @return The source
 */
function forwardedFor(proxyHops: number): ClientAddressSource
{
	return({
		header: 'x-forwarded-for',
		proxyHops
	});
}

/**
 * A request with only what clientNetwork reads
 *
 * @param remoteAddress The connection's address, undefined for a Unix socket
 * @param headers Request headers, named in lowercase
 * @return The request
 */
function fakeRequest(remoteAddress: string | undefined, headers: Record<string, string> = {}): Request
{
	return({
		socket: { remoteAddress },
		get: (name: string) => headers[name.toLowerCase()]
	} as unknown as Request);
}

describe('clientNetwork', () =>
{
	const forged = {
		'x-real-ip': '198.51.100.7',
		'x-forwarded-for': '203.0.113.9, 198.51.100.8, 192.0.2.50'
	};

	it('reads the connection\'s address without a header set, ignoring forwarding headers', () =>
	{
		assert.strictEqual(clientNetwork(fakeRequest('192.0.2.1'), CONNECTION), '192.0.2.1');
		assert.strictEqual(clientNetwork(fakeRequest('192.0.2.1', forged), CONNECTION), '192.0.2.1');
	});

	it('reads only the header set', () =>
	{
		assert.strictEqual(clientNetwork(fakeRequest(undefined, forged), REAL_IP), '198.51.100.7');
		assert.strictEqual(clientNetwork(fakeRequest(undefined, forged), forwardedFor(1)), '192.0.2.50');
	});

	it('reads the X-Forwarded-For entry the first trusted proxy added, ignoring those before it', () =>
	{
		assert.strictEqual(clientNetwork(fakeRequest(undefined, forged), forwardedFor(2)), '198.51.100.8');
		assert.strictEqual(clientNetwork(fakeRequest(undefined, { 'x-forwarded-for': '203.0.113.9, 2001:db8:1:2::5' }), forwardedFor(1)), '2001:db8:1:2::/64');
	});

	it('gives undefined when the address can\'t be read', () =>
	{
		const consoleError = console.error;

		// The first unreadable address is reported, which would only clutter the test output
		console.error = () => undefined;

		try
		{
			assert.strictEqual(clientNetwork(fakeRequest(undefined), CONNECTION), undefined);
			assert.strictEqual(clientNetwork(fakeRequest(undefined), REAL_IP), undefined);
			assert.strictEqual(clientNetwork(fakeRequest(undefined, { 'x-real-ip': 'unknown' }), REAL_IP), undefined);

			// Fewer entries than proxies
			assert.strictEqual(clientNetwork(fakeRequest(undefined, { 'x-forwarded-for': '192.0.2.50' }), forwardedFor(2)), undefined);
		}
		finally
		{
			console.error = consoleError;
		}
	});
});

describe('parseClientAddressSource', () =>
{
	it('uses the connection when no header is set', () =>
	{
		assert.deepStrictEqual(parseClientAddressSource({}), CONNECTION);
	});

	it('reads the header in any case, and the proxies in front for X-Forwarded-For', () =>
	{
		assert.deepStrictEqual(parseClientAddressSource({ CLIENT_ADDRESS_HEADER: 'X-Real-IP' }), REAL_IP);
		assert.deepStrictEqual(parseClientAddressSource({ CLIENT_ADDRESS_HEADER: 'X-Forwarded-For' }), forwardedFor(1));
		assert.deepStrictEqual(parseClientAddressSource({ CLIENT_ADDRESS_HEADER: 'x-forwarded-for', TRUSTED_PROXY_HOPS: '2' }), forwardedFor(2));
	});

	it('refuses settings that can\'t be right', () =>
	{
		assert.throws(() => parseClientAddressSource({ COLYSEUS_CLOUD: '1' }), /must be set on Colyseus Cloud/);
		assert.throws(() => parseClientAddressSource({ CLIENT_ADDRESS_HEADER: 'Forwarded' }), /must be X-Real-IP or X-Forwarded-For/);
		assert.throws(() => parseClientAddressSource({ TRUSTED_PROXY_HOPS: '1' }), /without CLIENT_ADDRESS_HEADER/);
		assert.throws(() => parseClientAddressSource({ CLIENT_ADDRESS_HEADER: 'X-Real-IP', TRUSTED_PROXY_HOPS: '1' }), /only applies/);

		for (const hops of ['0', '1.5', 'two', '11'])
		{
			assert.throws(() => parseClientAddressSource({ CLIENT_ADDRESS_HEADER: 'X-Forwarded-For', TRUSTED_PROXY_HOPS: hops }), /whole number/);
		}
	});
});
