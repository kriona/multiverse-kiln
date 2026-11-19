import type { CharacterSheet, CharacterSheetItem } from '@multiverse-kiln/shared';

import { t } from '../localization';
import { describeEditorError } from '../network/editorApi';
import { getElement, showMessage } from './dom';
import { unequipNote } from './equipmentText';
import { clearFieldErrors, reportFieldError, setFieldError } from './fieldErrors';
import { formMessages } from './formMessages';
import { itemName } from './itemNames';
import { characterLabel } from './raceAndClassNames';

/**
 * Gives some of an item to another character; rejects when it couldn't
 */
export type GiveItem = (receiverId: string, quantity: number) => Promise<void>;

/**
 * What a Give dialog is about while it is open
 */
interface Giving
{
	sheet: CharacterSheet;
	item: CharacterSheetItem;
	give: GiveItem;

	/**
	 * Called once the items are given, with the name of the character given them and how many
	 */
	given: (receiver: string, quantity: number) => void;

	/**
	 * Where a failure shows when the dialog was closed while the items were being sent, such as the
	 * sheet's own error
	 */
	pageError: HTMLElement;
}

/**
 * The dialog opened by Give in an item's menu on a character's sheet (pages that use it include
 * partials/character-sheet.html): "Give [item]", choosing another character in the group, by name, race
 * and class, the player's own included, and for more than one of the item, how many, 1 to start with.
 * It says which equipped ones giving them unequips. The items arrive at once, wherever the other character is
 */
export class GiveItemDialog
{
	private readonly dialog = getElement('character-give-dialog', HTMLDialogElement);
	private readonly form = getElement('character-give-form', HTMLFormElement);
	private readonly title = getElement('character-give-title', HTMLElement);
	private readonly receiver = getElement('character-give-receiver', HTMLSelectElement);
	private readonly quantityLabel = getElement('character-give-quantity-label', HTMLLabelElement);
	private readonly quantityText = getElement('character-give-quantity-text', HTMLElement);
	private readonly quantity = getElement('character-give-quantity', HTMLInputElement);
	private readonly unequips = getElement('character-give-unequips', HTMLElement);
	private readonly error = getElement('character-give-error', HTMLElement);
	private readonly confirm = getElement('character-give-confirm', HTMLButtonElement);
	private readonly cancel = getElement('character-give-cancel', HTMLButtonElement);

	/**
	 * What the dialog is about, while it is open
	 */
	private giving: Giving | undefined;

	/**
	 * Whether the items have been sent and the server hasn't answered
	 */
	private busy = false;

	/**
	 * Sets up the dialog's form and buttons
	 */
	constructor()
	{
		this.cancel.addEventListener('click', () =>
		{
			this.dialog.close();
		});

		this.dialog.addEventListener('close', () =>
		{
			this.giving = undefined;
		});

		// Escape doesn't close the dialog while the items are being sent
		this.dialog.addEventListener('cancel', (event) =>
		{
			if (this.busy)
			{
				event.preventDefault();
			}
		});

		this.quantity.addEventListener('input', () =>
		{
			setFieldError(this.quantity, undefined);
			this.showUnequips();
		});

		this.form.addEventListener('submit', (event) =>
		{
			event.preventDefault();
			void this.submit();
		});
	}

