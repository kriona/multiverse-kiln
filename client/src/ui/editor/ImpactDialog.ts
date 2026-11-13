import { type AreaEvacuation, type ChangeImpact, type DraftApplyChoices, type EditorChange, type GroupSizeLowering, type ItemDisabling, type MessageDescriptor, type Ruleset } from '@multiverse-kiln/shared';

import { t } from '../../localization';
import { getElement } from '../dom';
import { itemName } from '../itemNames';
import { className, raceName } from '../raceAndClassNames';

/**
 * One answer the dialog offers for an impact
 */
interface ImpactOption
{
	value: string;
	label: MessageDescriptor;
}

/**
 * Whether a change could affect players, so the editor asks the server before saving it: one that
 * disables a race, class, item or area, sets the group size, or applies the universe's draft
 *
 * @param change The change
 * @return True when it could
 */
export function mayAffectPlayers(change: EditorChange): boolean
{
	switch (change.kind)
	{
		case 'saveRace':
		case 'saveClass':
		case 'saveItem':
			return(!change.settings.enabled);
		case 'updateArea':
			return(change.update.enabled === false);
		case 'universe':
			return(change.update.groupSize !== undefined);
		case 'applyDraft':
			return(true);
		default:
			return(false);
	}
}

/**
 * The answers to a race's or class's impact: keepPlaying's two values
 */
const OPTION_ANSWERS: ImpactOption[] = [
	{
		value: 'keep',
		label: {
			id: 'editor.impact.keepPlaying',
			defaultMessage: 'Let them keep playing; only new characters can\'t choose it',
			description: 'Choice in the dialog the editor\'s Save opens, for a race or class being disabled that characters are: they can still play, and only new characters can\'t be it'
		}
	},
	{
		value: 'prevent',
		label: {
			id: 'editor.impact.preventPlaying',
			defaultMessage: 'Stop them playing until it is enabled again',
			description: 'Choice in the dialog the editor\'s Save opens, for a race or class being disabled that characters are: they are turned out of the lobby and their groups, and can\'t play until it is enabled again'
		}
	}
];

/**
 * The answers to an item's impact (ItemDisabling)
 */
const ITEM_ANSWERS: { value: ItemDisabling; label: MessageDescriptor }[] = [
	{
		value: 'keep',
		label: {
			id: 'editor.impact.keepItem',
			defaultMessage: 'Let them keep using it; no new copies are made',
			description: 'Choice in the dialog the editor\'s Save opens, for an item being disabled that characters carry: they keep it, and nobody new is given it'
		}
	},
	{
		value: 'remove',
		label: {
			id: 'editor.impact.removeItem',
			defaultMessage: 'Take it from them; they get it back if it is enabled again',
			description: 'Choice in the dialog the editor\'s Save opens, for an item being disabled that characters carry: it is taken away from them, and given back if the item is enabled again'
		}
	}
];

/**
 * The answers to an area's impact (AreaEvacuation)
 */
const AREA_ANSWERS: { value: AreaEvacuation; label: MessageDescriptor }[] = [
	{
		value: 'parent',
		label: {
			id: 'editor.impact.toParent',
			defaultMessage: 'Move everyone to the area it is in',
			description: 'Choice in the dialog the editor\'s Save opens, for an area being disabled with characters in it: they go to its parent area (or the nearest enabled area holding it), arriving at a link back into it when there is one'
		}
	},
	{
		value: 'start',
		label: {
			id: 'editor.impact.toStart',
			defaultMessage: 'Move everyone back to where they start',
			description: 'Choice in the dialog the editor\'s Save opens, for an area being disabled with characters in it: they go to the lobby\'s area, or to their group\'s starting area'
		}
	}
];

/**
 * The answers to a lowered group size's impact (GroupSizeLowering)
 */
const GROUP_ANSWERS: { value: GroupSizeLowering; label: MessageDescriptor }[] = [
	{
		value: 'keep',
		label: {
			id: 'editor.impact.keepGroups',
			defaultMessage: 'Let those groups keep playing; only limit the size of new groups',
			description: 'Choice in the dialog the editor\'s Save opens, for a group size smaller than some groups: they stay as they are, and can\'t take new members until they fit'
		}
	},
	{
		value: 'disband',
		label: {
			id: 'editor.impact.disbandGroups',
			defaultMessage: 'Disband the larger groups',
			description: 'Choice in the dialog the editor\'s Save opens, for a group size smaller than some groups: those groups end, and their members go back to the lobby'
		}
	},
	{
		value: 'removeMembers',
		label: {
			id: 'editor.impact.removeMembers',
			defaultMessage: 'Take out members, those who joined most recently first, until they fit',
			description: 'Choice in the dialog the editor\'s Save opens, for a group size smaller than some groups: members leave, newest first, never the character the group is centered on (its anchor being)'
		}
	}
];

