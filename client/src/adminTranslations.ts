import { canonicalLanguage, engineTranslationContents, importLanguageFile, isEngineTranslationLanguage, languageFileName, languageFileText, languageName, languageNameIn, MAX_TRANSLATION_FILE_BYTES, messageArguments, PSEUDO_LOCALE, SITE_NAME, SOURCE_LOCALE, TRANSLATION_FILE_EXTENSIONS, TRANSLATION_FILE_FORMATS, TRANSLATION_FILE_TYPES, translationFileFormatOf, UNIVERSE_LANGUAGES, universeSlug, writeTranslationFile, type EngineCatalog, type LanguageFileImport, type ReadTranslationFile, type SkippedTranslation, type TranslationFile, type TranslationFileFormat } from '@multiverse-kiln/shared';

import { showAdminRefusal, startAdminPage } from './AdminPage';
import { availableLocales, currentLocale, formatList, formatToNodes, loadTranslationFile, t } from './localization';
import { describeEditorError } from './network/editorApi';
import { refreshUnsavedWork, watchUnsavedWork } from './ui/changeTracker';
import { getElement, namedOptions, setOptions, showMessage } from './ui/dom';
import { reportFieldError, setFieldError } from './ui/fieldErrors';
import { describeTooLarge, describeUnreadable, describeWrongLanguage, downloadText, FILE_FORMAT_NAMES, readTranslationFileFrom } from './ui/translationFiles';

/**
 * The English messages, as the build has shared/locales/en.json. Only this page's script holds them
 */
const ENGLISH: EngineCatalog = (Object.values(import.meta.glob<EngineCatalog>('../../shared/locales/en.json', { eager: true, import: 'default' }))[0] ?? {});

/**
 * Where the repository keeps each language's file, from its root
 */
const LOCALES_FOLDER = 'shared/locales';

/**
 * A language file made from an imported file, waiting to be downloaded
 */
interface LanguageFileResult
{
	language: string;
	text: string;

	/**
	 * Whether the language had a file already, which this one replaces
	 */
	replacing: boolean;

	/**
	 * Whether it has been downloaded, after which leaving the page loses nothing
	 */
	downloaded: boolean;
}

/**
 * Starts the admin page's Translations tool (admin/translations.html) once the server says the player
 * may use it
 */
void startAdminPage(async (api) =>
{
	const loading = getElement('admin-loading', HTMLElement);

	try
	{
		await api.checkAccess();
	}
	catch (error)
	{
		loading.hidden = true;

		if (!showAdminRefusal(error))
		{
			showMessage(getElement('admin-refusal-message', HTMLElement), describeEditorError(error, {
				id: 'admin.translations.loadFailed',
				defaultMessage: 'Could not load the Translations tool. Try again in a moment.',
				description: 'Shown on the admin page\'s Translations tool when the server couldn\'t be asked whether the player may use it'
			}));
			getElement('admin-refusal', HTMLElement).hidden = false;
		}

		return;
	}

	loading.hidden = true;
	new EngineTranslationFiles().show();
});

/**
 * The Translations tool: exports the site's English messages as a translation file into a language,
 * with the language's translations so far, and reads a translated file back into the language's file
 * in shared/locales, which the admin downloads to commit to the repository. Everything happens in the
 * browser, from the files the build holds
 */
class EngineTranslationFiles
{
	private readonly content = getElement('admin-content', HTMLElement);
	private readonly language = getElement('translation-language', HTMLInputElement);
	private readonly languageName = getElement('translation-language-name', HTMLElement);
	private readonly format = getElement('translation-format', HTMLSelectElement);
	private readonly exportError = getElement('translation-export-error', HTMLElement);
	private readonly importError = getElement('translation-import-error', HTMLElement);
	private readonly importFile = getElement('translation-import-file', HTMLInputElement);
	private readonly resultPanel = getElement('translation-result', HTMLElement);
	private readonly resultHeading = getElement('translation-result-heading', HTMLElement);
	private readonly resultStatus = getElement('translation-result-status', HTMLElement);
	private readonly resultCommit = getElement('translation-result-commit', HTMLElement);
	private readonly skipped = getElement('translation-skipped', HTMLDetailsElement);
	private readonly skippedSummary = getElement('translation-skipped-summary', HTMLElement);
	private readonly skippedList = getElement('translation-skipped-list', HTMLUListElement);

