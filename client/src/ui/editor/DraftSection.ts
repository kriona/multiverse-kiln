import { canManageVersions, defineMessages, type EditableUniverse, type EditorChange } from '@multiverse-kiln/shared';
import trashIcon from 'virtual:icon/ph:trash';
import rocketIcon from 'virtual:icon/ph:rocket-launch';

import { t } from '../../localization';
import { describeEditorError } from '../../network/editorApi';
import { refreshUnsavedWork, watchUnsavedWork } from '../changeTracker';
import { askToConfirm } from '../confirmDialog';
import { getElement, showMessage } from '../dom';
import type { EditorSave } from './editorSave';
import type { SavableTab } from './SaveBar';
import type { ChangeSource } from './stagedChanges';

/**
 * What a save does to the universe's draft
 */
export type DraftAction = 'start' | 'apply' | 'discard';

const messages = defineMessages({
	saveOthersFirst: {
		id: 'editor.draft.saveOthersFirst',
		defaultMessage: 'Save or undo your other changes first.',
		description: 'In the dialogs asking to confirm applying or discarding the universe\'s draft, and on the editor\'s Universe tab, while other changes are unsaved: the draft is applied as it is saved, and discarding it would throw them away'
	}
});

/**
 * Starting, applying and discarding the universe's draft (see Universe versions in STRUCTURE-OVERVIEW.md),
 * for creators. Apply Draft and Discard Draft in the editor's toolbar ask first, then save at once, as
 * the toolbar's Start Draft does (StartDraftDialog); each waits until no other change is unsaved. The
 * action is saved after every other tab's changes. A save that is refused leaves it waiting in a
 * section of the Universe tab, which says why and can undo it
 */
export class DraftSection implements SavableTab
{
	private readonly section = getElement('universe-draft', HTMLElement);
	private readonly status = getElement('universe-draft-status', HTMLElement);
	private readonly undoButton = getElement('universe-draft-undo', HTMLButtonElement);
	private readonly error = getElement('universe-draft-error', HTMLElement);
	private readonly applyButton = getElement('editor-apply-draft', HTMLButtonElement);
	private readonly discardButton = getElement('editor-discard-draft', HTMLButtonElement);

	/**
	 * The universe as it was last loaded
	 */
	private universe: EditableUniverse | undefined;

	/**
	 * What will happen to the draft when the editor is saved, or undefined for nothing
	 */
	private action: DraftAction | undefined;

	/**
	 * The action the save being sent holds
	 */
	private collected: DraftAction | undefined;

	private readonly listeners = new Set<(unsaved: boolean) => void>();

	/**
	 * Whether an action is waiting to be saved
	 */
	readonly changes: ChangeSource = {
		hasUnsavedChanges: () => (this.action !== undefined),
		subscribe: (listener) =>
		{
			this.listeners.add(listener);

			return(() =>
			{
				this.listeners.delete(listener);
			});
		}
	};

	/**
	 * @param otherChanges Whether any other tab has unsaved changes, which applying and discarding wait for
	 * @param save Saves the editor, saying the changes were saved or not; resolves whether it saved
	 * @param onSaved Called with what the save did to the draft, once it is saved
	 */
	constructor(private readonly otherChanges: () => boolean, private readonly save: (announce: boolean) => Promise<boolean>, private readonly onSaved: (action: DraftAction) => void)
	{
		watchUnsavedWork(this.changes);

		this.applyButton.addEventListener('click', () =>
		{
			void this.confirmApply();
		});

		this.discardButton.addEventListener('click', () =>
		{
			void this.confirmDiscard();
		});

		this.undoButton.addEventListener('click', () =>
		{
			this.stage(undefined);
		});
	}

	/**
	 * Shows the toolbar's Apply Draft and Discard Draft while the universe has a draft, for a player whose
	 * role may apply and discard it
	 *
	 * @param universe The universe, in the version the editor has open
	 * @param locked Whether saving is turned off, for a universe a server admin has disabled
	 */
	open(universe: EditableUniverse, locked: boolean): void
	{
		const shown = (universe.hasDraft && canManageVersions(universe.role) && !locked);

		this.universe = universe;
		this.applyButton.hidden = !shown;
		this.discardButton.hidden = !shown;
		showMessage(this.error, undefined);
		this.stage(undefined);
	}

	/**
	 * Whether the player may start, apply and discard the draft
	 *
	 * @return True for a creator
	 */
	canSave(): boolean
	{
		return((this.universe !== undefined) && canManageVersions(this.universe.role));
	}

	/**
	 * Asks the player to confirm applying the draft, which can't be undone, then applies it
	 */
	private async confirmApply(): Promise<void>
	{
		const waiting = this.otherChanges();
		const confirmed = await askToConfirm({
			title: t({
				id: 'editor.draft.applyTitle',
				defaultMessage: 'Apply the draft?',
				description: 'Title of the dialog asking to confirm applying the universe\'s draft to the live version'
			}),
			question: t({
				id: 'editor.draft.applyQuestion',
				defaultMessage: 'Players will see everything changed in the draft at once. Changes saved to the live version since the draft was started are replaced by the draft\'s. This can\'t be undone.',
				description: 'Question in the dialog asking to confirm applying the universe\'s draft to the live version, which players play'
			}),
			note: (waiting ? t(messages.saveOthersFirst) : undefined),
			confirmLabel: t({
				id: 'editor.draft.applyConfirm',
				defaultMessage: 'Apply Draft',
				description: 'Button in the dialog asking to confirm applying the universe\'s draft, which applies it'
			}),
			confirmIcon: rocketIcon,
			confirmDisabled: waiting
		});

		if (confirmed)
		{
			await this.stageAndSave('apply', false);
		}
	}

