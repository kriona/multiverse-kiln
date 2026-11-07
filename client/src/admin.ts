import { showAdminRefusal, startAdminPage } from './AdminPage';
import { currentLocale } from './localization';
import { describeEditorError } from './network/editorApi';
import { getElement, showMessage } from './ui/dom';

/**
 * Starts the admin page (admin.html), which links to the admin tools, in alphabetical order, once the
 * server says the player may use them
 */
void startAdminPage(async (api) =>
{
	const loading = getElement('admin-loading', HTMLElement);

	try
	{
		await api.checkAccess();
	}
	catch (error)
	{
		loading.hidden = true;

		if (!showAdminRefusal(error))
		{
			const refusal = getElement('admin-refusal', HTMLElement);

			showMessage(getElement('admin-refusal-message', HTMLElement), describeEditorError(error, {
				id: 'admin.home.loadFailed',
				defaultMessage: 'Could not load the admin page. Try again in a moment.',
				description: 'Shown on the admin page that links to the admin tools when the server couldn\'t be asked whether the player may use them'
			}));
			refusal.hidden = false;
		}

		return;
	}

	loading.hidden = true;
	sortTools(getElement('admin-content', HTMLUListElement));
	getElement('admin-content', HTMLElement).hidden = false;
});

/**
 * Puts the links to the admin tools in alphabetical order by their names in the page's language. The
 * page lists them in English's order, which a translation's names may not keep
 *
 * @param list The list of links
 */
function sortTools(list: HTMLUListElement): void
{
	const locale = currentLocale();
	const nameOf = (item: Element): string => (item.querySelector('.admin-tool-name')?.textContent?.trim() ?? '');

	list.append(...[...list.children].sort((first, second) => nameOf(first).localeCompare(nameOf(second), locale)));
}
