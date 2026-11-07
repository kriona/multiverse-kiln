import type { AuditFieldChange, Ruleset, SaveConflict, UniverseEditDetail } from '@multiverse-kiln/shared';

import { t } from '../../localization';
import { getElement } from '../dom';
import { auditFieldName, describeValue, targetName } from './auditDetails';

/**
 * Asks, for each setting other editors saved a different value for since the player loaded it, whether
 * to keep the player's value or take the one saved (see Editing together in STRUCTURE-OVERVIEW.md)
 */
export class ConflictDialog
{
	private readonly dialog = getElement('conflict-dialog', HTMLDialogElement);
	private readonly form = getElement('conflict-form', HTMLFormElement);
	private readonly choices = getElement('conflict-choices', HTMLElement);
	private readonly cancelButton = getElement('conflict-cancel', HTMLButtonElement);

	/**
	 * Asks about a save's conflicts
	 *
	 * @param conflicts The settings that conflict, from the server
	 * @param ruleset The universe's ruleset, for the names of default tiles, items, races, classes and themes
	 * @return For each conflict, in order, true to keep the player's value and false to take the one
	 * saved; undefined when the player cancels
	 */
	ask(conflicts: readonly SaveConflict[], ruleset: Ruleset): Promise<boolean[] | undefined>
	{
		const choices = conflicts.map((conflict, index) => this.renderConflict(conflict, index, ruleset));

		this.choices.replaceChildren(...choices.map(({ fieldset }) => fieldset));

		return(new Promise((resolve) =>
		{
			let answered: boolean[] | undefined;

			/**
			 * Saves with the choices made, from the form's submit button
			 *
			 * @param event The submit
			 */
			const onSubmit = (event: SubmitEvent): void =>
			{
				event.preventDefault();
				answered = choices.map(({ keepsMine }) => keepsMine());
				this.dialog.close();
			};

			/**
			 * Goes back to the editor without saving, from Cancel
			 */
			const onCancel = (): void =>
			{
				this.dialog.close();
			};

			this.form.addEventListener('submit', onSubmit);
			this.cancelButton.addEventListener('click', onCancel);
			this.dialog.addEventListener('close', () =>
			{
				this.form.removeEventListener('submit', onSubmit);
				this.cancelButton.removeEventListener('click', onCancel);
				resolve(answered);
			}, { once: true });

			this.dialog.showModal();

			// Cancel takes focus, so pressing Enter by habit doesn't save without reading the choices
			this.cancelButton.focus();
		}));
	}

	/**
	 * The choice for one conflict: the setting, and keeping the player's value or taking the one saved
	 *
	 * @param conflict The conflict
	 * @param position The conflict's place in the dialog, which names its radio buttons
	 * @param ruleset The universe's ruleset
	 * @return The choice's fieldset, and whether the player chose to keep their value once the dialog is submitted
	 */
	private renderConflict(conflict: SaveConflict, position: number, ruleset: Ruleset): { fieldset: HTMLFieldSetElement; keepsMine: () => boolean }
	{
		const fieldset = document.createElement('fieldset');
		const legend = document.createElement('legend');
		const detail: UniverseEditDetail = {
			subject: conflict.subject,
			action: 'changed',
			target: conflict.target,
			fields: [],
			count: 1
		};

		/**
		 * A value as the Audit tab shows it, or nothing for a setting it doesn't name
		 *
		 * @param change The setting and its value
		 * @return The value, or an empty string
		 */
		const valueOf = (change: AuditFieldChange | null): string => ((change === null) ? '' : describeValue(change, detail, ruleset));

		const mine = valueOf(conflict.mine);
		const theirs = valueOf(conflict.theirs);
		const [keepInput, keepLabel] = createChoice(`conflict-${position}`, t({
			id: 'editor.conflict.keepMine',
			defaultMessage: '{hasValue, select, yes {Keep mine: {value}} other {Keep mine}}',
			description: 'Choice in the dialog the editor\'s Save opens when another editor saved a different value for a setting the player changed: save the player\'s value over theirs. {value} is the player\'s value, e.g. "Hardy" or "yes"'
		}, {
			hasValue: ((mine === '') ? 'no' : 'yes'),
			value: mine
		}));
		const [, takeLabel] = createChoice(`conflict-${position}`, t({
			id: 'editor.conflict.takeTheirs',
			defaultMessage: '{known, select, yes {{hasValue, select, yes {Take {name}\'s: {value}} other {Take {name}\'s}}} other {{hasValue, select, yes {Take the saved one: {value}} other {Take the saved one}}}}',
			description: 'Choice in the dialog the editor\'s Save opens when another editor saved a different value for a setting the player changed: drop the player\'s value and keep theirs. {name} is the other editor\'s display name when it is known ({known} is yes), and {value} the value they saved, e.g. "Stout" or "no"'
		}, {
			known: ((conflict.savedBy === null) ? 'no' : 'yes'),
			name: (conflict.savedBy?.name ?? ''),
			hasValue: ((theirs === '') ? 'no' : 'yes'),
			value: theirs
		}));

		keepInput.checked = true;
		legend.textContent = t({
			id: 'editor.conflict.setting',
			defaultMessage: '{subject, select, settings {Universe settings: {field}} ruleset {Ruleset: {field}} editor {Editor {name}: {field}} race {Race {name}: {field}} class {Class {name}: {field}} theme {Theme {name}: {field}} item {Item {name}: {field}} tile {Tile {name}: {field}} difficultyLevel {Difficulty level {name}: {field}} area {Area {name}: {field}} other {{name}: {field}}}',
			description: 'Heading of a choice in the dialog the editor\'s Save opens when another editor saved a different value for a setting the player changed: what the setting belongs to and the setting, e.g. "Race Dwarf: Name". {name} is the thing\'s name and {field} the setting\'s'
		}, {
			subject: conflict.subject,
			name: targetName(conflict.subject, conflict.target, ruleset),
			field: ((conflict.field === null) ? '' : auditFieldName(conflict.field))
		});
		fieldset.className = 'choice';
		fieldset.append(legend, keepLabel, takeLabel);

		return({
			fieldset,
			keepsMine: () => keepInput.checked
		});
	}
}

/**
 * One radio button of a conflict's choice, with its label
 *
 * @param name The choice's name, which its radio buttons share
 * @param text The label's text
 * @return The radio button, and the label holding it
 */
function createChoice(name: string, text: string): [HTMLInputElement, HTMLLabelElement]
{
	const label = document.createElement('label');
	const input = document.createElement('input');

	input.type = 'radio';
	input.name = name;
	label.className = 'checkbox';
	label.append(input, ' ', text);

	return([input, label]);
}
