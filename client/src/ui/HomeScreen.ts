import { DISALLOWED_TEXT_CHARACTERS, MAX_SHORT_DESCRIPTION_LENGTH, MAX_UNIVERSE_NAME_LENGTH, RULESET_NAMES, RULESETS, UNIVERSE_ROLE_NAMES, UNIVERSE_STAGE_NAMES, universeSlug, type EditableUniverseListPayload, type EditableUniverseSummary, type NewUniverseRequest, type Ruleset, type UniverseListPayload, type UniverseSummary } from '@multiverse-kiln/shared';

import { t } from '../localization';
import { describeEditorError } from '../network/editorApi';
import { editPageUrl, loginPageUrl, universePageUrl } from '../pages';
import { getElement, namedOptions, setOptions, setPageTitle, showMessage } from './dom';
import { clearFieldErrors, reportFieldError, setFieldError } from './fieldErrors';
import { formMessages } from './formMessages';

/**
 * What the Home screen asks the app to do
 */
export interface HomeScreenActions
{
	/**
	 * Fetches a page of universes, starting after the first `offset`
	 */
	loadPage: (offset: number) => Promise<UniverseListPayload>;

	/**
	 * Fetches the universes the player has a role in
	 */
	loadOwnUniverses: () => Promise<EditableUniverseListPayload>;

	/**
	 * Creates a universe, resolving with its ID
	 */
	createUniverse: (universe: NewUniverseRequest) => Promise<string>;

	/**
	 * Opens a universe in the editor
	 */
	edit: (universeId: string) => void;

	/**
	 * Logs the browser out. The session room then says so, which shows the screen again logged out
	 */
	logOut: () => Promise<void>;
}

/**
 * Home: the universes to play in, a page at a time, each linking to its page; the universes the player
 * works on, and creating a universe
 */
export class HomeScreen
{
	private readonly ownList = getElement('own-universe-list', HTMLUListElement);
	private readonly ownEmpty = getElement('own-universe-empty', HTMLElement);
	private readonly createButton = getElement('create-universe', HTMLButtonElement);
	private readonly createDialog = getElement('create-universe-dialog', HTMLDialogElement);
	private readonly createForm = getElement('create-universe-form', HTMLFormElement);
	private readonly createName = getElement('create-universe-name', HTMLInputElement);
	private readonly createDescription = getElement('create-universe-description', HTMLInputElement);
	private readonly createRuleset = getElement('create-universe-ruleset', HTMLSelectElement);
	private readonly createError = getElement('create-universe-error', HTMLElement);
	private readonly createSubmit = getElement('create-universe-submit', HTMLButtonElement);
	private readonly playerName = getElement('home-player-name', HTMLElement);
	private readonly playingAs = getElement('home-playing-as', HTMLElement);
	private readonly logOutButton = getElement('home-log-out', HTMLButtonElement);
	private readonly logInLink = getElement('home-log-in', HTMLAnchorElement);
	private readonly ownUniverses = getElement('own-universes', HTMLElement);
	private readonly notice = getElement('home-notice', HTMLElement);
	private readonly list = getElement('universe-list', HTMLUListElement);
	private readonly empty = getElement('universe-empty', HTMLElement);
	private readonly moreButton = getElement('universe-more', HTMLButtonElement);

	/**
	 * How many universes are listed, which is where the next page starts
	 */
	private listed = 0;

	/**
	 * Changes every time the list starts over, so a page that arrives for an older list is ignored
	 */
	private listVersion = 0;

	/**
	 * @param actions What the screen's controls do
	 */
	constructor(private readonly actions: HomeScreenActions)
	{
		this.moreButton.addEventListener('click', () =>
		{
			void this.loadPage();
		});

		this.logInLink.href = loginPageUrl();

		this.logOutButton.addEventListener('click', () =>
		{
			void this.logOut();
		});

		this.createName.maxLength = MAX_UNIVERSE_NAME_LENGTH;
		this.createDescription.maxLength = MAX_SHORT_DESCRIPTION_LENGTH;

		this.createButton.addEventListener('click', () =>
		{
			this.openCreateDialog();
		});

		getElement('create-universe-cancel', HTMLButtonElement).addEventListener('click', () =>
		{
			this.createDialog.close();
		});

		for (const field of [this.createName, this.createDescription])
		{
			field.addEventListener('input', () =>
			{
				setFieldError(field, undefined);
			});
		}

		this.createForm.addEventListener('submit', (event) =>
		{
			event.preventDefault();
			void this.createUniverse();
		});
	}