	/**
	 * The language file made from the last file imported, or undefined before one is
	 */
	private result: LanguageFileResult | undefined;

	/**
	 * Fills the choices and listens to the controls
	 */
	constructor()
	{
		setOptions(this.format, namedOptions(TRANSLATION_FILE_FORMATS, FILE_FORMAT_NAMES));
		this.fillLanguageChoices();

		this.language.addEventListener('input', () =>
		{
			setFieldError(this.language, undefined);
			this.showLanguageName();
		});

		getElement('translation-export', HTMLButtonElement).addEventListener('click', () =>
		{
			void this.exportFile();
		});

		getElement('translation-import', HTMLButtonElement).addEventListener('click', () =>
		{
			showMessage(this.importError, undefined);

			// An empty field takes the language the file names
			if ((this.language.value.trim() === '') || (this.chosenLanguage() !== undefined))
			{
				this.importFile.click();
			}
		});

		this.importFile.addEventListener('change', () =>
		{
			const file = this.importFile.files?.[0];

			// Choosing the same file again imports it again
			this.importFile.value = '';

			if (file)
			{
				void this.importTranslations(file);
			}
		});

		getElement('translation-download', HTMLButtonElement).addEventListener('click', () =>
		{
			this.download();
		});

		watchUnsavedWork({
			hasUnsavedChanges: () => ((this.result !== undefined) && !this.result.downloaded)
		});
	}

	/**
	 * Shows the tool
	 */
	show(): void
	{
		this.content.hidden = false;
	}

	/**
	 * Suggests languages for the language field: those the site has translations into, and the
	 * languages universes can be translated into, each by its tag with its name, sorted by name
	 */
	private fillLanguageChoices(): void
	{
		const current = currentLocale();
		const languages = [...new Set([...availableLocales(), ...UNIVERSE_LANGUAGES])]
			.filter(isEngineTranslationLanguage)
			.map((language) => ({ language, name: languageNameIn(language, current) }))
			.sort((first, second) => first.name.localeCompare(second.name, current));

		getElement('translation-language-choices', HTMLDataListElement).replaceChildren(...languages.map(({ language, name }) =>
		{
			const option = document.createElement('option');

			option.value = language;
			option.label = name;

			return(option);
		}));
	}

	/**
	 * Says under the language field which language its tag names, and whether the site has a
	 * translation into it
	 */
	private showLanguageName(): void
	{
		const language = canonicalLanguage(this.language.value);

		if ((language === undefined) || !isEngineTranslationLanguage(language))
		{
			showMessage(this.languageName, undefined);
			return;
		}

		const name = languageNameIn(language, currentLocale());

		showMessage(this.languageName, (hasLanguageFile(language)
			? t({
				id: 'admin.translations.hasTranslation',
				defaultMessage: '{language}: the site has a translation into it, which Export includes and Import adds to.',
				description: 'Under the language field on the admin page\'s Translations tool, once it holds a language the site is translated into; {language} is the language\'s name. Export and Import are the buttons below'
			}, {
				language: name
			})
			: t({
				id: 'admin.translations.noTranslation',
				defaultMessage: '{language}: the site has no translation into it yet.',
				description: 'Under the language field on the admin page\'s Translations tool, once it holds a language the site isn\'t translated into; {language} is the language\'s name'
			}, {
				language: name
			})));
	}

