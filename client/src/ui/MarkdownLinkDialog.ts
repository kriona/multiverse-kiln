import { t } from '../localization';
import { ChangeTracker } from './changeTracker';
import { getElement } from './dom';
import { clearFieldErrors, reportFieldError } from './fieldErrors';
import { ALLOWED_LINK } from './markdown';

/**
 * The dialog that asks for a link's address in a Markdown field's rich text (edit.html). An address
 * without a scheme is taken as a web page, or as an email address when it has an @
 */
export class MarkdownLinkDialog
{
	private readonly dialog = getElement('markdown-link-dialog', HTMLDialogElement);
	private readonly form = getElement('markdown-link-form', HTMLFormElement);
	private readonly address = getElement('markdown-link-address', HTMLInputElement);
	private readonly removeButton = getElement('markdown-link-remove', HTMLButtonElement);

	/**
	 * Whether the address has changed since the dialog opened
	 */
	private readonly changes = new ChangeTracker({ root: this.form });

	/**
	 * Called with the address once it is applied, or with null to remove the link
	 */
	private onApply: ((address: string | null) => void) | undefined;

	constructor()
	{
		this.changes.guardDialog(this.dialog);

		getElement('markdown-link-cancel', HTMLButtonElement).addEventListener('click', () =>
		{
			if (this.changes.confirmDiscard())
			{
				this.dialog.close();
			}
		});

		this.removeButton.addEventListener('click', () =>
		{
			this.finish(null);
		});

		this.form.addEventListener('submit', (event) =>
		{
			event.preventDefault();
			this.apply();
		});

		this.dialog.addEventListener('close', () =>
		{
			this.onApply = undefined;
		});
	}

	/**
	 * Opens the dialog
	 *
	 * @param href The link's address, or undefined when adding a link
	 * @param onApply Called with the address once it is applied, or with null to remove the link
	 */
	open(href: string | undefined, onApply: (address: string | null) => void): void
	{
		this.onApply = onApply;
		this.address.value = (href ?? '');
		this.removeButton.hidden = (href === undefined);
		clearFieldErrors(this.form);
		this.dialog.showModal();
		this.changes.markSaved();
		this.address.focus();
	}

	/**
	 * Applies the address typed, unless it isn't one a description may link to
	 */
	private apply(): void
	{
		const address = linkAddress(this.address.value);

		if (address === undefined)
		{
			reportFieldError(this.address, t({
				id: 'markdown.linkDialog.invalid',
				defaultMessage: 'Enter a web or email address.',
				description: 'Shown under the address in the dialog that adds a link to a Markdown field\'s rich text, such as a universe\'s long description, when it isn\'t a web or email address'
			}));
			return;
		}

		this.finish(address);
	}

	/**
	 * Closes the dialog and hands on the link's address
	 *
	 * @param address The address, or null to remove the link
	 */
	private finish(address: string | null): void
	{
		const onApply = this.onApply;

		this.changes.markSaved();
		this.dialog.close();
		onApply?.(address);
	}
}

/**
 * The address a link goes to, from what was typed
 *
 * @param typed What was typed
 * @return The address with its scheme, or undefined when it isn't a web or email address
 */
function linkAddress(typed: string): string | undefined
{
	const text = typed.trim();
	let address = text;

	if (!/^[a-z][a-z\d+.-]*:/i.test(text))
	{
		address = (/^[^\s/@]+@[^\s/@]+$/.test(text) ? `mailto:${text}` : `https://${text}`);
	}

	return(((text !== '') && ALLOWED_LINK.test(address) && URL.canParse(address)) ? address : undefined);
}
