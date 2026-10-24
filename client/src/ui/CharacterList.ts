import type { CharacterListPayload, CharacterSummary } from '@multiverse-kiln/shared';
import sheetIcon from 'virtual:icon/ph:scroll';

import { t } from '../localization';
import { characterMessages } from './characterMessages';
import { setButtonLabel } from './dom';
import { className, raceName } from './raceAndClassNames';

/**
 * What a character list asks the app to do
 */
export interface CharacterListActions
{
	/**
	 * Play one of the player's characters, wherever they are: in the lobby, or in their group
	 */
	choose: (character: CharacterSummary) => void;

	/**
	 * Show one of the player's characters on their character sheet
	 */
	openSheet: (character: CharacterSummary) => void;
}

/**
 * The list of the player's characters in a universe, on the lobby and group screens: each one a button
 * that plays them beside one that shows their sheet, marking the one this window plays and saying which
 * are in a group
 */
export class CharacterList
{
	/**
	 * @param list The list's element
	 * @param none Shown instead of the list when the player has no characters
	 * @param actions What the list's buttons do
	 */
	constructor(private readonly list: HTMLUListElement, private readonly none: HTMLElement, private readonly actions: CharacterListActions)
	{
	}

	/**
	 * Draws the player's characters
	 *
	 * @param characters The characters and the universe's ruleset, or undefined while they load
	 * @param playingId The character this window plays, if any
	 * @param groupId The group the window is in, if any, whose members are said to be in this group
	 */
	render(characters: CharacterListPayload | undefined, playingId: string | null | undefined, groupId?: string): void
	{
		if (!characters)
		{
			this.none.hidden = true;
			this.list.replaceChildren();
			return;
		}

		this.none.hidden = (characters.characters.length > 0);
		this.list.replaceChildren(...characters.characters.map((character) => this.renderCharacter(characters, character, (character.id === playingId), groupId)));
	}

	/**
	 * Draws one character
	 *
	 * @param characters The list they are in
	 * @param character The character
	 * @param isPlaying Whether this window plays them
	 * @param groupId The group the window is in, if any
	 * @return The list item
	 */
	private renderCharacter(characters: CharacterListPayload, character: CharacterSummary, isPlaying: boolean, groupId: string | undefined): HTMLLIElement
	{
		const item = document.createElement('li');
		const button = document.createElement('button');
		const name = document.createElement('strong');
		const description = document.createElement('span');

		name.textContent = character.name;
		description.className = 'character-description';
		description.textContent = t(characterMessages.raceAndClass, {
			race: raceName(character.race, characters.ruleset),
			class: className(character.characterClass, characters.ruleset)
		});

		button.type = 'button';
		button.className = 'character-choice';
		button.setAttribute('aria-pressed', String(isPlaying));
		button.append(name, ' ', description);

		// Kept focusable, so a screen reader still reads the character and when they go
		if (character.deleteAt !== null)
		{
			button.setAttribute('aria-disabled', 'true');
			button.append(' ', this.note('character-leaving', t(characterMessages.leaving, {
				deleteAt: Date.parse(character.deleteAt)
			})));
		}
		else if ((character.groupId !== null) && (character.groupId === groupId))
		{
			button.append(' ', this.note('character-group', t({
				id: 'characters.inThisGroup',
				defaultMessage: 'In this group',
				description: 'In the list of the player\'s characters, beside one who is in the group the player is playing now; choosing them switches to them'
			})));
		}
		else if (character.groupId !== null)
		{
			button.append(' ', this.note('character-group', t({
				id: 'characters.inGroup',
				defaultMessage: 'In a group',
				description: 'In the list of the player\'s characters, beside one who is in a group (characters playing together); choosing them goes to that group'
			})));
		}

		// Said in words as well as by the outline, for players who can't see it
		if (isPlaying)
		{
			button.append(' ', this.note('character-playing', t({
				id: 'lobby.characterPlaying',
				defaultMessage: 'Playing',
				description: 'In the lobby\'s list of the player\'s characters, shown beside the one they are playing now'
			})));
		}

		button.addEventListener('click', () =>
		{
			if (!isPlaying && (character.deleteAt === null))
			{
				this.actions.choose(character);
			}
		});

		const sheetButton = document.createElement('button');

		sheetButton.type = 'button';
		sheetButton.className = 'secondary character-sheet-button';
		setButtonLabel(sheetButton, sheetIcon, t({
			id: 'lobby.characterSheet',
			defaultMessage: 'Sheet',
			description: 'Short button beside each of the player\'s characters in the lobby that shows the character\'s sheet: their ability scores, money and equipment'
		}));
		sheetButton.setAttribute('aria-label', t({
			id: 'lobby.characterSheetLabel',
			defaultMessage: 'Character sheet of {name}',
			description: 'Name for screen readers of the button beside one of the player\'s characters in the lobby that shows their sheet; {name} is the character\'s name'
		}, {
			name: character.name
		}));
		sheetButton.addEventListener('click', () =>
		{
			this.actions.openSheet(character);
		});

		item.append(button, sheetButton);

		return(item);
	}

	/**
	 * A short note after a character's name
	 *
	 * @param className The note's class
	 * @param text The note
	 * @return The note's element
	 */
	private note(className: string, text: string): HTMLSpanElement
	{
		const note = document.createElement('span');

		note.className = className;
		note.textContent = text;

		return(note);
	}
}