/**
 * Asks what should happen to the characters and groups a save affects, before it is saved: one choice
 * for each race, class, item or area it disables that characters are using, and for a group size
 * smaller than some groups (see Disabling things players are using in STRUCTURE-OVERVIEW.md)
 */
export class ImpactDialog
{
	private readonly dialog = getElement('impact-dialog', HTMLDialogElement);
	private readonly form = getElement('impact-form', HTMLFormElement);
	private readonly choices = getElement('impact-choices', HTMLElement);
	private readonly cancelButton = getElement('impact-cancel', HTMLButtonElement);

	/**
	 * Asks about a save's impacts
	 *
	 * @param impacts What the save would do to players, from the server
	 * @param changes The save's changes, which the impacts name by their places
	 * @param ruleset The universe's ruleset, for the names of default races, classes and items
	 * @return The changes to save in place of those asked about, by their places; undefined when the
	 * player cancels
	 */
	ask(impacts: readonly ChangeImpact[], changes: readonly EditorChange[], ruleset: Ruleset): Promise<Map<number, EditorChange> | undefined>
	{
		const groups = impacts.map((impact, index) => this.renderImpact(impact, index, ruleset));

		this.choices.replaceChildren(...groups.map(({ fieldset }) => fieldset));

		return(new Promise((resolve) =>
		{
			let answered: Map<number, EditorChange> | undefined;

			/**
			 * Saves with the choices made, from the form's submit button
			 *
			 * @param event The submit
			 */
			const onSubmit = (event: SubmitEvent): void =>
			{
				event.preventDefault();

				const changed = new Map<number, EditorChange>();

				// Applying a draft has an impact for each thing it disables, each answered in the same change
				for (const [index, impact] of impacts.entries())
				{
					const change = (changed.get(impact.changeIndex) ?? changes[impact.changeIndex]);

					changed.set(impact.changeIndex, withAnswer(change, impact, groups[index].answer()));
				}

				answered = changed;
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
	 * The choice for one impact: what it affects, and the answers
	 *
	 * @param impact The impact
	 * @param position The impact's place in the dialog, which names its radio buttons
	 * @param ruleset The universe's ruleset
	 * @return The choice's fieldset, and the answer chosen in it once the dialog is submitted
	 */
	private renderImpact(impact: ChangeImpact, position: number, ruleset: Ruleset): { fieldset: HTMLFieldSetElement; answer: () => string }
	{
		const { legend, options, chosen } = describeImpact(impact, ruleset);
		const fieldset = document.createElement('fieldset');
		const heading = document.createElement('legend');
		const name = `impact-${position}`;
		const inputs = options.map((option) =>
		{
			const label = document.createElement('label');
			const input = document.createElement('input');

			input.type = 'radio';
			input.name = name;
			input.value = option.value;
			input.checked = (option.value === chosen);
			label.className = 'checkbox';
			label.append(input, ' ', t(option.label));
			fieldset.append(label);

			return(input);
		});

		heading.textContent = legend;
		fieldset.className = 'choice';
		fieldset.prepend(heading);

		return({
			fieldset,
			answer: () => (inputs.find((input) => input.checked)?.value ?? chosen)
		});
	}
}

/**
 * What an impact says, the answers it offers and the one chosen to begin with
 *
 * @param impact The impact
 * @param ruleset The universe's ruleset
 * @return The choice's heading, answers and first answer
 */
function describeImpact(impact: ChangeImpact, ruleset: Ruleset): { legend: string; options: readonly ImpactOption[]; chosen: string }
{
	switch (impact.kind)
	{
		case 'race':
		case 'class':
		{
			const values = {
				name: ((impact.kind === 'race') ? raceName(impact.name, ruleset) : className(impact.name, ruleset)),
				count: impact.characters
			};

			return({
				legend: ((impact.kind === 'race')
					? t({
						id: 'editor.impact.race',
						defaultMessage: 'Disabling {name}: {count, plural, one {# character is this race} other {# characters are this race}}',
						description: 'Heading of a choice in the dialog the editor\'s Save opens, for a race being disabled; {name} is the race\'s name and {count} how many characters are it'
					}, values)
					: t({
						id: 'editor.impact.class',
						defaultMessage: 'Disabling {name}: {count, plural, one {# character is this class} other {# characters are this class}}',
						description: 'Heading of a choice in the dialog the editor\'s Save opens, for a class being disabled; {name} is the class\'s name and {count} how many characters are it'
					}, values)),
				options: OPTION_ANSWERS,
				chosen: 'keep'
			});
		}

		case 'item':
			return({
				legend: t({
					id: 'editor.impact.item',
					defaultMessage: 'Disabling {name}: {count, plural, one {# character carries it} other {# characters carry it}}',
					description: 'Heading of a choice in the dialog the editor\'s Save opens, for an item being disabled; {name} is the item\'s name and {count} how many characters carry it'
				}, {
					name: itemName(impact.name, ruleset),
					count: impact.characters
				}),
				options: ITEM_ANSWERS,
				chosen: 'keep'
			});

		case 'area':
			return({
				legend: t({
					id: 'editor.impact.area',
					defaultMessage: 'Disabling {name}: {count, plural, one {# character is in it} other {# characters are in it}}',
					description: 'Heading of a choice in the dialog the editor\'s Save opens, for an area being disabled; {name} is the area\'s name and {count} how many characters are in it, playing or where their group left them'
				}, {
					name: impact.name,
					count: impact.characters
				}),
				// Without an enabled area holding it, there is no parent to go to
				options: (impact.hasParent ? AREA_ANSWERS : AREA_ANSWERS.filter((option) => (option.value !== 'parent'))),
				chosen: (impact.hasParent ? 'parent' : 'start')
			});

		case 'groupSize':
			return({
				legend: t({
					id: 'editor.impact.groupSize',
					defaultMessage: 'Groups of at most {size}: {count, plural, one {# group is larger} other {# groups are larger}}',
					description: 'Heading of a choice in the dialog the editor\'s Save opens, for a group size smaller than some groups; {size} is the new group size and {count} how many groups have more members'
				}, {
					size: impact.groupSize,
					count: impact.groups
				}),
				options: GROUP_ANSWERS,
				chosen: 'keep'
			});
	}
}

/**
 * A change with the answer to one of its impacts
 *
 * @param change The change
 * @param impact The impact answered
 * @param answer The answer chosen
 * @return The change to save
 */
function withAnswer(change: EditorChange, impact: ChangeImpact, answer: string): EditorChange
{
	switch (change.kind)
	{
		case 'applyDraft':
			return({ ...change, choices: withDraftAnswer(change.choices, impact, answer) });
		case 'saveRace':
			return({ ...change, settings: { ...change.settings, keepPlaying: (answer === 'keep') } });
		case 'saveClass':
			return({ ...change, settings: { ...change.settings, keepPlaying: (answer === 'keep') } });
		case 'saveItem':
			return({ ...change, whenDisabled: ((answer === 'remove') ? 'remove' : 'keep') });
		case 'updateRegion':
		case 'deleteRegion':
		case 'updateArea':
		case 'deleteArea':
			return((impact.kind === 'area')
				? { ...change, moveTo: { ...change.moveTo, [impact.id]: ((answer === 'parent') ? 'parent' : 'start') } }
				: change);
		case 'universe':
			return({ ...change, largerGroups: groupAnswer(answer) });
		default:
			return(change);
	}
}

/**
 * The choices of a change applying the universe's draft, with the answer to one of its impacts, which
 * names what it is about by its live ID
 *
 * @param choices The choices so far
 * @param impact The impact answered
 * @param answer The answer chosen
 * @return The choices
 */
function withDraftAnswer(choices: DraftApplyChoices, impact: ChangeImpact, answer: string): DraftApplyChoices
{
	switch (impact.kind)
	{
		case 'race':
			return({ ...choices, races: { ...choices.races, [impact.id]: (answer === 'keep') } });
		case 'class':
			return({ ...choices, classes: { ...choices.classes, [impact.id]: (answer === 'keep') } });
		case 'item':
			return({ ...choices, items: { ...choices.items, [impact.id]: ((answer === 'remove') ? 'remove' : 'keep') } });
		case 'area':
			return({ ...choices, areas: { ...choices.areas, [impact.id]: ((answer === 'parent') ? 'parent' : 'start') } });
		case 'groupSize':
			return({ ...choices, largerGroups: groupAnswer(answer) });
	}
}

/**
 * What a lowered group size does to larger groups, from the answer chosen
 *
 * @param answer The answer
 * @return The choice
 */
function groupAnswer(answer: string): GroupSizeLowering
{
	return((GROUP_ANSWERS.find((option) => (option.value === answer))?.value ?? 'keep'));
}
