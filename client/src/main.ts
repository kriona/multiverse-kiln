import { App } from './App';
import { connectToServer } from './network/serverConnection';
import { showStatus } from './ui/dom';

/**
 * Connects to the server and starts the app, or explains that it couldn't connect
 */
async function start(): Promise<void>
{
	showStatus('Connecting...');

	try
	{
		new App(await connectToServer());
	}
	catch (error)
	{
		console.error('Could not connect to the server:', error);
		showStatus('Could not connect to the server. Reload the page to try again.');
	}
}

void start();
