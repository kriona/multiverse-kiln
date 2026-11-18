import { ABILITY_NAMES, characterSlots, DARKVISION_NAMES, defineMessages, equippedCount, fitsSlot, handChoices, pf1eAbilityModifier, RULESET_ABILITIES, SIZE_NAMES, type CharacterItemsPayload, type CharacterSheet, type CharacterSheetItem, type EquipHand, type MessageDescriptor } from '@multiverse-kiln/shared';
import lastRitesIcon from 'virtual:icon/game-icons:candle-light';
import unequipIcon from 'virtual:icon/ph:backpack';
import giveIcon from 'virtual:icon/ph:hand-arrow-up';
import equipIcon from 'virtual:icon/ph:hand-grabbing';
import inspectIcon from 'virtual:icon/ph:magnifying-glass';
import signOutIcon from 'virtual:icon/ph:sign-out';
import discardIcon from 'virtual:icon/ph:trash';

import { currentLocale, formatToNodes, signedNumber, t } from '../localization';
import type { CharacterApi } from '../network/characterApi';
import { describeEditorError } from '../network/editorApi';
import type { GroupApi } from '../network/groupApi';
import { createActionMenu, type MenuAction } from './actionMenu';
import { announce } from './announcer';
import { getElement, setButtonLabel, showMessage } from './dom';
import { unequipNote } from './equipmentText';
import { clearFieldErrors, reportFieldError, setFieldError } from './fieldErrors';
import { formMessages } from './formMessages';
import { giveItemDialog } from './GiveItemDialog';
import { inspectItem } from './ItemInspectDialog';
import { CHARACTER_ITEMS_EVENT } from './itemNotices';
import { createItemIcon, itemDescription, itemName, slotText } from './itemNames';
import { describeLeaving, showLeaveButton, takeOutOfGroup } from './leavingGroup';
import { moneyElement } from './moneyField';
import { characterDescription, themeName } from './raceAndClassNames';

/**
 * Takes a character out of their group; rejects with an Error whose message says why it couldn't
 */
export type LeaveGroup = (universeId: string, groupId: string, characterId: string) => Promise<void>;

/**
 * The routes that load and delete the characters a sheet shows: the player's own (CharacterApi), or
 * any player's for the editor's Character List tab (EditorApi)
 */
export type CharacterSheetApi = Pick<CharacterApi, 'getCharacterSheet' | 'deleteCharacter' | 'scheduleCharacterDeletion' | 'restoreCharacter' | 'discardItems' | 'equipItem' | 'unequipItem' | 'giveItemsTo'>;

/**
 * Asks which items to give a character and gives them; resolves with how many different items were
 * given, 0 when none were chosen, or rejects when they couldn't be given
 */
export type GiveItems = (universeId: string, sheet: CharacterSheet) => Promise<number>;

/**
 * The character a sheet shows, the universe they are in, and whether it offers to change them
 */
interface ShownCharacter
{
	universeId: string;
	sheet: CharacterSheet;

	/**
	 * Whether the sheet offers to delete, restore the character, take them out of their group, discard
	 * their items, and give them items where the page can
	 */
	canChange: boolean;
}

/**
 * Text the sheet shows in more than one place (see src/localization.ts)
 */
const sheetMessages = defineMessages({
	loadFailed: {
		id: 'characterSheet.loadFailed',
		defaultMessage: 'Could not load the character sheet.',
		description: 'Shown in a character\'s sheet when the character couldn\'t be loaded'
	},
	equipFailed: {
		id: 'characterSheet.equipFailed',
		defaultMessage: 'Could not change what the character has equipped.',
		description: 'Shown on a character\'s sheet when equipping or unequipping an item from its menu failed'
	}
});

/**
 * The menu items that equip an item in particular hands, by the hands
 */
const EQUIP_IN_HAND: Record<EquipHand, MessageDescriptor> = defineMessages({
	main: {
		id: 'characterSheet.equipMainHand',
		defaultMessage: 'Equip in main hand',
		description: 'Item in the menu beside an item held in one hand, such as a dagger or a torch, on a character\'s sheet, that equips it in the character\'s main hand'
	},
	off: {
		id: 'characterSheet.equipOffHand',
		defaultMessage: 'Equip in off hand',
		description: 'Item in the menu beside an item held in one hand, such as a dagger, a shield or a torch, on a character\'s sheet, that equips it in the character\'s other hand'
	},
	both: {
		id: 'characterSheet.equipBothHands',
		defaultMessage: 'Equip in both hands',
		description: 'Item in the menu beside a weapon held in one hand, such as a longsword, on a character\'s sheet, that equips it gripped with both hands'
	}
});

/**
 * A dialog showing one of the player's characters: their race and class, ability scores, size,
 * darkvision, light sensitivity, money and equipment (pages that use it include partials/character-sheet.html)
 *
 * It only shows the character, so there is nothing in it to save. Its Delete button asks twice before
 * deleting the character: the second question cremates them (deletes them immediately) or gives them
 * their last rites (deletes them the site's characterDeletionDays later, and isn't offered while that
 * is 0). A character given their last rites can be restored from their sheet until then. A character in
 * a group can't be deleted, so for them Delete says so and offers to take them out of the group, going on
 * to the first question once they have left. A character in a group who can't play, because their race
 * or class is disabled, can also leave the group from their sheet. The editor's Character List tab
 * shows any player's character in it, offering the same to creators, along with Give Items, and nothing
 * to change to builders. It lists what the character has equipped in each slot. Each item the character
 * carries has a menu of what can be done with it: Equip, Unequip, Give (to another character in the
 * group, asking whom and how many), Inspect and Discard (asking how many), or only Inspect for those who
 * can't change the character. Discard and Give say which equipped ones they unequip. A change to the
 * character's items made anywhere else, such as in another window or by a gift, shows on the open sheet
 * and is read out
 */
