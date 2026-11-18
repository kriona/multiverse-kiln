/**
 * The avatar positioning tool (avatar-positions.html), for developers placing the engine's item drawings
 * on the avatar bases (see Avatars in STRUCTURE-OVERVIEW.md). It chooses an art type, an item drawing, a
 * race and a body type, draws the drawing's parts on that base, and moves each part by dragging, with the
 * arrow keys or by typing where it goes, the off hand's and right ring's flipped copies included. It copies
 * the drawing with its offsets as TypeScript to paste into the art type's file in shared/src/avatars/, and
 * writes no files. It only works while the server's dev tools are on
 *
 * This is the only place the browser composes avatar art: the server makes every avatar players see
 */
import { AVATAR_HEIGHT, AVATAR_MANIFEST, AVATAR_WIDTH, BEHIND_BASE_LAYER, BODY_TYPE_NAMES, BODY_TYPES, BOTH_HANDS_POSITION, DEFAULT_BACKGROUND, DEFAULT_ITEM_EQUIPS, DEFAULT_ITEM_NAMES, DEFAULT_RACE_NAMES, DEV_TOOLS_PATH, HELD_EQUIPMENT_NAMES, RULESET_EQUIPMENT, RULESET_NAMES, RULESETS, defineMessages, isBodyType, slotName, type AvatarPoint, type BodyType, type ItemDrawing, type MessageDescriptor, type Ruleset } from '@multiverse-kiln/shared';

import { formatList, t } from './localization';
import { serverHttpUrl } from './network/serverConnection';
import { startPage } from './pageStart';
import { announce } from './ui/announcer';
import { refreshUnsavedWork, watchUnsavedWork } from './ui/changeTracker';
import { getElement, setOptions, setPageTitle, type SelectOption } from './ui/dom';
import { addKeyHelp } from './ui/shortcuts';

/**
 * Where a part goes on each base, which the tool changes as parts are moved
 */
type EditableOffsets = Record<string, Partial<Record<BodyType, AvatarPoint>>>;

/**
 * A drawing's part as the tool edits it
 */
interface EditablePart
{
	file: string;
	layer?: string;
	offsets: EditableOffsets;
	mirroredOffsets?: EditableOffsets;
}

/**
 * One part of the chosen drawing as it is drawn: the part itself, or its flipped copy in the off hand or
 * right ring
 */
interface PartRef
{
	index: number;
	mirrored: boolean;
}

/**
 * Where a part was drawn, for finding the one under the pointer
 */
interface DrawnPart
{
	ref: PartRef;
	x: number;
	y: number;
	width: number;
	height: number;
}

/**
 * A part's row in the list of parts
 */
interface PartRow
{
	handle: HTMLButtonElement;
	x: HTMLInputElement;
	y: HTMLInputElement;
	note: HTMLElement;
}

/**
 * The folder the art is in, which each file's path in the manifest is relative to
 */
const ASSETS_FOLDER = 'assets/avatars/';

/**
 * Every PNG of the avatar art, by its path relative to shared/assets/avatars/, as an address the browser loads
 */
const FILE_URLS = new Map(Object.entries(import.meta.glob<string>('../../shared/assets/avatars/**/*.png', {
	eager: true,
	query: '?url',
	import: 'default'
}))
	.map(([path, url]) => [path.slice(path.indexOf(ASSETS_FOLDER) + ASSETS_FOLDER.length), url]));

/**
 * How far one press of an arrow key moves a part, and with Shift held
 */
const STEP = 1;
const LARGE_STEP = 10;

/**
 * How far a part's offset may go past the base's edges
 */
const MIN_OFFSET = -AVATAR_WIDTH;
const MAX_OFFSET = AVATAR_HEIGHT * 2;

/**
 * Text the tool shows in more than one place (see src/localization.ts)
 */
const messages = defineMessages({
	part: {
		id: 'avatarPositions.partName',
		defaultMessage: 'Part {number}: {file}',
		description: 'On the avatar positioning tool, a part of the chosen item drawing in the list of parts and in what is read out as it moves; {number} counts the drawing\'s parts from 1, and {file} is its image\'s file name'
	},
	mirroredPart: {
		id: 'avatarPositions.mirroredPartName',
		defaultMessage: 'Part {number}, flipped in the {slot}: {file}',
		description: 'On the avatar positioning tool, the flipped copy of a part of the chosen item drawing, drawn in the off hand or the right ring, in the list of parts and in what is read out as it moves; {number} counts the drawing\'s parts from 1, {slot} names the slot (such as Off hand), and {file} is its image\'s file name'
	},
	moved: {
		id: 'avatarPositions.moved',
		defaultMessage: '{part} at {x}, {y}',
		description: 'Read out by screen readers on the avatar positioning tool when a part is moved; {part} names it, and {x} and {y} are where its top left corner is on the base, in pixels'
	}
});

/**
 * The tool's controls and what they have chosen
 */
