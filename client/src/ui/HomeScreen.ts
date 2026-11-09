import { DISALLOWED_TEXT_CHARACTERS, hasIdShapedSlug, hasLinkLikeText,MAX_SHORT_DESCRIPTION_LENGTH,MAX_UNIVERSE_NAME_LENGTH, RULESET_NAMES, RULESETS, UNIVERSE_ROLE_NAMES, UNIVERSE_STAGE_NAMES, universeSlug, type EditableUniverseListPayload, type EditableUniverseSummary, type NewUniverseRequest, type Ruleset, type TwoFactorOffer, type UniverseListPayload, type UniverseSummary } from '@multiverse-kiln/shared';

import { currentLocale, t } from '../localization';
import type { AuthApi } from '../network/authApi';
import { describeEditorError } from '../network/editorApi';
import { editPageUrl, loginPageUrl, universePageUrl } from '../pages';
import { getElement, namedOptions, setOptions, setPageTitle, showMessage } from './dom';
import { clearFieldErrors, reportFieldError, setFieldError } from './fieldErrors';
import { formMessages } from './formMessages';
import { RecoveryCodesDialog } from './RecoveryCodesDialog';
import { TwoFactorSetupDialog } from './TwoFactorSetupDialog';
import { describeUniverseLanguages } from './universeLanguages';

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
}

/**
 * Home: the universes to play in, a page at a time, each linking to its page; the universes open for
 * testing that the player has a role in, which no one else sees; the universes the player works on,
 * and creating a universe, which offers to turn on 2FA when the account doesn't have it
 */
export class HomeScreen
{
	private readonly ownList = getElement('own-universe-list', HTMLUListElement);
	private readonly ownHeading = getElement('own-universes-heading', HTMLElement);
	private readonly ownInvite = getElement('own-universes-invite', HTMLElement);
	private readonly createButton = getElement('create-universe', HTMLButtonElement);
	private readonly createDialog = getElement('create-universe-dialog', HTMLDialogElement);
	private readonly createForm = getElement('create-universe-form', HTMLFormElement);
	private readonly createName = getElement('create-universe-name', HTMLInputElement);
	private readonly createDescription = getElement('create-universe-description', HTMLInputElement);
	private readonly createRuleset = getElement('create-universe-ruleset', HTMLSelectElement);
	private readonly createTwoFactorField = getElement('create-universe-two-factor-field', HTMLElement);
	private readonly createTwoFactor = getElement('create-universe-two-factor', HTMLInputElement);
	private readonly createError = getElement('create-universe-error', HTMLElement);
	private readonly createSubmit = getElement('create-universe-submit', HTMLButtonElement);
	private readonly twoFactorDialog: TwoFactorSetupDialog;
	private readonly recoveryCodesDialog = new RecoveryCodesDialog();
	private readonly logInLink = getElement('home-log-in', HTMLAnchorElement);
	private readonly ownUniverses = getElement('own-universes', HTMLElement);
	private readonly testingUniverses = getElement('testing-universes', HTMLElement);
	private readonly testingList = getElement('testing-universe-list', HTMLUListElement);
	private readonly notice = getElement('home-notice', HTMLElement);
	private readonly publicUniverses = getElement('public-universes', HTMLElement);
	private readonly list = getElement('universe-list', HTMLUListElement);
	private readonly moreButton = getElement('universe-more', HTMLButtonElement);
	private readonly emptyMessage = getElement('home-empty', HTMLElement);

	/**
	 * How many universes are listed, which is where the next page starts
	 */
	private listed = 0;

	/**
	 * Whether the first page of universes has arrived
	 */
	private firstPageLoaded = false;

	/**
	 * Whether the browser is logged in
	 */
	private loggedIn = false;

	/**
	 * How many universes the player has a role in, and whether they may create one (the site allows it
	 * and they haven't created the most they may), once their own universes have loaded
	 */
	private ownSummary: { count: number; canCreate: boolean } | undefined;

	/**
	 * What the Create Universe dialog needs to offer to turn on 2FA, or null when the account can't (or
	 * its own universes haven't loaded)
	 */
	private twoFactorOffer: TwoFactorOffer | null = null;

	/**
	 * The universe just created and the player's username, while the dialogs turning on 2FA are open
	 * before the universe opens in the editor
	 */
	private twoFactorSetup: { universeId: string; username: string } | undefined;

