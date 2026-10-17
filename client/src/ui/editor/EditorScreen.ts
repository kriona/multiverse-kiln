import { UNIVERSE_ROLE_NAMES, type EditableUniverse, type UniverseSummary } from '@multiverse-kiln/shared';

import { t } from '../../localization';
import { describeEditorError, type EditorApi } from '../../network/editorApi';
import type { ChangeTracker } from '../changeTracker';
import { getElement, showMessage } from '../dom';
import { CharactersTab } from './CharactersTab';
import { ClassesTab } from './ClassesTab';
import { ItemSelectDialog } from './ItemSelectDialog';
import { ItemsTab } from './ItemsTab';
import { RacesTab } from './RacesTab';
import { RulesetTab } from './RulesetTab';
import { TilesetsTab } from './TilesetsTab';
import { UniverseTab } from './UniverseTab';
import { ZoneSelectDialog } from './ZoneSelectDialog';
import { ZonesTab } from './ZonesTab';

/**
 * The editor's tabs
 */
export const EDITOR_TABS = [
	'universe',
	'ruleset',
	'lobby',
	'characters',
	'races',
	'classes',
	'tilesets',
	'zones',
	'items'
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
 * Edit Universe: a universe's settings, ruleset, characters, races, classes, tiles, zones and items, in tabs
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
	private readonly rulesetTab: RulesetTab;
	private readonly charactersTab: CharactersTab;
	private readonly racesTab: RacesTab;
	private readonly classesTab: ClassesTab;
	private readonly tilesetsTab: TilesetsTab;
	private readonly zonesTab: ZonesTab;
	private readonly itemsTab: ItemsTab;

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
		this.rulesetTab = new RulesetTab(api);

		const zoneSelect = new ZoneSelectDialog(api);
		const itemSelect = new ItemSelectDialog(api);

		this.charactersTab = new CharactersTab(api, zoneSelect, itemSelect, (universe) =>
		{
			this.setUniverse(universe);
		});
		this.racesTab = new RacesTab(api, zoneSelect, itemSelect);
		this.classesTab = new ClassesTab(api, zoneSelect, itemSelect);
		this.tilesetsTab = new TilesetsTab(api);
		this.zonesTab = new ZonesTab(api, (zoneId) =>
		{
			this.setPlace({ ...this.place, zoneId });
		});
		this.itemsTab = new ItemsTab(api);

		const trackedTabs: [EditorTab, ChangeTracker][] = [
			['universe', this.universeTab.changes],
			['ruleset', this.rulesetTab.changes],
			['characters', this.charactersTab.changes],
			['zones', this.zonesTab.changes]
		];

		for (const [name, changes] of trackedTabs)
		{
			changes.subscribe((unsaved) =>
			{
				this.markTab(name, unsaved);
			});
		}

		for (const name of EDITOR_TABS)
		{
			const tab = getElement(`editor-tab-${name}`, HTMLButtonElement);

			tab.addEventListener('click', () =>
			{
				this.selectTab(name);
			});

			tab.addEventListener('keydown', (event) =>
			{
				this.moveBetweenTabs(event, name);
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
		void this.rulesetTab.open(universe);
		this.charactersTab.open(universe);
		this.racesTab.open(universe);
		this.classesTab.open(universe);
		this.tilesetsTab.open(universe);
		this.zonesTab.open(universe, place.zoneId);
		this.itemsTab.open(universe);
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
	 * Marks a tab whose form has changes that haven't been saved, with a dot and, for screen readers,
	 * words after the tab's name, so they aren't forgotten on a tab out of view
	 *
	 * @param name The tab
	 * @param unsaved Whether its form has unsaved changes
	 */
	private markTab(name: EditorTab, unsaved: boolean): void
	{
		const tab = getElement(`editor-tab-${name}`, HTMLButtonElement);
		const marker = tab.querySelector('.tab-changes');

		if (!unsaved)
		{
			marker?.remove();
			return;
		}

		if (marker)
		{
			return;
		}

		const added = document.createElement('span');
		const text = document.createElement('span');

		added.className = 'tab-changes';
		text.className = 'visually-hidden';
		text.textContent = t({
			id: 'editor.tab.unsavedChanges',
			defaultMessage: '(unsaved changes)',
			description: 'Read out by screen readers after the name of an editor tab whose form has changes that haven\'t been saved; a dot shows it on screen'
		});
		added.append(text);
		tab.append(added);
	}

	/**
	 * Moves to the tab before or after with the arrow keys, or the first or last with Home and End, as
	 * tabs do in the platform's own tab lists
	 *
	 * @param event The key press on a tab
	 * @param current The tab pressed on
	 */
	private moveBetweenTabs(event: KeyboardEvent, current: EditorTab): void
	{
		const index = EDITOR_TABS.indexOf(current);
		const last = EDITOR_TABS.length - 1;
		const targets: Record<string, number> = {
			ArrowLeft: ((index === 0) ? last : (index - 1)),
			ArrowRight: ((index === last) ? 0 : (index + 1)),
			Home: 0,
			End: last
		};
		const target = targets[event.key];

		if ((target === undefined) || event.altKey || event.ctrlKey || event.metaKey)
		{
			return;
		}

		event.preventDefault();
		this.selectTab(EDITOR_TABS[target]);
		getElement(`editor-tab-${EDITOR_TABS[target]}`, HTMLButtonElement).focus();
	}

	/**
	 * Shows one tab and hides the others. Only the tab shown is in the Tab key's order; the arrow keys
	 * move between tabs (see moveBetweenTabs)
	 *
	 * @param selected The tab to show
	 */
	private selectTab(selected: EditorTab): void
	{
		for (const name of EDITOR_TABS)
		{
			const tab = getElement(`editor-tab-${name}`, HTMLButtonElement);

			tab.setAttribute('aria-selected', String(name === selected));
			tab.tabIndex = ((name === selected) ? 0 : -1);
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
