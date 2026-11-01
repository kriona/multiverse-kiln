import { canEditWorld, UNIVERSE_ROLE_NAMES, type EditableUniverse, type UniverseSettingsUpdate, type UniverseSummary } from '@multiverse-kiln/shared';

import { t } from '../../localization';
import { describeEditorError, type EditorApi } from '../../network/editorApi';
import { editPageUrl, HOME_PAGE_URL } from '../../pages';
import { EditorsTab } from './EditorsTab';
import { closeOpenDialogs, getElement, setPageTitle, showMessage, titleLink } from '../dom';
import { CharactersTab } from './CharactersTab';
import { LobbyTab } from './LobbyTab';
import { ClassesSection } from './ClassesSection';
import { DifficultySection } from './DifficultySection';
import { ItemSelectDialog } from './ItemSelectDialog';
import { ItemsTab } from './ItemsTab';
import { RacesSection } from './RacesSection';
import { RulesetTab } from './RulesetTab';
import { combineTabs, SaveBar, type SavableTab } from './SaveBar';
import { ThemesSection } from './ThemesSection';
import { TilesetsTab } from './TilesetsTab';
import { UniverseTab } from './UniverseTab';
import { AreaSelectDialog } from './AreaSelectDialog';
import { AreasTab } from './AreasTab';

/**
 * The editor's tabs
 */
export const EDITOR_TABS = [
	'universe',
	'editors',
	'ruleset',
	'lobby',
	'characters',
	'tilesets',
	'areas',
	'items'
] as const;

export type EditorTab = typeof EDITOR_TABS[number];

/**
 * The order the tabs' changes are saved in: the Areas tab's maps can be painted with tiles the
 * Tilesets tab adds, so the Tilesets tab goes first and the Areas tab after it. The server checks every
 * change against the role the player had when the save began, so the Editors tab's changes to roles
 * can go anywhere
 */
const SAVE_ORDER: readonly EditorTab[] = [
	'tilesets',
	'items',
	'ruleset',
	'characters',
	'universe',
	'lobby',
	'areas',
	'editors'
];

/**
 * The tabs every role sees; the others are for roles that may change the world (canEditWorld())
 */
const SHARED_TABS: ReadonlySet<EditorTab> = new Set(['editors', 'universe']);

/**
 * Where in the editor the player is: the tab shown, and the area open in the area editor
 */
export interface EditorPlace
{
	tab: EditorTab;
	areaId: string | undefined;
}

/**
 * What the editor asks the page to do
 */
export interface EditorScreenActions
{
	/**
	 * Goes into the universe's lobby to play it
	 */
	play: (universe: UniverseSummary) => void;

	/**
	 * The player has moved to another tab or area, so the page's address can follow
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
 * Edit Universe: a universe's editors, settings, ruleset (and the difficulty levels), lobby, characters
 * (and their races, classes and, in a ruleset with them, themes), tiles, areas and items, in tabs
 *
 * What the player may see and change depends on their role in the universe; the server checks it again
 * on every change, so the page only hides controls that would be refused
 */
export class EditorScreen
{
	private readonly title = getElement('editor-title', HTMLElement);
	private readonly role = getElement('editor-role', HTMLElement);
	private readonly notice = getElement('editor-notice', HTMLElement);
	private readonly universeTab: UniverseTab;
	private readonly rulesetTab: RulesetTab;
	private readonly lobbyTab: LobbyTab;
	private readonly charactersTab: CharactersTab;
	private readonly racesSection: RacesSection;
	private readonly classesSection: ClassesSection;
	private readonly themesSection: ThemesSection;
	private readonly difficultySection: DifficultySection;
	private readonly tilesetsTab: TilesetsTab;
	private readonly areasTab: AreasTab;
	private readonly itemsTab: ItemsTab;
	private readonly editorsTab: EditorsTab;

	/**
	 * Saves every tab, which keep their changes on the page until then
	 */
	private readonly saveBar: SaveBar;

