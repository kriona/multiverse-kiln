/**
 * The network a request comes from, for limits counted per network and for the auth events
 */
import type { Request } from 'express';

import { keyedHash } from '../auth/keyedHashes.js';
import { networkOf } from '../logic/networks.js';

/**
 * The most proxies TRUSTED_PROXY_HOPS may name
 */
const MAX_PROXY_HOPS = 10;

/**
 * Where a client's address comes from: the connection itself, or one header that the proxy in front
 * of the server sets. With X-Forwarded-For, each proxy adds an entry at the end, so the client's is
 * proxyHops entries from the end; entries before it can come from the client
 */
export type ClientAddressSource = { header: undefined } | { header: 'x-real-ip' } | { header: 'x-forwarded-for'; proxyHops: number };

let checked: ClientAddressSource | undefined;
let reportedUnreadable = false;

/**
 * Reads and checks where clients' addresses come from (CLIENT_ADDRESS_HEADER and TRUSTED_PROXY_HOPS).
 * Without a header, the connection's address is used, since a header could come from the client.
 * Which header to trust depends on the proxies in front of the server, so it is set for each host
 * and checked once deployed (see Phase 16 in PLAN.md)
 *
 * @param env Environment variables to read
 * @return Where the address comes from
 * @throws Error when a setting is invalid, or the server listens behind Colyseus Cloud's proxy (where
 * the connection has no address) without a header
 */
export function parseClientAddressSource(env: NodeJS.ProcessEnv): ClientAddressSource
{
	const header = env.CLIENT_ADDRESS_HEADER?.trim().toLowerCase();
	const hops = env.TRUSTED_PROXY_HOPS?.trim();

	if (!header)
	{
		if (hops)
		{
			throw new Error('TRUSTED_PROXY_HOPS is set without CLIENT_ADDRESS_HEADER. See server/.env.example');
		}

		if (env.COLYSEUS_CLOUD !== undefined)
		{
			throw new Error('CLIENT_ADDRESS_HEADER must be set on Colyseus Cloud, where the server only sees its proxy. See server/.env.example');
		}

		return({ header: undefined });
	}

	if (header === 'x-real-ip')
	{
		if (hops)
		{
			throw new Error('TRUSTED_PROXY_HOPS only applies when CLIENT_ADDRESS_HEADER is X-Forwarded-For');
		}

		return({ header });
	}

	if (header !== 'x-forwarded-for')
	{
		throw new Error(`CLIENT_ADDRESS_HEADER must be X-Real-IP or X-Forwarded-For: ${env.CLIENT_ADDRESS_HEADER}`);
	}

	const proxyHops = (hops ? Number(hops) : 1);

	if (!Number.isInteger(proxyHops) || (proxyHops < 1) || (proxyHops > MAX_PROXY_HOPS))
	{
		throw new Error(`TRUSTED_PROXY_HOPS must be a whole number from 1 to ${MAX_PROXY_HOPS}: ${hops}`);
	}

	return({
		header,
		proxyHops
	});
}

/**
 * Where clients' addresses come from, read from the environment the first time
 *
 * @return Where the address comes from
 * @throws Error when the settings are invalid (see parseClientAddressSource())
 */
export function clientAddressSource(): ClientAddressSource
{
	checked ??= parseClientAddressSource(process.env);

	return(checked);
}

/**
 * The network a request comes from. This is the only place the server reads a client's address
 *
 * @param request The request
 * @param source Where the address comes from (defaults to the server's settings)
 * @return The network (an IPv4 address or an IPv6 /64), or undefined when the address can't be read
 */
export function clientNetwork(request: Request, source: ClientAddressSource = clientAddressSource()): string | undefined
{
	const address = clientAddress(request, source);
	const network = networkOf(address ?? '');

	if ((network === undefined) && !reportedUnreadable)
	{
		// Limits counted per network skip a request without one, so this has to be noticed
		reportedUnreadable = true;
		console.error('A request\'s client address could not be read, so limits per network are not applied to it. Address:', address);
	}

	return(network);
}

/**
 * A request's client address, as the source says to read it
 *
 * @param request The request
 * @param source Where the address comes from
 * @return The address, or undefined when the connection or header gives none
 */
function clientAddress(request: Request, source: ClientAddressSource): string | undefined
{
	if (source.header === undefined)
	{
		return(request.socket.remoteAddress);
	}

	if (source.header === 'x-real-ip')
	{
		return(request.get('x-real-ip')?.trim());
	}

	// Several X-Forwarded-For headers arrive joined with commas, in order
	const entries = (request.get('x-forwarded-for') ?? '')
		.split(',')
		.map((entry) => entry.trim());

	// Fewer entries than proxies means the request didn't come through all of them
	return(((entries.length >= source.proxyHops) ? entries[entries.length - source.proxyHops] : undefined));
}

/**
 * The keyed hash of a request's network, stored in place of the address
 *
 * @param request The request
 * @return The hash, or null when the address can't be read
 */
export function clientNetworkHash(request: Request): Buffer | null
{
	const network = clientNetwork(request);

	return(((network !== undefined) ? keyedHash('network', network) : null));
}