export class CharacterSheetDialog
{
	private readonly dialog = getElement('character-sheet-dialog', HTMLDialogElement);
	private readonly title = getElement('character-sheet-title', HTMLElement);
	private readonly summary = getElement('character-sheet-summary', HTMLElement);
	private readonly status = getElement('character-sheet-status', HTMLElement);
	private readonly error = getElement('character-sheet-error', HTMLElement);
	private readonly pending = getElement('character-sheet-pending', HTMLElement);
	private readonly body = getElement('character-sheet-body', HTMLElement);
	private readonly abilityRows = getElement('character-sheet-ability-rows', HTMLTableSectionElement);
	private readonly traits = getElement('character-sheet-traits', HTMLDListElement);
	private readonly equipped = getElement('character-sheet-equipped', HTMLDListElement);
	private readonly items = getElement('character-sheet-items', HTMLUListElement);
	private readonly noItems = getElement('character-sheet-no-items', HTMLElement);
	private readonly deleteButton = getElement('character-sheet-delete', HTMLButtonElement);
	private readonly restoreButton = getElement('character-sheet-restore', HTMLButtonElement);
	private readonly leaveButton = getElement('character-sheet-leave', HTMLButtonElement);
	private readonly giveButton = getElement('character-sheet-give', HTMLButtonElement);
	private readonly leaveDialog = getElement('character-leave-dialog', HTMLDialogElement);
	private readonly leaveTitle = getElement('character-leave-title', HTMLElement);
	private readonly leaveReason = getElement('character-leave-reason', HTMLElement);
	private readonly leaveQuestion = getElement('character-leave-question', HTMLElement);
	private readonly leaveError = getElement('character-leave-error', HTMLElement);
	private readonly leaveConfirm = getElement('character-leave-confirm', HTMLButtonElement);
	private readonly deleteDialog = getElement('character-delete-dialog', HTMLDialogElement);
	private readonly deleteQuestion = getElement('character-delete-question', HTMLElement);
	private readonly farewellDialog = getElement('character-farewell-dialog', HTMLDialogElement);
	private readonly farewellQuestion = getElement('character-farewell-question', HTMLElement);
	private readonly farewellError = getElement('character-farewell-error', HTMLElement);
	private readonly cremateButton = getElement('character-cremate', HTMLButtonElement);
	private readonly lastRitesButton = getElement('character-last-rites', HTMLButtonElement);
	private readonly farewellCancelButton = getElement('character-farewell-cancel', HTMLButtonElement);
	private readonly discardDialog = getElement('character-discard-dialog', HTMLDialogElement);
	private readonly discardForm = getElement('character-discard-form', HTMLFormElement);
	private readonly discardTitle = getElement('character-discard-title', HTMLElement);
	private readonly discardQuantityLabel = getElement('character-discard-quantity-label', HTMLLabelElement);
	private readonly discardQuantityText = getElement('character-discard-quantity-text', HTMLElement);
	private readonly discardQuestion = getElement('character-discard-question', HTMLElement);
	private readonly discardQuantity = getElement('character-discard-quantity', HTMLInputElement);
	private readonly discardUnequips = getElement('character-discard-unequips', HTMLElement);
	private readonly discardError = getElement('character-discard-error', HTMLElement);
	private readonly discardConfirm = getElement('character-discard-confirm', HTMLButtonElement);
	private readonly discardCancel = getElement('character-discard-cancel', HTMLButtonElement);

	/**
	 * The character shown, once loaded
	 */
	private current: ShownCharacter | undefined;

	/**
	 * The item the dialog asking how many to discard is about, while it is open
	 */
	private discarding: CharacterSheetItem | undefined;

	/**
	 * Whether a deletion or restoration has been sent and the server hasn't answered
	 */
	private busy = false;

	/**
	 * How many of the sheet's own changes to the character's items are being sent, or loading the
	 * character again after they were made. News of a change that arrives meanwhile waits for them to
	 * finish (finishChangingItems()), since the server tells every window of the player about a change,
	 * this one included, and the sheet's own load already shows it
	 */
	private changingItems = 0;

	/**
	 * Whether news of a change to the character's items arrived while the sheet's own changes were
	 * being made, after the sheet's last load was sent
	 */
	private itemsChanged = false;

	/**
	 * Counts the loads of the character shown, so a load that finishes after a later one doesn't show
	 * what it found
	 */
	private loads = 0;

	/**
	 * Whether the question about leaving the group was asked from Delete, which goes on to ask whether to
	 * delete the character once they have left
	 */
	private deletingAfterLeaving = false;

	/**
	 * Changes every time the dialog opens, so a character that arrives for an earlier opening is ignored
	 */
	private version = 0;

	/**
	 * Takes a character out of their group
	 */
	private readonly leaveGroup: LeaveGroup;

	/**
	 * @param api The routes for the characters shown
	 * @param groupApi The routes that take characters out of groups
	 * @param charactersChanged Called after a character is deleted, given their last rites, restored or
	 * taken out of their group
	 * @param leaveGroup Takes a character out of their group, for a page that does more when one leaves,
	 * such as the game's page playing them in it; by default the group's route only
	 * @param giveItems Gives the character items, offered as Give Items to those who may change the
	 * character; left out, the sheet doesn't offer it
	 */
	constructor(private readonly api: CharacterSheetApi, groupApi: Pick<GroupApi, 'leaveGroup'>, private readonly charactersChanged: () => void, leaveGroup?: LeaveGroup, private readonly giveItems?: GiveItems)
	{
		this.leaveGroup = (leaveGroup ?? ((universeId, groupId, characterId) => takeOutOfGroup(groupApi, universeId, groupId, characterId)));

		this.discardCancel.addEventListener('click', () =>
		{
			this.discardDialog.close();
		});

		this.discardDialog.addEventListener('close', () =>
		{
			this.discarding = undefined;
		});

		// Escape doesn't close the question while the answer is being sent
		this.discardDialog.addEventListener('cancel', (event) =>
		{
			if (this.busy)
			{
				event.preventDefault();
			}
		});

		this.discardQuantity.addEventListener('input', () =>
		{
			setFieldError(this.discardQuantity, undefined);
			this.showDiscardUnequips();
		});

		// A change made anywhere else, such as in another window or by a gift, shows on the open sheet
		window.addEventListener(CHARACTER_ITEMS_EVENT, (event) =>
		{
			const { universeId, characterId } = (event as CustomEvent<CharacterItemsPayload>).detail;
			const current = this.current;

			if (current && (current.universeId === universeId) && (current.sheet.id === characterId))
			{
				if (this.changingItems > 0)
				{
					this.itemsChanged = true;
				}
				else
				{
					void this.showItemsChanged(current);
				}
			}
		});

		this.discardForm.addEventListener('submit', (event) =>
		{
			event.preventDefault();
			void this.discard();
		});

		getElement('character-sheet-close', HTMLButtonElement).addEventListener('click', () =>
		{
			this.dialog.close();
		});

		this.dialog.addEventListener('close', () =>
		{
			this.version++;
			this.current = undefined;
		});

		this.deleteButton.addEventListener('click', () =>
		{
			if (this.current?.sheet.group)
			{
				this.askToLeave(true);
			}
			else
			{
				this.askToDelete();
			}
		});

		this.restoreButton.addEventListener('click', () =>
		{
			void this.restore();
		});

		this.leaveButton.addEventListener('click', () =>
		{
			this.askToLeave(false);
		});

		this.giveButton.addEventListener('click', () =>
		{
			void this.give();
		});

		getElement('character-leave-cancel', HTMLButtonElement).addEventListener('click', () =>
		{
			this.leaveDialog.close();
		});

		this.leaveConfirm.addEventListener('click', () =>
		{
			void this.leave();
		});

		// Escape doesn't close the question while the answer is being sent
		this.leaveDialog.addEventListener('cancel', (event) =>
		{
			if (this.busy)
			{
				event.preventDefault();
			}
		});

		getElement('character-delete-cancel', HTMLButtonElement).addEventListener('click', () =>
		{
			this.deleteDialog.close();
		});

		getElement('character-delete-confirm', HTMLButtonElement).addEventListener('click', () =>
		{
			this.deleteDialog.close();
			this.askFarewell();
		});

		this.cremateButton.addEventListener('click', () =>
		{
			void this.cremate();
		});

		this.lastRitesButton.addEventListener('click', () =>
		{
			void this.giveLastRites();
		});

		this.farewellCancelButton.addEventListener('click', () =>
		{
			this.farewellDialog.close();
		});

		// Escape doesn't close the last question while its answer is being sent
		this.farewellDialog.addEventListener('cancel', (event) =>
		{
			if (this.busy)
			{
				event.preventDefault();
			}
		});
	}

