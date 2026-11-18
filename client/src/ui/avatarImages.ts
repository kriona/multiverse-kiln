/**
 * Characters' avatars on the pages: the picture the server draws of each (see Avatars in
 * STRUCTURE-OVERVIEW.md), full size on their sheet, as a head-and-shoulders crop in the lobby's and
 * group's lists, and as a thumbnail on profiles and the universe page
 */
import { avatarPath, type Ruleset } from '@multiverse-kiln/shared';

import { t } from '../localization';
import { serverHttpUrl } from '../network/serverConnection';
import { characterLabel } from './raceAndClassNames';

/**
 * How an avatar is shown
 *
 * - full: the whole picture, on a character's sheet
 * - portrait: a head-and-shoulders crop, beside a character in the lobby's and group's lists
 * - thumbnail: the whole picture, small, beside a character on profiles and the universe page
 */
export type AvatarSize = 'full' | 'portrait' | 'thumbnail';

/**
 * A character, as far as showing their avatar goes
 */
export interface AvatarCharacter
{
	id: string;
	name: string;
	race: { key: string | null; name: string | null };
	characterClass: { key: string | null; name: string | null };

	/**
	 * The hash of their avatar now, or null when they have none; undefined when it isn't known, as for
	 * others in a room, whose avatar is checked with the server each time
	 */
	avatarHash: string | null | undefined;
}

/**
 * A character's avatar: an image whose alt text is their name, race and class, or, for a character with
 * none, a frame saying "No avatar yet" (full size) or nothing (smaller). An image that can't be loaded
 * takes the same place. A portrait or thumbnail sits beside the character's name, which already says who
 * it is, so screen readers skip it
 *
 * @param character The character
 * @param ruleset The universe's ruleset
 * @param size How it is shown
 * @return The element
 */
export function avatarElement(character: AvatarCharacter, ruleset: Ruleset, size: AvatarSize): HTMLElement
{
	return(avatarFrame(character.id, character.avatarHash, ((size === 'full') ? characterLabel(character, ruleset) : ''), size));
}

/**
 * A character's avatar, for a list that knows only their ID, such as of others in a room
 *
 * @param characterId The character's ID
 * @param avatarHash The hash of their avatar now, null when they have none, or undefined when it isn't known
 * @param alt The image's alt text: empty beside the character's name
 * @param size How it is shown
 * @return The element
 */
export function avatarFrame(characterId: string, avatarHash: string | null | undefined, alt: string, size: AvatarSize): HTMLElement
{
	const frame = document.createElement('span');

	frame.className = `avatar avatar-${size}`;

	if (avatarHash === null)
	{
		showNoAvatar(frame, size);
		return(frame);
	}

	const image = document.createElement('img');

	image.src = serverHttpUrl(avatarPath(characterId, (avatarHash ?? null)));
	image.alt = alt;
	image.width = 200;
	image.height = 300;
	image.decoding = 'async';
	image.loading = ((size === 'full') ? 'eager' : 'lazy');
	image.addEventListener('error', () =>
	{
		showNoAvatar(frame, size);
	}, { once: true });
	frame.append(image);

	return(frame);
}

/**
 * Shows that a character has no avatar in an avatar's frame
 *
 * @param frame The frame
 * @param size How the avatar is shown
 */
function showNoAvatar(frame: HTMLElement, size: AvatarSize): void
{
	frame.classList.add('avatar-none');

	if (size !== 'full')
	{
		frame.replaceChildren();
		frame.hidden = true;
		return;
	}

	const text = document.createElement('span');

	text.textContent = t({
		id: 'avatar.none',
		defaultMessage: 'No avatar yet',
		description: 'Shown on a character\'s sheet in place of their avatar (a picture of the character) when nothing is drawn yet for their race, or their race looks like no default race'
	});
	frame.replaceChildren(text);
}
