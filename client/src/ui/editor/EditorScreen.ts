import { UNIVERSE_ROLE_NAMES, type EditableUniverse, type UniverseSummary } from '@multiverse-kiln/shared';

import { t } from '../../localization';
import { describeEditorError, type EditorApi } from '../../network/editorApi';
import { getElement, showMessage } from '../dom';
import { TilesetsTab } from './TilesetsTab';
import { UniverseTab } from './UniverseTab';
import { ZonesTab } from './ZonesTab';

/**
 * The editor's tabs
 */
export const EDITOR_TABS = [
	'universe',
	'lobby',
	'tilesets',
	'zones'
] as const;

export type EditorTab = typeof EDITOR_TABS[number];

/**
 * Where in the editor the player is: the tab shown, and the zone open in the zone editor
 */
export interface EditorPlace
{
	tab: EditorTab;
	zoneId: string | undefined;
}

/**
 * What the editor asks the page to do
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

	/**
	 * The player has moved to another tab or zone, so the page's address can follow
	 */
	placeChanged: (place: EditorPlace) => void;
}

/**
 * Whether a value names one of the editor's tabs
 *
 * @param value The value, e.g. from the page's address
 * @return True when it does
 */
export function isEditorTab(value: string | undefined): value is EditorTab
{
	return(EDITOR_TABS.some((tab) => (tab === value)));
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

	private place: EditorPlace = { tab: 'universe', zoneId: undefined };

	/**
	 * Changes every time a universe is opened, so one that arrives for an earlier open is ignored
	 */
	private openVersion = 0;

	/**
	 * @param api The editor's API
	 * @param actions What the screen's controls do
	 */
	constructor(private readonly api: EditorApi, private readonly actions: EditorScreenActions)
	{
		this.universeTab = new UniverseTab(api, (universe) =>
		{
			this.setUniverse(universe);
		});
		this.tilesetsTab = new TilesetsTab(api);
		this.zonesTab = new ZonesTab(api, (zoneId) =>
		{
			this.setPlace({ ...this.place, zoneId });
		});

		for (const name of EDITOR_TABS)
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
	 * Loads a universe and shows it
	 *
	 * @param universeId The universe's ID
	 * @param place The tab to show and the zone to open; the Universe tab when neither is given, or the
	 * Zones tab when only a zone is
	 */
	async open(universeId: string, place: Partial<EditorPlace> = {}): Promise<void>
	{
		const version = ++this.openVersion;

		this.universe = undefined;
		this.title.textContent = t({
			id: 'editor.title',
			defaultMessage: 'Edit Universe',
			description: 'Heading of the world editor until the universe\'s name has loaded'
		});
		this.role.textContent = '';
		this.hideNotice();

		let universe: EditableUniverse;

		try
		{
			universe = await this.api.getUniverse(universeId);
		}
		catch (error)
		{
			if (version === this.openVersion)
			{
				this.showNotice(describeEditorError(error, {
					id: 'editor.openFailed',
					defaultMessage: 'Could not open the universe.',
					description: 'Shown in the editor when the universe couldn\'t be loaded'
				}));
			}

			return;
		}

		if (version !== this.openVersion)
		{
			return;
		}

		this.place = { tab: (place.tab ?? ((place.zoneId === undefined) ? 'universe' : 'zones')), zoneId: place.zoneId };
		this.setUniverse(universe);
		this.universeTab.open(universe);
		this.tilesetsTab.open(universe);
		this.zonesTab.open(universe, place.zoneId);
		this.selectTab(this.place.tab);
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
		this.title.textContent = t({
			id: 'editor.universeTitle',
			defaultMessage: 'Edit {universe}',
			description: 'Heading of the world editor; {universe} is the universe\'s name'
		}, { universe: universe.name });
		document.title = t({
			id: 'editor.pageTitle',
			defaultMessage: 'Edit {universe} - Multiverse Kiln',
			description: 'The browser tab\'s title for the world editor; {universe} is the universe\'s name and Multiverse Kiln is the game engine\'s name'
		}, { universe: universe.name });
		this.role.textContent = t(UNIVERSE_ROLE_NAMES[universe.role]);
		this.zonesTab.setUniverse(universe);
	}

	/**
	 * Shows one tab and hides the others
	 *
	 * @param selected The tab to show
	 */
	private selectTab(selected: EditorTab): void
	{
		for (const name of EDITOR_TABS)
		{
			const tab = getElement(`editor-tab-${name}`, HTMLButtonElement);

			tab.setAttribute('aria-selected', String(name === selected));
			getElement(`editor-panel-${name}`, HTMLElement).hidden = (name !== selected);
		}

		this.setPlace({ ...this.place, tab: selected });
	}

	/**
	 * Remembers where the player is in the editor and tells the page
	 *
	 * @param place The tab and zone
	 */
	private setPlace(place: EditorPlace): void
	{
		this.place = place;
		this.actions.placeChanged(place);
	}
}