	/**
	 * The language in the language field, or undefined after saying what is wrong with it
	 *
	 * @return Its tag, in its canonical form
	 */
	private chosenLanguage(): string | undefined
	{
		const language = canonicalLanguage(this.language.value);

		if (language === undefined)
		{
			reportFieldError(this.language, t({
				id: 'admin.translations.languageInvalid',
				defaultMessage: 'Enter a language tag, such as de or pt-BR.',
				description: 'Shown under the language field on the admin page\'s Translations tool when it is empty or doesn\'t hold a language tag. de and pt-BR are language tags, which stay as they are'
			}));
			return(undefined);
		}

		if (language.toLowerCase() === SOURCE_LOCALE)
		{
			reportFieldError(this.language, t({
				id: 'admin.translations.languageEnglish',
				defaultMessage: 'The site\'s text is written in English. Choose the language to translate it into.',
				description: 'Shown under the language field on the admin page\'s Translations tool when it holds English, the language the site\'s text is written in'
			}));
			return(undefined);
		}

		if (!isEngineTranslationLanguage(language))
		{
			reportFieldError(this.language, t({
				id: 'admin.translations.languagePseudo',
				defaultMessage: '{language} is made from the English as the site runs, so it has no file to translate. Choose another language.',
				description: 'Shown under the language field on the admin page\'s Translations tool when it holds the pseudo-language for testing, which is made from the English; {language} is its name'
			}, {
				language: languageName(PSEUDO_LOCALE)
			}));
			return(undefined);
		}

		return(language);
	}

	/**
	 * The format chosen
	 *
	 * @return The format
	 */
	private chosenFormat(): TranslationFileFormat
	{
		return((TRANSLATION_FILE_FORMATS.find((each) => (each === this.format.value)) ?? TRANSLATION_FILE_FORMATS[0]));
	}

	/**
	 * The language's file as the site has it
	 *
	 * @param language The language tag
	 * @param errorElement Where to say it couldn't be loaded
	 * @return The file, or undefined when the site has none, or null after saying it couldn't be loaded
	 */
	private async existingFile(language: string, errorElement: HTMLElement): Promise<TranslationFile | undefined | null>
	{
		try
		{
			return(await loadTranslationFile(language));
		}
		catch (error)
		{
			console.error(`Could not load the ${language} translations:`, error);
			showMessage(errorElement, t({
				id: 'admin.translations.existingFailed',
				defaultMessage: 'Could not load the site\'s translation into {language}. Reload the page and try again.',
				description: 'Shown on the admin page\'s Translations tool when the site\'s translations into the language chosen couldn\'t be loaded, to export them or import into them; {language} is the language\'s name'
			}, {
				language: languageNameIn(language, currentLocale())
			}));
			return(null);
		}
	}

	/**
	 * Downloads every English message as a file in the format chosen, for translating into the language
	 * chosen, with the language's translations so far. Out-of-date translations are marked as such
	 */
	private async exportFile(): Promise<void>
	{
		showMessage(this.exportError, undefined);

		const language = this.chosenLanguage();
		const format = this.chosenFormat();

		if (language === undefined)
		{
			return;
		}

		const existing = await this.existingFile(language, this.exportError);

		if (existing === null)
		{
			return;
		}

		const text = writeTranslationFile(format, engineTranslationContents(ENGLISH, language, existing));

		downloadText(text, TRANSLATION_FILE_TYPES[format], `${universeSlug(SITE_NAME)}-${language}${TRANSLATION_FILE_EXTENSIONS[format][0]}`);
	}