	/**
	 * Gets the screen ready to be shown, listing the universes afresh. A player who is logged in sees
	 * their own universes too, and can log out; anyone else is offered the login page
	 *
	 * @param playerName The player's name, or null when the browser isn't logged in
	 */
	show(playerName: string | null): void
	{
		const loggedIn = (playerName !== null);

		setPageTitle(t({
			id: 'home.pageTitle',
			defaultMessage: 'Universes',
			description: 'The browser tab\'s title while Home lists the universes, before the game engine\'s name'
		}));
		this.playerName.textContent = (playerName ?? '');
		this.playingAs.hidden = !loggedIn;
		this.logOutButton.hidden = !loggedIn;
		this.logOutButton.disabled = false;
		this.logInLink.hidden = loggedIn;
		this.ownUniverses.hidden = !loggedIn;
		this.listed = 0;
		this.listVersion++;
		this.list.replaceChildren();
		this.empty.hidden = true;
		this.moreButton.hidden = true;
		this.ownList.replaceChildren();
		this.ownEmpty.hidden = true;
		void this.loadPage();

		if (loggedIn)
		{
			void this.loadOwnUniverses(this.listVersion);
		}
	}

	/**
	 * Logs out, explaining above the list when it couldn't
	 */
	private async logOut(): Promise<void>
	{
		this.logOutButton.disabled = true;

		try
		{
			await this.actions.logOut();
		}
		catch (error)
		{
			this.logOutButton.disabled = false;
			this.showNotice(describeEditorError(error, {
				id: 'home.logOutFailed',
				defaultMessage: 'Could not log out.',
				description: 'Shown above the list of universes when the Log out button didn\'t work'
			}));
		}
	}

	/**
	 * Shows a message above the list until the screen is next shown
	 *
	 * @param message Text to show
	 */
	showNotice(message: string): void
	{
		this.notice.textContent = message;
		this.notice.hidden = false;
	}

	/**
	 * Hides the notice
	 */
	hideNotice(): void
	{
		this.notice.hidden = true;
	}

	/**
	 * Adds the next page of universes to the list
	 */
	private async loadPage(): Promise<void>
	{
		const version = this.listVersion;
		let page: UniverseListPayload;

		this.moreButton.disabled = true;

		try
		{
			page = await this.actions.loadPage(this.listed);
		}
		catch (error)
		{
			console.error('Could not list the universes:', error);
			this.showNotice(t({
				id: 'home.listFailed',
				defaultMessage: 'Could not list the universes. Reload the page to try again.',
				description: 'Shown on Home when the list of universes couldn\'t be loaded'
			}));
			return;
		}
		finally
		{
			this.moreButton.disabled = false;
		}

		if (version !== this.listVersion)
		{
			return;
		}

		this.list.append(...page.universes.map((universe) => this.createItem(universe)));
		this.listed += page.universes.length;
		this.empty.hidden = (this.listed > 0);
		this.moreButton.hidden = !page.hasMore;
	}

	/**
	 * A universe's entry in the list: its name, one-sentence description and ruleset, linking to its page
	 *
	 * @param universe The universe
	 * @return The list item
	 */
	private createItem(universe: UniverseSummary): HTMLLIElement
	{
		const item = document.createElement('li');
		const link = document.createElement('a');
		const name = document.createElement('strong');
		const description = document.createElement('span');
		const ruleset = document.createElement('span');

		link.className = 'button universe-item';
		link.href = universePageUrl(universe.slug);
		name.textContent = universe.name;
		description.textContent = universe.shortDescription;
		ruleset.className = 'universe-ruleset';
		ruleset.textContent = t(RULESET_NAMES[universe.ruleset]);

		link.append(name, description, ruleset);
		item.append(link);

		return(item);
	}

