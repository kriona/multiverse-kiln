import type { CharacterListPayload, CharacterSummary, InviteDetails } from '@multiverse-kiln/shared';

import { t } from '../localization';
import { describeMobScale, difficultyName } from './difficultyNames';
import { getElement, showMessage } from './dom';
import { className, raceName } from './raceAndClassNames';

/**
 * What the invite screen asks the app to do
 */
export interface InviteScreenActions
{
	/**
	 * Join the group with one of the player's characters
	 *
	 * @return Resolves once they have joined; rejects with the reason, in the player's language, when they couldn't
	 */
	join: (character: CharacterSummary) => Promise<void>;

	/**
	 * Go to the universe's lobby without joining
	 */
	goToLobby: () => void;

	/**
	 * Make a new character, coming back to the invite afterward
	 */
	createCharacter: () => void;
}

/**
 * The screen an invite link opens: which group it leads to and its difficulty (warning of permadeath), and
 * the player's characters in the universe
 * to join it with. Characters already in a group, or given their last rites, are grayed out and can't
 * be chosen; a full group can't be joined at all
 */
export class InviteScreen
{
	private readonly title = getElement('invite-title', HTMLElement);
	private readonly summary = getElement('invite-summary', HTMLElement);
	private readonly difficulty = getElement('invite-difficulty', HTMLElement);
	private readonly permadeath = getElement('invite-permadeath', HTMLElement);
	private readonly error = getElement('invite-error', HTMLElement);
	private readonly choose = getElement('invite-choose', HTMLElement);
	private readonly list = getElement('invite-character-list', HTMLUListElement);
	private readonly none = getElement('invite-character-none', HTMLElement);
	private readonly createCharacterButton = getElement('invite-create-character', HTMLButtonElement);

	/**
	 * Whether a character's request to join has been sent and the server hasn't answered
	 */
	private joining = false;

	/**
	 * @param actions What the screen's controls do
	 */
	constructor(private readonly actions: InviteScreenActions)
	{
		getElement('invite-lobby', HTMLButtonElement).addEventListener('click', () =>
		{
			actions.goToLobby();
		});

		this.createCharacterButton.addEventListener('click', () =>
		{
			actions.createCharacter();
		});
	}

	/**
	 * Shows an invite and the characters that could join with it
	 *
	 * @param invite The group the invite leads to
	 * @param characters The player's characters in its universe
	 */
	show(invite: InviteDetails, characters: CharacterListPayload): void
	{
		const isFull = (invite.memberCount >= invite.groupSize);
		const title = ((invite.groupName !== '')
			? t({
				id: 'invite.joinNamed',
				defaultMessage: 'Join {group}',
				description: 'Heading of the screen an invite link opens; {group} is the group\'s name'
			}, {
				group: invite.groupName
			})
			: t({
				id: 'invite.joinUnnamed',
				defaultMessage: 'Join {anchor}\'s group',
				description: 'Heading of the screen an invite link opens, for a group with no name; {anchor} is the name of the character the group is centered on'
			}, {
				anchor: invite.anchorName
			}));

		this.joining = false;
		this.title.textContent = title;
		document.title = t({
			id: 'invite.pageTitle',
			defaultMessage: '{title} - {universe} - Multiverse Kiln',
			description: 'The browser tab\'s title on the screen an invite link opens; {title} is its heading, e.g. "Join The Fellowship", {universe} is the universe\'s name, and Multiverse Kiln is the game engine\'s name'
		}, {
			title,
			universe: invite.universeName
		});
		this.summary.textContent = t({
			id: 'invite.summary',
			defaultMessage: 'You\'re invited to play {universe} in a group created by {anchor}. It has {count, number} of {size, plural, one {# character} other {# characters}}.',
			description: 'On the screen an invite link opens, what the invite is for; {universe} is the universe\'s name, {anchor} is the name of the character the group is centered on, {count} is how many characters are in it, and {size} is the most it can have'
		}, {
			universe: invite.universeName,
			anchor: invite.anchorName,
			count: invite.memberCount,
			size: invite.groupSize
		});
		this.difficulty.textContent = t({
			id: 'invite.difficulty',
			defaultMessage: 'Difficulty: {level} ({mobs})',
			description: 'On the screen an invite link opens, the difficulty level the group plays at; {level} is its name, e.g. Hard, and {mobs} says how it changes mobs (monsters and enemies), e.g. "Mobs 50% harder"'
		}, {
			level: difficultyName(invite.difficulty),
			mobs: describeMobScale(invite.difficulty.mobScale)
		});
		this.permadeath.hidden = !invite.difficulty.permadeath;
		showMessage(this.error, (isFull
			? t({
				id: 'invite.full',
				defaultMessage: 'You can\'t join: the group is full.',
				description: 'On the screen an invite link opens, when the group already has as many characters as its universe allows'
			})
			: undefined));
		this.choose.hidden = isFull;
		this.createCharacterButton.hidden = isFull;
		this.none.hidden = (isFull || (characters.characters.length > 0));
		this.list.replaceChildren(...(isFull ? [] : characters.characters.map((character) => this.renderCharacter(characters, character))));
	}

