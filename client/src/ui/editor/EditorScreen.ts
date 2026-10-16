import type { EditableUniverse, UniverseSummary } from '@multiverse-kiln/shared';

import { describeEditorError, type EditorApi } from '../../network/editorApi';
import { getElement, showMessage } from '../dom';
import { TilesetsTab } from './TilesetsTab';
import { UniverseTab } from './UniverseTab';
import { ZonesTab } from './ZonesTab';

/**
 * The editor's tabs
 */
type TabName = 'universe' | 'lobby' | 'tilesets' | 'zones';

const tabNames: TabName[] = [
	'universe',
	'lobby',
	'tilesets',
	'zones'
];

/**
 * What the editor asks the app to do
 */
export interface EditorScreenActions
{
	/**
	 * Goes back to Home
	 */
	goHome: () => void;

	/**
	 * Goes into the universe's lobby to play it
	 */
	play: (universe: UniverseSummary) => void;
}

/**
 * Edit Universe: a universe's settings, tiles and zones, in tabs
 *
 * What the player may change depends on their role in the universe; the server checks it again on
 * every change, so the page only hides controls that would be refused
 */
export class EditorScreen
{
	private readonly title = getElement('editor-title', HTMLElement);
	private readonly role = getElement('editor-role', HTMLElement);
	private readonly notice = getElement('editor-notice', HTMLElement);
	private readonly universeTab: UniverseTab;
	private readonly tilesetsTab: TilesetsTab;
	private readonly zonesTab: ZonesTab;

	/**
	 * The universe being edited, once it has loaded
	 */
	private universe: EditableUniverse | undefined;

	/**
	 * Changes every time a universe is opened, so one that arrives for an earlier open is ignored
	 */
	private openVersion = 0;

	/**
	 * @param api The editor's API
	 * @param actions What the screen's controls do
	 */
	constructor(private readonly api: EditorApi, actions: EditorScreenActions)
	{
		this.universeTab = new UniverseTab(api, (universe) =>
		{
			this.setUniverse(universe);
		});
		this.tilesetsTab = new TilesetsTab(api);
		this.zonesTab = new ZonesTab(api);

		for (const name of tabNames)
		{
			getElement(`editor-tab-${name}`, HTMLButtonElement).addEventListener('click', () =>
			{
				this.selectTab(name);
			});
		}

		getElement('editor-home', HTMLButtonElement).addEventListener('click', () =>
		{
			actions.goHome();
		});

		getElement('editor-play', HTMLButtonElement).addEventListener('click', () =>
		{
			if (this.universe)
			{
				const { id, name, shortDescription, ruleset } = this.universe;

				actions.play({ id, name, shortDescription, ruleset });
			}
		});

		getElement('lobby-edit-zone', HTMLButtonElement).addEventListener('click', () =>
		{
			if (this.universe?.lobbyZoneId)
			{
				this.selectTab('zones');
				void this.zonesTab.openZone(this.universe.lobbyZoneId);
			}
		});
	}

	/**
	 * Loads a universe and shows its Universe tab
	 *
	 * @param universeId The universe's ID
	 */
	async open(universeId: string): Promise<void>
	{
		const version = ++this.openVersion;

		this.universe = undefined;
		this.title.textContent = 'Edit Universe';
		this.role.textContent = '';
		this.hideNotice();
		this.selectTab('universe');

		let universe: EditableUniverse;

		try
		{
			universe = await this.api.getUniverse(universeId);
		}
		catch (error)
		{
			if (version === this.openVersion)
			{
				this.showNotice(describeEditorError(error, 'open the universe'));
			}

			return;
		}

		if (version !== this.openVersion)
		{
			return;
		}

		this.setUniverse(universe);
		this.universeTab.open(universe);
		this.tilesetsTab.open(universe);
		this.zonesTab.open(universe);
	}

	/**
	 * The ID of the universe being edited
	 *
	 * @return The ID, or undefined while none is loaded
	 */
	get universeId(): string | undefined
	{
		return(this.universe?.id);
	}

	/**
	 * Shows a message above the tabs until the next universe is opened
	 *
	 * @param message Text to show
	 */
	showNotice(message: string): void
	{
		showMessage(this.notice, message);
	}

	/**
	 * Hides the notice
	 */
	hideNotice(): void
	{
		showMessage(this.notice, undefined);
	}

	/**
	 * Remembers the universe being edited and shows its name and the player's role
	 *
	 * @param universe The universe
	 */
	private setUniverse(universe: EditableUniverse): void
	{
		this.universe = universe;
		this.title.textContent = `Edit ${universe.name}`;
		this.role.textContent = universe.role.replaceAll('_', ' ');
		this.zonesTab.setUniverse(universe);
	}

	/**
	 * Shows one tab and hides the others
	 *
	 * @param selected The tab to show
	 */
	private selectTab(selected: TabName): void
	{
		for (const name of tabNames)
		{
			const tab = getElement(`editor-tab-${name}`, HTMLButtonElement);

			tab.setAttribute('aria-selected', String(name === selected));
			getElement(`editor-panel-${name}`, HTMLElement).hidden = (name !== selected);
		}
	}
}
