/**
 * Runs in every page's footer (partials/footer.html), right after the list of social site logos and
 * before the page is drawn: shows the logos of the site's social links as the last page remembered
 * them (src/ui/siteSocials.ts, under the same storage key), so they are there from the start rather
 * than appearing once the page's scripts run. The page's scripts take over from it, naming each link
 * and correcting them with the server's answer
 *
 * Only https links are shown, so nothing else written to the browser's storage can become a link; the
 * page's scripts then check each one's host as the server does
 *
 * A plain script, not a module, so it runs before the page is drawn; a file, not inline, so the
 * Content-Security-Policy needs no 'unsafe-inline'
 */
(function()
{
	try
	{
		var stored = JSON.parse(localStorage.getItem('kiln-site-socials') || 'null');

		if ((typeof stored !== 'object') || (stored === null))
		{
			return;
		}

		var items = document.querySelectorAll('#site-socials-list li[data-site]');
		var shown = 0;

		for (var index = 0; index < items.length; index++)
		{
			var url = stored[items[index].getAttribute('data-site')];

			if ((typeof url === 'string') && URL.canParse(url) && (new URL(url).protocol === 'https:'))
			{
				items[index].querySelector('a').href = url;
				items[index].hidden = false;
				shown++;
			}
		}

		document.getElementById('site-socials').hidden = (shown === 0);
	}
	catch
	{
		// Without storage, the logos appear once the page's scripts ask the server
	}
})();
