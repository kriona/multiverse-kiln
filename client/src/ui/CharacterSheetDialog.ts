import { ABILITY_NAMES, characterSlots, DARKVISION_NAMES, defineMessages, equipChangesNothing, equippedCount, fitsSlot, fitsSocialSlot, handChoices, pf1eAbilityModifier, ringChoices, RULESET_ABILITIES, SIZE_NAMES, socialSlotFor, socialSlots, type CharacterAppearance, type CharacterItemsPayload, type CharacterSheet, type CharacterSheetItem, type EquipHand, type EquipmentLayer, type EquipRing, type MessageDescriptor } from '@multiverse-kiln/shared';
import lastRitesIcon from 'virtual:icon/game-icons:candle-light';
import wearIcon from 'virtual:icon/game-icons:cape';
import showIcon from 'virtual:icon/ph:eye';
import hideIcon from 'virtual:icon/ph:eye-slash';
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
import { AppearanceChoices } from './AppearanceChoices';
import { avatarElement } from './avatarImages';
import { ChangeTracker } from './changeTracker';
import { getElement, setButtonLabel, showMessage } from './dom';
import { unequipNote } from './equipmentText';
import { clearFieldErrors, reportFieldError, setFieldError } from './fieldErrors';
import { formMessages } from './formMessages';
import { giveItemDialog } from './GiveItemDialog';
import { setUpInfoTip } from './infoTip';
import { INSPECT_MESSAGES, inspectItem } from './ItemInspectDialog';
import { CHARACTER_ITEMS_EVENT } from './itemNotices';
import { createItemIcon, itemName, slotText } from './itemNames';
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
export type CharacterSheetApi = Pick<CharacterApi, 'getCharacterSheet' | 'deleteCharacter' | 'scheduleCharacterDeletion' | 'restoreCharacter' | 'discardItems' | 'equipItem' | 'unequipItem' | 'giveItemsTo' | 'wearSocially' | 'setSlotHidden' | 'changeAppearance'>;

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

	/**
	 * Whether the Appearance dialog offers to change the character's body type: only to the universe's
	 * creators
	 */
	canChangeBodyType: boolean;
}

/**
 * A slot the slot dialog chooses the item for
 */
interface ChosenSlot
{
	layer: EquipmentLayer;
	slot: string;
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
	},
	lookFailed: {
		id: 'characterSheet.lookFailed',
		defaultMessage: 'Could not change how the character looks.',
		description: 'Shown on a character\'s sheet, or in its Appearance dialog, when wearing an item for its look, hiding a slot from the avatar (the picture of the character) or changing the appearance failed'
	},
	empty: {
		id: 'characterSheet.emptySlot',
		defaultMessage: 'Empty',
		description: 'The choice in the dialog choosing the item in one of a character\'s slots, from their sheet, that takes the item out'
	}
});

/**
 * The sheet's labels for how far a character sees in the dark and whether bright light dazzles them.
 * The editor's Audit tab names a race's settings for them with these too
 */
