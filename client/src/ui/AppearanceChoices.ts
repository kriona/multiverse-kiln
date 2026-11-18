/**
 * The choices of how a character's avatar is drawn: body type, art type and background, with a preview
 * of the base over the background (see Avatars in STRUCTURE-OVERVIEW.md). Create Character's Appearance
 * step and the Appearance dialog on a character's sheet use it
 *
 * Only the art types with a base for the race and body type are offered, and the art type choice is left
 * out for a race no art type has drawn. Only drawn backgrounds are offered, and the choice is left out
 * while none are. The preview is drawn by the server and shared by everyone who
 * chooses the same
 */
import { artTypesFor, AVATAR_MANIFEST, avatarPreviewPath, BACKGROUND_NAMES, BACKGROUNDS, BODY_TYPE_NAMES, drawnArtType, drawnBodyType, raceBodyTypes, type CharacterAppearance, type Ruleset } from '@multiverse-kiln/shared';

import { formatList, t } from '../localization';
import { serverHttpUrl } from '../network/serverConnection';

/**
 * Counts the choices made, so each has radio buttons of its own names
 */
let choicesMade = 0;

/**
 * The body type, art type and background choices, and the preview
 */
export class AppearanceChoices
{
	private readonly name = `appearance-${++choicesMade}`;
	private readonly bodyTypes = document.createElement('fieldset');
	private readonly artTypes = document.createElement('fieldset');
	private readonly backgrounds = document.createElement('fieldset');
	private readonly preview = document.createElement('div');

	private ruleset: Ruleset = 'pf1e';
	private raceKey: string | null = null;
	private chooseBodyType = true;
	private appearance: CharacterAppearance = {
		bodyType: 'mascThick',
		artType: 'stickFigure',
		background: 'darkGreen'
	};

	/**
	 * @param root The element to show the choices in
	 * @param changed Called after the player changes a choice
	 */
	constructor(root: HTMLElement, private readonly changed: (appearance: CharacterAppearance) => void)
	{
		for (const fieldset of [this.bodyTypes, this.artTypes, this.backgrounds])
		{
			fieldset.className = 'choice';
		}

		this.preview.className = 'appearance-preview avatar avatar-full';
		root.replaceChildren(this.preview, this.bodyTypes, this.artTypes, this.backgrounds);
		root.addEventListener('change', (event) =>
		{
			const input = event.target;

			if (!(input instanceof HTMLInputElement) || !input.checked)
			{
				return;
			}

			const kind = input.dataset.appearance;

			if ((kind === 'bodyType') || (kind === 'artType') || (kind === 'background'))
			{
				this.appearance = {
					...this.appearance,
					[kind]: input.value
				};
				this.render();

				// The radio buttons are made again, so focus goes back to the one chosen
				[...root.querySelectorAll<HTMLInputElement>(`input[data-appearance="${kind}"]`)]
					.find((each) => (each.value === input.value))
					?.focus();
				this.changed(this.appearance);
			}
		});
	}

	/**
	 * Shows the choices for a race, with a choice made
	 *
	 * @param ruleset The universe's ruleset
	 * @param raceKey The key of the default race the race is drawn as, or null for a race with no avatar
	 * @param appearance The choices made, or null for the first of each
	 * @param chooseBodyType Whether the body type can be chosen: on Create Character, and for the universe's creators
	 * @return The appearance shown, as it may differ from the one given: a body type the race doesn't have
	 * is its first, and an art type with no base for it is the first that has one
	 */
	show(ruleset: Ruleset, raceKey: string | null, appearance: CharacterAppearance | null, chooseBodyType: boolean): CharacterAppearance
	{
		const bodyTypes = raceBodyTypes(ruleset, raceKey);
		const start = (appearance ?? {
			bodyType: (bodyTypes[0] ?? 'mascThick'),
			artType: 'stickFigure',
			background: BACKGROUNDS[0]
		});

		this.ruleset = ruleset;
		this.raceKey = raceKey;
		this.chooseBodyType = chooseBodyType;
		this.appearance = {
			...start,
			bodyType: (chooseBodyType ? (drawnBodyType(ruleset, raceKey, start.bodyType) ?? start.bodyType) : start.bodyType)
		};
		this.render();

		return(this.appearance);
	}

	/**
	 * The choices made
	 *
	 * @return The appearance
	 */
	value(): CharacterAppearance
	{
		return(this.appearance);
	}