	/**
	 * Lists the universes the player works on, and allows creating one until they have created the most they may
	 *
	 * @param version The list's version when it was asked for; a list that arrives for an older one is ignored
	 */
	private async loadOwnUniverses(version: number): Promise<void>
	{
		let list: EditableUniverseListPayload;

		this.createButton.disabled = true;

		try
		{
			list = await this.actions.loadOwnUniverses();
		}
		catch (error)
		{
			if (version === this.listVersion)
			{
				this.showNotice(describeEditorError(error, {
					id: 'home.ownListFailed',
					defaultMessage: 'Could not list your universes.',
					description: 'Shown on Home when the list of universes the player can edit couldn\'t be loaded'
				}));
			}

			return;
		}

		if (version !== this.listVersion)
		{
			return;
		}

		const { universes, universeCreationEnabled, universesPerCreator } = list;
		const created = universes.filter((universe) => (universe.role === 'creator')).length;

		this.ownList.replaceChildren(...universes.map((universe) => this.createOwnItem(universe)));
		this.ownEmpty.hidden = (universes.length > 0);

		if (!universeCreationEnabled)
		{
			this.createButton.disabled = true;
			this.createButton.title = t({
				id: 'home.createDisabled',
				defaultMessage: 'Creating universes is turned off for now',
				description: 'Tooltip of the disabled Create Universe button when the site\'s admins have stopped everyone from creating universes'
			});
		}
		else if (created >= universesPerCreator)
		{
			this.createButton.disabled = true;
			this.createButton.title = t({
				id: 'home.createLimit',
				defaultMessage: 'You can create at most {max, plural, one {# universe} other {# universes}}',
				description: 'Tooltip of the disabled Create Universe button when the player has made as many universes as allowed'
			}, {
				max: universesPerCreator
			});
		}
		else
		{
			this.createButton.disabled = false;
			this.createButton.title = '';
		}
	}

	/**
	 * An entry in the player's own universes: its name, description, stage and the player's role, linking to the editor
	 *
	 * @param universe The universe
	 * @return The list item
	 */
	private createOwnItem(universe: EditableUniverseSummary): HTMLLIElement
	{
		const item = document.createElement('li');
		const link = document.createElement('a');
		const name = document.createElement('strong');
		const description = document.createElement('span');
		const details = document.createElement('span');

		link.className = 'button universe-item';
		link.href = editPageUrl(universe.id);
		name.textContent = universe.name;
		description.textContent = universe.shortDescription;
		details.className = 'universe-ruleset';
		details.textContent = t({
			id: 'home.ownDetails',
			defaultMessage: '{ruleset} - {stage} - {role}',
			description: 'Under each universe the player can edit: its ruleset (e.g. Pathfinder 1E), its stage (e.g. prologue) and the player\'s role (e.g. builder)'
		}, {
			ruleset: t(RULESET_NAMES[universe.ruleset]),
			stage: t(UNIVERSE_STAGE_NAMES[universe.stage]),
			role: t(UNIVERSE_ROLE_NAMES[universe.role])
		});

		link.append(name, description, details);
		item.append(link);

		return(item);
	}

	/**
	 * Opens the Create Universe dialog, empty
	 */
	private openCreateDialog(): void
	{
		this.createForm.reset();
		setOptions(this.createRuleset, [
			{
				value: '',
				label: t({
					id: 'home.create.chooseRuleset',
					defaultMessage: 'Choose a ruleset',
					description: 'First choice in the Create Universe dialog\'s ruleset list, asking the player to pick one'
				})
			},
			...namedOptions(RULESETS, RULESET_NAMES)
		]);
		showMessage(this.createError, undefined);
		clearFieldErrors(this.createForm);
		this.createSubmit.disabled = false;
		this.createDialog.showModal();
		this.createName.focus();
	}

	/**
	 * Creates the universe the dialog describes, and opens it in the editor
	 */
	private async createUniverse(): Promise<void>
	{
		const name = this.createName.value.trim();
		const shortDescription = this.createDescription.value.trim();

		if ((name === '') || DISALLOWED_TEXT_CHARACTERS.test(name))
		{
			reportFieldError(this.createName, t(formMessages.invalidText));
			return;
		}

		if (universeSlug(name) === '')
		{
			reportFieldError(this.createName, t(formMessages.universeNameNoLetters));
			return;
		}

		if (DISALLOWED_TEXT_CHARACTERS.test(shortDescription))
		{
			reportFieldError(this.createDescription, t(formMessages.invalidText));
			return;
		}

		this.createSubmit.disabled = true;

		try
		{
			const universeId = await this.actions.createUniverse({ name, shortDescription, ruleset: this.createRuleset.value as Ruleset });

			this.createDialog.close();
			this.actions.edit(universeId);
		}
		catch (error)
		{
			showMessage(this.createError, describeEditorError(error, {
				id: 'home.create.failed',
				defaultMessage: 'Could not create the universe.',
				description: 'Shown in the Create Universe dialog when the universe couldn\'t be made'
			}));
			this.createSubmit.disabled = false;
		}
	}
}