class PositioningTool
{
	private readonly artTypeSelect = getElement('positions-art-type', HTMLSelectElement);
	private readonly rulesetSelect = getElement('positions-ruleset', HTMLSelectElement);
	private readonly itemSelect = getElement('positions-item', HTMLSelectElement);
	private readonly drawingSelect = getElement('positions-drawing', HTMLSelectElement);
	private readonly raceSelect = getElement('positions-race', HTMLSelectElement);
	private readonly bodyTypeSelect = getElement('positions-body-type', HTMLSelectElement);
	private readonly details = getElement('positions-drawing-details', HTMLElement);
	private readonly problem = getElement('positions-problem', HTMLElement);
	private readonly canvas = getElement('positions-canvas', HTMLCanvasElement);
	private readonly partList = getElement('positions-part-list', HTMLUListElement);
	private readonly missingList = getElement('positions-missing', HTMLUListElement);
	private readonly noneMissing = getElement('positions-none-missing', HTMLElement);
	private readonly copyButton = getElement('positions-copy', HTMLButtonElement);
	private readonly copyStatus = getElement('positions-copy-status', HTMLElement);

	/**
	 * The drawings changed on this page, by drawingKey(), with whether each has changed since it was copied
	 */
	private readonly edits = new Map<string, EditablePart[]>();
	private readonly uncopied = new Set<string>();

	/**
	 * Each file loaded so far, or null for one the manifest names that isn't there
	 */
	private readonly images = new Map<string, Promise<HTMLImageElement | null>>();

	private readonly rows = new Map<string, PartRow>();
	private drawn: DrawnPart[] = [];
	private selected: PartRef | null = null;

	/**
	 * Counts the times the picture is drawn, so a slow load doesn't draw over a newer choice
	 */
	private drawings = 0;

	private copyTimer: number | undefined;

	/**
	 * Sets up the controls and shows the first drawing
	 */
	constructor()
	{
		setOptions(this.artTypeSelect, Object.entries(AVATAR_MANIFEST.artTypes)
			.map(([key, art]) => ({
				value: key,
				label: ((typeof art.name === 'string') ? art.name : t(art.name))
			})));
		setOptions(this.rulesetSelect, RULESETS.map((ruleset) => ({
			value: ruleset,
			label: t(RULESET_NAMES[ruleset])
		})));
		this.chooseFirstDrawn();

		this.artTypeSelect.addEventListener('change', () => this.fillItems());
		this.rulesetSelect.addEventListener('change', () => this.fillItems());
		this.itemSelect.addEventListener('change', () => this.fillDrawings());
		this.drawingSelect.addEventListener('change', () => this.fillRaces());
		this.raceSelect.addEventListener('change', () => this.fillBodyTypes());
		this.bodyTypeSelect.addEventListener('change', () => this.showBase());
		this.copyButton.addEventListener('click', () =>
		{
			void this.copy();
		});
		this.followPointer();

		watchUnsavedWork({
			hasUnsavedChanges: () => (this.uncopied.size > 0)
		});
		addKeyHelp({
			scope: getElement('positions-parts-section', HTMLElement),
			keys: () => t({
				id: 'avatarPositions.keys.move',
				defaultMessage: 'Arrow keys',
				description: 'In the list of keyboard shortcuts on the avatar positioning tool, the keys that move the chosen part; the keys are the same in every language'
			}),
			description: () => t({
				id: 'avatarPositions.keys.moveDescription',
				defaultMessage: 'Move the chosen part one pixel, or 10 with Shift',
				description: 'In the list of keyboard shortcuts on the avatar positioning tool, what the arrow keys do while a part\'s button in the list of parts has focus'
			})
		});

		this.fillItems();
	}

	/**
	 * Chooses the first art type and ruleset that have an item drawing, so the tool opens on something
	 */
	private chooseFirstDrawn(): void
	{
		for (const [artType, art] of Object.entries(AVATAR_MANIFEST.artTypes))
		{
			const ruleset = RULESETS.find((each) => (Object.keys(art.items[each]).length > 0));

			if (ruleset !== undefined)
			{
				this.artTypeSelect.value = artType;
				this.rulesetSelect.value = ruleset;
				return;
			}
		}
	}

	/**
	 * The chosen ruleset
	 *
	 * @return The ruleset
	 */
	private get ruleset(): Ruleset
	{
		return(RULESETS.find((ruleset) => (ruleset === this.rulesetSelect.value)) ?? RULESETS[0]);
	}

	/**
	 * The chosen art type's manifest
	 *
	 * @return The art type
	 */
	private get art(): (typeof AVATAR_MANIFEST)['artTypes'][string]
	{
		return(AVATAR_MANIFEST.artTypes[this.artTypeSelect.value]);
	}

	/**
	 * The chosen drawing, as the manifest has it
	 *
	 * @return The drawing, or undefined when there is none to choose
	 */
	private get drawing(): ItemDrawing | undefined
	{
		const drawings = this.art.items[this.ruleset][this.itemSelect.value] ?? [];

		return(drawings[Number(this.drawingSelect.value)]);
	}