	/**
	 * What the save bar saves on each tab
	 */
	private readonly savableTabs: Record<EditorTab, SavableTab>;

	/**
	 * The universe being edited, once it has loaded
	 */
	private universe: EditableUniverse | undefined;

	private place: EditorPlace = { tab: 'universe', areaId: undefined };

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
		this.universeTab = new UniverseTab((update) =>
		{
			this.updateUniverse(update);
		});
		this.rulesetTab = new RulesetTab(api);
		this.lobbyTab = new LobbyTab((update) =>
		{
			this.updateUniverse(update);
		});

		this.tilesetsTab = new TilesetsTab(api);

		const areaSelect = new AreaSelectDialog(api, this.tilesetsTab);
		const itemSelect = new ItemSelectDialog(api);

		this.charactersTab = new CharactersTab(api, areaSelect, itemSelect, (update) =>
		{
			this.updateUniverse(update);
		});
		this.racesSection = new RacesSection(api, areaSelect, itemSelect);
		this.classesSection = new ClassesSection(api, areaSelect, itemSelect);
		this.themesSection = new ThemesSection(api);
		this.difficultySection = new DifficultySection(api);
		this.areasTab = new AreasTab(api, this.tilesetsTab, (areaId) =>
		{
			this.setPlace({ ...this.place, areaId });
		});
		this.itemsTab = new ItemsTab(api);
		this.editorsTab = new EditorsTab(api, {
			ownRoleChanged: () =>
			{
				if (this.universe)
				{
					void this.open(this.universe.id, this.place);
				}
			},
			left: () =>
			{
				window.location.assign(HOME_PAGE_URL);
			}
		});
		this.saveBar = new SaveBar(api, () => this.universe?.id, (tab) =>
		{
			const name = EDITOR_TABS.find((candidate) => (this.savableTabs[candidate] === tab));

			if (name !== undefined)
			{
				this.selectTab(name);
			}
		}, () =>
		{
			void this.areasTab.reloadTiles();
		});

		this.savableTabs = {
			editors: this.editorsTab,
			universe: this.universeTab,
			ruleset: combineTabs(this.rulesetTab, this.difficultySection),
			lobby: this.lobbyTab,
			characters: combineTabs(this.charactersTab, this.racesSection, this.classesSection, this.themesSection),
			tilesets: this.tilesetsTab,
			areas: this.areasTab,
			items: this.itemsTab
		};

