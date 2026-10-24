import { getElement, setButtonLabel } from './dom';

/**
 * What the confirmation dialog asks
 */
export interface Confirmation
{
	title: string;
	question: string;

	/**
	 * The button that confirms, such as "Delete"
	 */
	confirmLabel: string;

	/**
	 * The confirm button's icon's SVG markup, from a virtual:icon import
	 */
	confirmIcon: string;
}

/**
 * Asks the player to confirm something in a dialog on the page, in place of the browser's window.confirm:
 * a title, the question, Cancel and a button that confirms. Cancel, Escape and closing the dialog say no.
 * Needs the confirm-dialog markup on the page (see edit.html)
 *
 * @param confirmation What to ask
 * @return Resolves true when the player confirms
 */
export function askToConfirm(confirmation: Confirmation): Promise<boolean>
{
	const dialog = getElement('confirm-dialog', HTMLDialogElement);
	const form = getElement('confirm-form', HTMLFormElement);
	const cancelButton = getElement('confirm-cancel', HTMLButtonElement);
	const confirmButton = getElement('confirm-submit', HTMLButtonElement);

	getElement('confirm-title', HTMLElement).textContent = confirmation.title;
	getElement('confirm-question', HTMLElement).textContent = confirmation.question;
	setButtonLabel(confirmButton, confirmation.confirmIcon, confirmation.confirmLabel);

	return(new Promise((resolve) =>
	{
		let confirmed = false;

		/**
		 * Confirms, from the form's submit button
		 *
		 * @param event The submit
		 */
		const onSubmit = (event: SubmitEvent): void =>
		{
			event.preventDefault();
			confirmed = true;
			dialog.close();
		};

		/**
		 * Says no, from Cancel
		 */
		const onCancel = (): void =>
		{
			dialog.close();
		};

		form.addEventListener('submit', onSubmit);
		cancelButton.addEventListener('click', onCancel);
		dialog.addEventListener('close', () =>
		{
			form.removeEventListener('submit', onSubmit);
			cancelButton.removeEventListener('click', onCancel);
			resolve(confirmed);
		}, { once: true });

		dialog.showModal();

		// Cancel takes focus, so pressing Enter by habit doesn't confirm
		cancelButton.focus();
	}));
}