	/**
	 * Opens the dialog and loads the character into it
	 *
	 * @param universeId The universe the character is in
	 * @param characterId The character's ID
	 * @param name The character's name, shown while the rest loads
	 * @param canChange Whether the sheet offers to change the character: delete, restore, take out of their group, give items and discard items
	 */
	async open(universeId: string, characterId: string, name: string, canChange = true): Promise<void>
	{
		const version = ++this.version;

		this.title.textContent = name;
		this.summary.textContent = '';
		this.status.textContent = t({
			id: 'characterSheet.loading',
			defaultMessage: 'Loading the character sheet...',
			description: 'Shown in a character\'s sheet while the character loads'
		});
		this.body.hidden = true;
		this.pending.hidden = true;
		this.deleteButton.hidden = true;
		this.restoreButton.hidden = true;
		this.leaveButton.hidden = true;
		this.giveButton.hidden = true;
		this.current = undefined;
		showMessage(this.error, undefined);
		this.dialog.showModal();
		this.title.focus();

		let sheet: CharacterSheet;

		try
		{
			sheet = await this.api.getCharacterSheet(universeId, characterId);
		}
		catch (error)
		{
			if (version === this.version)
			{
				this.status.textContent = '';
				showMessage(this.error, describeEditorError(error, sheetMessages.loadFailed));
			}

			return;
		}

		if (version === this.version)
		{
			this.current = {
				universeId,
				sheet,
				canChange
			};
			this.show(sheet, canChange);
		}
	}

	/**
	 * Fills the dialog with a character
	 *
	 * @param sheet The character
	 * @param canChange Whether the sheet offers to change the character: delete, restore, take out of their group, give items and discard items
	 */
	private show(sheet: CharacterSheet, canChange: boolean): void
	{
		const focusedItemId = this.focusedItemId();

		this.title.textContent = sheet.name;
		this.summary.textContent = characterDescription(sheet, sheet.ruleset);
		this.status.textContent = '';
		this.showAbilities(sheet);
		this.showTraits(sheet);
		this.showEquipment(sheet);
		this.showItems(sheet, canChange);
		this.showDeletion(sheet, canChange);
		this.body.hidden = false;

		// The item rows are made again, so focus on one goes back to its new menu button
		if (focusedItemId !== undefined)
		{
			this.focusItemMenu(focusedItemId);
		}
	}

	/**
	 * The item whose row has focus, on its menu button or in its menu
	 *
	 * @return The item's ID, or undefined when focus isn't on an item's row
	 */
	private focusedItemId(): number | undefined
	{
		const focused = document.activeElement;

		if (!focused || !this.items.contains(focused))
		{
			return(undefined);
		}

		const itemId = focused.closest('.action-menu')?.querySelector('.action-menu-button')?.getAttribute('data-item-id');

		return((itemId ? Number(itemId) : undefined));
	}

	/**
	 * Shows whether the character is waiting to be deleted, with Restore for one who is. Delete is
	 * offered either way, so a character given their last rites can still be cremated; for a character
	 * in a group, it asks them to leave first. A character who can't play because their race or class is
	 * disabled can't leave their group from it, so their sheet offers Leave group
	 *
	 * @param sheet The character
	 * @param canChange Whether to offer the buttons, or only say when the character will be deleted
	 */
	private showDeletion(sheet: CharacterSheet, canChange: boolean): void
	{
		const waiting = (sheet.deleteAt !== null);

		this.pending.textContent = (waiting
			? t({
				id: 'characterSheet.pending',
				defaultMessage: '{name} has had their last rites and will be deleted on {deleteAt, date, long}.',
				description: 'On the sheet of a character waiting to be deleted; {name} is the character\'s name and {deleteAt} the day they will be deleted'
			}, {
				name: sheet.name,
				deleteAt: Date.parse(sheet.deleteAt ?? '')
			})
			: '');
		this.pending.hidden = !waiting;
		this.restoreButton.hidden = (!canChange || !waiting);
		this.deleteButton.hidden = !canChange;
		this.leaveButton.hidden = (!canChange || (sheet.group === null) || (sheet.barredBy === null));
		this.giveButton.hidden = (!canChange || !this.giveItems);

		if (sheet.group)
		{
			showLeaveButton(this.leaveButton, sheet.group.isAnchor);
		}
	}

	/**
	 * Asks whether to take the character shown out of their group
	 *
	 * @param deleting Whether the player asked to delete the character, which they can't be while in a
	 * group: the question says so, and once they have left, goes on to ask whether to delete them
	 */
	private askToLeave(deleting: boolean): void
	{
		const sheet = this.current?.sheet;

		if (!sheet?.group)
		{
			return;
		}

		const { title, question, confirm } = describeLeaving(sheet.name, sheet.group.isAnchor);

		this.deletingAfterLeaving = deleting;
		this.leaveTitle.textContent = title;

		// Emptied when not shown, since the dialog's description reads it even while it is hidden
		this.leaveReason.textContent = (deleting
			? t({
				id: 'characterDelete.inGroup',
				defaultMessage: 'To delete {name}, you must first leave this group.',
				description: 'Shown above the question whether to leave the group, when the player asks to delete a character who is in a group from their sheet; once they have left, the player is asked whether to delete them. {name} is the character\'s name'
			}, {
				name: sheet.name
			})
			: '');
		this.leaveReason.hidden = !deleting;
		this.leaveQuestion.textContent = question;
		setButtonLabel(this.leaveConfirm, signOutIcon, confirm);
		this.leaveConfirm.disabled = false;
		showMessage(this.leaveError, undefined);
		this.leaveDialog.showModal();
	}

