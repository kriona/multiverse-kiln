/**
 * Runs in every page's <head> (partials/head.html), before the page is drawn: when the last page was
 * shown in a language other than English (src/localization.ts, under the same storage key), marks the
 * root element with data-translating, so the page stays hidden (src/_shared.scss) until
 * startLocalization() has translated it, rather than showing its HTML's English first. The style shows
 * the page after a moment even if that never happens
 *
 * A plain script, not a module, so it runs before the page is drawn; a file, not inline, so the
 * Content-Security-Policy needs no 'unsafe-inline'
 */
(function()
{
	try
	{
		var locale = localStorage.getItem('kiln-page-locale');

		if ((locale !== null) && (locale !== 'en'))
		{
			document.documentElement.setAttribute('data-translating', '');
		}
	}
	catch
	{
		// Without storage, the page shows in English until it's translated
	}
})();
