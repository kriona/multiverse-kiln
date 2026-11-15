import { optionalRulebooks, withRulebooks, type AreaEvacuation, type ChangeImpact, type DraftApplyChoices, type EditorChange, type GroupSizeLowering, type ImpactedOption, type ItemDisabling, type MessageDescriptor, type OptionName, type Ruleset } from '@multiverse-kiln/shared';

import { formatList, t } from '../../localization';
import { getElement } from '../dom';
import { itemName } from '../itemNames';
import { className, raceName } from '../raceAndClassNames';
import { rulebookName } from '../rulebookNames';

/**
 * One answer the dialog offers for an impact
 */
interface ImpactOption
{
	value: string;
	label: MessageDescriptor;
}

/**
 * One question the dialog asks about an impact: most impacts ask one, and a book turned off asks about
 * its races and classes and about its items
 */
interface ImpactQuestion
{
	/**
	 * Which of the impact's questions it is, naming its answer: answer, or playing and items for a book
	 */
	key: string;

	legend: string;

	/**
	 * What the question is about, such as the races and classes of a book turned off
	 */
	details?: string;

	options: readonly ImpactOption[];

	/**
	 * The answer chosen to begin with
	 */
	chosen: string;
}

/**
 * Whether a change could affect players, so the editor asks the server before saving it: one that
 * disables a race, class, item or area, sets the group size, leaves a book off, or applies the
 * universe's draft
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
		case 'ruleset':
			return(optionalRulebooks(change.settings.ruleset).some((rulebook) => !change.settings.settings.rulebooks.includes(rulebook)));
		case 'applyDraft':
			return(true);
		default:
			return(false);
	}
}

/**
 * The answers about a book's races and classes when it is turned off
 */
const RULEBOOK_PLAYING_ANSWERS: ImpactOption[] = [
	{
		value: 'keep',
		label: {
			id: 'editor.impact.rulebookKeepPlaying',
			defaultMessage: 'Let them keep playing; only new characters can\'t choose them',
			description: 'Choice in the dialog the editor\'s Save opens, for a book of game rules being turned off whose races and classes characters are: they can still play, and only new characters can\'t choose the book\'s races and classes'
		}
	},
	{
		value: 'prevent',
		label: {
			id: 'editor.impact.rulebookPreventPlaying',
			defaultMessage: 'Stop them playing until the book is turned on again',
			description: 'Choice in the dialog the editor\'s Save opens, for a book of game rules being turned off whose races and classes characters are: they are turned out of the lobby and their groups, and can\'t play until the book is turned on again'
		}
	}
];

/**
 * The answers about a book's items when it is turned off
 */
const RULEBOOK_ITEM_ANSWERS: ImpactOption[] = [
	{
		value: 'keep',
		label: {
			id: 'editor.impact.rulebookKeepItems',
			defaultMessage: 'Let them keep using them; no new copies are made',
			description: 'Choice in the dialog the editor\'s Save opens, for a book of game rules being turned off whose items characters carry: they keep them, and nobody new is given them'
		}
	},
	{
		value: 'remove',
		label: {
			id: 'editor.impact.rulebookRemoveItems',
			defaultMessage: 'Take them away; they get them back if the book is turned on again',
			description: 'Choice in the dialog the editor\'s Save opens, for a book of game rules being turned off whose items characters carry: the items are taken away from them, and given back if the book is turned on again'
		}
	}
];

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
 * The answer to an area being put in the lobby, the only thing that can happen to its group characters
 */