	/**
	 * Takes the character shown out of their group, once the player has said so, then asks whether to
	 * delete them when that is what the player asked for
	 */
	private async leave(): Promise<void>
	{
		const current = this.current;
		const group = current?.sheet.group;

		if (!current || !group || this.busy)
		{
			return;
		}

		this.busy = true;
		this.leaveConfirm.disabled = true;

		try
		{
			await this.leaveGroup(current.universeId, group.groupId, current.sheet.id);
		}
		catch (error)
		{
			showMessage(this.leaveError, ((error instanceof Error) ? error.message : String(error)));
			this.leaveConfirm.disabled = false;
			return;
		}
		finally
		{
			this.busy = false;
		}

		this.leaveDialog.close();

		if (this.current === current)
		{
			current.sheet = {
				...current.sheet,
				group: null
			};
			this.showDeletion(current.sheet, current.canChange);

			if (this.deletingAfterLeaving)
			{
				this.askToDelete();
			}
			else
			{
				this.deleteButton.focus();
			}
		}

		announce(t({
			id: 'characterSheet.leftGroup',
			defaultMessage: '{name} has left the group.',
			description: 'Read out by screen readers once a character has been taken out of their group from their sheet; {name} is the character\'s name'
		}, {
			name: current.sheet.name
		}));
		this.charactersChanged();
	}

	/**
	 * Asks whether to delete the character shown
	 */
	private askToDelete(): void
	{
		const sheet = this.current?.sheet;

		if (!sheet)
		{
			return;
		}

		this.deleteQuestion.textContent = t({
			id: 'characterDelete.question',
			defaultMessage: 'Do you want to delete {name}?',
			description: 'In the dialog that asks whether to delete a character; {name} is the character\'s name'
		}, {
			name: sheet.name
		});
		this.deleteDialog.showModal();
	}

	/**
	 * Asks the last question before deleting the character shown: whether to cremate them, give them
	 * their last rites, or keep them. Keeping them is the button focused
	 */
	private askFarewell(): void
	{
		const sheet = this.current?.sheet;

		if (!sheet)
		{
			return;
		}

		this.farewellQuestion.textContent = t({
			id: 'characterDelete.farewell',
			defaultMessage: 'Are you absolutely sure you want to delete {name}? This is permanent (a very long time!) and cannot be undone.',
			description: 'In the last dialog before deleting a character; {name} is the character\'s name. Playful: "permanent" is joked about as a very long time'
		}, {
			name: sheet.name
		});
		setButtonLabel(this.lastRitesButton, lastRitesIcon, t({
			id: 'characterDelete.lastRites',
			defaultMessage: 'Last Rites (delete in {days, plural, one {# day} other {# days}})',
			description: 'Button that deletes a character after some days, and lets the player restore them until then. Last Rites is a playful way of saying it (the rites said for someone about to die); the words in parentheses say plainly what it does. {days} is how many days it waits'
		}, {
			days: sheet.deletionDays
		}));

		// Not offered when the site has turned last rites off, or the character already has them
		this.lastRitesButton.hidden = ((sheet.deletionDays === 0) || (sheet.deleteAt !== null));
		showMessage(this.farewellError, undefined);
		this.setBusy(false);
		this.farewellDialog.showModal();
		this.farewellCancelButton.focus();
	}

	/**
	 * Deletes the character shown immediately, then closes the sheet
	 */
	private async cremate(): Promise<void>
	{
		const current = this.current;

		if (!current || this.busy)
		{
			return;
		}

		this.setBusy(true);

		try
		{
			await this.api.deleteCharacter(current.universeId, current.sheet.id);
		}
		catch (error)
		{
			this.setBusy(false);
			showMessage(this.farewellError, describeEditorError(error, {
				id: 'characterDelete.failed',
				defaultMessage: 'Could not delete the character.',
				description: 'Shown in the last dialog before deleting a character when the deletion failed'
			}));
			return;
		}

		this.setBusy(false);
		this.farewellDialog.close();
		this.dialog.close();
		announce(t({
			id: 'characterDelete.cremated',
			defaultMessage: '{name} has been deleted.',
			description: 'Read out by screen readers once a character has been deleted immediately; {name} is the character\'s name'
		}, {
			name: current.sheet.name
		}));
		this.charactersChanged();
	}

	/**
	 * Gives the character shown their last rites, and shows when they will be deleted
	 */
	private async giveLastRites(): Promise<void>
	{
		const current = this.current;

		if (!current || this.busy)
		{
			return;
		}

		let deleteAt: string;

		this.setBusy(true);

		try
		{
			deleteAt = await this.api.scheduleCharacterDeletion(current.universeId, current.sheet.id);
		}
		catch (error)
		{
			this.setBusy(false);
			showMessage(this.farewellError, describeEditorError(error, {
				id: 'characterDelete.lastRitesFailed',
				defaultMessage: 'Could not give the character their last rites.',
				description: 'Shown in the last dialog before deleting a character when scheduling the deletion failed'
			}));
			return;
		}

		this.setBusy(false);
		this.farewellDialog.close();

		if (this.current === current)
		{
			current.sheet = {
				...current.sheet,
				deleteAt
			};
			this.showDeletion(current.sheet, current.canChange);
			announce(this.pending.textContent ?? '');
		}

		this.charactersChanged();
	}

	/**
	 * Restores the character shown, who has had their last rites
	 */
	private async restore(): Promise<void>
	{
		const current = this.current;

		if (!current || this.busy)
		{
			return;
		}

		this.busy = true;
		this.restoreButton.disabled = true;

		try
		{
			await this.api.restoreCharacter(current.universeId, current.sheet.id);
		}
		catch (error)
		{
			showMessage(this.error, describeEditorError(error, {
				id: 'characterSheet.restoreFailed',
				defaultMessage: 'Could not restore the character.',
				description: 'Shown on the sheet of a character waiting to be deleted when taking back the deletion failed'
			}));
			return;
		}
		finally
		{
			this.busy = false;
			this.restoreButton.disabled = false;
		}

		showMessage(this.error, undefined);

		if (this.current === current)
		{
			current.sheet = {
				...current.sheet,
				deleteAt: null
			};
			this.showDeletion(current.sheet, current.canChange);
			this.deleteButton.focus();
		}

		announce(t({
			id: 'characterSheet.restored',
			defaultMessage: '{name} has been restored.',
			description: 'Read out by screen readers once a character waiting to be deleted has been restored; {name} is the character\'s name'
		}, {
			name: current.sheet.name
		}));
		this.charactersChanged();
	}