	/**
	 * Changes every time the list starts over, so a page that arrives for an older list is ignored
	 */
	private listVersion = 0;

	/**
	 * @param actions What the screen's controls do
	 * @param authApi The auth routes, which turn on 2FA
	 */
	constructor(private readonly actions: HomeScreenActions, authApi: AuthApi)
	{
		this.twoFactorDialog = new TwoFactorSetupDialog(authApi, (codes) =>
		{
			this.showRecoveryCodes(codes);
		});

		this.moreButton.addEventListener('click', () =>
		{
			void this.loadPage();
		});

		this.logInLink.href = loginPageUrl();

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
	 * their own universes too; anyone else is offered the login page
	 *
	 * @param loggedIn Whether the browser is logged in
	 */
	show(loggedIn: boolean): void
	{
		setPageTitle();
		this.logInLink.hidden = loggedIn;
		this.loggedIn = loggedIn;
		this.listed = 0;
		this.firstPageLoaded = false;
		this.ownSummary = undefined;
		this.twoFactorOffer = null;
		this.listVersion++;
		this.list.replaceChildren();
		this.publicUniverses.hidden = true;
		this.moreButton.hidden = true;
		this.ownList.replaceChildren();
		this.ownUniverses.hidden = true;
		this.emptyMessage.hidden = true;
		this.testingList.replaceChildren();
		this.testingUniverses.hidden = true;
		void this.loadPage();

		if (loggedIn)
		{
			void this.loadOwnUniverses(this.listVersion);
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
		this.firstPageLoaded = true;
		this.publicUniverses.hidden = (this.listed === 0);
		this.moreButton.hidden = !page.hasMore;
		this.showSections();
	}

	/**
	 * Shows the player's own universes once they have loaded, unless they have none and may not create
	 * one. When there are no universes to play either (or no login to have any with), Home says the
	 * first universe is still to come in place of the lists
	 */
	private showSections(): void
	{
		const nothingToPlay = (this.firstPageLoaded && (this.listed === 0));
		const nothingOwn = ((this.ownSummary !== undefined) && (this.ownSummary.count === 0) && !this.ownSummary.canCreate);

		this.emptyMessage.hidden = !(nothingToPlay && (!this.loggedIn || nothingOwn));
		this.ownUniverses.hidden = (!this.loggedIn || (this.ownSummary === undefined) || nothingOwn);
	}

	/**
	 * A universe's entry in the list: its name, one-sentence description, ruleset and languages, linking
	 * to its page
	 *
	 * @param universe The universe
	 * @return The list item
	 */
	private createItem(universe: UniverseSummary): HTMLLIElement
	{
		const item = document.createElement('li');
		const link = document.createElement('a');
		const name = document.createElement('h3');
		const description = document.createElement('span');
		const ruleset = document.createElement('span');
		const languages = document.createElement('span');

		link.className = 'button universe-item';
		link.href = universePageUrl(universe.slug);
		name.textContent = universe.name;
		description.textContent = universe.shortDescription;
		ruleset.className = 'universe-ruleset';
		ruleset.textContent = t(RULESET_NAMES[universe.ruleset]);
		languages.className = 'universe-ruleset';
		languages.textContent = describeUniverseLanguages(universe);

		link.append(name, description, ruleset, languages);
		item.append(link);

		return(item);
	}

	/**
	 * Lists the universes the player works on, with those open for testing (in prologue) in a section of
	 * their own linking to their pages, and shows Create Universe only while the site allows creating
	 * universes and the player hasn't created the most they may
	 *
	 * @param version The list's version when it was asked for; a list that arrives for an older one is ignored
	 */
	private async loadOwnUniverses(version: number): Promise<void>
	{
		let list: EditableUniverseListPayload;

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

		const { universes, universeCreationEnabled, universesPerCreator, twoFactorOffer } = list;
		const created = universes.filter((universe) => (universe.role === 'creator')).length;
		const testing = universes.filter((universe) => ((universe.stage === 'prologue') && !universe.disabled));

		const none = (universes.length === 0);
		const canCreate = (universeCreationEnabled && (created < universesPerCreator));

		// With none of their own, the player is asked whether to create one
		this.ownList.replaceChildren(...universes.map((universe) => this.createOwnItem(universe)));
		this.ownList.hidden = none;
		this.ownHeading.hidden = none;
		this.ownInvite.hidden = !none;
		this.createButton.hidden = !canCreate;
		this.testingList.replaceChildren(...testing.map((universe) => this.createItem(universe)));
		this.testingUniverses.hidden = (testing.length === 0);
		this.ownSummary = {
			count: universes.length,
			canCreate
		};
		this.twoFactorOffer = twoFactorOffer;
		this.showSections();
	}

	/**
	 * An entry in the player's own universes: its name, description, stage, the player's role and whether
	 * it is disabled, linking to the editor
	 *
	 * @param universe The universe
	 * @return The list item
	 */
	private createOwnItem(universe: EditableUniverseSummary): HTMLLIElement
	{
		const item = document.createElement('li');
		const link = document.createElement('a');
		const name = document.createElement('h3');
		const description = document.createElement('span');
		const details = document.createElement('span');

		link.className = 'button universe-item';
		link.href = editPageUrl(universe.id);
		name.textContent = universe.name;
		description.textContent = universe.shortDescription;
		details.className = 'universe-ruleset';
		details.textContent = (universe.disabled
			? t({
				id: 'home.ownDetailsDisabled',
				defaultMessage: '{ruleset} - {stage} - {role} - disabled by the site\'s admins',
				description: 'Under each universe the player can edit that one of the site\'s admins has disabled: its ruleset (e.g. Pathfinder 1E), its stage (e.g. prologue), the player\'s role (e.g. builder), and that it is disabled. The editor says why'
			}, {
				ruleset: t(RULESET_NAMES[universe.ruleset]),
				stage: t(UNIVERSE_STAGE_NAMES[universe.stage]),
				role: t(UNIVERSE_ROLE_NAMES[universe.role])
			})
			: t({
				id: 'home.ownDetails',
				defaultMessage: '{ruleset} - {stage} - {role}',
				description: 'Under each universe the player can edit: its ruleset (e.g. Pathfinder 1E), its stage (e.g. prologue) and the player\'s role (e.g. builder)'
			}, {
				ruleset: t(RULESET_NAMES[universe.ruleset]),
				stage: t(UNIVERSE_STAGE_NAMES[universe.stage]),
				role: t(UNIVERSE_ROLE_NAMES[universe.role])
			}));

		link.append(name, description, details);
		item.append(link);

		return(item);
	}

	/**
	 * Opens the Create Universe dialog, empty, with turning on 2FA checked when the account can
	 */
	private openCreateDialog(): void
	{
		this.createForm.reset();
		this.createTwoFactorField.hidden = (this.twoFactorOffer === null);
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
	 * Creates the universe the dialog describes, and opens it in the editor. With turning on 2FA
	 * checked, the dialog setting it up comes first
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

		if (hasIdShapedSlug(name))
		{
			reportFieldError(this.createName, t(formMessages.universeNameLikeId));
			return;
		}

		if (hasLinkLikeText(name))
		{
			reportFieldError(this.createName, t(formMessages.universeNameLinkLike));
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
			const universeId = await this.actions.createUniverse({ name, shortDescription, ruleset: this.createRuleset.value as Ruleset, locale: currentLocale() });
			const offer = this.twoFactorOffer;

			this.createDialog.close();

			if ((offer !== null) && !this.createTwoFactorField.hidden && this.createTwoFactor.checked)
			{
				this.setUpTwoFactor(universeId, offer);
			}
			else
			{
				this.actions.edit(universeId);
			}
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

	/**
	 * Opens the dialog turning on 2FA, after creating a universe. Skipping it opens the universe in the
	 * editor; turning 2FA on shows the recovery codes first
	 *
	 * @param universeId The universe just created
	 * @param offer The account's username and address, and whether it has a password
	 */
	private setUpTwoFactor(universeId: string, offer: TwoFactorOffer): void
	{
		this.twoFactorSetup = {
			universeId,
			username: offer.username
		};
		this.twoFactorDialog.open(offer, () =>
		{
			this.twoFactorSetup = undefined;
			this.actions.edit(universeId);
		});
	}

	/**
	 * Shows the recovery codes once 2FA is on, then opens the universe just created in the editor
	 *
	 * @param codes The recovery codes
	 */
	private showRecoveryCodes(codes: string[]): void
	{
		const setup = this.twoFactorSetup;

		this.twoFactorSetup = undefined;
		this.twoFactorOffer = null;

		if (setup === undefined)
		{
			return;
		}

		this.recoveryCodesDialog.open(codes, setup.username, () =>
		{
			this.actions.edit(setup.universeId);
		});
	}
}
