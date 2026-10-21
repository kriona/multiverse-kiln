import type { CharacterListPayload } from '@multiverse-kiln/shared';

import { t } from '../localization';
import type { CharacterApi } from '../network/characterApi';
import { describeEditorError } from '../network/editorApi';
import { getElement, showMessage } from './dom';
import { className, raceName } from './raceAndClassNames';

/**
 * The list of the player's characters on a universe's page: shown while the browser is logged in, and
 * hidden otherwise, since the page itself doesn't need a login
 */
export class UniverseCharacters
{
	private readonly panel = getElement('universe-characters', HTMLElement);
	private readonly list = getElement('universe-character-list', HTMLUListElement);
	private readonly none = getElement('universe-character-none', HTMLElement);
	private readonly error = getElement('universe-character-error', HTMLElement);

	/**
	 * Changes with every call to follow(), so a list that arrives for an older one is ignored
	 */
	private version = 0;

	/**
	 * @param api The player's characters
	 * @param universeId The universe whose characters are listed
	 */
	constructor(private readonly api: CharacterApi, private readonly universeId: string)
	{
	}

	/**
	 * Lists the logged-in player's characters afresh, or hides the list while the browser is logged out
	 *
	 * @param loggedIn Whether the browser is logged in
	 */
	async follow(loggedIn: boolean): Promise<void>
	{
		const version = ++this.version;

		if (!loggedIn)
		{
			this.panel.hidden = true;
			return;
		}

		let characters: CharacterListPayload;

		try
		{
			characters = await this.api.listCharacters(this.universeId);
		}
		catch (error)
		{
			if (version === this.version)
			{
				this.list.replaceChildren();
				this.none.hidden = true;
				showMessage(this.error, describeEditorError(error, {
					id: 'universePage.charactersFailed',
					defaultMessage: 'Could not list your characters.',
					description: 'Shown on a universe\'s page when the list of the player\'s characters in the universe couldn\'t be loaded'
				}));
				this.panel.hidden = false;
			}

			return;
		}

		if (version === this.version)
		{
			this.show(characters);
		}
	}

	/**
	 * Shows the characters: each one's name, race and class
	 *
	 * @param characters The player's characters in the universe
	 */
	private show(characters: CharacterListPayload): void
	{
		this.list.replaceChildren(...characters.characters.map((character) =>
		{
			const item = document.createElement('li');
			const name = document.createElement('strong');
			const description = document.createElement('span');

			name.textContent = character.name;
			description.className = 'universe-character-description';
			description.textContent = t({
				id: 'universePage.characterDescription',
				defaultMessage: '{race} {class}',
				description: 'On a universe\'s page, in the list of the player\'s characters, a character\'s race and class after their name, e.g. "Dwarf Fighter". Reorder them as your language needs'
			}, {
				race: raceName(character.race, characters.ruleset),
				class: className(character.characterClass, characters.ruleset)
			});
			item.append(name, ' ', description);

			return(item);
		}));
		this.none.hidden = (characters.characters.length > 0);
		showMessage(this.error, undefined);
		this.panel.hidden = false;
	}
}