	/**
	 * Asks which items to give the character shown and gives them, then shows the sheet with them
	 */
	private async give(): Promise<void>
	{
		const current = this.current;

		if (!current || !this.giveItems || this.busy)
		{
			return;
		}

		let count: number;

		this.busy = true;
		this.changingItems++;
		this.giveButton.disabled = true;

		try
		{
			count = await this.giveItems(current.universeId, current.sheet);
		}
		catch (error)
		{
			showMessage(this.error, describeEditorError(error, {
				id: 'characterSheet.giveFailed',
				defaultMessage: 'Could not give the items.',
				description: 'Shown on a character\'s sheet, from the editor\'s Character List tab, when the items chosen with Give Items couldn\'t be added to what the character carries'
			}));
			this.finishChangingItems();
			return;
		}
		finally
		{
			this.busy = false;
			this.giveButton.disabled = false;
		}

		showMessage(this.error, undefined);

		if (count === 0)
		{
			this.finishChangingItems();
			return;
		}

		await this.reload(current);
		this.finishChangingItems();
		announce(t({
			id: 'characterSheet.itemsGiven',
			defaultMessage: '{name} has been given {count, plural, one {# item} other {# different items}}.',
			description: 'Read out by screen readers once items chosen with Give Items, on a character\'s sheet from the editor\'s Character List tab, were added to what the character carries; {name} is the character\'s name and {count} how many different items'
		}, {
			name: current.sheet.name,
			count
		}));
	}

	/**
	 * Asks whether to discard an item the character shown carries, and, below the question, how many of
	 * it when they carry more than one, all of it to start with
	 *
	 * @param item The item, as the sheet lists it
	 */
	private askToDiscard(item: CharacterSheetItem): void
	{
		const sheet = this.current?.sheet;

		if (!sheet || this.busy)
		{
			return;
		}

		const name = itemName(item, sheet.ruleset);
		const several = (item.quantity > 1);

		// The item's name is set in italics, so it reads as a name whether it is a thing or a proper noun
		const italicName = document.createElement('i');

		italicName.textContent = name;

		this.discarding = item;
		this.discardTitle.textContent = t({
			id: 'characterSheet.discardItemTitle',
			defaultMessage: 'Discard {item}',
			description: 'Title of the dialog, opened by Discard in an item\'s menu on a character\'s sheet, that asks whether to discard the item from what the character carries; {item} is the item\'s name'
		}, {
			item: name
		});
		this.discardQuestion.replaceChildren(...formatToNodes({
			id: 'characterSheet.discardQuestion',
			defaultMessage: 'Are you sure you want to discard {item}?',
			description: 'In the dialog, opened by Discard in an item\'s menu on a character\'s sheet, that asks whether to discard the item from what the character carries; when they carry more than one, a field below it asks how many. {item} is the item\'s name, shown in italics'
		}, {
			item: italicName
		}));
		this.discardQuantityText.textContent = t({
			id: 'characterSheet.discardQuantity',
			defaultMessage: 'Choose how many to discard, up to {max, number}',
			description: 'Label of the field, in the dialog that discards an item a character carries, for how many of it to discard, shown when they carry more than one; {max} is how many they carry'
		}, {
			max: item.quantity
		});
		clearFieldErrors(this.discardDialog);
		showMessage(this.discardError, undefined);
		this.discardQuantityLabel.hidden = !several;
		this.discardQuantity.max = String(item.quantity);
		this.discardQuantity.value = String(item.quantity);
		this.discardQuantity.style.setProperty('--digits', String(String(item.quantity).length));
		this.showDiscardUnequips();
		this.discardConfirm.disabled = false;
		this.discardCancel.disabled = false;
		this.discardDialog.showModal();

		if (several)
		{
			this.discardQuantity.select();
		}
		else
		{
			this.discardCancel.focus();
		}
	}

	/**
	 * Says, in the dialog asking how many of an item to discard, which equipped ones discarding them
	 * unequips. The note is emptied while hidden, since the dialog's description reads it
	 */
	private showDiscardUnequips(): void
	{
		const sheet = this.current?.sheet;
		const item = this.discarding;
		const quantity = (((item?.quantity ?? 1) > 1) ? this.discardQuantity.valueAsNumber : 1);
		const note = ((sheet && item && Number.isInteger(quantity)) ? unequipNote(sheet.ruleset, sheet.equipment, item.id, (item.quantity - quantity)) : '');

		this.discardUnequips.textContent = note;
		this.discardUnequips.hidden = (note === '');
	}

	/**
	 * Discards as many of the item asked about as the field says from what the character shown carries,
	 * then shows the sheet without them
	 */
	private async discard(): Promise<void>
	{
		const current = this.current;
		const item = this.discarding;

		if (!current || !item || this.busy)
		{
			return;
		}

		const quantity = ((item.quantity > 1) ? this.discardQuantity.valueAsNumber : 1);

		if (!Number.isInteger(quantity) || (quantity < 1) || (quantity > item.quantity))
		{
			reportFieldError(this.discardQuantity, t(formMessages.wholeNumber, {
				min: 1,
				max: item.quantity
			}));
			return;
		}

		this.busy = true;
		this.changingItems++;
		this.discardConfirm.disabled = true;
		this.discardCancel.disabled = true;

		try
		{
			await this.api.discardItems(current.universeId, current.sheet.id, [
				{
					itemId: item.id,
					quantity
				}
			]);
		}
		catch (error)
		{
			showMessage(this.discardError, describeEditorError(error, {
				id: 'characterSheet.discardFailed',
				defaultMessage: 'Could not discard the items.',
				description: 'Shown in the dialog that discards an item a character carries, opened from their sheet, when the items couldn\'t be discarded'
			}));
			this.finishChangingItems();
			return;
		}
		finally
		{
			this.busy = false;
			this.discardConfirm.disabled = false;
			this.discardCancel.disabled = false;
		}

		this.discardDialog.close();
		await this.reload(current);
		this.finishChangingItems();
		this.focusItemMenu(item.id);
		announce(t({
			id: 'characterSheet.itemsDiscarded',
			defaultMessage: '{name} discarded {quantity, plural, =1 {{item}} other {{item} x#}}.',
			description: 'Read out by screen readers once items a character carried were discarded from their sheet; {name} is the character\'s name, {item} the item\'s name and {quantity} how many were discarded, written as the sheet writes it, e.g. "Arrow x20"'
		}, {
			name: current.sheet.name,
			item: itemName(item, current.sheet.ruleset),
			quantity
		}));
	}