	/**
	 * The chosen body type
	 *
	 * @return The body type, or undefined when none is chosen
	 */
	private get bodyType(): BodyType | undefined
	{
		const value = this.bodyTypeSelect.value;

		return((isBodyType(value) ? value : undefined));
	}

	/**
	 * Names the chosen drawing among the page's edits
	 *
	 * @return The key
	 */
	private drawingKey(): string
	{
		return([this.artTypeSelect.value, this.ruleset, this.itemSelect.value, this.drawingSelect.value].join('|'));
	}

	/**
	 * The chosen drawing's parts as the page has them, copied from the manifest the first time
	 *
	 * @return The parts
	 */
	private parts(): EditablePart[]
	{
		const key = this.drawingKey();
		let parts = this.edits.get(key);

		if (!parts)
		{
			parts = structuredClone(this.drawing?.parts ?? []) as EditablePart[];
			this.edits.set(key, parts);
		}

		return(parts);
	}

	/**
	 * The slot whose drawing the chosen item's flipped copy uses: the main hand for an item held in one
	 * hand and the left ring for a ring, while the drawing is for that slot
	 *
	 * @return The slot, or undefined when the drawing has no flipped copy
	 */
	private mirroredSlot(): { source: string; slot: string } | undefined
	{
		const equips = DEFAULT_ITEM_EQUIPS[this.ruleset][this.itemSelect.value];
		const { ringLocation } = RULESET_EQUIPMENT[this.ruleset];
		let mirror: { source: string; slot: string } | undefined;

		if (equips === 'oneHand')
		{
			mirror = {
				source: 'mainHand',
				slot: 'offHand'
			};
		}
		else if ((ringLocation !== null) && (equips === ringLocation))
		{
			mirror = {
				source: 'ringLeft',
				slot: 'ringRight'
			};
		}

		const slots = this.drawing?.slots;

		return((((mirror !== undefined) && ((slots === undefined) || slots.includes(mirror.source))) ? mirror : undefined));
	}

	/**
	 * Lists the items the chosen art type has drawings of in the chosen ruleset
	 */
	private fillItems(): void
	{
		const names = DEFAULT_ITEM_NAMES[this.ruleset];
		const keys = Object.keys(this.art.items[this.ruleset]);

		setOptions(this.itemSelect, keys
			.map((key) => ({
				value: key,
				label: (Object.hasOwn(names, key) ? t(names[key]) : key)
			}))
			.sort((a, b) => a.label.localeCompare(b.label)));
		this.fillDrawings();
	}

	/**
	 * Lists the chosen item's drawings
	 */
	private fillDrawings(): void
	{
		const drawings = this.art.items[this.ruleset][this.itemSelect.value] ?? [];

		setOptions(this.drawingSelect, drawings.map((_drawing, index) => ({
			value: String(index),
			label: t({
				id: 'avatarPositions.drawingNumber',
				defaultMessage: 'Drawing {number}',
				description: 'A choice in the avatar positioning tool\'s list of an item\'s drawings; {number} counts them from 1 in the order the manifest lists them'
			}, { number: (index + 1) })
		})));
		this.fillRaces();
	}

	/**
	 * Lists the races the chosen drawing is for that have a base in the chosen art type, and says what the
	 * drawing is for
	 */
	private fillRaces(): void
	{
		const drawing = this.drawing;
		const bases = this.art.bases[this.ruleset];
		const names = DEFAULT_RACE_NAMES[this.ruleset];

		setOptions(this.raceSelect, (drawing?.races ?? [])
			.filter((race) => (Object.hasOwn(bases, race) && (this.baseBodyTypes(race).length > 0)))
			.map((race) => ({
				value: race,
				label: (Object.hasOwn(names, race) ? t(names[race]) : race)
			})));
		this.describeDrawing();
		this.fillBodyTypes();
	}

	/**
	 * The body types of a race the chosen drawing is for that have a base in the chosen art type
	 *
	 * @param race The race's key
	 * @return The body types, in BODY_TYPES' order
	 */
	private baseBodyTypes(race: string): BodyType[]
	{
		const bases = this.art.bases[this.ruleset];
		const allowed = this.drawing?.bodyTypes;

		return(BODY_TYPES.filter((bodyType) => (Object.hasOwn(bases, race) && (bases[race][bodyType] !== undefined) && ((allowed === undefined) || allowed.includes(bodyType)))));
	}

	/**
	 * Lists the chosen race's body types that have a base
	 */
	private fillBodyTypes(): void
	{
		const options: SelectOption[] = this.baseBodyTypes(this.raceSelect.value).map((bodyType) => ({
			value: bodyType,
			label: t(BODY_TYPE_NAMES[bodyType])
		}));

		setOptions(this.bodyTypeSelect, options);
		this.showBase();
	}

