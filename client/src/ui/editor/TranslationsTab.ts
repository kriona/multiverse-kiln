import { canEditUniverseSettings, languageName, MAX_UNIVERSE_LANGUAGES, PROFILE_LANGUAGES, type EditableUniverse, type UniverseSettingsUpdate } from '@multiverse-kiln/shared';
import trashIcon from 'virtual:icon/ph:trash';

import { currentLocale, t } from '../../localization';
import { describeEditorError } from '../../network/editorApi';
import { ChangeTracker } from '../changeTracker';
import { ChipCombobox } from '../ChipCombobox';
import type { ComboboxChoice } from '../ComboboxList';
import { askToConfirm } from '../confirmDialog';
import { getElement, showMessage } from '../dom';
import { clearFieldErrors, reportFieldError, setFieldError } from '../fieldErrors';
import { languageChoices } from '../languagePicker';
import type { EditorSave } from './editorSave';
import type { SavableTab } from './SaveBar';

/**
 * The Translations tab: the language the universe's text is written in, and the languages it is
 * translated into. Taking a language off that has translations asks first, since saving deletes them
 */
export class TranslationsTab implements SavableTab
{
	private readonly form = getElement('translations-form', HTMLFormElement);
	private readonly fields = getElement('translations-fields', HTMLFieldSetElement);
	private readonly source = getElement('translations-source', HTMLSelectElement);
	private readonly search = getElement('translations-languages-search', HTMLInputElement);
	private readonly error = getElement('translations-error', HTMLElement);

	/**
	 * The languages that can be chosen: every language a profile can name, and any other the universe
	 * already has, which open() adds so a save never drops it. The chip field reads it as it changes
	 */
	private readonly choices: ComboboxChoice[] = languageChoices(PROFILE_LANGUAGES);

	private readonly languages: ChipCombobox;

	/**
	 * Whether the form has changes that haven't been saved
	 */
	readonly changes: ChangeTracker;

	/**
	 * The universe as it was last loaded or saved
	 */
	private universe: EditableUniverse | undefined;

	/**
	 * The languages chosen before the last change to them, to put back when the player keeps translations
	 */
	private chosenBefore: string[] = [];

	/**
	 * The languages the save being sent holds
	 */
	private collected: Required<Pick<UniverseSettingsUpdate, 'sourceLanguage' | 'translationLanguages'>> | undefined;

	/**
	 * @param onSaved Called with the settings saved, once they are
	 */
	constructor(private readonly onSaved: (update: UniverseSettingsUpdate) => void)
	{
		this.languages = new ChipCombobox({
			searchId: 'translations-languages-search',
			listboxId: 'translations-languages-options',
			chosenId: 'translations-languages-chosen',
			choices: this.choices,
			max: MAX_UNIVERSE_LANGUAGES,
			tooMany: t({
				id: 'editor.translations.languagesTooMany',
				defaultMessage: 'A universe can be translated into up to {max, plural, one {# language} other {# languages}}.',
				description: 'Shown under the field for the languages a universe is translated into, on the editor\'s Translations tab, when more than {max}, a number, are chosen'
			}, {
				max: MAX_UNIVERSE_LANGUAGES
			}),
			onChange: () =>
			{
				void this.languagesChanged();
			}
		});
		this.changes = new ChangeTracker({
			root: this.form,
			state: () => this.languages.values
		});

		this.source.addEventListener('change', () =>
		{
			setFieldError(this.search, undefined);
		});
	}

	/**
	 * Shows a universe's languages, read-only unless the player's role may change them
	 *
	 * @param universe The universe
	 */
	open(universe: EditableUniverse): void
	{
		this.universe = universe;
		this.addChoices([universe.sourceLanguage, ...universe.translationLanguages]);
		this.source.value = universe.sourceLanguage;
		this.languages.values = universe.translationLanguages;
		this.chosenBefore = this.languages.values;
		this.fields.disabled = !this.canSave();
		showMessage(this.error, undefined);
		clearFieldErrors(this.form);
		this.changes.markSaved();
	}

	/**
	 * Makes sure languages can be chosen, both as the source language and as translations, adding any
	 * that aren't yet, so a language the universe has always shows
	 *
	 * @param languages The languages, by tag
	 */
	private addChoices(languages: readonly string[]): void
	{
		const missing = languages.filter((language) => !this.choices.some((choice) => (choice.value === language)));

		if (missing.length > 0)
		{
			this.choices.push(...languageChoices(missing));
			this.choices.sort((first, second) => first.name.localeCompare(second.name, currentLocale()));
		}

		if ((missing.length > 0) || (this.source.options.length === 0))
		{
			this.source.replaceChildren(...this.choices.map((choice) => this.createSourceOption(choice)));
		}
	}