const LOBBY_AREA_ANSWERS: ImpactOption[] = [
	{
		value: 'start',
		label: {
			id: 'editor.impact.lobbyToStart',
			defaultMessage: 'Move them back to where their groups start',
			description: 'The only choice in the dialog the editor\'s Save opens, for an area being put below the lobby region with characters of groups in it: groups never play in the lobby, so they go to their group\'s starting area'
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
 * smaller than some groups. A book turned off asks once about its races and classes, and once about its
 * items (see Disabling things players are using in STRUCTURE-OVERVIEW.md)
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

		this.choices.replaceChildren(...groups.flatMap(({ fieldsets }) => fieldsets));

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
	 * The choices for one impact: what each question affects, and its answers
	 *
	 * @param impact The impact
	 * @param position The impact's place in the dialog, which names its radio buttons
	 * @param ruleset The universe's ruleset
	 * @return A fieldset for each question, and the answers chosen in them once the dialog is submitted,
	 * by question
	 */
	private renderImpact(impact: ChangeImpact, position: number, ruleset: Ruleset): { fieldsets: HTMLFieldSetElement[]; answer: () => ImpactAnswers }
	{
		const questions = describeImpact(impact, ruleset).map((question) =>
		{
			const { key, legend, details, options, chosen } = question;
			const fieldset = document.createElement('fieldset');
			const heading = document.createElement('legend');
			const name = `impact-${position}-${key}`;
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

			if (details !== undefined)
			{
				const paragraph = document.createElement('p');

				paragraph.className = 'hint';
				paragraph.textContent = details;
				fieldset.prepend(paragraph);
			}

			fieldset.prepend(heading);

			return({
				fieldset,
				answer: (): [string, string] => [key, (inputs.find((input) => input.checked)?.value ?? chosen)]
			});
		});

		return({
			fieldsets: questions.map(({ fieldset }) => fieldset),
			answer: () => Object.fromEntries(questions.map(({ answer }) => answer()))
		});
	}
}

/**
 * The answers chosen for one impact, by question (ImpactQuestion's key)
 */
type ImpactAnswers = Record<string, string>;

/**
 * The questions an impact asks: one, or for a book turned off, one about its races and classes and one
 * about its items, each only when characters use them
 *
 * @param impact The impact
 * @param ruleset The universe's ruleset
 * @return The questions
 */
function describeImpact(impact: ChangeImpact, ruleset: Ruleset): ImpactQuestion[]
{
	if (impact.kind !== 'rulebook')
	{
		return([{ key: 'answer', ...describeSingleImpact(impact, ruleset) }]);
	}

	const rulebook = rulebookName(ruleset, impact.rulebook);
	const listed = (options: readonly ImpactedOption[], nameOf: (name: OptionName) => string): string => formatList(options.map((option) => t({
		id: 'editor.impact.rulebookOption',
		defaultMessage: '{name} ({count, plural, one {# character} other {# characters}})',
		description: 'One race, class or item in the list under a choice in the dialog the editor\'s Save opens, for a book of game rules being turned off; {name} is its name and {count} how many characters are it or carry it'
	}, {
		name: nameOf(option.name),
		count: option.characters
	})));
	const questions: ImpactQuestion[] = [];

	if ((impact.races.length + impact.classes.length) > 0)
	{
		questions.push({
			key: 'playing',
			legend: t({
				id: 'editor.impact.rulebookPlaying',
				defaultMessage: 'Turning off {rulebook}: characters are its races and classes',
				description: 'Heading of a choice in the dialog the editor\'s Save opens, for a book of game rules being turned off whose races and classes characters are; {rulebook} is the book\'s name. The races and classes are listed under it'
			}, {
				rulebook
			}),
			details: formatList([
				...((impact.races.length > 0) ? [listed(impact.races, (name) => raceName(name, ruleset))] : []),
				...((impact.classes.length > 0) ? [listed(impact.classes, (name) => className(name, ruleset))] : [])
			]),
			options: RULEBOOK_PLAYING_ANSWERS,
			chosen: 'keep'
		});
	}

	if (impact.items.length > 0)
	{
		questions.push({
			key: 'items',
			legend: t({
				id: 'editor.impact.rulebookItems',
				defaultMessage: 'Turning off {rulebook}: characters carry its items',
				description: 'Heading of a choice in the dialog the editor\'s Save opens, for a book of game rules being turned off whose items characters carry; {rulebook} is the book\'s name. The items are listed under it'
			}, {
				rulebook
			}),
			details: listed(impact.items, (name) => itemName(name, ruleset)),
			options: RULEBOOK_ITEM_ANSWERS,
			chosen: 'keep'
		});
	}

	return(questions);
}

/**
 * What an impact other than a book's says, the answers it offers and the one chosen to begin with
 *
 * @param impact The impact
 * @param ruleset The universe's ruleset
 * @return The choice's heading, answers and first answer
 */
function describeSingleImpact(impact: Exclude<ChangeImpact, { kind: 'rulebook' }>, ruleset: Ruleset): Omit<ImpactQuestion, 'key'>
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

		case 'lobbyArea':
			return({
				legend: t({
					id: 'editor.impact.lobbyArea',
					defaultMessage: 'Putting {name} in the lobby: {count, plural, one {# character in a group is in it} other {# characters in groups are in it}}',
					description: 'Heading in the dialog the editor\'s Save opens, for an area being put below the lobby region, which only the lobby walks; {name} is the area\'s name and {count} how many characters of groups are in it, playing or where their group left them'
				}, {
					name: impact.name,
					count: impact.characters
				}),
				// Groups never play in the lobby, so there is nowhere else for them to go
				options: LOBBY_AREA_ANSWERS,
				chosen: 'start'
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
 * A change with the answers to one of its impacts
 *
 * @param change The change
 * @param impact The impact answered
 * @param answers The answers chosen, by question
 * @return The change to save
 */
function withAnswer(change: EditorChange, impact: ChangeImpact, answers: ImpactAnswers): EditorChange
{
	const answer = (answers.answer ?? '');

	switch (change.kind)
	{
		case 'applyDraft':
			return({ ...change, choices: withDraftAnswer(change.choices, impact, answers) });
		case 'ruleset':
		{
			if (impact.kind !== 'rulebook')
			{
				return(change);
			}

			const { settings } = change.settings;
			const barredRulebooks = settings.barredRulebooks.filter((rulebook) => (rulebook !== impact.rulebook));

			return({
				...change,
				settings: withRulebooks(change.settings, {
					rulebooks: settings.rulebooks,
					barredRulebooks: ((answers.playing === 'prevent') ? [...barredRulebooks, impact.rulebook] : barredRulebooks)
				}),
				whenRulebooksOff: {
					...change.whenRulebooksOff,
					[impact.rulebook]: ((answers.items === 'remove') ? 'remove' : 'keep')
				}
			});
		}
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
				? {
					...change,
					moveTo: { ...change.moveTo, [impact.id]: ((answer === 'parent') ? 'parent' : 'start') }
				}
				: change);
		case 'universe':
			return(((impact.kind === 'groupSize') ? { ...change, largerGroups: groupAnswer(answer) } : change));
		default:
			return(change);
	}
}

/**
 * The choices of a change applying the universe's draft, with the answers to one of its impacts, which
 * names what it is about by its live ID
 *
 * @param choices The choices so far
 * @param impact The impact answered
 * @param answers The answers chosen, by question
 * @return The choices
 */
function withDraftAnswer(choices: DraftApplyChoices, impact: ChangeImpact, answers: ImpactAnswers): DraftApplyChoices
{
	const answer = (answers.answer ?? '');

	switch (impact.kind)
	{
		case 'rulebook':
			return({
				...choices,
				rulebooks: {
					...choices.rulebooks,
					[impact.rulebook]: {
						keepPlaying: (answers.playing !== 'prevent'),
						items: ((answers.items === 'remove') ? 'remove' : 'keep')
					}
				}
			});
		case 'race':
			return({ ...choices, races: { ...choices.races, [impact.id]: (answer === 'keep') } });
		case 'class':
			return({ ...choices, classes: { ...choices.classes, [impact.id]: (answer === 'keep') } });
		case 'item':
			return({ ...choices, items: { ...choices.items, [impact.id]: ((answer === 'remove') ? 'remove' : 'keep') } });
		case 'area':
			return({ ...choices, areas: { ...choices.areas, [impact.id]: ((answer === 'parent') ? 'parent' : 'start') } });
		case 'lobbyArea':
			return(choices);
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