		for (const name of SAVE_ORDER)
		{
			const tab = this.savableTabs[name];

			this.saveBar.add(tab, getElement(`editor-panel-${name}`, HTMLElement));
			tab.changes.subscribe((unsaved) =>
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

		getElement('editor-play', HTMLButtonElement).addEventListener('click', () =>
		{
			if (this.universe)
			{
				const { id, name, slug, shortDescription, ruleset } = this.universe;

				actions.play({ id, name, slug, shortDescription, ruleset });
			}
		});

		getElement('lobby-edit-area', HTMLButtonElement).addEventListener('click', () =>
		{
			if (this.universe?.lobbyAreaId)
			{
				this.selectTab('areas');
				void this.areasTab.openArea(this.universe.lobbyAreaId);
			}
		});
	}

	/**
	 * Loads a universe and shows it
	 *
	 * @param universeId The universe's ID
	 * @param place The tab to show and the area to open; the Universe tab when neither is given, or the
	 * Areas tab when only an area is
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

		this.place = { tab: (place.tab ?? ((place.areaId === undefined) ? 'universe' : 'areas')), areaId: place.areaId };
		this.setUniverse(universe);
		this.universeTab.open(universe);
		void this.rulesetTab.open(universe);
		this.lobbyTab.open(universe);
		this.charactersTab.open(universe);
		this.themesSection.open(universe);
		this.difficultySection.open(universe);
		this.racesSection.open(universe);
		this.classesSection.open(universe);
		this.tilesetsTab.open(universe);
		this.areasTab.open(universe, place.areaId);
		this.itemsTab.open(universe);
		this.editorsTab.open(universe);

		for (const name of EDITOR_TABS)
		{
			getElement(`editor-tab-${name}`, HTMLButtonElement).hidden = !this.canSeeTab(name);
		}

		this.selectTab(this.place.tab);
	}

	/**
	 * Whether the player's role shows a tab: beta testers and translators see only the editors and the
	 * universe's settings
	 *
	 * @param name The tab
	 * @return True when it does
	 */
	private canSeeTab(name: EditorTab): boolean
	{
		return(SHARED_TABS.has(name) || ((this.universe !== undefined) && canEditWorld(this.universe.role)));
	}

	/**
	 * The tabs the player's role shows, in order
	 *
	 * @return The tabs
	 */
	private visibleTabs(): EditorTab[]
	{
		return(EDITOR_TABS.filter((name) => this.canSeeTab(name)));
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
	 * Takes settings a tab saved as the universe's
	 *
	 * @param update The settings saved
	 */
	private updateUniverse(update: UniverseSettingsUpdate): void
	{
		if (this.universe)
		{
			this.setUniverse({ ...this.universe, ...update });
		}
	}

	/**
	 * Remembers the universe being edited and shows its name and the player's role
	 *
	 * @param universe The universe
	 */
	private setUniverse(universe: EditableUniverse): void
	{
		this.universe = universe;
		this.title.replaceChildren(titleLink(t({
			id: 'editor.universeTitle',
			defaultMessage: 'Edit {universe}',
			description: 'Heading of the world editor, linking to the editor\'s first tab; {universe} is the universe\'s name'
		}, {
			universe: universe.name
		}), editPageUrl(universe.id)));
		setPageTitle(t({
			id: 'editor.pageTitle',
			defaultMessage: 'Edit {universe}',
			description: 'The browser tab\'s title for the world editor, before the game engine\'s name; {universe} is the universe\'s name'
		}, {
			universe: universe.name
		}));
		this.role.textContent = t(UNIVERSE_ROLE_NAMES[universe.role]);
		this.areasTab.setUniverse(universe);
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
		const tabs = this.visibleTabs();
		const index = tabs.indexOf(current);
		const last = tabs.length - 1;
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
		this.selectTab(tabs[target]);
		getElement(`editor-tab-${tabs[target]}`, HTMLButtonElement).focus();
	}

	/**
	 * Shows one tab and hides the others. Only the tab shown is in the Tab key's order; the arrow keys
	 * move between tabs (see moveBetweenTabs). A tab the player's role doesn't show gives way to the
	 * Universe tab
	 *
	 * @param tab The tab to show
	 */
	private selectTab(tab: EditorTab): void
	{
		const selected = (this.canSeeTab(tab) ? tab : 'universe');

		for (const name of EDITOR_TABS)
		{
			const tab = getElement(`editor-tab-${name}`, HTMLButtonElement);

			tab.setAttribute('aria-selected', String(name === selected));
			tab.tabIndex = ((name === selected) ? 0 : -1);
			getElement(`editor-panel-${name}`, HTMLElement).hidden = (name !== selected);
		}

		this.saveBar.show(this.savableTabs[selected]);
		this.setPlace({ ...this.place, tab: selected });
	}

	/**
	 * Shows a tab and area the page's history went back or forward to, closing any dialog open over the
	 * place being left
	 *
	 * @param place The tab and area
	 * @return False when the player kept the unsaved changes of a dialog or the area editor, staying where they were
	 */
	showPlace(place: EditorPlace): boolean
	{
		if (!closeOpenDialogs())
		{
			return(false);
		}

		if ((place.areaId !== this.place.areaId) && !this.areasTab.showPlace(place.areaId))
		{
			return(false);
		}

		this.selectTab(place.tab);

		return(true);
	}

	/**
	 * Remembers where the player is in the editor and tells the page
	 *
	 * @param place The tab and area
	 */
	private setPlace(place: EditorPlace): void
	{
		this.place = place;
		this.actions.placeChanged(place);
	}
}