	/**
	 * Puts focus back on an item's menu button once the sheet has been drawn again, or on the sheet's
	 * buttons when the item's row is gone, such as when all of it was discarded or given away
	 *
	 * @param itemId The item
	 */
	private focusItemMenu(itemId: number): void
	{
		const menuButton = this.items.querySelector<HTMLButtonElement>(`.action-menu-button[data-item-id="${itemId}"]`);

		(menuButton ?? (this.giveButton.hidden ? getElement('character-sheet-close', HTMLButtonElement) : this.giveButton)).focus();
	}

	/**
	 * Equips an item the character shown carries, then shows the sheet with it equipped. What was in its
	 * slots is unequipped
	 *
	 * @param item The item, as the sheet lists it
	 * @param hand The hands to hold it in, or null for an item that is worn or held in two hands
	 */
	private async equip(item: CharacterSheetItem, hand: EquipHand | null): Promise<void>
	{
		const current = this.current;

		if (!current || this.busy)
		{
			return;
		}

		this.busy = true;
		this.changingItems++;

		try
		{
			await this.api.equipItem(current.universeId, current.sheet.id, item.id, hand);
		}
		catch (error)
		{
			showMessage(this.error, describeEditorError(error, sheetMessages.equipFailed));
			this.finishChangingItems();
			return;
		}
		finally
		{
			this.busy = false;
		}

		showMessage(this.error, undefined);
		await this.reload(current);
		this.finishChangingItems();
		this.focusItemMenu(item.id);
		announce(t({
			id: 'characterSheet.equippedAnnouncement',
			defaultMessage: '{name} equipped {item}.',
			description: 'Read out by screen readers once an item was equipped from its menu on a character\'s sheet; {name} is the character\'s name and {item} the item\'s name. What was in its slot is unequipped, which the sheet\'s Equipped list shows'
		}, {
			name: current.sheet.name,
			item: itemName(item, current.sheet.ruleset)
		}));
	}

	/**
	 * Unequips an item the character shown has equipped, everywhere it is, then shows the sheet without it
	 * equipped
	 *
	 * @param item The item, as the sheet lists it
	 */
	private async unequip(item: CharacterSheetItem): Promise<void>
	{
		const current = this.current;

		if (!current || this.busy)
		{
			return;
		}

		this.busy = true;
		this.changingItems++;

		try
		{
			await this.api.unequipItem(current.universeId, current.sheet.id, item.id, null);
		}
		catch (error)
		{
			showMessage(this.error, describeEditorError(error, sheetMessages.equipFailed));
			this.finishChangingItems();
			return;
		}
		finally
		{
			this.busy = false;
		}

		showMessage(this.error, undefined);
		await this.reload(current);
		this.finishChangingItems();
		this.focusItemMenu(item.id);
		announce(t({
			id: 'characterSheet.unequipped',
			defaultMessage: '{name} unequipped {item}.',
			description: 'Read out by screen readers once an item was unequipped from its menu on a character\'s sheet; {name} is the character\'s name and {item} the item\'s name. The character still carries it'
		}, {
			name: current.sheet.name,
			item: itemName(item, current.sheet.ruleset)
		}));
	}

	/**
	 * Asks which character in the group to give an item the character shown carries to, and how many,
	 * then gives them and shows the sheet without them
	 *
	 * @param item The item, as the sheet lists it
	 */
	private askToGive(item: CharacterSheetItem): void
	{
		const current = this.current;

		if (!current || this.busy)
		{
			return;
		}

		giveItemDialog().open(current.sheet, item, async (receiverId, quantity) =>
		{
			this.changingItems++;

			try
			{
				await this.api.giveItemsTo(current.universeId, current.sheet.id, receiverId, [
					{
						itemId: item.id,
						quantity
					}
				]);
			}
			catch (error)
			{
				this.finishChangingItems();
				throw error;
			}
		}, (receiver, quantity) =>
		{
			void this.reload(current).then(() =>
			{
				this.finishChangingItems();
				this.focusItemMenu(item.id);
			});
			announce(t({
				id: 'characterSheet.itemsGivenTo',
				defaultMessage: '{name} gave {receiver} {quantity, plural, =1 {{item}} other {{item} x#}}.',
				description: 'Read out by screen readers once a character gave an item to another character in their group from their sheet; {name} is the giver\'s name, {receiver} the name of the character given it, {item} the item\'s name and {quantity} how many, written as the sheet writes it, e.g. "arrows x20"'
			}, {
				name: current.sheet.name,
				receiver,
				item: itemName(item, current.sheet.ruleset),
				quantity
			}));
		});
	}

	/**
	 * Loads the character shown again and shows them, unless the dialog has moved on to another or a
	 * later load has been sent. The load shows every change whose news arrived before it was sent
	 *
	 * @param current The character shown
	 * @return Whether it showed the character
	 */
	private async reload(current: ShownCharacter): Promise<boolean>
	{
		const load = ++this.loads;
		let sheet: CharacterSheet;

		this.itemsChanged = false;

		try
		{
			sheet = await this.api.getCharacterSheet(current.universeId, current.sheet.id);
		}
		catch (error)
		{
			if (this.current === current)
			{
				showMessage(this.error, describeEditorError(error, sheetMessages.loadFailed));
			}

			return(false);
		}

		if ((this.current !== current) || (load !== this.loads))
		{
			return(false);
		}

		current.sheet = sheet;
		this.show(sheet, current.canChange);

		return(true);
	}

	/**
	 * Shows a change to the character's items made somewhere else, such as in another window, by a
	 * creator or by a gift, and reads out that it happened
	 *
	 * @param current The character shown
	 */
	private async showItemsChanged(current: ShownCharacter): Promise<void>
	{
		if (await this.reload(current))
		{
			announce(t({
				id: 'characterSheet.itemsChanged',
				defaultMessage: '{name}\'s items have changed.',
				description: 'Read out by screen readers when what a character carries or has equipped changed somewhere other than their open sheet, such as in another window, by a universe\'s creator or by a gift, and the sheet shows the change; {name} is the character\'s name'
			}, {
				name: current.sheet.name
			}));
		}
	}

	/**
	 * Ends one of the sheet's own changes to the character's items. Once none are left, news of a change
	 * that arrived after the sheet's last load was sent, or while a change that failed was being sent,
	 * loads the character again
	 */
	private finishChangingItems(): void
	{
		const current = this.current;

		this.changingItems--;

		if ((this.changingItems === 0) && this.itemsChanged && current)
		{
			void this.reload(current);
		}
	}

