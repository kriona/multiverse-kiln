import '@github/markdown-toolbar-element';
import { canEditUniverseSettings, DISALLOWED_TEXT_CHARACTERS, DISPLAY_TIME_NAMES, DISPLAY_TIMES, FAERIE_MORNING_NAMES, FAERIE_MORNINGS, MAX_LONG_DESCRIPTION_LENGTH, MAX_SHORT_DESCRIPTION_LENGTH, MAX_UNIVERSE_NAME_LENGTH, PASSAGE_OF_TIME_NAMES, PASSAGES_OF_TIME, RULESET_NAMES, UNIVERSE_STAGE_DESCRIPTIONS, UNIVERSE_STAGE_NAMES, UNIVERSE_STAGES, universeSlug, type DisplayTime, type EditableUniverse, type FaerieMorning, type PassageOfTime, type UniverseSettingsUpdate, type UniverseStage } from '@multiverse-kiln/shared';

import { t } from '../../localization';
import { describeEditorError, type EditorApi } from '../../network/editorApi';
import { ChangeTracker } from '../changeTracker';
import { getElement, namedOptions, setOptions, showMessage } from '../dom';
import { clearFieldErrors, reportFieldError, setFieldError } from '../fieldErrors';
import { formMessages } from '../formMessages';
import { showMarkdown } from '../markdown';
import type { SavableTab } from './SaveBar';

/**
 * The toolbar button each Ctrl (or Cmd) shortcut in the long description presses, by key
 */
const FORMAT_SHORTCUTS: Partial<Record<string, string>> = {
	b: 'md-bold',
	i: 'md-italic'
};

/**
 * The Universe tab: the universe's name, descriptions, stage, passage of time and how the time is shown
 */
export class UniverseTab implements SavableTab
{
	private readonly form = getElement('universe-form', HTMLFormElement);
	private readonly fields = getElement('universe-fields', HTMLFieldSetElement);
	private readonly name = getElement('universe-name-input', HTMLInputElement);
	private readonly shortDescription = getElement('universe-short-description', HTMLInputElement);
	private readonly longDescription = getElement('universe-long-description', HTMLTextAreaElement);
	private readonly toolbar = getElement('universe-long-toolbar', HTMLElement);
	private readonly preview = getElement('universe-long-preview', HTMLElement);
	private readonly stage = getElement('universe-stage', HTMLFieldSetElement);
	private readonly ruleset = getElement('universe-ruleset-name', HTMLElement);
	private readonly time = getElement('universe-time', HTMLSelectElement);
	private readonly faerieField = getElement('universe-faerie-field', HTMLElement);
	private readonly faerie = getElement('universe-faerie', HTMLSelectElement);
	private readonly displayTime = getElement('universe-display-time', HTMLSelectElement);
	private readonly error = getElement('universe-error', HTMLElement);

	/**
	 * The stage choices' radio buttons, by stage
	 */
	private readonly stageInputs = new Map<UniverseStage, HTMLInputElement>();

	/**
	 * Whether the form has changes that haven't been saved
	 */
	readonly changes = new ChangeTracker({ root: this.form });

	/**
	 * The universe as it was last loaded or saved
	 */
	private universe: EditableUniverse | undefined;

	/**
	 * @param api The editor's API
	 * @param onSaved Called with the universe after its settings are saved
	 */
	constructor(private readonly api: EditorApi, private readonly onSaved: (universe: EditableUniverse) => void)
	{
		this.name.maxLength = MAX_UNIVERSE_NAME_LENGTH;
		this.shortDescription.maxLength = MAX_SHORT_DESCRIPTION_LENGTH;
		this.longDescription.maxLength = MAX_LONG_DESCRIPTION_LENGTH;
		this.stage.append(...UNIVERSE_STAGES.map((stage) => this.createStageChoice(stage)));
		setOptions(this.time, namedOptions(PASSAGES_OF_TIME, PASSAGE_OF_TIME_NAMES));
		setOptions(this.faerie, namedOptions(FAERIE_MORNINGS, FAERIE_MORNING_NAMES));
		setOptions(this.displayTime, namedOptions(DISPLAY_TIMES, DISPLAY_TIME_NAMES));

		this.longDescription.addEventListener('input', () =>
		{
			showMarkdown(this.preview, this.longDescription.value);
		});

		this.longDescription.addEventListener('keydown', (event) =>
		{
			this.applyShortcut(event);
		});

		this.time.addEventListener('change', () =>
		{
			this.faerieField.hidden = (this.time.value !== 'faerie');
		});

		for (const input of [this.name, this.shortDescription, this.longDescription])
		{
			input.addEventListener('input', () =>
			{
				setFieldError(input, undefined);
			});
		}
	}

