import { ADMIN_ROLE, canEditAtEndOfTime, canEditWorld, canManageEditors, canManageVersions, canViewUniverse, detailsForVersionOpen, EDITOR_ROLE_NAMES, EDITOR_TABS, EDITOR_TWO_FACTOR_ERROR_ID, type EditableUniverse, type EditorSavedPayload, type EditorTab, type UniverseSettingsUpdate, type UniverseVersionName } from '@multiverse-kiln/shared';

import { t } from '../../localization';
import { announce } from '../announcer';
import type { AdminApi } from '../../network/adminApi';
import type { AuthApi } from '../../network/authApi';
import { describeEditorError, EditorApiError, errorId, errorValue, type EditorApi } from '../../network/editorApi';
import { changeMessages, hasUnsavedWork } from '../changeTracker';
import { DraftSection } from './DraftSection';
import { StartDraftDialog } from './StartDraftDialog';
import { editPageUrl, HOME_PAGE_URL, universePageUrl } from '../../pages';
import { readPlayerValue, rememberPlayerValue } from '../../rememberedValues';
import { AuditTab } from './AuditTab';
import { EditorsSettingsSection } from './EditorsSettingsSection';
import { EditorsTab } from './EditorsTab';
import { closeOpenDialogs, getElement, setPageTitle, showMessage, titleLink } from '../dom';
import { ScrollingTabs } from '../scrollingTabs';
import { CharacterListTab } from './CharacterListTab';
import { CharactersTab } from './CharactersTab';
import { CoinsSection } from './CoinsSection';
import { LobbyTab } from './LobbyTab';
import { ClassesSection } from './ClassesSection';
import { DifficultySection } from './DifficultySection';
import { ItemSelectDialog } from './ItemSelectDialog';
import { ItemsTab } from './ItemsTab';
import { RacesSection } from './RacesSection';
import { RulesetTab } from './RulesetTab';
import { combineTabs, SaveBar, type SavableTab } from './SaveBar';
import { showSaveNotice } from './saveNotices';
import { FormFollower, SETTINGS_FORMS, type FollowsOtherSaves, type OtherSave, type SettingsForm } from './otherSaves';
import type { ChangeSource } from './stagedChanges';
import { ThemesSection } from './ThemesSection';
import { TilesetsTab } from './TilesetsTab';
import { TranslationsTab } from './TranslationsTab';
import { TranslationTable } from './TranslationTable';
import { UniverseDeleteSection } from './UniverseDeleteSection';
import { UniverseExportSection } from './UniverseExportSection';
import { UniverseImportSection } from './UniverseImportSection';
import { UniverseTab } from './UniverseTab';
import type { AreaClaims } from './areaClaims';
import { AreaSelectDialog } from './AreaSelectDialog';
import { AreasTab } from './AreasTab';

/**
 * The order the tabs' changes are saved in: the Areas tab's areas can be painted with tiles the
 * Tilesets tab adds, so the Tilesets tab goes first and the Areas tab after it. The server checks every
 * change against the role the player had when the save began, so the Editors tab's changes to roles
 * can go anywhere. The Translations tab goes last, so the server checks translations and notes against
 * the text as the other tabs' changes leave it. The Character List and Audit tabs only list, so they
 * save nothing
 */
const SAVE_ORDER = [
	'tilesets',
	'items',
	'ruleset',
	'characters',
	'universe',
	'lobby',
	'areas',
	'editors',
	'translations'
] as const satisfies readonly EditorTab[];

/**
 * A tab with changes to save
 */
type SavableEditorTab = typeof SAVE_ORDER[number];

/**
 * Whether a tab has changes to save
 *
 * @param name The tab
 * @return True when it does
 */
function isSavableTab(name: EditorTab): name is SavableEditorTab
{
	return(SAVE_ORDER.some((tab) => (tab === name)));
}

/**
 * The tabs every role sees; the Audit tab is for roles that may manage the editors (canManageEditors()),
 * the Translations tab for translators as well, and the others for roles that may change the world
 * (canEditWorld())
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
	 * The player has moved to another tab or area, so the page's address can follow
	 */
	placeChanged: (place: EditorPlace) => void;

	/**
	 * The editor has opened another version of the universe, so the page's address can follow
	 */
	versionChanged: (version: UniverseVersionName) => void;

	/**
	 * The Areas tab has loaded the universe's areas, so areaName() knows their names
	 */
	areasLoaded: () => void;

	/**
	 * The universe requires its editors to have 2FA on and the player doesn't, so it didn't open
	 *
	 * @param message Why, in the player's language, naming the universe
	 * @param universeName The universe's name, or undefined when the server didn't give it
	 */
	twoFactorRequired: (message: string, universeName: string | undefined) => void;
}

/**
 * The notices above the tabs about the version open, which the player can dismiss: the draft is open,
 * or the live version of a universe with a draft is
 */
const VERSION_NOTICES = ['draft', 'liveWithDraft'] as const;

type VersionNotice = typeof VERSION_NOTICES[number];

