/**
 * The network a request comes from, for limits counted per network and for the auth events
 */
import type { Request } from 'express';

import { keyedHash } from '../auth/keyedHashes.js';
import { networkOf } from '../logic/networks.js';

/**
 * The network a request comes from. This is the only place the server reads a client's address, so
 * when it runs behind a proxy (such as Colyseus Cloud's), reading the proxy's forwarding header,
 * trusted only from the proxy, goes here
 *
 * @param request The request
 * @return The network (an IPv4 address or an IPv6 /64), or undefined when the address can't be read
 */
export function clientNetwork(request: Request): string | undefined
{
	return(networkOf(request.socket.remoteAddress ?? ''));
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