	/**
	 * Says which races, body types and slots the chosen drawing is for
	 */
	private describeDrawing(): void
	{
		const drawing = this.drawing;

		if (!drawing)
		{
			this.details.textContent = '';
			return;
		}

		const raceNames = DEFAULT_RACE_NAMES[this.ruleset];
		const every = (): string => t({
			id: 'avatarPositions.every',
			defaultMessage: 'every one',
			description: 'On the avatar positioning tool, in "For {races}; body types: {bodyTypes}; slots: {slots}", in place of the body types or slots when the drawing doesn\'t narrow them'
		});

		this.details.textContent = t({
			id: 'avatarPositions.drawingFor',
			defaultMessage: 'For {races}; body types: {bodyTypes}; slots: {slots}',
			description: 'On the avatar positioning tool, under the choices, what the chosen item drawing is for: {races}, {bodyTypes} and {slots} are lists of names, and the last two can be "every one"'
		}, {
			races: formatList(drawing.races.map((race) => (Object.hasOwn(raceNames, race) ? t(raceNames[race]) : race))),
			bodyTypes: ((drawing.bodyTypes === undefined) ? every() : formatList(drawing.bodyTypes.map((bodyType) => t(BODY_TYPE_NAMES[bodyType])))),
			slots: ((drawing.slots === undefined) ? every() : formatList(drawing.slots.map((slot) => this.slotLabel(slot))))
		});
	}

	/**
	 * A slot's name, or holding in both hands
	 *
	 * @param slot The slot, or BOTH_HANDS_POSITION
	 * @return The name in the player's language
	 */
	private slotLabel(slot: string): string
	{
		const name: MessageDescriptor | undefined = ((slot === BOTH_HANDS_POSITION) ? HELD_EQUIPMENT_NAMES.bothHands : slotName(this.ruleset, slot));

		return(((name === undefined) ? slot : t(name)));
	}

	/**
	 * Shows the chosen drawing on the chosen base: its list of parts, the bases still to place, and the picture
	 */
	private showBase(): void
	{
		this.selected = null;
		this.showProblem();
		this.fillParts();
		this.fillMissing();
		this.copyButton.disabled = (this.drawing === undefined);
		void this.draw();
	}

	/**
	 * Says why nothing can be placed, if anything stops it
	 */
	private showProblem(): void
	{
		let text: string | undefined;

		if (this.itemSelect.options.length === 0)
		{
			text = t({
				id: 'avatarPositions.noItems',
				defaultMessage: 'This art type has no item drawings for this ruleset yet.',
				description: 'On the avatar positioning tool, when the chosen art type has no item drawings in the chosen ruleset\'s part of the manifest'
			});
		}
		else if (this.raceSelect.options.length === 0)
		{
			text = t({
				id: 'avatarPositions.noBases',
				defaultMessage: 'None of the races this drawing is for has a base drawn in this art type yet.',
				description: 'On the avatar positioning tool, when no race the chosen item drawing lists has a base (the drawing of the race\'s body) in the chosen art type'
			});
		}

		this.problem.hidden = (text === undefined);
		this.problem.textContent = (text ?? '');
	}

	/**
	 * Names a part as the list of parts and what is read out show it
	 *
	 * @param ref The part
	 * @return Its name in the player's language
	 */
	private partLabel(ref: PartRef): string
	{
		const part = this.parts()[ref.index];
		const mirror = this.mirroredSlot();

		if (ref.mirrored && (mirror !== undefined))
		{
			return(t(messages.mirroredPart, {
				number: (ref.index + 1),
				slot: this.slotLabel(mirror.slot),
				file: part.file
			}));
		}

		return(t(messages.part, {
			number: (ref.index + 1),
			file: part.file
		}));
	}

	/**
	 * The parts as they are drawn and listed: each part, then its flipped copy when the drawing has one
	 *
	 * @return The parts
	 */
	private partRefs(): PartRef[]
	{
		const mirrored = (this.mirroredSlot() !== undefined);

		return(this.parts().flatMap((_part, index) => [
			{
				index,
				mirrored: false
			},
			...(mirrored ? [{
				index,
				mirrored: true
			}] : [])
		]));
	}

	/**
	 * Where a part goes on the chosen base
	 *
	 * @param ref The part
	 * @return The place, or undefined when it has none there yet
	 */
	private offsetOf(ref: PartRef): AvatarPoint | undefined
	{
		const part = this.parts()[ref.index];
		const offsets = (ref.mirrored ? part.mirroredOffsets : part.offsets);
		const bodyType = this.bodyType;
		const race = this.raceSelect.value;

		return((((offsets !== undefined) && (bodyType !== undefined) && Object.hasOwn(offsets, race)) ? offsets[race][bodyType] : undefined));
	}

	/**
	 * Lists the chosen drawing's parts, each with where it goes on the chosen base
	 */
	private fillParts(): void
	{
		this.rows.clear();
		this.partList.replaceChildren(...((this.bodyType === undefined) ? [] : this.partRefs().map((ref) => this.partRow(ref))));
		this.showOffsets();
	}