/**
 * The key a dismissed notice about the version open is remembered under, for the player
 *
 * @param universeId The universe's ID
 * @param notice The notice
 * @return The key
 */
function versionNoticeKey(universeId: string, notice: VersionNotice): string
{
	return(`editor.versionNoticeDismissed.${universeId}.${notice}`);
}

/**
 * A tab's name as its button shows it, without the words screen readers hear for its unsaved changes
 *
 * @param name The tab
 * @return Its name in the player's language
 */
function tabName(name: EditorTab): string
{
	const button = getElement(`editor-tab-${name}`, HTMLButtonElement).cloneNode(true) as HTMLButtonElement;

	button.querySelector('.tab-changes')?.remove();

	return(button.textContent.trim());
}

/**
 * The editor's heading in its toolbar, naming the universe and linking to the editor's first tab
 *
 * @param universeId The universe's ID
 * @param name The universe's name
 * @return The link
 */
export function editorTitleLink(universeId: string, name: string): HTMLAnchorElement
{
	return(titleLink(t({
		id: 'editor.universeTitle',
		defaultMessage: 'Edit {universe}',
		description: 'Heading of the world editor, linking to the editor\'s first tab; {universe} is the universe\'s name'
	}, {
		universe: name
	}), editPageUrl(universeId)));
}

/**
 * Sets the browser tab's title to the editor's, naming the universe
 *
 * @param name The universe's name
 */