	/**
	 * Turns the last question's buttons off while its answer is being sent
	 *
	 * @param busy Whether an answer is being sent
	 */
	private setBusy(busy: boolean): void
	{
		this.busy = busy;
		this.cremateButton.disabled = busy;
		this.lastRitesButton.disabled = busy;
		this.farewellCancelButton.disabled = busy;
	}

	/**
	 * Lists each ability with its score and the bonus or penalty it gives
	 *
	 * @param sheet The character
	 */
	private showAbilities(sheet: CharacterSheet): void
	{
		this.abilityRows.replaceChildren(...RULESET_ABILITIES[sheet.ruleset].map((ability) =>
		{
			const row = document.createElement('tr');
			const name = document.createElement('th');
			const score = document.createElement('td');
			const modifier = document.createElement('td');
			const value = sheet.abilityScores[ability];

			name.scope = 'row';
			name.textContent = t(ABILITY_NAMES[sheet.ruleset][ability]);
			score.textContent = value.toLocaleString(currentLocale());
			modifier.textContent = signedNumber(pf1eAbilityModifier(value));
			row.append(name, score, modifier);

			return(row);
		}));
	}

	/**
	 * Lists the character's theme, hit points and stamina points in a ruleset that has them, their size,
	 * their darkvision and light sensitivity, and their money
	 *
	 * @param sheet The character
	 */
	private showTraits(sheet: CharacterSheet): void
	{
		const entries: [string, string | Node][] = [];

		if (sheet.theme !== null)
		{
			entries.push([t({
				id: 'characterSheet.theme',
				defaultMessage: 'Theme',
				description: 'On a character\'s sheet in Starfinder, the label of their theme: a background such as ace pilot'
			}), themeName(sheet.theme, sheet.ruleset)]);
		}

		if (sheet.hitPoints !== null)
		{
			entries.push([t({
				id: 'characterSheet.hitPoints',
				defaultMessage: 'Hit points',
				description: 'On a character\'s sheet in Starfinder, the label of their hit points'
			}), sheet.hitPoints.toLocaleString(currentLocale())]);
		}

		if (sheet.staminaPoints !== null)
		{
			entries.push([t({
				id: 'characterSheet.staminaPoints',
				defaultMessage: 'Stamina points',
				description: 'On a character\'s sheet in Starfinder, the label of their stamina points, which are lost before hit points and come back with rest'
			}), sheet.staminaPoints.toLocaleString(currentLocale())]);
		}

		entries.push(
			[t({
				id: 'characterSheet.size',
				defaultMessage: 'Size',
				description: 'On a character\'s sheet, the label of their size, such as Medium'
			}), t(SIZE_NAMES[sheet.ruleset][sheet.size])],
			[t({
				id: 'character.darkvision',
				defaultMessage: 'Darkvision',
				description: 'How far a character can see in the dark, if at all: the label on a character\'s sheet, and of the race editor\'s field for how far the race\'s characters can; also names the setting in the list of what a save changed, on the editor\'s Audit tab'
			}), t(DARKVISION_NAMES[sheet.darkvision])],
			[t({
				id: 'character.lightSensitivity',
				defaultMessage: 'Light sensitivity',
				description: 'Whether bright light dazzles a character: the label on a character\'s sheet, and the race editor\'s checkbox for whether it dazzles the race\'s characters; also names the setting in the list of what a save changed, on the editor\'s Audit tab'
			}), t({
				id: 'characterSheet.lightSensitivityValue',
				defaultMessage: '{lightSensitivity, select, true {Yes} other {No}}',
				description: 'On a character\'s sheet, whether bright light dazzles them'
			}, {
				lightSensitivity: String(sheet.lightSensitivity)
			})],
			[t({
				id: 'characterSheet.money',
				defaultMessage: 'Money',
				description: 'On a character\'s sheet, the label of the coins they carry, such as 15gp 5sp'
			}), moneyElement(sheet.money, sheet.ruleset, sheet.coinNames, sheet.coinAbbreviations)]
		);

		this.traits.replaceChildren(...entries.flatMap(([term, value]) =>
		{
			const termElement = document.createElement('dt');
			const valueElement = document.createElement('dd');

			termElement.textContent = term;
			valueElement.append(value);

			return([termElement, valueElement]);
		}));
	}

	/**
	 * Lists each of the character's equipment slots with the item in it, or Empty. An item held in both
	 * hands shows in the main hand, and the off hand says it is taken
	 *
	 * @param sheet The character
	 */
	private showEquipment(sheet: CharacterSheet): void
	{
		const itemsById = new Map(sheet.items.map((item) => [item.id, item]));
		const bySlot = new Map(sheet.equipment.map((equipped) => [equipped.slot, equipped]));
		const held = bySlot.get('mainHand');
		const empty = t({
			id: 'characterSheet.emptySlot',
			defaultMessage: 'Empty',
			description: 'On a character\'s sheet, in the Equipped list, beside an equipment slot with nothing in it'
		});

		this.equipped.replaceChildren(...characterSlots(sheet.ruleset, sheet.hasTail).flatMap((slot) =>
		{
			const term = document.createElement('dt');
			const value = document.createElement('dd');
			const equipped = bySlot.get(slot);
			const item = ((equipped === undefined) ? undefined : itemsById.get(equipped.itemId));

			term.textContent = slotText(slot, sheet.ruleset);

			if (item && equipped?.bothHands)
			{
				value.textContent = t({
					id: 'characterSheet.inBothHands',
					defaultMessage: '{item} (both hands)',
					description: 'On a character\'s sheet, in the Equipped list, beside the main hand when the item there is held in both hands, such as a greatsword; {item} is the item\'s name'
				}, {
					item: itemName(item, sheet.ruleset)
				});
			}
			else if (item)
			{
				value.textContent = itemName(item, sheet.ruleset);
			}
			else if ((slot === 'offHand') && held?.bothHands && itemsById.has(held.itemId))
			{
				value.textContent = t({
					id: 'characterSheet.offHandTaken',
					defaultMessage: 'Holding {item} with the main hand',
					description: 'On a character\'s sheet, in the Equipped list, beside the off hand when the item in the main hand is held in both hands, such as a greatsword; {item} is that item\'s name'
				}, {
					item: itemName(itemsById.get(held.itemId) ?? { key: null, name: null }, sheet.ruleset)
				});
			}
			else
			{
				value.textContent = empty;
				value.className = 'character-sheet-empty-slot';
			}

			return([term, value]);
		}));
	}

