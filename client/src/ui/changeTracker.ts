import { defineMessages } from '@multiverse-kiln/shared';

import { t } from '../localization';

/**
 * Text the change tracker shows (see src/localization.ts)
 */
const messages = defineMessages({
	unsavedChanges: {
		id: 'form.unsavedChanges',
		defaultMessage: 'Unsaved changes',
		description: 'Shown next to a form\'s Save button while it has changes that haven\'t been saved'
	},
	discardChanges: {
		id: 'form.discardChanges',
		defaultMessage: 'You have changes that haven\'t been saved. Discard them?',
		description: 'Asked before closing a form or dialog that has unsaved changes; the browser\'s OK discards them and Cancel goes back to the form'
	}
});

/**
 * Something on the page that may hold work not yet saved, such as a form or painting still being sent
 */
export interface UnsavedWork
{
	/**
	 * Whether it holds work that would be lost if the page closed now
	 */
	hasUnsavedChanges(): boolean;
}

/**
 * Everything on the page that may hold unsaved work
 */
const unsavedWork = new Set<UnsavedWork>();

/**
 * Whether the page is asking the browser to warn before it closes
 */
let warningOnLeave = false;

/**
 * Asks the browser to warn that work would be lost before the page closes, reloads or goes to another page
 *
 * @param event The browser's beforeunload event
 */
function warnBeforeLeaving(event: BeforeUnloadEvent): void
{
	event.preventDefault();
}

/**
 * Adds something that may hold unsaved work. While anything does, leaving the page makes the browser
 * ask first. Call refreshUnsavedWork() whenever whether it holds unsaved work may have changed
 *
 * @param work The work
 * @return Removes it again
 */
export function watchUnsavedWork(work: UnsavedWork): () => void
{
	unsavedWork.add(work);
	refreshUnsavedWork();

	return(() =>
	{
		unsavedWork.delete(work);
		refreshUnsavedWork();
	});
}

/**
 * Whether anything on the page holds unsaved work
 *
 * @return True when leaving the page now would lose something
 */
export function hasUnsavedWork(): boolean
{
	return([...unsavedWork].some((work) => work.hasUnsavedChanges()));
}

/**
 * Asks the browser to warn before the page closes exactly while something holds unsaved work. The
 * warning is only listened for while it is needed, since browsers don't keep pages that listen for it
 * in their back-forward cache
 */
export function refreshUnsavedWork(): void
{
	const warn = hasUnsavedWork();

	if (warn === warningOnLeave)
	{
		return;
	}

	warningOnLeave = warn;

	if (warn)
	{
		window.addEventListener('beforeunload', warnBeforeLeaving);
	}
	else
	{
		window.removeEventListener('beforeunload', warnBeforeLeaving);
	}
}

/**
 * How a ChangeTracker follows a form
 */
export interface ChangeTrackerOptions
{
	/**
	 * The form or dialog whose fields to watch. A field with the data-untracked attribute is left out,
	 * such as a search field that only filters a list
	 */
	root: HTMLElement;

	/**
	 * What the form holds outside its fields, such as an area chosen in another dialog, compared as JSON
	 */
	state?: () => unknown;

	/**
	 * Shows "Unsaved changes" while there are any, such as the status next to the form's Save button.
	 * Other text in it, such as "Saved", is left alone
	 */
	status?: HTMLElement;
}

/**
 * Follows whether a form or dialog has changes that haven't been saved, by comparing its fields with
 * how they were when it was last loaded or saved (markSaved). While it has some, it says so next to the
 * Save button, tells its listeners, makes the browser ask before the page closes, and asks before the
 * form is closed or replaced (confirmDiscard)
 *
 * A dialog's tracker counts only while the dialog is open, and asks before Escape closes it (guardDialog)
 */
export class ChangeTracker implements UnsavedWork
{
	/**
	 * The fields and state as they were last loaded or saved, as JSON
	 */
	private saved: string;

	private unsaved = false;

	/**
	 * Whether the form is showing, so its changes could be lost; always, unless guardDialog says otherwise
	 */
	private isActive: () => boolean = () => true;

	private readonly listeners = new Set<(unsaved: boolean) => void>();

	/**
	 * @param options The form, what else it holds, and where to say it has unsaved changes
	 */
	constructor(private readonly options: ChangeTrackerOptions)
	{
		this.saved = this.read();

		for (const type of ['input', 'change'])
		{
			options.root.addEventListener(type, () =>
			{
				this.check();
			});
		}

		watchUnsavedWork(this);
	}

	/**
	 * Whether the form has changes that haven't been saved
	 *
	 * @return True when it has, and is showing
	 */
	hasUnsavedChanges(): boolean
	{
		return(this.unsaved);
	}

	/**
	 * Takes the form as it is now as saved: call once it has loaded, after it saves, and after its
	 * changes are discarded
	 */
	markSaved(): void
	{
		this.saved = this.read();
		this.check();
	}

	/**
	 * Compares the form with how it was saved. The fields' own changes are noticed by themselves; call
	 * this after changing the form's state or its fields from code
	 */
	check(): void
	{
		const unsaved = (this.isActive() && (this.read() !== this.saved));
		const status = this.options.status;
		const statusText = t(messages.unsavedChanges);

		if (status)
		{
			if (unsaved)
			{
				status.textContent = statusText;
			}
			else if (status.textContent === statusText)
			{
				status.textContent = '';
			}
		}

		if (unsaved === this.unsaved)
		{
			return;
		}

		this.unsaved = unsaved;
		refreshUnsavedWork();

		for (const listener of this.listeners)
		{
			listener(unsaved);
		}
	}

	/**
	 * Hears when the form starts or stops having unsaved changes
	 *
	 * @param listener Called with whether it has them
	 * @return Stops listening
	 */
	subscribe(listener: (unsaved: boolean) => void): () => void
	{
		this.listeners.add(listener);

		return(() =>
		{
			this.listeners.delete(listener);
		});
	}

	/**
	 * Asks the player whether to throw away the form's unsaved changes, before something closes or replaces it
	 *
	 * @return True when there is nothing to lose or the player chose to discard it, so the form may close
	 */
	confirmDiscard(): boolean
	{
		this.check();

		if (!this.unsaved)
		{
			return(true);
		}

		if (!window.confirm(t(messages.discardChanges)))
		{
			return(false);
		}

		this.markSaved();

		return(true);
	}

	/**
	 * Makes the tracker follow a dialog: its changes count only while it is open, and Escape asks before
	 * closing it over unsaved changes. Its Cancel button should ask too, with confirmDiscard()
	 *
	 * @param dialog The dialog
	 */
	guardDialog(dialog: HTMLDialogElement): void
	{
		this.isActive = () => dialog.open;

		dialog.addEventListener('cancel', (event) =>
		{
			if (!this.confirmDiscard())
			{
				event.preventDefault();
			}
		});

		dialog.addEventListener('close', () =>
		{
			this.check();
		});
	}

	/**
	 * The form's fields and state, as JSON
	 *
	 * @return The JSON
	 */
	private read(): string
	{
		const fields = this.options.root.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input, select, textarea');
		const values = [...fields]
			.filter((field) => !field.hasAttribute('data-untracked') && !['button', 'submit', 'reset'].includes(field.type))
			.map((field) => (((field instanceof HTMLInputElement) && ((field.type === 'checkbox') || (field.type === 'radio'))) ? field.checked : field.value));

		return(JSON.stringify([values, this.options.state?.()]));
	}
}