	/**
	 * Shows a universe's settings, read-only unless the player's role may change them
	 *
	 * @param universe The universe
	 */
	open(universe: EditableUniverse): void
	{
		this.universe = universe;
		this.name.value = universe.name;
		this.shortDescription.value = universe.shortDescription;
		this.longDescription.value = universe.longDescription;
		for (const [stage, input] of this.stageInputs)
		{
			input.checked = (stage === universe.stage);
		}

		this.ruleset.textContent = t(RULESET_NAMES[universe.ruleset]);
		this.time.value = universe.passageOfTime;
		this.faerie.value = (universe.faerieMorning ?? FAERIE_MORNINGS[0]);
		this.faerieField.hidden = (universe.passageOfTime !== 'faerie');
		this.displayTime.value = universe.displayTime;
		this.fields.disabled = !this.canSave();
		// A disabled fieldset doesn't disable the toolbar's custom elements, so it's hidden instead
		this.toolbar.hidden = this.fields.disabled;
		showMessage(this.error, undefined);
		clearFieldErrors(this.form);
		showMarkdown(this.preview, universe.longDescription);
		this.changes.markSaved();
	}

	/**
	 * One stage's choice: a radio button, with the stage's name and what it means for the universe
	 *
	 * @param stage The stage
	 * @return The choice's label, holding its radio button
	 */
	private createStageChoice(stage: UniverseStage): HTMLLabelElement
	{
		const label = document.createElement('label');
		const input = document.createElement('input');
		const text = document.createElement('span');
		const name = document.createElement('span');
		const description = document.createElement('span');

		label.className = 'checkbox described-choice';
		input.type = 'radio';
		input.name = 'universe-stage';
		input.value = stage;
		text.className = 'choice-text';
		name.textContent = t(UNIVERSE_STAGE_NAMES[stage]);
		description.className = 'choice-description';
		description.textContent = t(UNIVERSE_STAGE_DESCRIPTIONS[stage]);
		text.append(name, description);
		label.append(input, text);
		this.stageInputs.set(stage, input);

		return(label);
	}

	/**
	 * Formats the long description's selection when a key press is one of the formatting shortcuts
	 *
	 * @param event The key press in the long description
	 */
	private applyShortcut(event: KeyboardEvent): void
	{
		if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey)
		{
			return;
		}

		const buttonTag = FORMAT_SHORTCUTS[event.key.toLowerCase()];
		const button = (buttonTag ? this.toolbar.querySelector<HTMLElement>(buttonTag) : null);

		if (button)
		{
			event.preventDefault();
			button.click();
		}
	}

	/**
	 * Whether the player may change the universe's settings
	 *
	 * @return True for a creator
	 */
	canSave(): boolean
	{
		return((this.universe !== undefined) && canEditUniverseSettings(this.universe.role));
	}

	/**
	 * Saves the settings as the form shows them
	 *
	 * @return True when they were saved
	 */
	async save(): Promise<boolean>
	{
		const universe = this.universe;

		if (!universe || !this.checkText())
		{
			return(false);
		}

		const passageOfTime = this.time.value as PassageOfTime;
		const update: Required<Pick<UniverseSettingsUpdate, 'name' | 'shortDescription' | 'longDescription' | 'stage' | 'passageOfTime' | 'faerieMorning' | 'displayTime'>> = {
			name: this.name.value.trim(),
			shortDescription: this.shortDescription.value.trim(),
			longDescription: this.longDescription.value,
			stage: (UNIVERSE_STAGES.find((stage) => this.stageInputs.get(stage)?.checked) ?? universe.stage),
			passageOfTime,
			faerieMorning: ((passageOfTime === 'faerie') ? this.faerie.value as FaerieMorning : null),
			displayTime: this.displayTime.value as DisplayTime
		};

		showMessage(this.error, undefined);

		try
		{
			await this.api.updateUniverse(universe.id, update);
			this.universe = { ...universe, ...update };
			this.changes.markSaved();
			this.onSaved(this.universe);

			return(true);
		}
		catch (error)
		{
			showMessage(this.error, describeEditorError(error, {
				id: 'editor.universe.saveFailed',
				defaultMessage: 'Could not save the universe.',
				description: 'Shown on the Universe tab when its settings couldn\'t be stored'
			}));

			return(false);
		}
	}

	/**
	 * Checks the text fields for characters the server refuses, and the name for a letter or number,
	 * pointing the player at the first field with a problem
	 *
	 * @return True when every field may be saved
	 */
	private checkText(): boolean
	{
		const checks: [HTMLInputElement | HTMLTextAreaElement, string][] = [
			[this.name, this.name.value.trim()],
			[this.shortDescription, this.shortDescription.value],
			[this.longDescription, this.longDescription.value.replace(/[\t\n\r]/g, '')]
		];

		for (const [input, text] of checks)
		{
			if (((input === this.name) && (text === '')) || DISALLOWED_TEXT_CHARACTERS.test(text))
			{
				reportFieldError(input, t(formMessages.invalidText));
				return(false);
			}

			if ((input === this.name) && (universeSlug(text) === ''))
			{
				reportFieldError(input, t(formMessages.universeNameNoLetters));
				return(false);
			}
		}

		return(true);
	}
}