	/**
	 * Shows why an invite can't be used, with only the way to the lobby
	 *
	 * @param message Why, in the player's language
	 */
	showProblem(message: string): void
	{
		this.title.textContent = t({
			id: 'invite.title',
			defaultMessage: 'Invite',
			description: 'Heading of the screen an invite link opens, until the group it leads to has loaded'
		});
		document.title = this.title.textContent;
		this.summary.textContent = '';
		this.difficulty.textContent = '';
		this.permadeath.hidden = true;
		showMessage(this.error, message);
		this.choose.hidden = true;
		this.none.hidden = true;
		this.createCharacterButton.hidden = true;
		this.list.replaceChildren();
	}

	/**
	 * Draws one of the player's characters as a button that joins the group with them, grayed out when
	 * they can't
	 *
	 * @param characters The list they are in
	 * @param character The character
	 * @return The list item
	 */
	private renderCharacter(characters: CharacterListPayload, character: CharacterSummary): HTMLLIElement
	{
		const item = document.createElement('li');
		const button = document.createElement('button');
		const name = document.createElement('strong');
		const description = document.createElement('span');
		const reason = ((character.groupId !== null)
			? t({
				id: 'invite.characterInGroup',
				defaultMessage: 'Already in a group',
				description: 'On the screen an invite link opens, beside a character who can\'t join because they are in a group already'
			})
			: ((character.deleteAt !== null)
				? t({
					id: 'invite.characterLeaving',
					defaultMessage: 'To be deleted',
					description: 'On the screen an invite link opens, beside a character who can\'t join because they have been given their last rites (are waiting to be deleted)'
				})
				: undefined));

		name.textContent = character.name;
		description.className = 'character-description';
		description.textContent = t({
			id: 'lobby.characterDescription',
			defaultMessage: '{race} {class}',
			description: 'In the lobby\'s list of the player\'s characters, a character\'s race and class after their name, e.g. "Dwarf Fighter". Reorder them as your language needs'
		}, {
			race: raceName(character.race, characters.ruleset),
			class: className(character.characterClass, characters.ruleset)
		});

		button.type = 'button';
		button.className = 'character-choice';
		button.append(name, ' ', description);

		// Kept focusable, so a screen reader still reads why the character can't join
		if (reason !== undefined)
		{
			const note = document.createElement('span');

			note.className = 'character-leaving';
			note.textContent = reason;
			button.setAttribute('aria-disabled', 'true');
			button.append(' ', note);
		}

		button.addEventListener('click', () =>
		{
			if (reason === undefined)
			{
				void this.join(character);
			}
		});

		item.append(button);

		return(item);
	}

	/**
	 * Joins the group with a character, showing why when it can't
	 *
	 * @param character The character
	 */
	private async join(character: CharacterSummary): Promise<void>
	{
		if (this.joining)
		{
			return;
		}

		this.joining = true;
		showMessage(this.error, undefined);

		try
		{
			await this.actions.join(character);
		}
		catch (error)
		{
			showMessage(this.error, ((error instanceof Error) ? error.message : String(error)));
		}
		finally
		{
			this.joining = false;
		}
	}
}
