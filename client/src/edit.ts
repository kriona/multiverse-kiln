import { EditorPage } from './EditorPage';
import { t } from './localization';
import { startPage } from './pageStart';
import { HOME_PAGE_URL, readEditUniverseId, readPageParameter, TAB_PARAMETER, AREA_PARAMETER } from './pages';
import { isEditorTab } from './ui/editor/EditorScreen';
import { setPageTitle, showStatus } from './ui/dom';
import { pageMessages } from './ui/pageMessages';

/**
 * Starts the world editor's page in the player's language for the universe its address names, or goes
 * to Home without one
 */
async function start(): Promise<void>
{
	const universeId = readEditUniverseId();
	const tab = readPageParameter(TAB_PARAMETER);

	if (universeId === undefined)
	{
		window.location.replace(HOME_PAGE_URL);
		return;
	}

	const { server } = await startPage();

	setPageTitle(document.title);
	showStatus(t(pageMessages.connecting));

	try
	{
		new EditorPage(await server, universeId, {
			tab: (isEditorTab(tab) ? tab : undefined),
			areaId: readPageParameter(AREA_PARAMETER)
		});
	}
	catch (error)
	{
		console.error('Could not connect to the server:', error);
		showStatus(t(pageMessages.connectFailed));
	}
}

void start();
