import { SessionServerMessageType, type CharacterItemsPayload, type ItemsReceivedPayload } from '@multiverse-kiln/shared';

import { localizedText, t } from '../localization';
import type { ServerConnection } from '../network/serverConnection';
import { showToast } from './toast';

/**
 * The window event sent when one of the player's characters' items or equipment changed, with a
 * CharacterItemsPayload as its detail, for a sheet showing them to load them again and a list showing
 * their avatar to show it again (reloadOnCharacterItems())
 */
export const CHARACTER_ITEMS_EVENT = 'kiln-character-items';

/**
 * Loads a page's characters again each time one of them changes items, equipment or how they look, in
 * any window, so their avatars show the look they have now. Changes that come while they load make one
 * more load once it finishes, so the last avatars shown are never older than the last change. A load
 * that fails is only logged, leaving the avatars shown
 *
 * @param shows Whether the page lists the character a change is to
 * @param reload Loads the characters again and shows their avatars
 */
export function reloadOnCharacterItems(shows: (change: CharacterItemsPayload) => boolean, reload: () => Promise<unknown>): void
{
	let loading = false;
	let loadAgain = false;

	/**
	 * Loads the characters until no change has come since the last load started
	 */
	async function loadUntilCurrent(): Promise<void>
	{
		loading = true;

		do
		{
			loadAgain = false;

			try
			{
				await reload();
			}
			catch (error)
			{
				console.error('Could not load the characters\' avatars again:', error);
			}
		}
		while (loadAgain);

		loading = false;
	}

	window.addEventListener(CHARACTER_ITEMS_EVENT, (event) =>
	{
		if (!shows((event as CustomEvent<CharacterItemsPayload>).detail))
		{
			return;
		}

		if (loading)
		{
			loadAgain = true;
		}
		else
		{
			void loadUntilCurrent();
		}
	});
}

/**
 * Follows the session room's news of the player's characters' items on every page: a change to a
 * character's items, equipment or look, made anywhere, is passed on as CHARACTER_ITEMS_EVENT, so an open
 * sheet and the lists of the player's characters show it, and items another character gave one of the
 * player's characters show a toast saying who gave them what
 *
 * @param server The page's connection to the server (startPage())
 */
export function startItemNotices(server: Promise<ServerConnection>): void
{
	void server.then(({ session }) =>
	{
		session.onMessage(SessionServerMessageType.CharacterItems, (payload: CharacterItemsPayload) =>
		{
			window.dispatchEvent(new CustomEvent<CharacterItemsPayload>(CHARACTER_ITEMS_EVENT, { detail: payload }));
		});

		session.onMessage(SessionServerMessageType.ItemsReceived, (payload: ItemsReceivedPayload) =>
		{
			showToast(t({
				id: 'itemsReceived.toast',
				defaultMessage: '{giver} gave {receiver} {quantity, plural, =1 {{item}} other {{item} x#}}.',
				description: 'Toast shown on every page the player has open when another character, perhaps one of their own, gives one of their characters items. {giver} is the name of the character who gave them, {receiver} the name of the player\'s character given them, {item} the item\'s name and {quantity} how many, written as a character\'s sheet writes it, e.g. "arrows x20"'
			}, {
				giver: payload.giver,
				receiver: payload.receiver,
				item: ((typeof payload.item === 'string') ? payload.item : localizedText(payload.item)),
				quantity: payload.quantity
			}));
		});
	}, () =>
	{
		// The account menu already says the server couldn't be reached
	});
}
