import { ABILITY_NAMES, DARKVISION_NAMES, defineMessages, pf1eAbilityModifier, RULESET_ABILITIES, SIZE_NAMES, type CharacterSheet, type CharacterSheetItem } from '@multiverse-kiln/shared';
import lastRitesIcon from 'virtual:icon/game-icons:candle-light';
import signOutIcon from 'virtual:icon/ph:sign-out';
import discardIcon from 'virtual:icon/ph:trash';

import { currentLocale, formatToNodes, signedNumber, t } from '../localization';
import type { CharacterApi } from '../network/characterApi';
import { describeEditorError } from '../network/editorApi';
import type { GroupApi } from '../network/groupApi';
import { createActionMenu } from './actionMenu';
import { announce } from './announcer';
import { getElement, setButtonLabel, showMessage } from './dom';
import { clearFieldErrors, reportFieldError, setFieldError } from './fieldErrors';
import { formMessages } from './formMessages';
import { createItemIcon, itemDescription, itemName } from './itemNames';
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
export type CharacterSheetApi = Pick<CharacterApi, 'getCharacterSheet' | 'deleteCharacter' | 'scheduleCharacterDeletion' | 'restoreCharacter' | 'discardItems'>;

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
 * to change to builders. Each item the character carries has a menu of what can be done with it, which
 * offers Discard, asking how many
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
		this.title.textContent = sheet.name;
		this.summary.textContent = characterDescription(sheet, sheet.ruleset);
		this.status.textContent = '';
		this.showAbilities(sheet);
		this.showTraits(sheet);
		this.showItems(sheet, canChange);
		this.showDeletion(sheet, canChange);
		this.body.hidden = false;
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
			return;
		}

		await this.reload(current);
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

		// The item's row is gone when all of it was discarded, so focus goes on to the sheet's buttons
		const menuButton = this.items.querySelector<HTMLButtonElement>(`.action-menu-button[data-item-id="${item.id}"]`);

		(menuButton ?? (this.giveButton.hidden ? getElement('character-sheet-close', HTMLButtonElement) : this.giveButton)).focus();
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
	 * Loads the character shown again and shows them, unless the dialog has moved on to another
	 *
	 * @param current The character shown
	 */
	private async reload(current: ShownCharacter): Promise<void>
	{
		let sheet: CharacterSheet;

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

			return;
		}

		if (this.current === current)
		{
			current.sheet = sheet;
			this.show(sheet, current.canChange);
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
	 * Lists the items the character carries by name, the way the player's language sorts them, with how
	 * many of each and their descriptions, and a menu beside each of what can be done with it for those who may change the character
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

			text.className = 'character-sheet-item-text';
			nameText.textContent = t({
				id: 'characterSheet.item',
				defaultMessage: '{quantity, plural, =1 {{item}} other {{item} x#}}',
				description: 'On a character\'s sheet, an item they carry, with how many when there is more than one; {item} is the item\'s name, e.g. "Arrow x20"'
			}, {
				item: name,
				quantity: item.quantity
			});
			text.append(nameText);

			if (description !== '')
			{
				const descriptionText = document.createElement('span');

				descriptionText.className = 'character-sheet-item-description';
				descriptionText.textContent = description;
				text.append(descriptionText);
			}

			row.append(createItemIcon(item.category, sheet.ruleset), text);

			if (canChange)
			{
				row.append(this.createItemMenu(item, name));
			}

			return(row);
		}));
		this.noItems.hidden = (items.length > 0);
	}

	/**
	 * The menu beside an item of what can be done with it: Discard
	 *
	 * @param item The item
	 * @param name The item's name
	 * @return The menu's button, and the menu
	 */
	private createItemMenu(item: CharacterSheetItem, name: string): HTMLElement
	{
		const menu = createActionMenu(t({
			id: 'characterSheet.itemMenu',
			defaultMessage: 'Actions for {item}',
			description: 'Name for screen readers, and tooltip, of the button of three vertical dots beside an item on a character\'s sheet, which opens a menu of what can be done with the item, such as Discard; {item} is the item\'s name'
		}, {
			item: name
		}), [
			{
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
			}
		]);

		menu.classList.add('character-sheet-item-menu');
		menu.querySelector<HTMLButtonElement>('.action-menu-button')?.setAttribute('data-item-id', String(item.id));

		return(menu);
	}
}
