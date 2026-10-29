/**
 * The client's address (SITE_URL), which emails link to and Google and Discord send players back to
 */

let checked: string | undefined;

/**
 * Reads and checks a site address: an https:// origin, without a path, query string or fragment
 *
 * @param value The address, such as SITE_URL's value
 * @return The origin, without a trailing slash
 * @throws Error when it is missing or not such an address
 */
export function parseSiteUrl(value: string | undefined): string
{
	if (!value)
	{
		throw new Error('SITE_URL is not set. See server/.env.example');
	}

	let url: URL;

	try
	{
		url = new URL(value);
	}
	catch
	{
		throw new Error(`SITE_URL isn't an address: ${value}`);
	}

	if ((url.protocol !== 'https:') || (url.pathname !== '/') || (url.search !== '') || (url.hash !== '') || (url.username !== '') || (url.password !== ''))
	{
		throw new Error(`SITE_URL must be an https:// address with nothing after the host and port, such as https://www.example.com: ${value}`);
	}

	return(url.origin);
}

/**
 * The client's address, read from SITE_URL the first time
 *
 * @return The origin, without a trailing slash
 * @throws Error when SITE_URL is missing or not an https:// origin
 */
export function siteUrl(): string
{
	checked ??= parseSiteUrl(process.env.SITE_URL);

	return(checked);
}

/**
 * The full address of one of the client's pages
 *
 * @param path The page's path, and query string if any, such as /login
 * @return The address
 */
export function sitePageUrl(path: string): string
{
	return(new URL(path, siteUrl()).toString());
}
