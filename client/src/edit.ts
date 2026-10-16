import { EditorPage } from './EditorPage';
import { connectToServer } from './network/serverConnection';
import { gamePageUrl, readPageParameter, TAB_PARAMETER, UNIVERSE_PARAMETER, ZONE_PARAMETER } from './pages';
import { isEditorTab } from './ui/editor/EditorScreen';
import { showStatus } from './ui/dom';

/**
 * Starts the world editor's page for the universe its address names, or goes to Home without one
 */
async function start(): Promise<void>
{
	const universeId = readPageParameter(UNIVERSE_PARAMETER);
	const tab = readPageParameter(TAB_PARAMETER);

	if (universeId === undefined)
	{
		window.location.replace(gamePageUrl());
		return;
	}

	showStatus('Connecting...');

	try
	{
		new EditorPage(await connectToServer(), universeId, {
			tab: (isEditorTab(tab) ? tab : undefined),
			zoneId: readPageParameter(ZONE_PARAMETER)
		});
	}
	catch (error)
	{
		console.error('Could not connect to the server:', error);
		showStatus('Could not connect to the server. Reload the page to try again.');
	}
}

void start();