	/**
	 * Asks the player to confirm discarding the draft, then discards it
	 */
	private async confirmDiscard(): Promise<void>
	{
		const waiting = this.otherChanges();
		const confirmed = await askToConfirm({
			title: t({
				id: 'editor.draft.discardTitle',
				defaultMessage: 'Discard the draft?',
				description: 'Title of the dialog asking to confirm deleting the universe\'s draft'
			}),
			question: t({
				id: 'editor.draft.discardQuestion',
				defaultMessage: 'Everything changed in the draft will be discarded. The live version remains unchanged.',
				description: 'Question in the dialog asking to confirm deleting the universe\'s draft'
			}),
			note: (waiting ? t(messages.saveOthersFirst) : undefined),
			confirmLabel: t({
				id: 'editor.draft.discardConfirm',
				defaultMessage: 'Discard Draft',
				description: 'Button in the dialog asking to confirm deleting the universe\'s draft, which deletes it'
			}),
			confirmIcon: trashIcon,
			confirmDisabled: waiting
		});

		if (confirmed)
		{
			await this.stageAndSave('discard', false);
		}
	}

	/**
	 * Starts, applies or discards the draft at once: stages it and saves the editor. A save the player
	 * cancels (in the dialog asking what happens to players) takes it back; one the server refuses leaves
	 * it waiting on the Universe tab, saying why
	 *
	 * @param action The action
	 * @param announce Whether the save says the changes were saved, for other changes saved with it
	 */
	async stageAndSave(action: DraftAction, announce: boolean): Promise<void>
	{
		showMessage(this.error, undefined);
		this.stage(action);

		if (!await this.save(announce) && this.section.hidden)
		{
			this.stage(undefined);
		}
	}

	/**
	 * Chooses what will happen to the draft when the editor is saved, and shows it on the Universe tab while
	 * it waits
	 *
	 * @param action The action, or undefined for nothing
	 */
	private stage(action: DraftAction | undefined): void
	{
		const changed = (action !== this.action);

		this.action = action;
		this.status.textContent = ((action === undefined) ? '' : this.describe(action));

		if (action === undefined)
		{
			showMessage(this.error, undefined);
			this.section.hidden = true;
		}

		if (changed)
		{
			refreshUnsavedWork();

			for (const listener of this.listeners)
			{
				listener(action !== undefined);
			}
		}
	}

	/**
	 * Shows the Universe tab's section once a save holding the action is refused, saying why
	 *
	 * @param message Why
	 */
	private showRefused(message: string): void
	{
		this.section.hidden = false;
		showMessage(this.error, message);
	}

	/**
	 * What the Universe tab says about an action waiting to be saved
	 *
	 * @param action The action
	 * @return The text
	 */
	private describe(action: DraftAction): string
	{
		switch (action)
		{
			case 'start':
				return(t({
					id: 'editor.draft.startStaged',
					defaultMessage: 'A draft will be started when the editor is saved, as a copy of the live version with the other changes being saved.',
					description: 'On the editor\'s Universe tab once a draft is started from the dialog the toolbar\'s Start Draft opens, until the editor is saved; it shows only when that save was refused'
				}));

			case 'apply':
				return(t({
					id: 'editor.draft.applyStaged',
					defaultMessage: 'The draft will be applied to the live version when the editor is saved.',
					description: 'On the editor\'s Universe tab once Apply Draft in the toolbar is confirmed, until the editor is saved; it shows only when that save was refused'
				}));

			case 'discard':
				return(t({
					id: 'editor.draft.discardStaged',
					defaultMessage: 'The draft will be discarded when the editor is saved.',
					description: 'On the editor\'s Universe tab once Discard Draft in the toolbar is confirmed, until the editor is saved; it shows only when that save was refused'
				}));
		}
	}

	/**
	 * Adds the waiting action to a save, after the other tabs' changes
	 *
	 * @param save The save
	 * @return False when the draft can't be applied or discarded yet, because other changes aren't saved
	 */
	collect(save: EditorSave): boolean
	{
		const action = this.action;

		if (action === undefined)
		{
			return(true);
		}

		if ((action !== 'start') && this.otherChanges())
		{
			this.showRefused(t(messages.saveOthersFirst));
			return(false);
		}

		const changes: Record<DraftAction, EditorChange> = {
			start: { kind: 'startDraft' },
			apply: { kind: 'applyDraft', choices: { races: {}, classes: {}, items: {}, areas: {} } },
			discard: { kind: 'discardDraft' }
		};

		showMessage(this.error, undefined);
		this.collected = action;
		save.add(changes[action], (refusal) =>
		{
			this.showRefused(describeEditorError(refusal.error, {
				id: 'editor.draft.saveFailed',
				defaultMessage: 'Could not change the draft.',
				description: 'Shown on the editor\'s Universe tab when the server refused starting, applying or discarding the draft, followed by why; nothing was saved'
			}));
		});

		return(true);
	}

	/**
	 * Takes the action as saved, and tells the editor, which opens the version it leaves
	 */
	saved(): void
	{
		const action = this.collected;

		this.collected = undefined;

		if (action !== undefined)
		{
			this.section.hidden = true;
			this.stage(undefined);
			this.onSaved(action);
		}
	}
}