	/**
	 * One language in the source language's list: its name in itself, then in the page's language when
	 * that differs
	 *
	 * @param choice The language
	 * @return The option
	 */
	private createSourceOption(choice: ComboboxChoice): HTMLOptionElement
	{
		const label = ((choice.detail === undefined) ? choice.name : t({
			id: 'editor.translations.languageChoice',
			defaultMessage: '{name} ({nameHere})',
			description: 'A language in the list of source languages on the editor\'s Translations tab, when its name in itself differs from its name in the page\'s language; {name} is its name in itself, such as Deutsch, and {nameHere} its name in the page\'s language, such as German'
		}, {
			name: choice.name,
			nameHere: choice.detail
		}));

		return(new Option(label, choice.value));
	}

	/**
	 * Asks before taking off a language the universe has translations into, since saving deletes them,
	 * and puts the languages back as they were when the player keeps them. Each change adds or takes off
	 * one language
	 */
	private async languagesChanged(): Promise<void>
	{
		const before = this.chosenBefore;
		const chosen = this.languages.values;
		const counts = (this.universe?.translationCounts ?? {});
		const language = before.find((each) => (!chosen.includes(each) && ((counts[each] ?? 0) > 0)));

		this.chosenBefore = chosen;
		setFieldError(this.search, undefined);

		if (language !== undefined)
		{
			const confirmed = await askToConfirm({
				title: t({
					id: 'editor.translations.removeTitle',
					defaultMessage: 'Delete translations',
					description: 'Title of the dialog asking whether to take a language off the languages a universe is translated into, on the editor\'s Translations tab, when it has translations'
				}),
				question: t({
					id: 'editor.translations.removeQuestion',
					defaultMessage: 'Taking {language} off deletes the universe\'s {count, plural, one {# translation} other {# translations}} into it when the universe is saved. Take it off?',
					description: 'Asks whether to take a language off the languages a universe is translated into, on the editor\'s Translations tab; {language} is the language\'s name, and {count} how many pieces of the universe\'s text are translated into it'
				}, {
					language: languageName(language),
					count: (counts[language] ?? 0)
				}),
				confirmLabel: t({
					id: 'editor.translations.remove',
					defaultMessage: 'Take Off',
					description: 'Button in the dialog asking whether to take a language off the languages a universe is translated into, deleting its translations when the universe is saved'
				}),
				confirmIcon: trashIcon
			});

			if (!confirmed)
			{
				this.chosenBefore = before;
				this.languages.values = before;
			}
		}

		this.changes.check();
	}

	/**
	 * Whether the player may change the universe's languages
	 *
	 * @return True for a creator
	 */
	canSave(): boolean
	{
		return((this.universe !== undefined) && canEditUniverseSettings(this.universe.role));
	}

	/**
	 * Adds the languages as the form shows them to a save, unless the source language is also chosen as
	 * a translation
	 *
	 * @param save The save
	 * @return False when it is
	 */
	collect(save: EditorSave): boolean
	{
		if (!this.universe)
		{
			return(false);
		}

		const update = {
			sourceLanguage: this.source.value,
			translationLanguages: this.languages.values
		};

		if (update.translationLanguages.includes(update.sourceLanguage))
		{
			reportFieldError(this.search, t({
				id: 'editor.translations.sourceTranslated',
				defaultMessage: '{language} is the source language, so the universe can\'t also be translated into it.',
				description: 'Shown under the field for the languages a universe is translated into, on the editor\'s Translations tab, when the source language is chosen there too; {language} is the language\'s name'
			}, {
				language: languageName(update.sourceLanguage)
			}));
			return(false);
		}

		showMessage(this.error, undefined);
		this.collected = update;
		save.add({ kind: 'universe', update }, (refusal) =>
		{
			showMessage(this.error, describeEditorError(refusal.error, {
				id: 'editor.translations.saveFailed',
				defaultMessage: 'Could not save the languages.',
				description: 'Shown on the editor\'s Translations tab when the server refused its languages, followed by why; nothing was saved'
			}));
		});

		return(true);
	}

	/**
	 * Takes the languages as saved; the translations into languages taken off are gone
	 */
	saved(): void
	{
		const universe = this.universe;
		const update = this.collected;

		this.collected = undefined;

		if (universe && update)
		{
			const translationCounts = Object.fromEntries(Object.entries(universe.translationCounts)
				.filter(([language]) => update.translationLanguages.includes(language)));

			this.universe = { ...universe, ...update, translationCounts };
			this.changes.markSaved();
			this.onSaved(update);
		}
	}
}