export function setEditorPageTitle(name: string): void
{
	setPageTitle(t({
		id: 'editor.pageTitle',
		defaultMessage: 'Edit {universe}',
		description: 'The browser tab\'s title for the world editor, before the game engine\'s name; {universe} is the universe\'s name'
	}, {
		universe: name
	}));
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
 * (and their races, classes and, in a ruleset with them, themes), the characters players have made,
 * tiles, areas, items, the record of saves and its languages, in tabs
 *
 * What the player may see and change depends on their role in the universe; the server checks it again
 * on every change, so the page only hides controls that would be refused
 */
export class EditorScreen
{
	private readonly title = getElement('editor-title', HTMLElement);
	private readonly role = getElement('editor-role', HTMLElement);
	private readonly notice = getElement('editor-notice', HTMLElement);
	private readonly connectionNotice = getElement('editor-connection-notice', HTMLElement);
	private readonly versionField = getElement('editor-version-field', HTMLElement);
	private readonly versionChoice = getElement('editor-version', HTMLSelectElement);
	private readonly screen = getElement('editor-screen', HTMLElement);
	private readonly versionNotice = getElement('editor-version-notice', HTMLElement);
	private readonly versionNoticeText = getElement('editor-version-notice-text', HTMLElement);
	private readonly versionNoticeDismiss = getElement('editor-version-notice-dismiss', HTMLButtonElement);

	/**
	 * Which notice about the version open shows above the tabs, if any, for its X to dismiss
	 */
	private versionNoticeKind: VersionNotice | undefined;
	private readonly startDraftButton = getElement('editor-start-draft', HTMLButtonElement);
	private readonly tabList = getElement('editor-tabs', HTMLElement);
	private readonly tabStrip = new ScrollingTabs(this.tabList, getElement('editor-tabs-back', HTMLButtonElement), getElement('editor-tabs-forward', HTMLButtonElement));
	private readonly universeTab: UniverseTab;
	private readonly universeDeleteSection: UniverseDeleteSection;
	private readonly universeExportSection: UniverseExportSection;
	private readonly universeImportSection: UniverseImportSection;
	private readonly draftSection: DraftSection;
	private readonly startDraftDialog: StartDraftDialog;
	private readonly rulesetTab: RulesetTab;
	private readonly coinsSection: CoinsSection;
	private readonly lobbyTab: LobbyTab;
	private readonly charactersTab: CharactersTab;
	private readonly characterListTab: CharacterListTab;
	private readonly racesSection: RacesSection;
	private readonly classesSection: ClassesSection;
	private readonly themesSection: ThemesSection;
	private readonly difficultySection: DifficultySection;
	private readonly tilesetsTab: TilesetsTab;
	private readonly areasTab: AreasTab;
	private readonly itemsTab: ItemsTab;
	private readonly editorsTab: EditorsTab;
	private readonly editorsSettings: EditorsSettingsSection;
	private readonly auditTab: AuditTab;
	private readonly translationsTab: TranslationsTab;
	private readonly translationTable: TranslationTable;

	/**
	 * Saves every tab, which keep their changes on the page until then
	 */
	private readonly saveBar: SaveBar;

	/**
	 * What the save bar saves on each tab
	 */
	private readonly savableTabs: Record<SavableEditorTab, SavableTab>;

	/**
	 * What keeps each tab up with saves made in other windows
	 */
	private readonly followers: Record<SavableEditorTab, readonly FollowsOtherSaves[]>;

	/**
	 * The settings forms waiting for the universe to load again, since a save changed their settings
	 * while they had no unsaved changes, each with what notes the save if they have some by the time
	 * it loads
	 */
	private readonly formsToReload = new Map<SettingsForm, () => void>();

	/**
	 * Each form holding the universe's settings: its unsaved changes, and what loads it from the universe
	 * as the server has it
	 */
	private readonly settingsForms: Record<SettingsForm, { changes: ChangeSource; open: (universe: EditableUniverse) => void }>;

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
	 * Saves made in other windows while a universe is loading, followed once it has loaded, since it may
	 * have loaded from before them
	 */
	private savesWhileOpening: EditorSavedPayload[] = [];

	/**
	 * What the save being taken as saved did to the player's own place in the universe: changed their
	 * role or languages, or left it. The editor follows it once every tab has taken its changes as saved,
	 * so the changes the other tabs saved don't count as unsaved
	 */
	private ownChangeSaved: 'role' | 'left' | undefined;

	/**
	 * @param api The editor's API
	 * @param actions What the screen's controls do
	 * @param accountApis The auth routes and the admin routes, which deleting the universe uses
	 */
	constructor(private readonly api: EditorApi, private readonly actions: EditorScreenActions, accountApis: { auth: AuthApi; admin: AdminApi })
	{
		this.universeTab = new UniverseTab((update) =>
		{
			this.updateUniverse(update);
		});
		this.universeDeleteSection = new UniverseDeleteSection(api, accountApis.auth, accountApis.admin, hasUnsavedWork);
		this.universeExportSection = new UniverseExportSection(api);
		this.universeImportSection = new UniverseImportSection(api, {
			canStart: () => ((this.universe !== undefined) && canManageVersions(this.universe.role) && !this.saveBar.isLocked()),
			hasUnsavedChanges: () => this.hasTabChanges(),
			// The save says the changes were saved only when there were some besides starting the draft
			start: () => this.draftSection.stageAndSave('start', this.hasTabChanges()),
			open: () => this.chooseVersion('draft'),
			imported: () =>
			{
				// The import may have made and deleted anything in the draft, the area open included
				this.switchVersion('draft');
			}
		});
		this.draftSection = new DraftSection(() => this.hasTabChanges(), (announce) => this.saveBar.save(announce), (action) =>
		{
			// Starting a draft opens it; applying or discarding one leaves only the live version
			this.switchVersion((action === 'start') ? 'draft' : 'live');
		});
		this.startDraftDialog = new StartDraftDialog(() =>
		{
			// The save says the changes were saved only when there were some besides starting the draft
			void this.draftSection.stageAndSave('start', this.hasTabChanges());
		});
		this.versionNoticeDismiss.addEventListener('click', () =>
		{
			this.dismissVersionNotice();
		});
		this.startDraftButton.addEventListener('click', () =>
		{
			this.startDraftDialog.open(this.hasTabChanges());
		});
		this.rulesetTab = new RulesetTab(api);
		this.coinsSection = new CoinsSection(() =>
		{
			this.charactersTab.coinsChanged(false);
		}, (update) =>
		{
			this.updateUniverse(update);
			this.charactersTab.coinsChanged(true);
		});
		this.tilesetsTab = new TilesetsTab(api);

		const areaSelect = new AreaSelectDialog(api, this.tilesetsTab);
		const itemSelect = new ItemSelectDialog(api);

		this.lobbyTab = new LobbyTab(api, areaSelect, (update) =>
		{
			this.updateUniverse(update);

			if (update.lobbyAreaId !== undefined)
			{
				this.areasTab.setLobbyArea(update.lobbyAreaId);
			}
		});

		this.charactersTab = new CharactersTab(api, areaSelect, itemSelect, () => this.coinsSection.abbreviations(), (update) =>
		{
			this.updateUniverse(update);
		});
		this.characterListTab = new CharacterListTab(api);
		this.auditTab = new AuditTab(api);
		this.translationTable = new TranslationTable(api);
		this.translationsTab = new TranslationsTab((update) =>
		{
			this.updateUniverse(update);

			if (this.universe)
			{
				this.translationTable.useUniverse(this.universe);
			}
		});
		this.racesSection = new RacesSection(api, areaSelect, itemSelect);
		this.classesSection = new ClassesSection(api, areaSelect, itemSelect);
		this.themesSection = new ThemesSection(api);
		this.difficultySection = new DifficultySection(api);
		this.areasTab = new AreasTab(api, this.tilesetsTab, (areaId) =>
		{
			this.setPlace({ ...this.place, areaId });
		}, () =>
		{
			actions.areasLoaded();
		}, () =>
		{
			this.selectTab('lobby');
			getElement('editor-tab-lobby', HTMLButtonElement).focus();
		});
		this.itemsTab = new ItemsTab(api);
		this.editorsTab = new EditorsTab(api, {
			ownRoleChanged: () =>
			{
				this.ownChangeSaved = 'role';
			},
			left: () =>
			{
				this.ownChangeSaved = 'left';
			}
		});
		this.editorsSettings = new EditorsSettingsSection((update) =>
		{
			this.updateUniverse(update);
		});
		this.saveBar = new SaveBar(api, () => this.universe, (tab) =>
		{
			const name = ((tab === this.draftSection) ? 'universe' : SAVE_ORDER.find((candidate) => (this.savableTabs[candidate] === tab)));

			if (name !== undefined)
			{
				this.selectTab(name);
			}
		}, (saved) =>
		{
			const own = this.ownChangeSaved;

			this.ownChangeSaved = undefined;

			if (own === 'left')
			{
				window.location.assign(HOME_PAGE_URL);
				return;
			}

			// Opening the universe again loads everything below
			if ((own === 'role') && this.accessChanged())
			{
				return;
			}

			void this.areasTab.reloadTiles();
			this.auditTab.reload();

			// A save of the Translations tab loads its table itself
			if (!saved.includes(this.savableTabs.translations))
			{
				this.translationTable.reload();
			}

			this.reloadSavedSettings();
		});

		this.savableTabs = {
			editors: combineTabs(this.editorsTab, this.editorsSettings),
			universe: this.universeTab,
			ruleset: combineTabs(this.rulesetTab, this.coinsSection, this.difficultySection),
			lobby: this.lobbyTab,
			characters: combineTabs(this.charactersTab, this.racesSection, this.classesSection, this.themesSection),
			tilesets: this.tilesetsTab,
			areas: this.areasTab,
			items: this.itemsTab,
			translations: combineTabs(this.translationTable, this.translationsTab)
		};

		this.settingsForms = {
			universe: {
				changes: this.universeTab.changes,
				open: (universe) =>
				{
					this.universeTab.open(universe);
				}
			},
			lobby: {
				changes: this.lobbyTab.changes,
				open: (universe) =>
				{
					this.lobbyTab.open(universe);
					this.areasTab.setLobbyArea(universe.lobbyAreaId);
				}
			},
			coins: {
				changes: this.coinsSection.changes,
				open: (universe) =>
				{
					this.coinsSection.open(universe);
					this.charactersTab.coinsChanged(true);
				}
			},
			characters: {
				changes: this.charactersTab.changes,
				open: (universe) =>
				{
					this.charactersTab.open(universe);
				}
			},
			translations: {
				changes: this.translationsTab.changes,
				open: (universe) =>
				{
					this.translationsTab.open(universe);
					this.translationTable.useUniverse(universe);
				}
			},
			editors: {
				changes: this.editorsSettings.changes,
				open: (universe) =>
				{
					this.editorsSettings.open(universe);
				}
			}
		};

		/**
		 * Keeps one of the forms holding the universe's settings up with saves made in other windows
		 *
		 * @param form The form
		 * @return Its follower
		 */
		const settingsForm = (form: SettingsForm): FormFollower => new FormFollower(getElement(`${form}-form`, HTMLFormElement), {
			subject: 'settings',
			fields: SETTINGS_FORMS[form].fields
		}, this.settingsForms[form].changes, (kept) =>
		{
			this.formsToReload.set(form, kept);
		});

		this.followers = {
			tilesets: [this.tilesetsTab],
			items: [this.itemsTab],
			ruleset: [
				new FormFollower(getElement('ruleset-form', HTMLFormElement), { subject: 'ruleset' }, this.rulesetTab.changes, () =>
				{
					if (this.universe)
					{
						void this.rulesetTab.open(this.universe);
					}
				}),
				settingsForm('coins'),
				this.difficultySection
			],
			characters: [settingsForm('characters'), this.racesSection, this.classesSection, this.themesSection],
			universe: [settingsForm('universe')],
			lobby: [settingsForm('lobby')],
			areas: [this.areasTab],
			editors: [this.editorsTab, settingsForm('editors')],
			translations: [settingsForm('translations'), this.translationTable]
		};

		for (const name of SAVE_ORDER)
		{
			const tab = this.savableTabs[name];

			this.saveBar.add(tab, getElement(`editor-panel-${name}`, HTMLElement));
			tab.changes.subscribe((unsaved) =>
			{
				this.markTab(name, (unsaved || ((name === 'universe') && this.draftSection.changes.hasUnsavedChanges())));
			});
		}

		// Starting, applying or discarding the draft saves after every other change
		this.saveBar.add(this.draftSection, getElement('editor-panel-universe', HTMLElement));
		this.draftSection.changes.subscribe((unsaved) =>
		{
			this.markTab('universe', (unsaved || this.universeTab.changes.hasUnsavedChanges()));
		});

		this.versionChoice.addEventListener('change', () =>
		{
			this.chooseVersion(this.versionChoice.value as UniverseVersionName);
		});

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

		// Saves heard of before now are in what loads
		this.savesWhileOpening = [];
		this.universe = undefined;
		this.api.forgetLists();
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
			// The draft may have been applied or discarded since the address was made, so the live version opens
			if ((version === this.openVersion) && (this.api.version === 'draft') && (error instanceof EditorApiError) && (error.status === 404))
			{
				this.api.version = 'live';
				this.actions.versionChanged('live');
				await this.open(universeId, { tab: place.tab, areaId: undefined });
				this.showNotice(error.message);
				return;
			}

			if ((version === this.openVersion) && (error instanceof EditorApiError) && (errorId(error.data) === EDITOR_TWO_FACTOR_ERROR_ID))
			{
				this.savesWhileOpening = [];
				this.actions.twoFactorRequired(error.message, errorValue(error.data, 'universe'));
				return;
			}

			if (version === this.openVersion)
			{
				this.savesWhileOpening = [];
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
		this.saveBar.setLocked(((universe.disabledReason !== null) && !universe.serverAdmin));
		this.showAccessNotice(universe);
		this.showVersion(universe);
		this.startDraftButton.hidden = (universe.hasDraft || !canManageVersions(universe.role) || this.saveBar.isLocked());

		this.universeTab.open(universe);
		this.universeDeleteSection.open(universe);
		this.universeExportSection.open(universe);
		this.universeImportSection.open(universe);
		this.draftSection.open(universe, this.saveBar.isLocked());
		void this.rulesetTab.open(universe);
		// Before the Characters tab, which writes its money in the abbreviations this shows
		this.coinsSection.open(universe);
		this.lobbyTab.open(universe);
		this.charactersTab.open(universe);
		this.characterListTab.open(universe);
		this.themesSection.open(universe);
		this.difficultySection.open(universe);
		this.racesSection.open(universe);
		this.classesSection.open(universe);
		this.tilesetsTab.open(universe);
		this.areasTab.open(universe, place.areaId);
		this.itemsTab.open(universe);
		this.editorsTab.open(universe);
		this.editorsSettings.open(universe);
		this.auditTab.open(universe);
		this.translationsTab.open(universe);
		this.translationTable.open(universe);

		for (const name of EDITOR_TABS)
		{
			getElement(`editor-tab-${name}`, HTMLButtonElement).hidden = !this.canSeeTab(name);
		}

		this.selectTab(this.place.tab);

		const saves = this.savesWhileOpening;

		this.savesWhileOpening = [];

		for (const saved of saves)
		{
			void this.otherSaved(saved);
		}
	}

	/**
	 * Whether the player's role shows a tab: beta testers see only the editors and the universe's
	 * settings, translators those and the translations, and only creators and site admins see the audit
	 *
	 * @param name The tab
	 * @return True when it does
	 */
	private canSeeTab(name: EditorTab): boolean
	{
		if (SHARED_TABS.has(name))
		{
			return(true);
		}

		if (this.universe === undefined)
		{
			return(false);
		}

		if ((name === 'translations') && (this.universe.role === 'translator'))
		{
			return(true);
		}

		return(((name === 'audit') ? canManageEditors(this.universe.role) : canEditWorld(this.universe.role)));
	}

	/**
	 * Every tab, in the order the page shows them
	 *
	 * @return The tabs
	 */
	private tabsInPageOrder(): EditorTab[]
	{
		return([...this.tabList.querySelectorAll('[role="tab"]')]
			.map((tab) => tab.id.slice('editor-tab-'.length))
			.filter(isEditorTab));
	}

	/**
	 * The tabs the player's role shows, in the order the page shows them
	 *
	 * @return The tabs
	 */
	private visibleTabs(): EditorTab[]
	{
		return(this.tabsInPageOrder().filter((name) => this.canSeeTab(name)));
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
	 * Says above the tabs when a server admin has disabled the universe, and why, when the universe is
	 * locked at the end of time and the player isn't one who may still change it, and when the player
	 * edits it with the site admin role
	 *
	 * @param universe The universe
	 */
	private showAccessNotice(universe: EditableUniverse): void
	{
		if ((universe.disabledReason !== null) && universe.serverAdmin)
		{
			this.showNotice(t({
				id: 'editor.universeDisabledAdmin',
				defaultMessage: 'The site\'s admins have disabled this universe, so it can\'t be played and its editors can\'t save. As a site admin, you can still save changes to it. Reason: {reason}',
				description: 'Shown above the editor\'s tabs to one of the site\'s admins for a universe the admins disabled; {reason} is the reason the admin gave, as they typed it'
			}, {
				reason: universe.disabledReason
			}));
		}
		else if (universe.disabledReason !== null)
		{
			this.showNotice(t({
				id: 'editor.universeDisabled',
				defaultMessage: 'The site\'s admins have disabled this universe, so it can\'t be played and changes to it can\'t be saved. You can still leave it on the Editors tab. Reason: {reason}',
				description: 'Shown above the editor\'s tabs for a universe one of the site\'s admins disabled, where the player can only save leaving it; {reason} is the reason the admin gave, as they typed it'
			}, {
				reason: universe.disabledReason
			}));
		}
		else if ((universe.stage === 'end_of_time') && !canEditAtEndOfTime(universe.role))
		{
			this.showNotice(t({
				id: 'editor.universeLocked',
				defaultMessage: 'This universe has reached the end of time, so only its creators can change it. You can still leave it on the Editors tab.',
				description: 'Shown above the editor\'s tabs to a builder, beta tester or translator of a universe in the stage end of time, which locks it'
			}));
		}
		else if (universe.role === ADMIN_ROLE)
		{
			this.showNotice(t({
				id: 'editor.editingAsAdmin',
				defaultMessage: 'You are editing this universe as a site admin: you can change everything a creator can.',
				description: 'Shown above the editor\'s tabs to one of the site\'s admins who opened a universe they have no stronger role in, which they edit with the site admin role'
			}));
		}
	}

	/**
	 * Loads the universe again after what the player may do in it changed (their role, its stage, whether
	 * the site's admins have disabled it, or whether they have 2FA on, which a creator needs to require
	 * it), on the tab and area showing. While anything is unsaved it only says so, since loading again
	 * would throw the changes away
	 *
	 * @return True when the universe loads again
	 */
	accessChanged(): boolean
	{
		return(this.reloadUniverse(t({
			id: 'editor.accessChanged',
			defaultMessage: 'What you can do in this universe has changed: your role, its stage, whether the site\'s admins have disabled it, or whether you have two-factor authentication on. Save or undo your changes, then reload the page to see what you can do now.',
			description: 'Shown above the editor\'s tabs when the player\'s role in the universe, its stage or whether the site\'s admins disabled it changed, or the player turned two-factor authentication on or off, while they had unsaved changes, which loading the universe again would throw away'
		})));
	}

	/**
	 * Loads the universe again on the tab and area showing, or, while anything is unsaved, says why it
	 * should be, since loading again would throw the changes away
	 *
	 * @param unsavedMessage What to say above the tabs while anything is unsaved, in the player's language
	 * @return True when the universe loads again
	 */
	private reloadUniverse(unsavedMessage: string): boolean
	{
		if (!this.universe)
		{
			return(false);
		}

		if (hasUnsavedWork())
		{
			this.showNotice(unsavedMessage);
			return(false);
		}

		void this.open(this.universe.id, this.place);
		return(true);
	}

	/**
	 * Follows a save made in another window, once the universe has loaded (a save heard of while it
	 * loads waits for it): lists the saves on the Audit tab again (once the tab shows), updates what the
	 * save changed that this window has no unsaved changes to, marks what it has them to, and says who
	 * saved what, once the painting it made to the area open is taken into its cells. Of a save to the
	 * other version, it follows only what the universe holds once (detailsForVersionOpen()). Starting,
	 * applying or discarding the draft changes the whole universe, which loads again, or says to reload
	 * while anything is unsaved
	 *
	 * @param heard The save, with everything it changed that the player's role shows
	 */
	async otherSaved(heard: EditorSavedPayload): Promise<void>
	{
		const universe = this.universe;

		if (!universe)
		{
			this.savesWhileOpening.push(heard);
			return;
		}

		const saved: EditorSavedPayload = {
			...heard,
			details: detailsForVersionOpen(heard.details, heard.version, this.api.version)
		};

		this.auditTab.otherSaved();

		if (saved.details.length === 0)
		{
			return;
		}

		// Before the tabs follow the save, so the lists they load again are the saved ones
		this.api.forgetLists();

		if (saved.details.some((detail) => (detail.subject === 'draft')))
		{
			showSaveNotice(saved, universe.ruleset, []);
			this.reloadUniverse(t({
				id: 'editor.draftChangedElsewhere',
				defaultMessage: 'Another editor started, applied or discarded the universe\'s draft. Save or undo your changes, then reload the page to see the universe as it now is.',
				description: 'Shown above the editor\'s tabs when another editor started, applied or discarded the universe\'s draft (a copy players don\'t see) while the player had unsaved changes, which loading the universe again would throw away'
			}));
			return;
		}

		const save: OtherSave = {
			name: saved.name,
			details: saved.details
		};
		const kept: string[] = [];

		this.formsToReload.clear();

		for (const name of this.tabsInPageOrder())
		{
			// Every part follows the save, even once one has kept changes
			if (isSavableTab(name) && this.followers[name].map((follower) => follower.otherSaved(save)).includes(true))
			{
				kept.push(tabName(name));
			}
		}

		if (saved.details.some((detail) => ((detail.subject === 'tile') || (detail.subject === 'tileset'))))
		{
			void this.areasTab.reloadTiles();
		}

		void this.reloadSettings();
		showSaveNotice(saved, universe.ruleset, kept, await this.areasTab.followPainting(save));
	}

	/**
	 * Loads the forms holding the universe's settings again after this window saved, those without
	 * unsaved changes, since the save kept the settings other editors saved that this window didn't change
	 */
	private reloadSavedSettings(): void
	{
		for (const form of Object.keys(this.settingsForms) as SettingsForm[])
		{
			if (!this.settingsForms[form].changes.hasUnsavedChanges())
			{
				// The save was this window's, so a form changed while the settings load has nothing to note
				this.formsToReload.set(form, () => undefined);
			}
		}

		void this.reloadSettings();
	}

	/**
	 * Loads the universe's settings again for the forms waiting for them (formsToReload), and shows them
	 * there. A form that has unsaved changes by the time they arrive keeps them, noting the save, and
	 * the other forms keep the settings this window has, unsaved changes included
	 */
	private async reloadSettings(): Promise<void>
	{
		const forms = new Map(this.formsToReload);
		const current = this.universe;
		const version = this.openVersion;

		this.formsToReload.clear();

		if ((forms.size === 0) || !current)
		{
			return;
		}

		let saved: EditableUniverse;

		try
		{
			saved = await this.api.getUniverse(current.id);
		}
		catch
		{
			// The forms keep the settings they show until the universe is next loaded
			return;
		}

		const shown = this.universe;

		if ((version !== this.openVersion) || !shown)
		{
			return;
		}

		for (const [form, kept] of forms)
		{
			if (this.settingsForms[form].changes.hasUnsavedChanges())
			{
				forms.delete(form);
				kept();
			}
		}

		const keptSettings = Object.fromEntries(Object.entries(SETTINGS_FORMS)
			.filter(([form]) => !forms.has(form as SettingsForm))
			.flatMap(([, { keys }]) => keys.map((key) => [key, shown[key]])));
		const universe: EditableUniverse = {
			...saved,
			...keptSettings
		};

		this.setUniverse(universe);

		for (const form of Object.keys(SETTINGS_FORMS) as SettingsForm[])
		{
			if (forms.has(form))
			{
				this.settingsForms[form].open(universe);
			}
		}
	}

	/**
	 * Turns saving off for good and says why, once the player may no longer open the universe's editor
	 *
	 * @param message Why, in the player's language
	 */
	lockOut(message: string): void
	{
		this.saveBar.setLocked(true);
		this.universeDeleteSection.lock();
		this.universeExportSection.lock();
		this.universeImportSection.lock();
		this.showNotice(message);
	}

	/**
	 * Says above the tabs, and reads out, that the page isn't connected to the universe's editor room, so
	 * the tabs don't follow what other windows save. It shows until the page is reloaded, whichever
	 * universe or version is opened
	 */
	showDisconnected(): void
	{
		const message = t({
			id: 'editor.disconnected',
			defaultMessage: 'This window isn\'t connected to the other editors, so changes saved in other windows don\'t show here and the editors\' chat is off. Save your changes, then reload the page to connect again.',
			description: 'Shown above the editor\'s tabs, and read out by screen readers, when the page couldn\'t connect to the server\'s room for the universe\'s editors or lost its connection to it; saving still works'
		});

		showMessage(this.connectionNotice, message);
		announce(message, true);
	}

	/**
	 * Keeps the save bar showing while it lists other editors, even on a tab with nothing to save
	 *
	 * @param shown Whether it lists any
	 */
	setOthersHere(shown: boolean): void
	{
		this.saveBar.setOthersHere(shown);
	}

	/**
	 * Shows who else is editing each area of the version open, on the Areas tab
	 *
	 * @param claims Who else has each area open, from areaClaims()
	 */
	setAreaClaims(claims: AreaClaims): void
	{
		this.areasTab.setClaims(claims);
	}

	/**
	 * Shows who else has unsaved work on the draft, which applying or discarding it warns about
	 *
	 * @param names Their display names, from unsavedDraftEditors()
	 */
	setUnsavedDraftEditors(names: readonly string[]): void
	{
		this.draftSection.setUnsavedEditors(names);
	}

	/**
	 * The name of an area of the version of the universe open, once the Areas tab has loaded them
	 *
	 * @param version The version the area is in, live or draft
	 * @param areaId The area's ID
	 * @return Its name, or undefined when it isn't known here, such as for an area of the other version
	 */
	areaName(version: string, areaId: string): string | undefined
	{
		return(((version === this.api.version) ? this.areasTab.areaName(areaId) : undefined));
	}

	/**
	 * Hides the notice
	 */
	hideNotice(): void
	{
		showMessage(this.notice, undefined);
	}

	/**
	 * Shows which version of the universe is open, with the choice of the other while it has a draft, and
	 * says what saving it does: the draft reaches no player until it is applied, and changes saved to the
	 * live version while there is a draft are replaced when it is applied
	 *
	 * @param universe The universe
	 */
	private showVersion(universe: EditableUniverse): void
	{
		const kind = ((universe.version === 'draft') ? 'draft' : (universe.hasDraft ? 'liveWithDraft' : undefined));

		this.versionField.hidden = !universe.hasDraft;
		this.versionChoice.value = universe.version;
		this.versionNoticeKind = kind;

		// The tabs and the save bar are drawn in the draft's purple while it is open (edit.scss)
		this.screen.classList.toggle('editing-draft', (universe.version === 'draft'));

		// The draft is gone, so a new one shows both notices again
		if (!universe.hasDraft)
		{
			for (const each of VERSION_NOTICES)
			{
				rememberPlayerValue(versionNoticeKey(universe.id, each), null);
			}
		}

		switch (kind)
		{
			case 'draft':
				this.versionNoticeText.textContent = t({
					id: 'editor.version.draftNotice',
					defaultMessage: 'You are editing the draft version of this universe. Players will not see changes until they are applied.',
					description: 'Shown above the editor\'s tabs while the universe\'s draft (a copy players don\'t see) is open, until the player dismisses it'
				});
				break;

			case 'liveWithDraft':
				this.versionNoticeText.textContent = t({
					id: 'editor.version.liveWithDraftNotice',
					defaultMessage: 'You are editing the live version of this universe. The universe has a draft: changes saved here are replaced when the draft is applied unless they are also made in the draft.',
					description: 'Shown above the editor\'s tabs while the live version of a universe with a draft is open, until the player dismisses it'
				});
				break;

			default:
				this.versionNoticeText.textContent = '';
		}

		this.versionNotice.hidden = ((kind === undefined) || (readPlayerValue(versionNoticeKey(universe.id, kind)) !== null));
	}

	/**
	 * Hides the notice about the version open, for this universe until it no longer has a draft, and
	 * moves focus to the tab showing, since the notice's X goes with it
	 */
	private dismissVersionNotice(): void
	{
		if (this.universe && this.versionNoticeKind)
		{
			rememberPlayerValue(versionNoticeKey(this.universe.id, this.versionNoticeKind), 'dismissed');
		}

		this.versionNotice.hidden = true;
		this.tabList.querySelector<HTMLElement>('[aria-selected="true"]')?.focus();
	}

	/**
	 * Whether any tab has changes that haven't been saved, other than what is staged for the draft
	 *
	 * @return True when one has
	 */
	private hasTabChanges(): boolean
	{
		return(SAVE_ORDER.some((name) => this.savableTabs[name].changes.hasUnsavedChanges()));
	}

	/**
	 * Opens the version the player chose beside their role, after asking whether to throw away unsaved
	 * changes, which belong to the version open
	 *
	 * @param version The version
	 * @return Whether the version opens: false when it is open already, or the player keeps their changes
	 */
	private chooseVersion(version: UniverseVersionName): boolean
	{
		if ((version === this.api.version) || !this.universe)
		{
			return(false);
		}

		if (hasUnsavedWork() && !window.confirm(t(changeMessages.discardChanges)))
		{
			this.versionChoice.value = this.api.version;
			return(false);
		}

		this.switchVersion(version);
		return(true);
	}

	/**
	 * Opens another version of the universe on the tab showing. The area open stays closed, since the
	 * versions' areas have IDs of their own
	 *
	 * @param version The version
	 */
	private switchVersion(version: UniverseVersionName): void
	{
		const universe = this.universe;

		if (!universe)
		{
			return;
		}

		closeOpenDialogs();
		this.api.version = version;
		this.actions.versionChanged(version);
		this.setPlace({ tab: this.place.tab, areaId: undefined });
		void this.open(universe.id, this.place);
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
		this.title.replaceChildren(editorTitleLink(universe.id, universe.name));
		setEditorPageTitle(universe.name);
		this.role.textContent = t(EDITOR_ROLE_NAMES[universe.role]);
		this.showViewLink(universe);
		this.areasTab.setUniverse(universe);
		getElement('lobby-edit-area', HTMLButtonElement).hidden = (universe.lobbyAreaId === null);
	}

	/**
	 * Points View Universe at the universe's page, by ID, since a rename saved here changes its slug.
	 * Hidden while the universe has no page for the player: while it is disabled, and in a stage their
	 * role doesn't let them view it in. A server admin's own role in the universe isn't known here, so
	 * the site admin role always sees it
	 *
	 * @param universe The universe
	 */
	private showViewLink(universe: EditableUniverse): void
	{
		const link = getElement('editor-view', HTMLAnchorElement);
		const viewable = ((universe.disabledReason === null) && ((universe.role === ADMIN_ROLE) || canViewUniverse(universe.stage, universe.role)));

		link.hidden = !viewable;

		if (viewable)
		{
			link.href = universePageUrl(universe.id);
		}
		else
		{
			link.removeAttribute('href');
		}
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

		// A save may have disabled or renamed areas since the Lobby tab showed them; the areas are only
		// loaded again after one (see EditorApi.sendShared()). Opening a universe on the Lobby tab has
		// just loaded them
		if ((selected === 'lobby') && (this.place.tab !== 'lobby'))
		{
			this.lobbyTab.refreshAreas();
		}

		for (const name of EDITOR_TABS)
		{
			const tab = getElement(`editor-tab-${name}`, HTMLButtonElement);

			tab.setAttribute('aria-selected', String(name === selected));
			tab.tabIndex = ((name === selected) ? 0 : -1);
			getElement(`editor-panel-${name}`, HTMLElement).hidden = (name !== selected);
		}

		this.tabStrip.reveal(getElement(`editor-tab-${selected}`, HTMLButtonElement));
		this.auditTab.setVisible(selected === 'audit');
		this.translationTable.setVisible(selected === 'translations');

		this.saveBar.show((isSavableTab(selected) ? this.savableTabs[selected] : undefined));
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