	/**
	 * Makes a part's row in the list of parts: a button that chooses it and moves it with the arrow keys,
	 * and fields for where it goes
	 *
	 * @param ref The part
	 * @return The row
	 */
	private partRow(ref: PartRef): HTMLLIElement
	{
		const item = document.createElement('li');
		const handle = document.createElement('button');
		const note = document.createElement('span');
		const field = (axis: 'x' | 'y'): { label: HTMLLabelElement; input: HTMLInputElement } =>
		{
			const label = document.createElement('label');
			const input = document.createElement('input');

			input.type = 'number';
			input.min = String(MIN_OFFSET);
			input.max = String(MAX_OFFSET);
			input.step = '1';
			input.addEventListener('change', () =>
			{
				const value = Math.trunc(Number(input.value));

				if (!Number.isFinite(value) || (input.value === ''))
				{
					this.showOffsets();
					return;
				}

				const current = (this.offsetOf(ref) ?? { x: 0, y: 0 });

				this.select(ref);
				this.moveTo(ref, ((axis === 'x') ? value : current.x), ((axis === 'y') ? value : current.y));
			});
			label.append(((axis === 'x') ? 'X' : 'Y'), ' ', input);
			label.translate = false;

			return({ label, input });
		};
		const x = field('x');
		const y = field('y');

		handle.type = 'button';
		handle.className = 'positions-part-handle';
		handle.textContent = this.partLabel(ref);
		handle.setAttribute('aria-pressed', 'false');
		handle.setAttribute('aria-describedby', 'positions-parts-hint');
		handle.addEventListener('click', () => this.select(ref));
		handle.addEventListener('keydown', (event) =>
		{
			const steps: Record<string, [number, number]> = {
				ArrowLeft: [-1, 0],
				ArrowRight: [1, 0],
				ArrowUp: [0, -1],
				ArrowDown: [0, 1]
			};
			const step = steps[event.key];

			if ((step === undefined) || event.altKey || event.ctrlKey || event.metaKey)
			{
				return;
			}

			event.preventDefault();
			this.select(ref);

			const distance = (event.shiftKey ? LARGE_STEP : STEP);
			const current = (this.offsetOf(ref) ?? { x: 0, y: 0 });

			this.moveTo(ref, (current.x + (step[0] * distance)), (current.y + (step[1] * distance)));
			this.announceMove(ref);
		});
		note.className = 'hint';
		item.className = 'positions-part';
		item.append(handle, x.label, y.label, note);
		this.rows.set(refKey(ref), {
			handle,
			x: x.input,
			y: y.input,
			note
		});

		return(item);
	}

	/**
	 * Shows each part's place on the chosen base in its fields, and whether it is chosen
	 */
	private showOffsets(): void
	{
		for (const ref of this.partRefs())
		{
			const row = this.rows.get(refKey(ref));
			const offset = this.offsetOf(ref);

			if (!row)
			{
				continue;
			}

			row.x.value = ((offset === undefined) ? '' : String(offset.x));
			row.y.value = ((offset === undefined) ? '' : String(offset.y));
			row.note.textContent = ((offset === undefined)
				? t({
					id: 'avatarPositions.notPlaced',
					defaultMessage: 'Not placed on this base yet',
					description: 'On the avatar positioning tool, beside a part in the list of parts that has no offset for the chosen base, so the game doesn\'t draw it there. Moving it gives it one'
				})
				: '');
			row.handle.setAttribute('aria-pressed', String((this.selected !== null) && (refKey(this.selected) === refKey(ref))));
		}
	}

	/**
	 * Chooses the part that the pointer and the picture's outline move
	 *
	 * @param ref The part
	 */
	private select(ref: PartRef): void
	{
		this.selected = ref;
		this.showOffsets();
		void this.draw();
	}

	/**
	 * Moves a part on the chosen base, giving it an offset there if it had none
	 *
	 * @param ref The part
	 * @param x Where its left edge goes
	 * @param y Where its top edge goes
	 */
	private moveTo(ref: PartRef, x: number, y: number): void
	{
		const bodyType = this.bodyType;

		if (bodyType === undefined)
		{
			return;
		}

		const part = this.parts()[ref.index];
		const race = this.raceSelect.value;
		const clamp = (value: number): number => Math.max(MIN_OFFSET, Math.min(MAX_OFFSET, Math.round(value)));

		if (ref.mirrored)
		{
			part.mirroredOffsets ??= {};
		}

		const offsets = (ref.mirrored ? (part.mirroredOffsets ?? {}) : part.offsets);

		offsets[race] ??= {};
		offsets[race][bodyType] = {
			x: clamp(x),
			y: clamp(y)
		};
		this.uncopied.add(this.drawingKey());
		refreshUnsavedWork();
		this.showOffsets();
		this.fillMissing();
		void this.draw();
	}

	/**
	 * Reads out where a part is now
	 *
	 * @param ref The part
	 */
	private announceMove(ref: PartRef): void
	{
		const offset = this.offsetOf(ref);

		if (offset !== undefined)
		{
			announce(t(messages.moved, {
				part: this.partLabel(ref),
				x: offset.x,
				y: offset.y
			}));
		}
	}