	/**
	 * Opens the dialog
	 *
	 * @param sheet The character giving the item, who is in a group with other characters
	 * @param item The item, as the sheet lists it
	 * @param give Gives the items
	 * @param given Called once they are given
	 * @param pageError Where a failure shows when the dialog was closed while the items were being sent
	 */
	open(sheet: CharacterSheet, item: CharacterSheetItem, give: GiveItem, given: (receiver: string, quantity: number) => void, pageError: HTMLElement): void
	{
		const members = (sheet.group?.members ?? []);
		const several = (item.quantity > 1);

		this.giving = {
			sheet,
			item,
			give,
			given,
			pageError
		};
		this.title.textContent = t({
			id: 'characterSheet.giveItemTitle',
			defaultMessage: 'Give {item}',
			description: 'Title of the dialog, opened by Give in an item\'s menu on a character\'s sheet, that gives the item to another character in their group; {item} is the item\'s name'
		}, {
			item: itemName(item, sheet.ruleset)
		});
		this.receiver.replaceChildren(...members.map((member) =>
		{
			const option = document.createElement('option');

			option.value = member.characterId;
			option.textContent = characterLabel(member, sheet.ruleset);

			return(option);
		}));
		this.quantityText.textContent = t({
			id: 'characterSheet.giveQuantity',
			defaultMessage: 'Choose how many to give, up to {max, number}',
			description: 'Label of the field, in the dialog that gives an item a character carries to another character in their group, for how many of it to give, shown when they carry more than one; {max} is how many they carry'
		}, {
			max: item.quantity
		});
		clearFieldErrors(this.dialog);
		showMessage(this.error, undefined);
		this.quantityLabel.hidden = !several;
		this.quantity.max = String(item.quantity);
		this.quantity.value = '1';
		this.quantity.style.setProperty('--digits', String(String(item.quantity).length));
		this.confirm.disabled = false;
		this.cancel.disabled = false;
		this.showUnequips();
		this.dialog.showModal();
		this.receiver.focus();
	}

	/**
	 * Says which equipped ones giving as many as the field says unequips
	 */
	private showUnequips(): void
	{
		const giving = this.giving;
		const quantity = this.chosenQuantity();
		const note = ((giving && Number.isInteger(quantity)) ? unequipNote(giving.sheet.ruleset, giving.sheet.equipment, giving.item.id, (giving.item.quantity - quantity)) : '');

		this.unequips.textContent = note;
		this.unequips.hidden = (note === '');
	}

	/**
	 * How many to give: the field's number, or 1 when the character carries only one
	 *
	 * @return The number, which may not be a whole number in range
	 */
	private chosenQuantity(): number
	{
		return((((this.giving?.item.quantity ?? 1) > 1) ? this.quantity.valueAsNumber : 1));
	}

	/**
	 * Gives as many of the item as the field says to the character chosen
	 */
	private async submit(): Promise<void>
	{
		const giving = this.giving;

		if (!giving || this.busy)
		{
			return;
		}

		const { item } = giving;
		const quantity = this.chosenQuantity();
		const receiver = giving.sheet.group?.members.find((member) => (member.characterId === this.receiver.value));

		if (!Number.isInteger(quantity) || (quantity < 1) || (quantity > item.quantity))
		{
			reportFieldError(this.quantity, t(formMessages.wholeNumber, {
				min: 1,
				max: item.quantity
			}));
			return;
		}

		if (!receiver)
		{
			return;
		}

		this.busy = true;
		this.confirm.disabled = true;
		this.cancel.disabled = true;

		try
		{
			await giving.give(receiver.characterId, quantity);
		}
		catch (error)
		{
			// Shown on the page when the dialog was closed anyway, such as by a browser that lets Escape close it
			showMessage((this.dialog.open ? this.error : giving.pageError), describeEditorError(error, {
				id: 'characterSheet.giveItemFailed',
				defaultMessage: 'Could not give the items.',
				description: 'Shown in the dialog, opened by Give in an item\'s menu on a character\'s sheet, when the item couldn\'t be given to the character chosen'
			}));
			return;
		}
		finally
		{
			this.busy = false;
			this.confirm.disabled = false;
			this.cancel.disabled = false;
		}

		this.dialog.close();
		giving.given(receiver.name, quantity);
	}
}

/**
 * The page's Give dialog, made the first time something is given, so a page with more than one sheet
 * sets up its form once
 */
let shared: GiveItemDialog | undefined;

/**
 * The page's Give dialog
 *
 * @return The dialog
 */
export function giveItemDialog(): GiveItemDialog
{
	shared ??= new GiveItemDialog();

	return(shared);
}
