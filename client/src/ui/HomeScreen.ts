import { RULESET_NAMES, type UniverseDetails, type UniverseListPayload, type UniverseSummary } from '@multiverse-kiln/shared';

import { getElement } from './dom';

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
	 * Fetches a universe in full, for its overview
	 */
	loadDetails: (universeId: string) => Promise<UniverseDetails>;

	/**
	 * Goes into a universe's lobby
	 */
	enter: (universe: UniverseSummary) => void;
}

/**
 * Home: the universes to play in, a page at a time, and an overview of the one chosen with a button to enter it
 */
export class HomeScreen
{
	private readonly playerName = getElement('home-player-name', HTMLElement);
	private readonly notice = getElement('home-notice', HTMLElement);
	private readonly list = getElement('universe-list', HTMLUListElement);
	private readonly empty = getElement('universe-empty', HTMLElement);
	private readonly moreButton = getElement('universe-more', HTMLButtonElement);
	private readonly dialog = getElement('universe-dialog', HTMLDialogElement);
	private readonly dialogName = getElement('universe-name', HTMLElement);
	private readonly dialogRuleset = getElement('universe-ruleset', HTMLElement);
	private readonly dialogSummary = getElement('universe-summary', HTMLElement);
	private readonly dialogDescription = getElement('universe-description', HTMLElement);
	private readonly enterButton = getElement('universe-enter', HTMLButtonElement);

	/**
	 * How many universes are listed, which is where the next page starts
	 */
	private listed = 0;

	/**
	 * Changes every time the list starts over, so a page that arrives for an older list is ignored
	 */
	private listVersion = 0;

	/**
	 * The universe the overview is showing
	 */
	private chosen: UniverseSummary | undefined;

	/**
	 * @param actions What the screen's controls do
	 */
	constructor(private readonly actions: HomeScreenActions)
	{
		this.moreButton.addEventListener('click', () =>
		{
			void this.loadPage();
		});

		getElement('universe-close', HTMLButtonElement).addEventListener('click', () =>
		{
			this.dialog.close();
		});

		this.enterButton.addEventListener('click', () =>
		{
			const universe = this.chosen;

			this.dialog.close();

			if (universe)
			{
				actions.enter(universe);
			}
		});
	}

	/**
	 * Gets the screen ready to be shown, listing the universes afresh
	 *
	 * @param playerName The player's name
	 */
	show(playerName: string): void
	{
		this.playerName.textContent = playerName;
		this.listed = 0;
		this.listVersion++;
		this.list.replaceChildren();
		this.empty.hidden = true;
		this.moreButton.hidden = true;
		void this.loadPage();
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
			this.showNotice('Could not list the universes. Reload the page to try again.');
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
	 * A universe's entry in the list: its name, one-sentence description and ruleset, opening its overview
	 *
	 * @param universe The universe
	 * @return The list item
	 */
	private createItem(universe: UniverseSummary): HTMLLIElement
	{
		const item = document.createElement('li');
		const button = document.createElement('button');
		const name = document.createElement('strong');
		const description = document.createElement('span');
		const ruleset = document.createElement('span');

		button.type = 'button';
		button.className = 'universe-item';
		name.textContent = universe.name;
		description.textContent = universe.shortDescription;
		ruleset.className = 'universe-ruleset';
		ruleset.textContent = RULESET_NAMES[universe.ruleset];

		button.append(name, description, ruleset);
		button.addEventListener('click', () =>
		{
			void this.openOverview(universe);
		});

		item.append(button);

		return(item);
	}

	/**
	 * Shows a universe's overview, filling in its long description once it has loaded
	 *
	 * @param universe The universe
	 */
	private async openOverview(universe: UniverseSummary): Promise<void>
	{
		this.chosen = universe;
		this.dialogName.textContent = universe.name;
		this.dialogRuleset.textContent = RULESET_NAMES[universe.ruleset];
		this.dialogSummary.textContent = universe.shortDescription;
		this.dialogDescription.textContent = '';
		this.dialog.showModal();

		try
		{
			const details = await this.actions.loadDetails(universe.id);

			// Shown as written until descriptions are rendered as Markdown
			if (this.chosen === universe)
			{
				this.dialogDescription.textContent = details.longDescription;
			}
		}
		catch (error)
		{
			console.error('Could not load the universe:', error);

			if (this.chosen === universe)
			{
				this.dialogDescription.textContent = 'Could not load the rest of this universe\'s description.';
			}
		}
	}
}