	/**
	 * Lists the bases the chosen drawing is for that it has no offsets or flipped offsets for yet, each a
	 * button choosing that base
	 */
	private fillMissing(): void
	{
		const drawing = this.drawing;
		const parts = this.parts();
		const mirrored = (this.mirroredSlot() !== undefined);
		const raceNames = DEFAULT_RACE_NAMES[this.ruleset];
		const items: HTMLLIElement[] = [];

		for (const race of (drawing?.races ?? []))
		{
			for (const bodyType of this.baseBodyTypes(race))
			{
				const lacking = (offsetsOf: (part: EditablePart) => EditableOffsets | undefined): number => parts
					.filter((part) => (offsetsOf(part)?.[race]?.[bodyType] === undefined))
					.length;
				const names = {
					race: (Object.hasOwn(raceNames, race) ? t(raceNames[race]) : race),
					bodyType: t(BODY_TYPE_NAMES[bodyType])
				};
				const missing = lacking((part) => part.offsets);
				const missingFlipped = (mirrored ? lacking((part) => part.mirroredOffsets) : 0);

				if (missing > 0)
				{
					items.push(this.missingItem(race, bodyType, t({
						id: 'avatarPositions.missingParts',
						defaultMessage: '{race}, {bodyType}: {count, plural, one {# part has} other {# parts have}} no offset',
						description: 'On the avatar positioning tool, a base in the list of bases still to place, as a button that shows that base; {race} and {bodyType} name the base, and {count} counts the drawing\'s parts with no offset there, which the game doesn\'t draw on it'
					}, {
						...names,
						count: missing
					})));
				}

				if (missingFlipped > 0)
				{
					items.push(this.missingItem(race, bodyType, t({
						id: 'avatarPositions.missingFlipped',
						defaultMessage: '{race}, {bodyType}: {count, plural, one {# flipped part has} other {# flipped parts have}} no offset',
						description: 'On the avatar positioning tool, a base in the list of bases still to place, as a button that shows that base; {race} and {bodyType} name the base, and {count} counts the drawing\'s parts with no offset there for their flipped copy in the off hand or right ring, which the game doesn\'t draw there on it'
					}, {
						...names,
						count: missingFlipped
					})));
				}
			}
		}

		this.missingList.replaceChildren(...items);
		this.noneMissing.hidden = ((items.length > 0) || (drawing === undefined));
	}

	/**
	 * Makes an entry of the list of bases still to place: a button that shows the base
	 *
	 * @param race The base's race
	 * @param bodyType The base's body type
	 * @param text What is missing there
	 * @return The entry
	 */
	private missingItem(race: string, bodyType: BodyType, text: string): HTMLLIElement
	{
		const item = document.createElement('li');
		const button = document.createElement('button');

		button.type = 'button';
		button.className = 'link-button';
		button.textContent = text;
		button.addEventListener('click', () =>
		{
			this.raceSelect.value = race;
			this.fillBodyTypes();
			this.bodyTypeSelect.value = bodyType;
			this.showBase();
			this.bodyTypeSelect.focus();
		});
		item.append(button);

		return(item);
	}

	/**
	 * Loads one of the art's files
	 *
	 * @param file Its path, relative to shared/assets/avatars/
	 * @return The image, or null when the file isn't there or can't be read
	 */
	private load(file: string): Promise<HTMLImageElement | null>
	{
		let image = this.images.get(file);

		if (!image)
		{
			const url = FILE_URLS.get(file);

			image = ((url === undefined)
				? Promise.resolve(null)
				: new Promise((resolve) =>
				{
					const element = new Image();

					element.src = url;
					element.decode()
						.then(() => resolve(element))
						.catch(() => resolve(null));
				}));
			this.images.set(file, image);
		}

		return(image);
	}