	/**
	 * Draws the choices and the preview for the race and the choices made, choosing an art type the body
	 * type has a base in when the one chosen has none, and a drawn background when the one chosen isn't
	 */
	private render(): void
	{
		const { ruleset, raceKey } = this;
		const bodyTypes = raceBodyTypes(ruleset, raceKey);
		const artTypes = artTypesFor(AVATAR_MANIFEST, ruleset, raceKey, this.appearance.bodyType);
		const backgrounds = BACKGROUNDS.filter((background) => Object.hasOwn(AVATAR_MANIFEST.backgrounds, background));

		if ((artTypes.length > 0) && !artTypes.includes(this.appearance.artType))
		{
			this.appearance = {
				...this.appearance,
				artType: artTypes[0]
			};
		}

		if ((backgrounds.length > 0) && !(backgrounds as readonly string[]).includes(this.appearance.background))
		{
			this.appearance = {
				...this.appearance,
				background: backgrounds[0]
			};
		}

		this.bodyTypes.hidden = (!this.chooseBodyType || (bodyTypes.length === 0));
		this.fill(this.bodyTypes, 'bodyType', t({
			id: 'appearance.bodyType',
			defaultMessage: 'Body type',
			description: 'Heading of the choice of a character\'s body type for their avatar (the picture of the character), such as Femme thin: on Create Character\'s Appearance step, and in the Appearance dialog of a character\'s sheet for the universe\'s creators'
		}), bodyTypes.map((bodyType) => [bodyType, t(BODY_TYPE_NAMES[bodyType]), false]));

		this.artTypes.hidden = (artTypes.length === 0);
		this.fill(this.artTypes, 'artType', t({
			id: 'appearance.artType',
			defaultMessage: 'Art type',
			description: 'Heading of the choice of how a character\'s avatar (the picture of the character) is drawn, such as Stick figure, or in the style of an artist named after them: on Create Character\'s Appearance step, and in the Appearance dialog of a character\'s sheet'
		}), artTypes.map((artType) =>
		{
			const name = AVATAR_MANIFEST.artTypes[artType].name;

			return([artType, ((typeof name === 'string') ? name : t(name)), (typeof name === 'string')]);
		}));

		this.backgrounds.hidden = ((bodyTypes.length === 0) || (backgrounds.length === 0));
		this.fill(this.backgrounds, 'background', t({
			id: 'appearance.background',
			defaultMessage: 'Background',
			description: 'Heading of the choice of the background behind a character\'s avatar (the picture of the character), such as Dark green: on Create Character\'s Appearance step, and in the Appearance dialog of a character\'s sheet'
		}), backgrounds.map((background) => [background, t(BACKGROUND_NAMES[background]), false]));

		this.showPreview();
	}

	/**
	 * Fills a fieldset with radio buttons, checking the one chosen
	 *
	 * @param fieldset The fieldset
	 * @param kind Which choice it is
	 * @param legend Its legend
	 * @param choices Each choice's value, its text, and whether the text is a name that isn't translated
	 */
	private fill(fieldset: HTMLFieldSetElement, kind: keyof CharacterAppearance, legend: string, choices: readonly [string, string, boolean][]): void
	{
		const legendElement = document.createElement('legend');

		legendElement.textContent = legend;
		fieldset.replaceChildren(legendElement, ...choices.map(([value, text, untranslated]) =>
		{
			const label = document.createElement('label');
			const input = document.createElement('input');
			const textElement = document.createElement('span');

			label.className = 'checkbox';
			input.type = 'radio';
			input.name = `${this.name}-${kind}`;
			input.value = value;
			input.dataset.appearance = kind;
			input.checked = (this.appearance[kind] === value);
			textElement.textContent = text;

			if (untranslated)
			{
				textElement.translate = false;
			}

			label.append(input, textElement);

			return(label);
		}));
	}

	/**
	 * The choices made, in words, such as "Femme thin, Lucia, Dark red", for Create Character's review
	 *
	 * @return The words, leaving out the choices not offered for the race
	 */
	describe(): string
	{
		return(formatList([...this.bodyTypes.elements, ...this.artTypes.elements, ...this.backgrounds.elements]
			.filter((input): input is HTMLInputElement => ((input instanceof HTMLInputElement) && input.checked && !(input.closest('fieldset')?.hidden ?? true)))
			.map((input) => (input.nextElementSibling?.textContent ?? ''))));
	}

	/**
	 * A preview of the base and background chosen, or a note that the race has no avatar
	 *
	 * @return The preview
	 */
	createPreview(): HTMLElement
	{
		const preview = document.createElement('div');

		preview.className = 'appearance-preview avatar avatar-full';
		this.fillPreview(preview);

		return(preview);
	}

	/**
	 * Shows the base and background chosen, or that the race has no avatar
	 */
	private showPreview(): void
	{
		this.fillPreview(this.preview);
	}

	/**
	 * Fills a preview with the base and background chosen, or a note that the race has no avatar
	 *
	 * @param preview The preview's element
	 */
	private fillPreview(preview: HTMLElement): void
	{
		const { ruleset, raceKey, appearance } = this;
		const bodyType = drawnBodyType(ruleset, raceKey, appearance.bodyType);
		const artType = drawnArtType(AVATAR_MANIFEST, ruleset, raceKey, appearance.bodyType, appearance.artType);

		if ((raceKey === null) || (bodyType === undefined) || (artType === undefined))
		{
			const text = document.createElement('span');

			text.textContent = t({
				id: 'appearance.none',
				defaultMessage: 'Nothing is drawn for this race yet.',
				description: 'Shown in place of the preview of a character\'s avatar (the picture of the character) on Create Character\'s Appearance and review steps and in the Appearance dialog of a character\'s sheet, when no art is drawn for their race'
			});
			preview.classList.add('avatar-none');
			preview.replaceChildren(text);
			return;
		}

		const image = document.createElement('img');

		image.src = serverHttpUrl(avatarPreviewPath(artType, ruleset, raceKey, bodyType, appearance.background));
		image.alt = t({
			id: 'appearance.preview',
			defaultMessage: 'Preview of the avatar',
			description: 'Text read by screen readers for the preview of a character\'s avatar (the picture of the character), without their items, on Create Character\'s Appearance and review steps and in the Appearance dialog of a character\'s sheet'
		});
		image.width = 200;
		image.height = 300;
		preview.classList.remove('avatar-none');
		preview.replaceChildren(image);
	}
}
