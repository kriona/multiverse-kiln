import type { ProfileCharacter } from '@multiverse-kiln/shared';

import { universePageUrl } from '../pages';
import { avatarElement } from './avatarImages';
import { characterDescription } from './raceAndClassNames';

/**
 * Lists a profile's characters under their universes, each universe's name a link to its page
 *
 * @param container Where the list goes, emptied first
 * @param characters The characters, already ordered by universe
 * @param renderCharacter Makes one character's list item
 */
export function showProfileCharacters<C extends ProfileCharacter>(container: HTMLElement, characters: readonly C[], renderCharacter: (character: C) => HTMLLIElement): void
{
	const groups = new Map<string, C[]>();

	for (const character of characters)
	{
		groups.set(character.universe.id, [...(groups.get(character.universe.id) ?? []), character]);
	}

	container.replaceChildren(...[...groups.values()].map((group) =>
	{
		const section = document.createElement('section');
		const heading = document.createElement('h3');
		const link = document.createElement('a');
		const list = document.createElement('ul');

		section.className = 'profile-universe';
		link.href = universePageUrl(group[0].universe.slug);
		link.textContent = group[0].universe.name;
		heading.append(link);
		list.append(...group.map(renderCharacter));
		section.append(heading, list);

		return(section);
	}));
}

/**
 * A character's avatar, name, and race and class, as a profile lists them
 *
 * @param character The character
 * @return The avatar's thumbnail, the name, and the race and class after it
 */
export function profileCharacterLabel(character: ProfileCharacter): HTMLElement[]
{
	const name = document.createElement('strong');
	const description = document.createElement('span');

	name.textContent = character.name;
	description.className = 'profile-character-description';
	description.textContent = characterDescription(character, character.universe.ruleset);

	return([avatarElement(character, character.universe.ruleset, 'thumbnail'), name, description]);
}
