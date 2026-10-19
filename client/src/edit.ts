import { EditorPage } from './EditorPage';
import { startLocalization, t } from './localization';
import { connectToServer } from './network/serverConnection';
import { startPageLifecycle } from './pageLifecycle';
import { gamePageUrl, readPageParameter, TAB_PARAMETER, UNIVERSE_PARAMETER, AREA_PARAMETER } from './pages';
import { isEditorTab } from './ui/editor/EditorScreen';
import { showStatus } from './ui/dom';
import { startLanguagePicker } from './ui/languagePicker';
import { pageMessages } from './ui/pageMessages';
import { startShortcuts } from './ui/shortcuts';

/**
 * Starts the world editor's page in the player's language for the universe its address names, or goes
 * to Home without one
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

	startPageLifecycle();
	await startLocalization();
	startLanguagePicker();
	startShortcuts();
	showStatus(t(pageMessages.connecting));

	try
	{
		new EditorPage(await connectToServer(), universeId, {
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