export const VISION_LABELS = defineMessages({
	darkvision: {
		id: 'character.darkvision',
		defaultMessage: 'Darkvision',
		description: 'How far a character can see in the dark, if at all: the label on a character\'s sheet, and of the race editor\'s field for how far the race\'s characters can; also names the setting in the list of what a save changed, on the editor\'s Audit tab'
	},
	lightSensitivity: {
		id: 'character.lightSensitivity',
		defaultMessage: 'Light sensitivity',
		description: 'Whether bright light dazzles a character: the label on a character\'s sheet, and the race editor\'s checkbox for whether it dazzles the race\'s characters; also names the setting in the list of what a save changed, on the editor\'s Audit tab'
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
 * The menu items that equip a ring in a ring slot while both are full, by the ring slot
 */
const EQUIP_AS_RING: Record<EquipRing, MessageDescriptor> = defineMessages({
	left: {
		id: 'characterSheet.equipLeftRing',
		defaultMessage: 'Equip as left ring',
		description: 'Item in the menu beside a ring on a character\'s sheet, offered while both ring slots are full, that equips it in the left ring slot in place of what is there'
	},
	right: {
		id: 'characterSheet.equipRightRing',
		defaultMessage: 'Equip as right ring',
		description: 'Item in the menu beside a ring on a character\'s sheet, offered while both ring slots are full, that equips it in the right ring slot in place of what is there'
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
 * to change to builders. It lists what the character has equipped in each slot, each with a menu of
 * Choose item, Unequip, Inspect and Hide on avatar, or only Inspect for those who can't change the
 * character. Each item the character carries and hasn't equipped has a menu of what can be done with
 * it: Equip, Give (to another character in the group, asking whom and how many), Inspect and Discard
 * (asking how many), or only Inspect for those who can't change the character. Discard and Give say which equipped ones they unequip. A change to the
 * character's items made anywhere else, such as in another window or by a gift, shows on the open sheet
 * and is read out
 *
 * It shows the character's avatar, with an Appearance button changing its art type and background (and
 * body type, for the universe's creators). The Social list has the slots for items worn only for how they
 * look, which the item menu's Wear socially fills. In both lists, each slot's name chooses its item, and
 * its Hide toggle leaves it off the avatar
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
	private readonly social = getElement('character-sheet-social', HTMLDListElement);
	private readonly avatar = getElement('character-sheet-avatar', HTMLElement);
	private readonly appearanceButton = getElement('character-sheet-appearance', HTMLButtonElement);
	private readonly slotDialog = getElement('character-slot-dialog', HTMLDialogElement);
	private readonly slotTitle = getElement('character-slot-title', HTMLElement);
	private readonly slotAbout = getElement('character-slot-about', HTMLElement);
	private readonly slotChoices = getElement('character-slot-choices', HTMLUListElement);
	private readonly slotError = getElement('character-slot-error', HTMLElement);
	private readonly appearanceDialog = getElement('character-appearance-dialog', HTMLDialogElement);
	private readonly appearanceForm = getElement('character-appearance-form', HTMLFormElement);
	private readonly appearanceError = getElement('character-appearance-error', HTMLElement);
	private readonly appearanceSave = getElement('character-appearance-save', HTMLButtonElement);
	private readonly appearanceChoices: AppearanceChoices;
	private readonly appearanceTracker: ChangeTracker;

	/**
	 * The slot the slot dialog is choosing the item for, while it is open
	 */
	private choosingSlot: ChosenSlot | undefined;
	private readonly items = getElement('character-sheet-items', HTMLUListElement);
	private readonly noItems = getElement('character-sheet-no-items', HTMLElement);
	private readonly allEquipped = getElement('character-sheet-all-equipped', HTMLElement);
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
		setUpInfoTip(getElement('character-sheet-social-info', HTMLButtonElement), getElement('character-sheet-social-about', HTMLElement));
		this.appearanceChoices = new AppearanceChoices(getElement('character-appearance-choices', HTMLElement), () =>
		{
			this.appearanceTracker.check();
		});
		this.appearanceTracker = new ChangeTracker({
			root: this.appearanceForm,
			state: () => this.appearanceChoices.value()
		});
		this.appearanceTracker.guardDialog(this.appearanceDialog);

		this.appearanceButton.addEventListener('click', () =>
		{
			this.openAppearance();
		});

		getElement('character-appearance-cancel', HTMLButtonElement).addEventListener('click', () =>
		{
			if (this.appearanceTracker.confirmDiscard())
			{
				this.appearanceDialog.close();
			}
		});

		this.appearanceForm.addEventListener('submit', (event) =>
		{
			event.preventDefault();
			void this.saveAppearance();
		});

		getElement('character-slot-cancel', HTMLButtonElement).addEventListener('click', () =>
		{
			this.slotDialog.close();
		});

		this.slotDialog.addEventListener('close', () =>
		{
			const chosen = this.choosingSlot;

			this.choosingSlot = undefined;

			if (chosen && this.dialog.open)
			{
				this.focusSlotMenu(chosen);
			}
		});

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
	 * @param canChangeBodyType Whether the Appearance dialog offers to change the character's body type,
	 * which only the universe's creators can
	 */
	async open(universeId: string, characterId: string, name: string, canChange = true, canChangeBodyType = false): Promise<void>
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
		this.appearanceButton.hidden = true;
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
				canChange,
				canChangeBodyType
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
		this.avatar.replaceChildren(avatarElement(sheet, sheet.ruleset, 'full'));
		this.appearanceButton.hidden = !canChange;
		this.showAbilities(sheet);
		this.showTraits(sheet);
		this.showSlots(sheet, 'stats', canChange);
		this.showSlots(sheet, 'social', canChange);
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
	 * @param ring The ring slot to put a ring in, or null for a free one
	 */
	private async equip(item: CharacterSheetItem, hand: EquipHand | null, ring: EquipRing | null): Promise<void>
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
			await this.api.equipItem(current.universeId, current.sheet.id, item.id, hand, ring);
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
	 * Takes an item the character shown has equipped out of one of their slots, then shows the sheet with
	 * the slot empty
	 *
	 * @param item The item, as the sheet lists it
	 * @param slot The slot
	 */
	private async unequip(item: CharacterSheetItem, slot: string): Promise<void>
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
			await this.api.unequipItem(current.universeId, current.sheet.id, item.id, slot);
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
		this.focusSlotMenu({
			layer: 'stats',
			slot
		});
		announce(t({
			id: 'characterSheet.unequipped',
			defaultMessage: '{name} unequipped {item}.',
			description: 'Read out by screen readers once an item was unequipped from the menu beside its slot in the Equipped list of a character\'s sheet; {name} is the character\'s name and {item} the item\'s name. The character still carries it'
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
				await this.api.giveItemsTo(current.universeId, current.sheet.id, receiverId, {
					itemId: item.id,
					quantity
				});
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
			[t(VISION_LABELS.darkvision), t(DARKVISION_NAMES[sheet.darkvision])],
			[t(VISION_LABELS.lightSensitivity), t({
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
	 * Lists each of the character's slots of a layer with the item in it, or empty: the equipment slots in
	 * the Equipped list, and the social slots in the Social list. An item held in both hands shows in the
	 * main hand, and the off hand says it is taken. A slot hidden from the avatar is marked with a crossed
	 * out eye. Each slot has a menu (see slotMenu())
	 *
	 * @param sheet The character
	 * @param layer Which slots
	 * @param canChange Whether the sheet offers to change the character
	 */
	private showSlots(sheet: CharacterSheet, layer: EquipmentLayer, canChange: boolean): void
	{
		const itemsById = new Map(sheet.items.map((item) => [item.id, item]));
		const bySlot = new Map(((layer === 'stats') ? sheet.equipment : sheet.socialEquipment).map((equipped) => [equipped.slot, equipped]));
		const held = bySlot.get('mainHand');
		const slots = ((layer === 'stats') ? characterSlots(sheet.ruleset, sheet.hasTail) : socialSlots(sheet.ruleset));
		const list = ((layer === 'stats') ? this.equipped : this.social);

		list.replaceChildren(...slots.flatMap((slot) =>
		{
			const term = document.createElement('dt');
			const value = document.createElement('dd');
			const valueText = document.createElement('span');
			const equipped = bySlot.get(slot);
			const item = ((equipped === undefined) ? undefined : itemsById.get(equipped.itemId));
			const hidden = sheet.hiddenSlots.includes(slot);

			term.textContent = slotText(slot, sheet.ruleset);
			value.append(valueText);

			if (item && equipped?.bothHands)
			{
				valueText.textContent = t({
					id: 'characterSheet.inBothHands',
					defaultMessage: '{item} (both hands)',
					description: 'On a character\'s sheet, in the Equipped list, beside the main hand when the item there is held in both hands, such as a greatsword; {item} is the item\'s name'
				}, {
					item: itemName(item, sheet.ruleset)
				});
			}
			else if (item)
			{
				valueText.textContent = itemName(item, sheet.ruleset);
			}
			else if ((slot === 'offHand') && held?.bothHands && itemsById.has(held.itemId))
			{
				valueText.textContent = t({
					id: 'characterSheet.offHandTaken',
					defaultMessage: 'Holding {item} with the main hand',
					description: 'On a character\'s sheet, in the Equipped list, beside the off hand when the item in the main hand is held in both hands, such as a greatsword; {item} is that item\'s name'
				}, {
					item: itemName(itemsById.get(held.itemId) ?? { key: null, name: null }, sheet.ruleset)
				});
			}
			else
			{
				const empty = document.createElement('span');

				empty.className = 'character-sheet-empty-slot';
				empty.textContent = t({
					id: 'characterSheet.slotIsEmpty',
					defaultMessage: 'empty',
					description: 'On a character\'s sheet, in the Equipped and Social lists, beside a slot with nothing in it. Shown in lowercase italics'
				});
				valueText.append(empty);
			}

			if (hidden)
			{
				valueText.append(this.hiddenMark());
			}

			const menu = this.slotMenu(sheet, layer, slot, item, hidden, canChange);

			if (menu)
			{
				value.append(menu);
			}

			return([term, value]);
		}));
	}

	/**
	 * The crossed out eye beside a slot hidden from the avatar, named for screen readers and in its tooltip
	 *
	 * @return The mark
	 */
	private hiddenMark(): HTMLElement
	{
		const mark = document.createElement('span');
		const template = document.createElement('template');
		const label = t({
			id: 'characterSheet.hiddenOnAvatar',
			defaultMessage: 'Hidden on the avatar',
			description: 'Name for screen readers, and tooltip, of the crossed out eye beside a slot in the Equipped and Social lists of a character\'s sheet that is left off the character\'s avatar (the picture of the character), whatever is in it'
		});

		template.innerHTML = hideIcon;
		mark.className = 'character-sheet-hidden-mark';
		mark.title = label;
		mark.setAttribute('role', 'img');
		mark.setAttribute('aria-label', label);
		mark.append(template.content);

		return(mark);
	}

	/**
	 * A slot's menu. For those who may change the character: Choose item, which opens the dialog choosing
	 * its item, then Unequip and Inspect for an item in an Equipped slot, then Hide on avatar or Show on
	 * avatar. For others, Inspect for an item in an Equipped slot. A slot is hidden in both layers at once,
	 * so its menus in the Equipped and Social lists agree
	 *
	 * @param sheet The character
	 * @param layer The list it is in
	 * @param slot The slot
	 * @param item The item in the slot, if any
	 * @param hidden Whether the slot is hidden from the avatar
	 * @param canChange Whether the sheet offers to change the character
	 * @return The menu's button and the menu, or undefined when it would have nothing in it
	 */
	private slotMenu(sheet: CharacterSheet, layer: EquipmentLayer, slot: string, item: CharacterSheetItem | undefined, hidden: boolean, canChange: boolean): HTMLElement | undefined
	{
		const name = slotText(slot, sheet.ruleset);
		const chosen: ChosenSlot = {
			layer,
			slot
		};
		const equipped = ((layer === 'stats') ? item : undefined);
		const unequip: MenuAction[] = ((equipped === undefined)
			? []
			: [{
				label: t({
					id: 'characterSheet.unequip',
					defaultMessage: 'Unequip',
					description: 'Item in the menu beside a slot in the Equipped list of a character\'s sheet that takes the item out of the slot. The character still carries it'
				}),
				icon: unequipIcon,
				run: () =>
				{
					void this.unequip(equipped, slot);
				}
			}]);
		const inspect: MenuAction[] = ((equipped === undefined)
			? []
			: [{
				label: t(INSPECT_MESSAGES.inspect),
				icon: inspectIcon,
				run: () =>
				{
					inspectItem(equipped, sheet.ruleset);
				}
			}]);
		const choose: MenuAction = {
			label: t({
				id: 'characterSheet.slotMenu.choose',
				defaultMessage: 'Choose item',
				description: 'Item in the menu beside a slot in the Equipped and Social lists of a character\'s sheet that opens a dialog choosing the item in the slot, or taking it out'
			}),
			icon: ((layer === 'stats') ? equipIcon : wearIcon),
			run: () =>
			{
				this.chooseSlotItem(chosen);
			}
		};
		const toggleHidden: MenuAction = {
			label: (hidden
				? t({
					id: 'characterSheet.slotMenu.show',
					defaultMessage: 'Show on avatar',
					description: 'Item in the menu beside a slot in the Equipped and Social lists of a character\'s sheet, while the slot is hidden, that shows it on the character\'s avatar (the picture of the character) again'
				})
				: t({
					id: 'characterSheet.slotMenu.hide',
					defaultMessage: 'Hide on avatar',
					description: 'Item in the menu beside a slot in the Equipped and Social lists of a character\'s sheet that leaves the slot off the character\'s avatar (the picture of the character), whatever is in it'
				})),
			icon: (hidden ? showIcon : hideIcon),
			run: () =>
			{
				void this.changeLook((current) => this.api.setSlotHidden(current.universeId, current.sheet.id, slot, !hidden), () =>
				{
					this.focusSlotMenu(chosen);
				}, (current) => t({
					id: 'characterSheet.slotHiddenAnnouncement',
					defaultMessage: '{hidden, select, true {{slot} is hidden on {name}\'s avatar.} other {{slot} shows on {name}\'s avatar again.}}',
					description: 'Read out by screen readers once Hide on avatar or Show on avatar was chosen in the menu beside a slot on a character\'s sheet; {slot} is the slot\'s name, such as Shoulders, and {name} the character\'s name'
				}, {
					hidden: String(!hidden),
					slot: name,
					name: current.sheet.name
				}));
			}
		};
		const actions = (canChange ? [choose, ...unequip, ...inspect, toggleHidden] : inspect);

		if (actions.length === 0)
		{
			return(undefined);
		}

		const menu = createActionMenu(t({
			id: 'characterSheet.slotMenu',
			defaultMessage: 'Actions for {slot}',
			description: 'Name for screen readers, and tooltip, of the button of three vertical dots beside a slot in the Equipped and Social lists of a character\'s sheet, which opens a menu such as Choose item, Unequip, Inspect and Hide on avatar; {slot} is the slot\'s name, such as Shoulders'
		}, {
			slot: name
		}), actions);
		const button = menu.querySelector<HTMLButtonElement>('.action-menu-button');

		menu.classList.add('character-sheet-slot-menu');

		if (button)
		{
			button.dataset.layer = layer;
			button.dataset.slot = slot;
		}

		return(menu);
	}

	/**
	 * Opens the dialog choosing the item in a slot: the items the character carries that fit it, and Empty
	 *
	 * @param chosen The slot and its layer
	 */
	private chooseSlotItem(chosen: ChosenSlot): void
	{
		const current = this.current;

		if (!current || this.busy)
		{
			return;
		}

		const { sheet } = current;
		const { layer, slot } = chosen;
		const inSlot = ((layer === 'stats') ? sheet.equipment : sheet.socialEquipment).find((equipped) => (equipped.slot === slot));
		const name = slotText(slot, sheet.ruleset);
		const fitting = sheet.items
			.filter((item) => ((layer === 'stats') ? this.fitsStatsSlot(item, slot) : fitsSocialSlot(sheet.ruleset, item, slot)))
			.map((item) => ({
				item,
				name: itemName(item, sheet.ruleset)
			}))
			.sort((a, b) => a.name.localeCompare(b.name, currentLocale()));

		this.choosingSlot = chosen;
		this.slotTitle.textContent = ((layer === 'stats')
			? t({
				id: 'characterSheet.chooseSlotItem',
				defaultMessage: 'Equip in {slot}',
				description: 'Title of the dialog, opened by Choose item in the menu beside a slot in the Equipped list of a character\'s sheet, that chooses the item equipped there; {slot} is the slot\'s name, such as Main hand'
			}, {
				slot: name
			})
			: t({
				id: 'characterSheet.chooseSocialItem',
				defaultMessage: 'Wear on {slot} for its look',
				description: 'Title of the dialog, opened by Choose item in the menu beside a slot in the Social list of a character\'s sheet, that chooses the item worn there only for how it looks on the character\'s avatar (the picture of the character); {slot} is the slot\'s name, such as Shoulders'
			}, {
				slot: name
			}));
		this.slotAbout.textContent = ((fitting.length === 0)
			? t({
				id: 'characterSheet.nothingFits',
				defaultMessage: '{name} carries nothing that goes there.',
				description: 'In the dialog choosing the item in one of a character\'s slots, from their sheet, when they carry no item that fits the slot; {name} is the character\'s name'
			}, {
				name: sheet.name
			})
			: t({
				id: 'characterSheet.chooseItem',
				defaultMessage: 'Choose an item {name} carries.',
				description: 'In the dialog choosing the item in one of a character\'s slots, from their sheet, above the items that fit the slot; {name} is the character\'s name'
			}, {
				name: sheet.name
			}));
		showMessage(this.slotError, undefined);

		const choice = (text: string, chosenItem: CharacterSheetItem | null, isCurrent: boolean): HTMLLIElement =>
		{
			const row = document.createElement('li');
			const button = document.createElement('button');

			button.type = 'button';
			button.className = 'secondary';
			button.textContent = text;

			if (isCurrent)
			{
				button.setAttribute('aria-current', 'true');
			}

			button.addEventListener('click', () =>
			{
				void this.putInSlot(chosen, chosenItem, inSlot?.itemId ?? null);
			});
			row.append(button);

			return(row);
		};

		this.slotChoices.replaceChildren(
			choice(t(sheetMessages.empty), null, (inSlot === undefined)),
			...fitting.map(({ item, name: itemText }) => choice(itemText, item, (inSlot?.itemId === item.id)))
		);
		this.slotDialog.showModal();
		(this.slotChoices.querySelector<HTMLButtonElement>('[aria-current="true"]') ?? this.slotTitle).focus();
	}

	/**
	 * Whether an item the character carries fits one of their stats slots as the slot dialog offers it: a
	 * worn item in its place's slots, a one-handed item in either hand, a two-handed one in the main hand
	 *
	 * @param item The item
	 * @param slot The slot
	 * @return True when it fits
	 */
	private fitsStatsSlot(item: CharacterSheetItem, slot: string): boolean
	{
		const sheet = this.current?.sheet;

		return((sheet !== undefined) && fitsSlot(sheet.ruleset, item.equips, slot));
	}

	/**
	 * Puts the item chosen in the slot dialog's slot, or takes out what is there, then closes the dialog
	 * and shows the sheet with the change
	 *
	 * @param chosen The slot and its layer
	 * @param item The item, or null to empty the slot
	 * @param inSlot The item in the slot now, or null
	 */
	private async putInSlot(chosen: ChosenSlot, item: CharacterSheetItem | null, inSlot: number | null): Promise<void>
	{
		const current = this.current;

		if (!current || this.busy || ((item?.id ?? null) === inSlot))
		{
			this.slotDialog.close();
			return;
		}

		const { layer, slot } = chosen;

		const send = async (): Promise<void> =>
		{
			if (layer === 'social')
			{
				await this.api.wearSocially(current.universeId, current.sheet.id, slot, (item?.id ?? null));
			}
			else if (item === null)
			{
				await this.api.unequipItem(current.universeId, current.sheet.id, inSlot ?? 0, slot);
			}
			else
			{
				await this.api.equipItem(current.universeId, current.sheet.id, item.id, this.handFor(item, slot), this.ringFor(slot));
			}
		};

		this.busy = true;
		this.changingItems++;

		try
		{
			await send();
		}
		catch (error)
		{
			showMessage(this.slotError, describeEditorError(error, ((layer === 'stats') ? sheetMessages.equipFailed : sheetMessages.lookFailed)));
			this.finishChangingItems();
			return;
		}
		finally
		{
			this.busy = false;
		}

		this.slotDialog.close();
		showMessage(this.error, undefined);
		await this.reload(current);
		this.finishChangingItems();
		this.focusSlotMenu(chosen);
		announce(t({
			id: 'characterSheet.slotChanged',
			defaultMessage: '{item, select, none {{slot} is empty.} other {{name} has {item} in {slot}.}}',
			description: 'Read out by screen readers once the item in one of a character\'s slots was chosen from their sheet; {slot} is the slot\'s name, such as Shoulders, {name} the character\'s name, and {item} the item\'s name, or "none" when the slot was emptied'
		}, {
			item: ((item === null) ? 'none' : itemName(item, current.sheet.ruleset)),
			slot: slotText(slot, current.sheet.ruleset),
			name: current.sheet.name
		}));
	}

	/**
	 * The hands equipping an item in a slot holds it in
	 *
	 * @param item The item
	 * @param slot The slot
	 * @return Both hands for a two-handed item, the main or off hand for a one-handed item, and null for a
	 * worn one
	 */
	private handFor(item: CharacterSheetItem, slot: string): EquipHand | null
	{
		if (item.equips === 'twoHands')
		{
			return('both');
		}

		if (item.equips !== 'oneHand')
		{
			return(null);
		}

		return(((slot === 'offHand') ? 'off' : 'main'));
	}

	/**
	 * The ring slot equipping a ring in a slot puts it in
	 *
	 * @param slot The slot
	 * @return The left or right ring for a ring slot, and null for others
	 */
	private ringFor(slot: string): EquipRing | null
	{
		if (slot === 'ringLeft')
		{
			return('left');
		}

		return(((slot === 'ringRight') ? 'right' : null));
	}

	/**
	 * Puts focus on a slot's menu button in its list, once the sheet has been drawn again
	 *
	 * @param chosen The slot and its layer
	 */
	private focusSlotMenu(chosen: ChosenSlot): void
	{
		this.dialog.querySelector<HTMLButtonElement>(`.character-sheet-slot-menu .action-menu-button[data-layer="${chosen.layer}"][data-slot="${chosen.slot}"]`)?.focus();
	}

	/**
	 * Makes a change to how the character shown looks, then shows the sheet with it and reads out what
	 * changed
	 *
	 * @param send Sends the change
	 * @param refocus Puts focus back where it was, once the sheet is drawn again
	 * @param announcement What to read out once it is made
	 */
	private async changeLook(send: (current: ShownCharacter) => Promise<void>, refocus: () => void, announcement: (current: ShownCharacter) => string): Promise<void>
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
			await send(current);
		}
		catch (error)
		{
			showMessage(this.error, describeEditorError(error, sheetMessages.lookFailed));
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
		refocus();
		announce(announcement(current));
	}

	/**
	 * Opens the Appearance dialog with the character's art type and background, and their body type for
	 * the universe's creators
	 */
	private openAppearance(): void
	{
		const current = this.current;

		if (!current)
		{
			return;
		}

		this.appearanceChoices.show(current.sheet.ruleset, current.sheet.avatarKey, current.sheet.appearance, current.canChangeBodyType);
		showMessage(this.appearanceError, undefined);
		this.appearanceSave.disabled = false;
		this.appearanceDialog.showModal();
		this.appearanceTracker.markSaved();
	}

	/**
	 * Saves the Appearance dialog's choices, then closes it and shows the sheet with the new avatar
	 */
	private async saveAppearance(): Promise<void>
	{
		const current = this.current;

		if (!current || this.busy)
		{
			return;
		}

		const appearance: CharacterAppearance = {
			...this.appearanceChoices.value(),
			bodyType: (current.canChangeBodyType ? this.appearanceChoices.value().bodyType : current.sheet.appearance.bodyType)
		};

		this.busy = true;
		this.appearanceSave.disabled = true;
		this.changingItems++;

		try
		{
			await this.api.changeAppearance(current.universeId, current.sheet.id, appearance);
		}
		catch (error)
		{
			showMessage(this.appearanceError, describeEditorError(error, sheetMessages.lookFailed));
			this.finishChangingItems();
			return;
		}
		finally
		{
			this.busy = false;
			this.appearanceSave.disabled = false;
		}

		this.appearanceTracker.markSaved();
		this.appearanceDialog.close();
		await this.reload(current);
		this.finishChangingItems();
		this.appearanceButton.focus();
		announce(t({
			id: 'characterSheet.appearanceSaved',
			defaultMessage: '{name}\'s appearance has changed.',
			description: 'Read out by screen readers once the Appearance dialog on a character\'s sheet saved how their avatar (the picture of the character) is drawn; {name} is the character\'s name'
		}, {
			name: current.sheet.name
		}));
	}

	/**
	 * Lists the items the character carries and hasn't equipped by name, the way the player's language
	 * sorts them, with how many of each, and a menu beside each of what can be done with it: everything
	 * for those who may change the character, and Inspect for others. Equipped items show in the Equipped
	 * list instead, so an item of which some are equipped lists how many are left
	 *
	 * @param sheet The character
	 * @param canChange Whether the sheet offers to change the character
	 */
	private showItems(sheet: CharacterSheet, canChange: boolean): void
	{
		const items = sheet.items
			.map((item) => ({
				item,
				name: itemName(item, sheet.ruleset),
				left: (item.quantity - equippedCount(sheet.equipment, item.id))
			}))
			.filter(({ left }) => (left > 0))
			.sort((a, b) => a.name.localeCompare(b.name, currentLocale()));

		this.items.replaceChildren(...items.map(({ item, name, left }) =>
		{
			const row = document.createElement('li');
			const text = document.createElement('span');

			text.textContent = t({
				id: 'characterSheet.item',
				defaultMessage: '{quantity, plural, =1 {{item}} other {{item} x#}}',
				description: 'On a character\'s sheet, an item they carry and haven\'t equipped, with how many when there is more than one; {item} is the item\'s name, e.g. "Arrow x20"'
			}, {
				item: name,
				quantity: left
			});
			row.append(createItemIcon(item.category, sheet.ruleset), text, this.createItemMenu(sheet, item, name, canChange));

			return(row);
		}));
		this.noItems.hidden = (sheet.items.length > 0);
		this.allEquipped.hidden = ((items.length > 0) || (sheet.items.length === 0));
	}

	/**
	 * The menu beside an item of what can be done with it: Equip (in a hand of the player's choosing for
	 * an item held in one, and as the left or right ring for a ring while both ring slots are full),
	 * Wear socially, Give, Inspect and Discard for those who may change the character, and Inspect for others.
	 * Each way to equip it is offered when it changes something (equipChangesNothing()); Give while the
	 * character is in a group with others
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
			label: t(INSPECT_MESSAGES.inspect),
			icon: inspectIcon,
			run: () =>
			{
				inspectItem(item, sheet.ruleset);
			}
		};

		if (canChange)
		{
			const fits = characterSlots(sheet.ruleset, sheet.hasTail).some((slot) => fitsSlot(sheet.ruleset, item.equips, slot));
			const changesSomething = (hand: EquipHand | null, ring: EquipRing | null): boolean => !equipChangesNothing(sheet.ruleset, sheet.equipment, item, item.quantity, hand, sheet.hasTail, ring);
			const rings = ringChoices(sheet.ruleset, sheet.equipment, item);

			if (fits && (rings.length > 0))
			{
				actions.push(...rings
					.filter((ring) => changesSomething(null, ring))
					.map((ring) => this.equipAction(item, t(EQUIP_AS_RING[ring]), null, ring)));
			}
			else if (fits && (item.equips !== 'oneHand'))
			{
				if (changesSomething(null, null))
				{
					actions.push(this.equipAction(item, t({
						id: 'characterSheet.equip',
						defaultMessage: 'Equip',
						description: 'Item in the menu beside an item on a character\'s sheet that equips it: puts on an item that is worn, or takes up one held in two hands. What was in its slot is unequipped'
					}), null, null));
				}
			}
			else if (fits)
			{
				actions.push(...handChoices(item)
					.filter((hand) => changesSomething(hand, null))
					.map((hand) => this.equipAction(item, t(EQUIP_IN_HAND[hand]), hand, null)));
			}

			const socialSlot = socialSlotFor(sheet.ruleset, sheet.socialEquipment, item);

			if ((socialSlot !== undefined) && !sheet.socialEquipment.some((worn) => ((worn.slot === socialSlot) && (worn.itemId === item.id))))
			{
				actions.push({
					label: t({
						id: 'characterSheet.wearSocially',
						defaultMessage: 'Wear socially',
						description: 'Item in the menu beside an item on a character\'s sheet that wears it in its social slot: only for how it looks on the character\'s avatar (the picture of the character), in place of what is equipped there. It gives nothing'
					}),
					icon: wearIcon,
					run: () =>
					{
						void this.changeLook((shown) => this.api.wearSocially(shown.universeId, shown.sheet.id, socialSlot, item.id), () =>
						{
							this.focusItemMenu(item.id);
						}, (shown) => t({
							id: 'characterSheet.woreSocially',
							defaultMessage: '{name} wears {item} on {slot} for its look.',
							description: 'Read out by screen readers once an item was worn in a social slot from its menu on a character\'s sheet; {name} is the character\'s name, {item} the item\'s name and {slot} the slot\'s name, such as Shoulders'
						}, {
							name: shown.sheet.name,
							item: itemName(item, shown.sheet.ruleset),
							slot: slotText(socialSlot, shown.sheet.ruleset)
						}));
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
	 * @param ring The ring slot to put a ring in, or null for a free one
	 * @return The menu item
	 */
	private equipAction(item: CharacterSheetItem, label: string, hand: EquipHand | null, ring: EquipRing | null): MenuAction
	{
		return({
			label,
			icon: equipIcon,
			run: () =>
			{
				void this.equip(item, hand, ring);
			}
		});
	}
}
