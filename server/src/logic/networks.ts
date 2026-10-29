/**
 * Which network a client is on, for limits counted per network (see Email codes in STRUCTURE-OVERVIEW.md)
 */

/**
 * An IPv4 address: four numbers from 0 to 255
 */
const IPV4_PATTERN = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

/**
 * Expands an IPv6 address to its eight groups
 *
 * @param address The address, without a zone (%eth0) or brackets
 * @return The groups as numbers, or undefined when it isn't an IPv6 address
 */
function ipv6Groups(address: string): number[] | undefined
{
	let text = address.toLowerCase();

	// An address can end in an embedded IPv4 address, which is written as two groups
	const lastColon = text.lastIndexOf(':');
	const ending = text.slice(lastColon + 1);

	if (ending.includes('.'))
	{
		if (!IPV4_PATTERN.test(ending))
		{
			return(undefined);
		}

		const bytes = ending.split('.').map(Number);

		text = `${text.slice(0, lastColon + 1)}${((bytes[0] << 8) | bytes[1]).toString(16)}:${((bytes[2] << 8) | bytes[3]).toString(16)}`;
	}

	const halves = text.split('::');

	if (halves.length > 2)
	{
		return(undefined);
	}

	const parse = (part: string): number[] | undefined =>
	{
		if (part === '')
		{
			return([]);
		}

		const groups: number[] = [];

		for (const group of part.split(':'))
		{
			if (!/^[0-9a-f]{1,4}$/.test(group))
			{
				return(undefined);
			}

			groups.push(parseInt(group, 16));
		}

		return(groups);
	};

	const head = parse(halves[0]);
	const rest = ((halves.length === 2) ? parse(halves[1]) : []);

	if (!head || !rest)
	{
		return(undefined);
	}

	const given = [...head, ...rest];

	if (halves.length === 1)
	{
		return(((given.length === 8) ? given : undefined));
	}

	if (given.length > 7)
	{
		return(undefined);
	}

	return([...head, ...new Array<number>(8 - given.length).fill(0), ...rest]);
}

/**
 * The network a client address belongs to: an IPv4 address on its own, or an IPv6 address's /64
 * prefix, since one IPv6 home or phone is given a whole /64. IPv4 addresses written as IPv6
 * (::ffff:192.0.2.1) count as IPv4
 *
 * @param address The client's address, as the connection reports it
 * @return A key for the network, the same for every address in it, or undefined when the address can't be read
 */
export function networkOf(address: string): string | undefined
{
	const bare = address.trim().replace(/^\[|\]$/g, '').replace(/%.*$/, '');

	if (IPV4_PATTERN.test(bare))
	{
		return(bare);
	}

	const groups = ipv6Groups(bare);

	if (!groups)
	{
		return(undefined);
	}

	if (groups.slice(0, 5).every((group) => (group === 0)) && (groups[5] === 0xffff))
	{
		return([groups[6] >> 8, groups[6] & 255, groups[7] >> 8, groups[7] & 255].join('.'));
	}

	return(`${groups.slice(0, 4).map((group) => group.toString(16)).join(':')}::/64`);
}
