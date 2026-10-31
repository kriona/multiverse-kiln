/**
 * Runs in every page's <head> (partials/head.html), before the page is drawn: puts the logged-in
 * player's name, as the last page remembered it (src/ui/accountMenu.ts, under the same storage key),
 * on the root element, so the toolbar draws the account menu in its place at once (src/_shared.scss).
 * Without it, the menu would appear only once the page's scripts ran, moving the rest of the toolbar
 * aside. The page's scripts take over from it
 *
 * A plain script, not a module, so it runs before the page is drawn; a file, not inline, so the
 * Content-Security-Policy needs no 'unsafe-inline'
 */
(function()
{
	try
	{
		var name = localStorage.getItem('kiln-account-name');

		if (name !== null)
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