	/**
	 * Draws the background, the chosen base and the chosen drawing's parts on it, the chosen part outlined,
	 * and says which files the manifest names that aren't there
	 */
	private async draw(): Promise<void>
	{
		const drawing = ++this.drawings;
		const bodyType = this.bodyType;
		const base = ((bodyType === undefined) ? undefined : this.art.bases[this.ruleset][this.raceSelect.value]?.[bodyType]);
		const artType = this.artTypeSelect.value;
		const background = AVATAR_MANIFEST.backgrounds[DEFAULT_BACKGROUND];
		const refs = ((base === undefined) ? [] : this.partRefs());
		const parts = this.parts();
		const ordered = [
			...refs.filter((ref) => (parts[ref.index].layer === BEHIND_BASE_LAYER)),
			null,
			...refs.filter((ref) => (parts[ref.index].layer !== BEHIND_BASE_LAYER))
		];
		const [backgroundImage, baseImage, ...partImages] = await Promise.all([
			this.load(background),
			((base === undefined) ? Promise.resolve(null) : this.load(`${artType}/${base}`)),
			...ordered.map((ref) => ((ref === null) ? Promise.resolve(null) : this.load(`${artType}/${parts[ref.index].file}`)))
		]);

		if (drawing !== this.drawings)
		{
			return;
		}

		const context = this.canvas.getContext('2d');

		if (!context)
		{
			return;
		}

		const missingFiles = new Set<string>();

		context.clearRect(0, 0, AVATAR_WIDTH, AVATAR_HEIGHT);
		context.imageSmoothingEnabled = false;

		if (backgroundImage)
		{
			context.drawImage(backgroundImage, 0, 0);
		}

		this.drawn = [];
		ordered.forEach((ref, index) =>
		{
			if (ref === null)
			{
				if (baseImage)
				{
					context.drawImage(baseImage, 0, 0);
				}
				else if (base !== undefined)
				{
					missingFiles.add(`${artType}/${base}`);
				}

				return;
			}

			const image = partImages[index];
			const offset = this.offsetOf(ref);
			const placed = (offset ?? { x: 0, y: 0 });

			if (!image)
			{
				missingFiles.add(`${artType}/${parts[ref.index].file}`);
				return;
			}

			context.save();
			context.globalAlpha = ((offset === undefined) ? 0.4 : 1);

			if (ref.mirrored)
			{
				context.translate((placed.x + image.width), placed.y);
				context.scale(-1, 1);
				context.drawImage(image, 0, 0);
			}
			else
			{
				context.drawImage(image, placed.x, placed.y);
			}

			context.restore();
			this.drawn.push({
				ref,
				x: placed.x,
				y: placed.y,
				width: image.width,
				height: image.height
			});
		});

		const chosen = this.drawn.find((part) => ((this.selected !== null) && (refKey(part.ref) === refKey(this.selected))));

		if (chosen)
		{
			context.save();
			context.strokeStyle = '#59d95e';
			context.setLineDash([3, 2]);
			context.strokeRect((chosen.x + 0.5), (chosen.y + 0.5), Math.max((chosen.width - 1), 1), Math.max((chosen.height - 1), 1));
			context.restore();
		}

		if (missingFiles.size > 0)
		{
			this.problem.hidden = false;
			this.problem.textContent = t({
				id: 'avatarPositions.missingFiles',
				defaultMessage: 'The manifest names {count, plural, one {a file that isn\'t} other {files that aren\'t}} in shared/assets/avatars/: {files}',
				description: 'On the avatar positioning tool, when the avatar manifest names image files that haven\'t been added to the art folder; {files} lists their paths'
			}, {
				count: missingFiles.size,
				files: formatList([...missingFiles])
			});
		}
	}

	/**
	 * Moves parts by dragging them on the picture: the part under the pointer, the last drawn on top
	 */
	private followPointer(): void
	{
		let dragged: { ref: PartRef; startX: number; startY: number; from: AvatarPoint } | undefined;

		/**
		 * Where the pointer is on the base, in the base's pixels
		 *
		 * @param event The pointer event
		 * @return The point
		 */
		const pointOf = (event: PointerEvent): AvatarPoint =>
		{
			const rect = this.canvas.getBoundingClientRect();

			return({
				x: ((event.clientX - rect.left) * (AVATAR_WIDTH / rect.width)),
				y: ((event.clientY - rect.top) * (AVATAR_HEIGHT / rect.height))
			});
		};

		this.canvas.addEventListener('pointerdown', (event) =>
		{
			if (event.button !== 0)
			{
				return;
			}

			const point = pointOf(event);
			const hit = [...this.drawn].reverse().find((part) =>((point.x >= part.x) && (point.x < (part.x + part.width)) && (point.y >= part.y) && (point.y < (part.y + part.height))));

			if (!hit)
			{
				return;
			}

			event.preventDefault();
			this.select(hit.ref);
			dragged = {
				ref: hit.ref,
				startX: point.x,
				startY: point.y,
				from: {
					x: hit.x,
					y: hit.y
				}
			};
			this.canvas.setPointerCapture(event.pointerId);
			this.canvas.classList.add('dragging');
		});
		this.canvas.addEventListener('pointermove', (event) =>
		{
			if (!dragged || !this.canvas.hasPointerCapture(event.pointerId))
			{
				return;
			}

			const point = pointOf(event);

			this.moveTo(dragged.ref, (dragged.from.x + (point.x - dragged.startX)), (dragged.from.y + (point.y - dragged.startY)));
		});
		this.canvas.addEventListener('lostpointercapture', () =>
		{
			if (dragged)
			{
				this.announceMove(dragged.ref);
			}

			dragged = undefined;
			this.canvas.classList.remove('dragging');
		});
	}

	/**
	 * Copies the chosen drawing, with the offsets the page has, as TypeScript for the art type's file
	 */
	private async copy(): Promise<void>
	{
		const drawing = this.drawing;

		if (!drawing)
		{
			return;
		}

		let copied = true;

		try
		{
			await navigator.clipboard.writeText(drawingSource(drawing, this.parts()));
			this.uncopied.delete(this.drawingKey());
			refreshUnsavedWork();
		}
		catch
		{
			copied = false;
		}

		window.clearTimeout(this.copyTimer);
		this.copyStatus.textContent = (copied
			? t({
				id: 'avatarPositions.copied',
				defaultMessage: 'Copied. Paste it over the drawing in the art type\'s file.',
				description: 'On the avatar positioning tool, beside the Copy drawing button once the drawing has been copied as code'
			})
			: t({
				id: 'avatarPositions.copyFailed',
				defaultMessage: 'The browser didn\'t allow copying.',
				description: 'On the avatar positioning tool, beside the Copy drawing button when the browser refused to copy to the clipboard'
			}));
		this.copyTimer = window.setTimeout(() =>
		{
			this.copyStatus.textContent = '';
		}, 4000);
	}
}