	/**
	 * Reads translations from a file, in the format its name says (or the format chosen), into the
	 * language chosen, or the language the file names when none is, and makes the language's file from
	 * them and the site's translations so far (importLanguageFile()). A file naming another language
	 * than the one chosen, and one larger than MAX_TRANSLATION_FILE_BYTES, are refused
	 *
	 * @param file The file
	 */
	private async importTranslations(file: File): Promise<void>
	{
		const format = (translationFileFormatOf(file.name) ?? this.chosenFormat());

		showMessage(this.importError, undefined);

		if (file.size > MAX_TRANSLATION_FILE_BYTES)
		{
			showMessage(this.importError, describeTooLarge());
			return;
		}

		let read: ReadTranslationFile;

		try
		{
			read = await readTranslationFileFrom(file, format);
		}
		catch (error)
		{
			showMessage(this.importError, describeUnreadable(error, format));
			return;
		}

		const fileLanguage = ((read.language === null) ? undefined : (canonicalLanguage(read.language) ?? read.language));

		if ((this.language.value.trim() === '') && (fileLanguage !== undefined))
		{
			this.language.value = fileLanguage;
			this.showLanguageName();
		}

		const language = this.chosenLanguage();

		if (language === undefined)
		{
			return;
		}

		if ((fileLanguage !== undefined) && (fileLanguage.toLowerCase() !== language.toLowerCase()))
		{
			showMessage(this.importError, describeWrongLanguage(languageNameIn(fileLanguage, currentLocale()), languageNameIn(language, currentLocale())));
			return;
		}

		const existing = await this.existingFile(language, this.importError);

		if (existing === null)
		{
			return;
		}

		const imported = importLanguageFile(ENGLISH, read, existing);

		this.result = {
			language,
			text: languageFileText(imported.file),
			replacing: (existing !== undefined),
			downloaded: false
		};
		refreshUnsavedWork();
		this.showResult(imported);
	}

	/**
	 * Shows what the language file made from an imported file holds, the translations skipped and why,
	 * and how to add the file to the site, then moves focus to it
	 *
	 * @param imported The language file and what changed
	 */
	private showResult(imported: LanguageFileImport): void
	{
		const result = this.result;

		if (!result)
		{
			return;
		}

		const total = Object.keys(ENGLISH).length;
		const fileName = languageFileName(result.language);
		const sentences = [
			t({
				id: 'admin.translations.imported',
				defaultMessage: '{imported, plural, =0 {The file has no new translations.} one {Imported # translation.} other {Imported # translations.}}',
				description: 'Shown on the admin page\'s Translations tool after importing a translation file: {imported} is how many translations it added or changed'
			}, {
				imported: imported.imported
			}),
			t({
				id: 'admin.translations.coverage',
				defaultMessage: 'The language file translates {translated, number} of the site\'s {total, number} messages, {outdated, plural, =0 {all of them up to date} one {# of them out of date} other {# of them out of date}}.',
				description: 'Shown on the admin page\'s Translations tool after importing a translation file, about the language file made from it: {translated} is how many of the site\'s {total} messages it translates, and {outdated} how many of those were translated from English that has changed since'
			}, {
				translated: (total - imported.status.missing.length),
				total,
				outdated: imported.status.outdated.length
			})
		];

		if (imported.removed > 0)
		{
			sentences.push(t({
				id: 'admin.translations.removed',
				defaultMessage: '{removed, plural, one {It leaves out # translation of a message the site no longer has.} other {It leaves out # translations of messages the site no longer has.}}',
				description: 'Shown on the admin page\'s Translations tool after importing a translation file, when the language\'s file had translations of messages the site\'s English doesn\'t have any more, which the new file leaves out; {removed} is how many'
			}, {
				removed: imported.removed
			}));
		}

		this.resultStatus.textContent = sentences.join(' ');
		this.resultCommit.textContent = t({
			id: 'admin.translations.commit',
			defaultMessage: 'Download {fileName} and commit it to the site\'s code as {path}{replacing, select, yes {, replacing the file there} other {}}. The site shows the translation once it is built and deployed with it.',
			description: 'Shown on the admin page\'s Translations tool after importing a translation file, above the Download button: the language file only changes the site once it is added to the site\'s code and the site is built again. {fileName} is the file\'s name, such as de.json, and {path} where it goes, such as shared/locales/de.json; both stay as they are. {replacing} is yes when the site has a file for the language already'
		}, {
			fileName,
			path: `${LOCALES_FOLDER}/${fileName}`,
			replacing: (result.replacing ? 'yes' : 'no')
		});
		this.showSkipped(imported.skipped);

		this.resultPanel.hidden = false;
		this.resultHeading.focus();
	}

