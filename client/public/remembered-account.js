/**
 * Runs in every page's <head> (partials/head.html), before the page is drawn: puts the logged-in
 * player's name, as the last page remembered it (src/ui/accountMenu.ts, as a player value under the
 * same storage keys as src/rememberedValues.ts), on the root element, so the toolbar draws the account
 * menu in its place at once (src/_shared.scss). Without it, the menu would appear only once the page's
 * scripts ran, moving the rest of the toolbar aside. A name whose session may have ended isn't drawn.
 * The page's scripts take over from it
 *
 * A plain script, not a module, so it runs before the page is drawn; a file, not inline, so the
 * Content-Security-Policy needs no 'unsafe-inline'
 */
(function()
{
	try
	{
		var name = localStorage.getItem('kiln-player.name');
		var expiresAt = Number(localStorage.getItem('kiln-player.expiresAt'));

		if ((name !== null) && (expiresAt > Date.now()))
		{
			// A JSON string is a CSS string too, for the names players can have
			document.documentElement.style.setProperty('--account-name', JSON.stringify(name));
			document.documentElement.setAttribute('data-account-name', '');
		}
	}
	catch
	{
		// Without storage, the menu appears once the page's scripts ask the server
	}
})();