/**
 * Names a part among a drawing's parts and their flipped copies
 *
 * @param ref The part
 * @return The key
 */
function refKey(ref: PartRef): string
{
	return(`${ref.index}${(ref.mirrored ? 'm' : '')}`);
}

/**
 * Writes a list of strings as a TypeScript array
 *
 * @param values The strings
 * @return The array's source
 */
function stringArray(values: readonly string[]): string
{
	return(`[${values.map((value) => `'${value.replace(/\\/g, '\\\\').replace(/'/g, '\\\'')}'`).join(', ')}]`);
}

/**
 * Writes a part's offsets as TypeScript, indented with tabs, in the manifest's style
 *
 * @param offsets The offsets
 * @param indent The tabs before the property
 * @return The offsets' source, without a property name
 */
function offsetsSource(offsets: EditableOffsets, indent: string): string
{
	const races = Object.entries(offsets)
		.map(([race, bodyTypes]) => [race, BODY_TYPES.filter((bodyType) => (bodyTypes[bodyType] !== undefined))] as const)
		.filter(([, bodyTypes]) => (bodyTypes.length > 0));
	const lines = races.map(([race, bodyTypes]) => [
		`${indent}\t${race}: {`,
		bodyTypes
			.map((bodyType) =>
			{
				const point = offsets[race][bodyType] as AvatarPoint;

				return(`${indent}\t\t${bodyType}: { x: ${point.x}, y: ${point.y} }`);
			})
			.join(',\n'),
		`${indent}\t}`
	].join('\n'));

	return(((lines.length === 0) ? '{}' : `{\n${lines.join(',\n')}\n${indent}}`));
}

/**
 * Writes a drawing as TypeScript to paste over it in the art type's file, with the page's offsets
 *
 * @param drawing The drawing as the manifest has it
 * @param parts Its parts, with the page's offsets
 * @return The drawing's source, indented to sit in an item's list of drawings
 */
function drawingSource(drawing: ItemDrawing, parts: readonly EditablePart[]): string
{
	const indent = '\t\t\t\t';
	const lines = [`${indent}{`, `${indent}\traces: ${stringArray(drawing.races)},`];

	if (drawing.bodyTypes !== undefined)
	{
		lines.push(`${indent}\tbodyTypes: ${stringArray(drawing.bodyTypes)},`);
	}

	if (drawing.slots !== undefined)
	{
		lines.push(`${indent}\tslots: ${stringArray(drawing.slots)},`);
	}

	lines.push(`${indent}\tparts: [`);
	lines.push(parts
		.map((part) =>
		{
			const partIndent = `${indent}\t\t`;
			const properties = [`${partIndent}\tfile: ${stringArray([part.file]).slice(1, -1)}`];

			if (part.layer !== undefined)
			{
				properties.push(`${partIndent}\tlayer: ${stringArray([part.layer]).slice(1, -1)}`);
			}

			properties.push(`${partIndent}\toffsets: ${offsetsSource(part.offsets, `${partIndent}\t`)}`);

			if (part.mirroredOffsets !== undefined)
			{
				properties.push(`${partIndent}\tmirroredOffsets: ${offsetsSource(part.mirroredOffsets, `${partIndent}\t`)}`);
			}

			return(`${partIndent}{\n${properties.join(',\n')}\n${partIndent}}`);
		})
		.join(',\n'));
	lines.push(`${indent}\t]`);
	lines.push(`${indent}}`);

	return(lines.join('\n'));
}

/**
 * Whether the server's dev tools are on, which the tool needs
 *
 * @return True when they are
 */
async function devToolsOn(): Promise<boolean>
{
	try
	{
		const response = await fetch(serverHttpUrl(DEV_TOOLS_PATH), { cache: 'no-store' });

		return(response.ok);
	}
	catch
	{
		return(false);
	}
}

/**
 * Starts the page: the tool once the server says its dev tools are on, or a notice saying why it can't
 * be used
 */
async function start(): Promise<void>
{
	await startPage();
	setPageTitle(document.title);

	const usable = await devToolsOn();
	const hasDrawings = Object.values(AVATAR_MANIFEST.artTypes).some((art) => RULESETS.some((ruleset) => (Object.keys(art.items[ruleset]).length > 0)));

	getElement('positions-loading', HTMLElement).hidden = true;
	getElement('positions-unavailable', HTMLElement).hidden = usable;
	getElement('positions-empty', HTMLElement).hidden = (!usable || hasDrawings);
	getElement('positions-tool', HTMLElement).hidden = (!usable || !hasDrawings);

	if (usable && hasDrawings)
	{
		new PositioningTool();
	}
}

void start();
