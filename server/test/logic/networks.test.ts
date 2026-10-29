import assert from 'assert';

import { networkOf } from '../../src/logic/networks.js';

describe('networkOf', () =>
{
	it('keeps an IPv4 address whole', () =>
	{
		assert.strictEqual(networkOf('192.0.2.1'), '192.0.2.1');
		assert.strictEqual(networkOf(' 10.0.0.255 '), '10.0.0.255');
	});

	it('reads IPv4 addresses written as IPv6 as IPv4', () =>
	{
		assert.strictEqual(networkOf('::ffff:192.0.2.1'), '192.0.2.1');
		assert.strictEqual(networkOf('::FFFF:c000:0201'), '192.0.2.1');
	});

	it('keeps the /64 prefix of an IPv6 address', () =>
	{
		assert.strictEqual(networkOf('2001:db8:1234:5678:9abc:def0:1:2'), '2001:db8:1234:5678::/64');
		assert.strictEqual(networkOf('2001:0DB8:1234:5678::1'), '2001:db8:1234:5678::/64');
	});

	it('puts addresses in the same /64 in one network', () =>
	{
		assert.strictEqual(networkOf('2001:db8:0:1::a'), networkOf('2001:db8:0:1:ffff:ffff:ffff:ffff'));
		assert.notStrictEqual(networkOf('2001:db8:0:1::a'), networkOf('2001:db8:0:2::a'));
	});

	it('expands :: anywhere in the address', () =>
	{
		assert.strictEqual(networkOf('::1'), '0:0:0:0::/64');
		assert.strictEqual(networkOf('2001:db8::'), '2001:db8:0:0::/64');
		assert.strictEqual(networkOf('fe80::1%eth0'), 'fe80:0:0:0::/64');
		assert.strictEqual(networkOf('[2001:db8::1]'), '2001:db8:0:0::/64');
	});

	it('reads an embedded IPv4 ending', () =>
	{
		assert.strictEqual(networkOf('64:ff9b::192.0.2.1'), '64:ff9b:0:0::/64');
	});

	it('refuses what isn\'t an address', () =>
	{
		assert.strictEqual(networkOf(''), undefined);
		assert.strictEqual(networkOf('256.0.0.1'), undefined);
		assert.strictEqual(networkOf('1.2.3'), undefined);
		assert.strictEqual(networkOf('2001:db8::1::2'), undefined);
		assert.strictEqual(networkOf('1:2:3:4:5:6:7:8:9'), undefined);
		assert.strictEqual(networkOf('1:2:3:4:5:6:7'), undefined);
		assert.strictEqual(networkOf('12345::'), undefined);
		assert.strictEqual(networkOf('::ffff:1.2.3.400'), undefined);
	});
});