	/**
	 * Lists the translations an import skipped, each by its message ID with why
	 *
	 * @param skipped The translations skipped
	 */
	private showSkipped(skipped: readonly SkippedTranslation[]): void
	{
		this.skipped.hidden = (skipped.length === 0);
		this.skipped.open = false;
		this.skippedSummary.textContent = t({
			id: 'admin.translations.skipped',
			defaultMessage: '{count, plural, one {Skipped # translation} other {Skipped # translations}}',
			description: 'Shown on the admin page\'s Translations tool after importing a translation file, when some of its translations couldn\'t be used; opens the list of them with why. {count} is how many'
		}, {
			count: skipped.length
		});
		this.skippedList.replaceChildren(...skipped.map((entry) =>
		{
			const item = document.createElement('li');
			const id = document.createElement('code');

			id.textContent = entry.id;
			id.translate = false;
			item.append(...formatToNodes({
				id: 'admin.translations.skippedItem',
				defaultMessage: '{id}: {reason}',
				description: 'One translation in the list of those an import skipped on the admin page\'s Translations tool: {id} is the message\'s ID, which stays as it is, and {reason} why it was skipped'
			}, {
				id,
				reason: skippedReason(entry)
			}));

			return(item);
		}));
	}

	/**
	 * Downloads the language file made from the last file imported
	 */
	private download(): void
	{
		const result = this.result;

		if (!result)
		{
			return;
		}

		downloadText(result.text, TRANSLATION_FILE_TYPES.json, languageFileName(result.language));
		result.downloaded = true;
		refreshUnsavedWork();
	}
}

/**
 * Why a translation was skipped
 *
 * @param entry The translation skipped
 * @return The reason, in the player's language
 */
function skippedReason(entry: SkippedTranslation): string
{
	switch (entry.reason)
	{
		case 'unknown':
			return(t({
				id: 'admin.translations.skippedUnknown',
				defaultMessage: 'The site has no message with this ID.',
				description: 'Why the admin page\'s Translations tool skipped a translation it imported: the site\'s English has no message with its ID, such as one deleted since the file was exported'
			}));
		case 'needsReview':
			return(t({
				id: 'admin.translations.skippedNeedsReview',
				defaultMessage: 'The file marks it as needing review.',
				description: 'Why the admin page\'s Translations tool skipped a translation it imported: the file marks it as still needing review (fuzzy, in a Gettext PO file)'
			}));
		case 'unreadable':
			return(t({
				id: 'admin.translations.skippedUnreadable',
				defaultMessage: 'It isn\'t valid ICU MessageFormat: check its braces.',
				description: 'Why the admin page\'s Translations tool skipped a translation it imported: it can\'t be read as a message, usually because of a missing or extra brace. ICU MessageFormat is a name'
			}));
		case 'arguments':
		{
			const names = messageArguments(ENGLISH[entry.id].defaultMessage);

			return(t({
				id: 'admin.translations.skippedArguments',
				defaultMessage: '{count, plural, =0 {It has arguments or tags, and the English has none.} other {It must use the same arguments and tags as the English: {names}.}}',
				description: 'Why the admin page\'s Translations tool skipped a translation it imported: its arguments (such as {name}) or tags differ from the English message\'s. {count} is how many the English has, and {names} lists them, as they stay'
			}, {
				count: names.length,
				names: formatList(names.map((name) => (name.startsWith('<') ? name : `{${name}}`)))
			}));
		}
	}
}

/**
 * Whether the site has a translation into a language
 *
 * @param language The language tag, in its canonical form
 * @return True when shared/locales has its file
 */
function hasLanguageFile(language: string): boolean
{
	return(availableLocales().includes(language) && (language !== SOURCE_LOCALE));
}