	/**
	 * Lists the items the character carries by name, the way the player's language sorts them, with how
	 * many of each, how many are equipped and their descriptions, and a menu beside each of what can be
	 * done with it: everything for those who may change the character, and Inspect for others
	 *
	 * @param sheet The character
	 * @param canChange Whether the sheet offers to change the character
	 */
	private showItems(sheet: CharacterSheet, canChange: boolean): void
	{
		const items = sheet.items
			.map((item) => ({
				item,
				name: itemName(item, sheet.ruleset)
			}))
			.sort((a, b) => a.name.localeCompare(b.name, currentLocale()));

		this.items.replaceChildren(...items.map(({ item, name }) =>
		{
			const row = document.createElement('li');
			const text = document.createElement('span');
			const nameText = document.createElement('span');
			const description = itemDescription(item, sheet.ruleset);

			const equipped = equippedCount(sheet.equipment, item.id);

			text.className = 'character-sheet-item-text';
			nameText.textContent = ((equipped === 0)
				? t({
					id: 'characterSheet.item',
					defaultMessage: '{quantity, plural, =1 {{item}} other {{item} x#}}',
					description: 'On a character\'s sheet, an item they carry, with how many when there is more than one; {item} is the item\'s name, e.g. "Arrow x20"'
				}, {
					item: name,
					quantity: item.quantity
				})
				: t({
					id: 'characterSheet.itemEquipped',
					defaultMessage: '{quantity, plural, =1 {{item} (equipped)} other {{item} x# ({equipped, number} equipped)}}',
					description: 'On a character\'s sheet, an item they carry that they have equipped, with how many they carry when there is more than one and how many of those are equipped; {item} is the item\'s name, e.g. "Dagger x3 (2 equipped)"'
				}, {
					item: name,
					quantity: item.quantity,
					equipped
				}));
			text.append(nameText);

			if (description !== '')
			{
				const descriptionText = document.createElement('span');

				descriptionText.className = 'character-sheet-item-description';
				descriptionText.textContent = description;
				text.append(descriptionText);
			}

			row.append(createItemIcon(item.category, sheet.ruleset), text, this.createItemMenu(sheet, item, name, canChange));

			return(row);
		}));
		this.noItems.hidden = (items.length > 0);
	}

	/**
	 * The menu beside an item of what can be done with it: Equip (in a hand of the player's choosing for
	 * an item held in one), Unequip, Give, Inspect and Discard for those who may change the character, and
	 * Inspect for others. Equip is offered while one of the item isn't equipped, and for an item held in
	 * the hands, in hands it isn't already in; Give while the character is in a group with others
	 *
	 * @param sheet The character
	 * @param item The item
	 * @param name The item's name
	 * @param canChange Whether the sheet offers to change the character
	 * @return The menu's button, and the menu
	 */
	private createItemMenu(sheet: CharacterSheet, item: CharacterSheetItem, name: string, canChange: boolean): HTMLElement
	{
		const actions: MenuAction[] = [];
		const inspect: MenuAction = {
			label: t({
				id: 'characterSheet.inspect',
				defaultMessage: 'Inspect',
				description: 'Item in the menu beside an item on a character\'s sheet, and button beside an item in item selection, that opens a dialog showing what the item is: its kind, types, book, where it equips and description'
			}),
			icon: inspectIcon,
			run: () =>
			{
				inspectItem(item, sheet.ruleset);
			}
		};

		if (canChange)
		{
			const equipped = equippedCount(sheet.equipment, item.id);
			const fits = characterSlots(sheet.ruleset, sheet.hasTail).some((slot) => fitsSlot(sheet.ruleset, item.equips, slot));
			const allEquipped = (equipped >= item.quantity);
			const hands = handChoices(item).filter((hand) => !(allEquipped && sheet.equipment.some((each) => ((each.itemId === item.id) && (each.slot === ((hand === 'off') ? 'offHand' : 'mainHand')) && (each.bothHands === (hand === 'both'))))));

			// A worn or two-handed item fully equipped has nowhere else to go
			if (fits && (item.equips !== 'oneHand'))
			{
				if (!allEquipped)
				{
					actions.push(this.equipAction(item, t({
						id: 'characterSheet.equip',
						defaultMessage: 'Equip',
						description: 'Item in the menu beside an item on a character\'s sheet that equips it: puts on an item that is worn, or takes up one held in two hands. What was in its slot is unequipped'
					}), null));
				}
			}
			else if (fits)
			{
				actions.push(...hands.map((hand) => this.equipAction(item, t(EQUIP_IN_HAND[hand]), hand)));
			}

			if (equipped > 0)
			{
				actions.push({
					label: t({
						id: 'characterSheet.unequip',
						defaultMessage: 'Unequip',
						description: 'Item in the menu beside an item on a character\'s sheet that unequips it everywhere it is equipped. The character still carries it'
					}),
					icon: unequipIcon,
					run: () =>
					{
						void this.unequip(item);
					}
				});
			}

			if ((sheet.group?.members.length ?? 0) > 0)
			{
				actions.push({
					label: t({
						id: 'characterSheet.give',
						defaultMessage: 'Give',
						description: 'Item in the menu beside an item on a character\'s sheet that asks which character in the group to give it to, and how many'
					}),
					icon: giveIcon,
					run: () =>
					{
						this.askToGive(item);
					}
				});
			}

			actions.push(inspect, {
				label: t({
					id: 'characterSheet.discard',
					defaultMessage: 'Discard',
					description: 'Item in the menu beside an item on a character\'s sheet that asks how many of it to discard from what the character carries'
				}),
				icon: discardIcon,
				danger: true,
				run: () =>
				{
					this.askToDiscard(item);
				}
			});
		}
		else
		{
			actions.push(inspect);
		}

		const menu = createActionMenu(t({
			id: 'characterSheet.itemMenu',
			defaultMessage: 'Actions for {item}',
			description: 'Name for screen readers, and tooltip, of the button of three vertical dots beside an item on a character\'s sheet, which opens a menu of what can be done with the item, such as Equip, Give, Inspect and Discard; {item} is the item\'s name'
		}, {
			item: name
		}), actions);

		menu.classList.add('character-sheet-item-menu');
		menu.querySelector<HTMLButtonElement>('.action-menu-button')?.setAttribute('data-item-id', String(item.id));

		return(menu);
	}

	/**
	 * A menu item that equips an item
	 *
	 * @param item The item
	 * @param label The menu item's text
	 * @param hand The hands to hold it in, or null for an item that is worn or held in two hands
	 * @return The menu item
	 */
	private equipAction(item: CharacterSheetItem, label: string, hand: EquipHand | null): MenuAction
	{
		return({
			label,
			icon: equipIcon,
			run: () =>
			{
				void this.equip(item, hand);
			}
		});
	}
}
