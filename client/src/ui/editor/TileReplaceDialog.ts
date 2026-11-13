import { DefaultTileLoss, placeKey, tileChanges, type EditableUniverse, type EditorTile, type InheritedTile, type LosingPlace, type PlaceRef, type PlaceTileChange, type PlaceWorld, type TileLoss, type TileReplacementChoice } from '@multiverse-kiln/shared';

import { formatList, t } from '../../localization';
import { describeEditorError } from '../../network/editorApi';
import { editorAreaUrl } from '../../pages';
import { announce } from '../announcer';
import { ChangeTracker } from '../changeTracker';
import { getElement, setOptions, showMessage } from '../dom';
import { tileName } from '../tileNames';
import { describeProblem, inheritLabel, type PlaceNames } from './places';
import { isNewPlace } from './stagedAreas';

/**
 * The regions and areas as the Areas tab's changes leave them, which the dialog works out what changes from
 */
export interface TilePlaces
{
	/**
	 * Loads the regions, areas and tiles, unless they have loaded already
	 */
	loadPlaces(): Promise<void>;

	/**
	 * The regions and areas as the Areas tab's changes leave them, with the tiles' kinds as the Tilesets
	 * tab's changes leave them
	 *
	 * @return The world
	 */
	world(): PlaceWorld;

	/**
	 * Names the regions and areas
	 *
	 * @return The namer
	 */
	names(): PlaceNames;

	/**
	 * The tiles the universe can use, with the Tilesets tab's changes
	 *
	 * @return The tiles
	 */
	tiles(): readonly EditorTile[];

	/**
	 * Whether the player may change a region or area
	 *
	 * @param place The region or area
	 * @return True when they may
	 */
	canEditPlace(place: PlaceRef): boolean;

	/**
	 * Shows the regions and areas as a save left them, once it gave some of them other default tiles
	 */
	placesSaved(): Promise<void>;
}

/**
 * What the dialog shows for one place losing the tile
 */
interface PlaceRow
{
	losing: LosingPlace;
	select: HTMLSelectElement;
	warning: HTMLElement;
}

/**
 * What the dialog is choosing for
 */
interface Replacing
{
	universe: EditableUniverse;
	tile: EditorTile;
	loss: TileLoss;

	/**
	 * The places losing the tile, and what choices leave
	 */
	losing: DefaultTileLoss;

	/**
	 * The tiles the version can use, without the tile when it is being deleted
	 */
	tileIds: ReadonlySet<number>;
	places: TilePlaces;
	rows: PlaceRow[];
}

/**
 * The value of a place's choice that takes what is above it
 */
const INHERIT_VALUE = 'inherit';

/**
 * The dialog that asks what regions and areas take as their default tile instead of a tile being
 * deleted, or no longer for one kind of area (see Replacing a default tile in STRUCTURE-OVERVIEW.md).
 * It lists each place that gives the tile to areas, with those areas, and a choice for each: Inherit,
 * when what is above it gives every one of those areas a tile, or a tile. Applying hands the changes
 * to the Tilesets tab, which saves them with the tile
 */
export class TileReplaceDialog
{
	private readonly dialog = getElement('tile-replace-dialog', HTMLDialogElement);
	private readonly form = getElement('tile-replace-form', HTMLFormElement);
	private readonly intro = getElement('tile-replace-intro', HTMLElement);
	private readonly status = getElement('tile-replace-status', HTMLElement);
	private readonly fields = getElement('tile-replace-fields', HTMLElement);
	private readonly all = getElement('tile-replace-all', HTMLSelectElement);
	private readonly count = getElement('tile-replace-count', HTMLElement);
	private readonly list = getElement('tile-replace-places', HTMLUListElement);
	private readonly outside = getElement('tile-replace-outside', HTMLElement);
	private readonly outsideList = getElement('tile-replace-outside-list', HTMLUListElement);
	private readonly problems = getElement('tile-replace-problems', HTMLElement);
	private readonly problemList = getElement('tile-replace-problem-list', HTMLUListElement);
	private readonly error = getElement('tile-replace-error', HTMLElement);
	private readonly cancelButton = getElement('tile-replace-cancel', HTMLButtonElement);
	private readonly changes: ChangeTracker;

	private replacing: Replacing | undefined;

	/**
	 * Called with the changes once the player applies them
	 */
	private onApply: (changes: PlaceTileChange[]) => void = () => undefined;

	/**
	 * Called when the dialog closes without applying
	 */
	private onCancel: () => void = () => undefined;

	/**
	 * Whether the dialog closed by applying
	 */
	private applied = false;

	/**
	 * Changes each time the dialog opens, so a load for an earlier opening is ignored
	 */
	private openVersion = 0;

	/**
	 * The count last shown, so it is only read out when it changes
	 */
	private shownCount = '';

	constructor()
	{
		this.changes = new ChangeTracker({ root: this.form });
		this.changes.guardDialog(this.dialog);

		this.cancelButton.addEventListener('click', () =>
		{
			if (this.changes.confirmDiscard())
			{
				this.dialog.close();
			}
		});

		this.dialog.addEventListener('close', () =>
		{
			if (!this.applied)
			{
				this.onCancel();
			}
		});

		this.all.addEventListener('change', () =>
		{
			if (this.all.value !== '')
			{
				for (const row of (this.replacing?.rows ?? []))
				{
					row.select.value = this.all.value;
				}
			}

			this.refresh();
		});

		this.list.addEventListener('change', () =>
		{
			this.refresh();
		});

		this.form.addEventListener('submit', (event) =>
		{
			event.preventDefault();
			this.apply();
		});
	}

	/**
	 * Works out which places lose a tile as their default tile and, when any do, asks what each takes
	 * instead. With none, onApply is called at once with no changes, and the dialog doesn't show
	 *
	 * @param universe The universe
	 * @param tile The tile
	 * @param loss How it is lost
	 * @param places The regions and areas
	 * @param before Changes the world as earlier choices for the same tile leave it, if any
	 * @param onApply Called with the default tile each place gets
	 * @param onCancel Called when the player closes the dialog instead
	 */
	async open(universe: EditableUniverse, tile: EditorTile, loss: TileLoss, places: TilePlaces, before: ((world: PlaceWorld) => PlaceWorld) | undefined, onApply: (changes: PlaceTileChange[]) => void, onCancel: () => void): Promise<void>
	{
		const version = ++this.openVersion;

		try
		{
			await places.loadPlaces();
		}
		catch (error)
		{
			if (version === this.openVersion)
			{
				this.show(onApply, onCancel);
				this.fields.hidden = true;
				this.intro.textContent = '';
				this.status.textContent = '';
				showMessage(this.error, describeEditorError(error, {
					id: 'editor.tileReplace.loadFailed',
					defaultMessage: 'Could not find out which regions and areas take the tile as their default tile.',
					description: 'Shown in the dialog replacing a default tile when the regions and areas couldn\'t be loaded'
				}));
			}

			return;
		}

		if (version !== this.openVersion)
		{
			return;
		}

		const world = (before ? before(places.world()) : places.world());
		const losing = new DefaultTileLoss(world, tile.id, loss);

		if (losing.places.length === 0)
		{
			onApply([]);
			return;
		}

		this.replacing = {
			universe,
			tile,
			loss,
			losing,
			tileIds: new Set(world.tileKinds.keys()),
			places,
			rows: []
		};
		this.fill(this.replacing);
		this.show(onApply, onCancel);
		this.changes.markSaved();
		this.refresh();
		this.all.focus();
	}

	/**
	 * Shows the dialog, to apply or cancel
	 *
	 * @param onApply Called with the changes once applied
	 * @param onCancel Called when it closes without applying
	 */
	private show(onApply: (changes: PlaceTileChange[]) => void, onCancel: () => void): void
	{
		this.onApply = onApply;
		this.onCancel = onCancel;
		this.applied = false;
		this.shownCount = '';
		showMessage(this.error, undefined);
		this.dialog.showModal();
	}

	/**
	 * Fills the dialog with the places losing the tile, and the choices each has
	 *
	 * @param replacing What the dialog is choosing for
	 */
	private fill(replacing: Replacing): void
	{
		const { universe, tile, loss, losing, tileIds, places } = replacing;
		const names = places.names();
		const name = tileName(tile, universe.ruleset);
		const tiles = places.tiles()
			.filter((each) => (each.enabled && (each.id !== tile.id) && tileIds.has(each.id)))
			.map((each) => ({
				value: String(each.id),
				label: tileName(each, universe.ruleset)
			}))
			.sort((a, b) => a.label.localeCompare(b.label));
		const chooseTile = {
			value: '',
			label: t({
				id: 'editor.tileReplace.choose',
				defaultMessage: 'Choose a tile',
				description: 'First choice in the lists of the dialog replacing a default tile, before one is chosen'
			})
		};

		this.intro.textContent = ((loss.kind === 'delete')
			? t({
				id: 'editor.tileReplace.deleteIntro',
				defaultMessage: '"{tile}" is the default tile of these regions and areas. Choose what each gets instead; nothing changes until the Tilesets tab is saved.',
				description: 'Opens the dialog replacing a default tile, when the tile is being deleted; {tile} is its name'
			}, {
				tile: name
			})
			: t({
				id: 'editor.tileReplace.uncheckIntro',
				defaultMessage: '"{tile}" is the default tile of {indoors, select, true {indoor} other {outdoor}} areas. Choose what these regions and areas get instead; nothing changes until the Tilesets tab is saved.',
				description: 'Opens the dialog replacing a default tile, when the tile is no longer for indoor (or outdoor) areas but is the default tile of some; {tile} is its name and {indoors} whether it is indoor areas'
			}, {
				tile: name,
				indoors: String(loss.indoors)
			}));
		this.status.textContent = '';
		setOptions(this.all, [chooseTile, ...tiles]);
		this.list.replaceChildren();
		replacing.rows = losing.places.map((each, index) =>
		{
			const item = document.createElement('li');
			const label = document.createElement('label');
			const select = document.createElement('select');
			const areas = document.createElement('p');
			const warning = document.createElement('p');
			const inherited = losing.inheritedTiles(each);

			select.id = `tile-replace-place-${index}`;
			label.htmlFor = select.id;
			label.textContent = t({
				id: 'editor.tileReplace.place',
				defaultMessage: '{kind, select, region {Region {name}} other {Area {name}}}',
				description: 'Names a region or area in the dialog replacing a default tile, over its list of what it gets instead; {name} is its name'
			}, {
				kind: each.place.kind,
				name: names(each.place)
			});
			setOptions(select, [
				...((inherited === undefined)
					? [chooseTile]
					: [{
						value: INHERIT_VALUE,
						label: this.inheritText(inherited, names)
					}]),
				...tiles
			]);
			select.value = ((inherited === undefined) ? '' : INHERIT_VALUE);
			areas.className = 'hint';
			areas.append(...this.areaLinks(each, names));
			warning.className = 'form-error';
			warning.hidden = true;
			warning.id = `${select.id}-warning`;
			select.setAttribute('aria-describedby', warning.id);
			item.className = 'tile-replace-place';
			item.append(label, select, areas, warning);
			this.list.append(item);

			return({
				losing: each,
				select,
				warning
			});
		});
		this.fields.hidden = false;
	}

	/**
	 * What Inherit shows: the tile the areas get and where it comes from, or each area's when they differ
	 *
	 * @param inherited What each area would get
	 * @param names Names the places
	 * @return The label
	 */
	private inheritText(inherited: readonly InheritedTile[], names: PlaceNames): string
	{
		const replacing = this.replacing;

		if (!replacing)
		{
			return('');
		}

		const { universe, places } = replacing;
		const first = inherited.at(0);

		// A place giving the tile to no area has nothing to show of what it would inherit
		if (first === undefined)
		{
			return(inheritLabel('defaultTileId', { kind: 'ignored' }, names, places.tiles(), universe.ruleset, false));
		}

		if (inherited.every((each) => ((each.tileId === first.tileId) && (each.from.map(placeKey).join() === first.from.map(placeKey).join()))))
		{
			return(inheritLabel('defaultTileId', { kind: 'inherited', value: first.tileId, from: first.from }, names, places.tiles(), universe.ruleset, false));
		}

		const tileNamed = (tileId: number): string =>
		{
			const tile = places.tiles().find((each) => (each.id === tileId));

			return(((tile === undefined) ? String(tileId) : tileName(tile, universe.ruleset)));
		};

		return(t({
			id: 'editor.tileReplace.inheritEach',
			defaultMessage: 'Inherit ({tiles})',
			description: 'The choice in the dialog replacing a default tile that takes what is above a region, when the areas it served would get different tiles; {tiles} lists each tile with its area, e.g. "Grass for Field and Sand for Beach"'
		}, {
			tiles: formatList(inherited.map((each) => t({
				id: 'editor.tileReplace.inheritValue',
				defaultMessage: '{tile} for {area}',
				description: 'One area and the default tile it would inherit, in the Inherit choice of the dialog replacing a default tile; {tile} is the tile and {area} the area'
			}, {
				tile: tileNamed(each.tileId),
				area: names({ kind: 'area', id: each.areaId })
			})), 'conjunction')
		}));
	}

	/**
	 * The areas a place gives the tile to, each linking to it in the editor, after a word saying what they are
	 *
	 * @param losing The place
	 * @param names Names the places
	 * @return The text and links
	 */
	private areaLinks(losing: LosingPlace, names: PlaceNames): (string | HTMLElement)[]
	{
		const universe = this.replacing?.universe;

		if (losing.belowKeeper)
		{
			return([t({
				id: 'editor.tileReplace.belowKeeper',
				defaultMessage: 'It inherits the tile from a region or area that keeps it for its other areas. Inherit leaves it to take what is above it once the tile no longer suits it.',
				description: 'Under an area in the dialog replacing a default tile, when the tile is no longer for its kind, but the place it inherits the tile from keeps it for areas of the other kind'
			})]);
		}

		if (losing.areaIds.length === 0)
		{
			return([t({
				id: 'editor.tileReplace.noAreas',
				defaultMessage: 'No area takes it from here.',
				description: 'Under a region or area in the dialog replacing a default tile that sets the tile but gives it to no area'
			})]);
		}

		const parts: (string | HTMLElement)[] = [t({
			id: 'editor.tileReplace.areas',
			defaultMessage: 'Its areas with the tile:',
			description: 'Under a region or area in the dialog replacing a default tile, before the areas that take the tile from it, each a link'
		})];

		losing.areaIds.forEach((areaId, index) =>
		{
			const place: PlaceRef = { kind: 'area', id: areaId };
			const name = names(place);

			parts.push(((index === 0) ? ' ' : ', '));

			if (universe && !isNewPlace(place))
			{
				const link = document.createElement('a');

				link.href = editorAreaUrl(universe.id, areaId, ((universe.version === 'draft') ? 'draft' : undefined));
				link.target = '_blank';
				link.textContent = name;
				parts.push(link);
			}
			else
			{
				parts.push(name);
			}
		});

		return(parts);
	}

	/**
	 * Each place's choice
	 *
	 * @return The choices, by placeKey(), leaving out places with nothing chosen
	 */
	private choices(): Map<string, TileReplacementChoice>
	{
		const choices = new Map<string, TileReplacementChoice>();

		for (const row of (this.replacing?.rows ?? []))
		{
			if (row.select.value === INHERIT_VALUE)
			{
				choices.set(placeKey(row.losing.place), { kind: 'inherit' });
			}
			else if (row.select.value !== '')
			{
				choices.set(placeKey(row.losing.place), { kind: 'tile', tileId: Number(row.select.value) });
			}
		}

		return(choices);
	}

	/**
	 * Shows what the choices leave: a warning by each tile not for the kind of an area it would become
	 * the default tile of, how many places have a choice that can go on, the places outside a builder's
	 * assignments, and the problems the choices leave
	 *
	 * @return Whether the choices can be applied
	 */
	private refresh(): boolean
	{
		const replacing = this.replacing;

		if (!replacing)
		{
			return(false);
		}

		const { losing, places, rows } = replacing;
		const names = places.names();
		const choices = this.choices();
		let chosen = 0;

		for (const row of rows)
		{
			const choice = choices.get(placeKey(row.losing.place));
			const unsuited = ((choice?.kind === 'tile') ? losing.unsuitedAreas(row.losing, choice.tileId) : []);

			showMessage(row.warning, ((unsuited.length === 0)
				? undefined
				: t({
					id: 'editor.tileReplace.unsuited',
					defaultMessage: 'This tile isn\'t for {areas}. Choose another.',
					description: 'Warning under a region or area in the dialog replacing a default tile, when the tile chosen for it isn\'t for the kind (indoors or outdoors) of areas it would become the default tile of; {areas} lists them'
				}, {
					areas: formatList(unsuited.map((areaId) => names({ kind: 'area', id: areaId })), 'conjunction')
				})));
			row.select.setAttribute('aria-invalid', String(unsuited.length > 0));

			if ((choice !== undefined) && (unsuited.length === 0))
			{
				chosen++;
			}
		}

		const count = t({
			id: 'editor.tileReplace.count',
			defaultMessage: '{chosen} / {total} chosen',
			description: 'In the dialog replacing a default tile: how many of the regions and areas listed have a choice that can go on, out of how many there are'
		}, {
			chosen,
			total: rows.length
		});

		this.count.textContent = count;

		if ((this.shownCount !== '') && (count !== this.shownCount))
		{
			announce(count);
		}

		this.shownCount = count;

		const outside = rows.filter((row) => !places.canEditPlace(row.losing.place));

		this.outsideList.replaceChildren(...outside.map((row) =>
		{
			const item = document.createElement('li');

			item.textContent = names(row.losing.place);

			return(item);
		}));
		this.outside.hidden = (outside.length === 0);

		const allChosen = (chosen === rows.length);
		const problems = (allChosen ? losing.problems(tileChanges(losing.places, choices)) : []);

		this.problemList.replaceChildren(...problems.map((problem) =>
		{
			const item = document.createElement('li');

			item.textContent = describeProblem(problem, names, places.tiles(), replacing.universe.ruleset);

			return(item);
		}));
		this.problems.hidden = (problems.length === 0);

		return(allChosen && (outside.length === 0) && (problems.length === 0));
	}

	/**
	 * Hands the changes on, once every place has a choice that can go on
	 */
	private apply(): void
	{
		const replacing = this.replacing;

		if (!replacing)
		{
			this.dialog.close();
			return;
		}

		if (!this.refresh())
		{
			const unchosen = replacing.rows.find((row) => ((row.select.value === '') || (row.select.getAttribute('aria-invalid') === 'true')));

			showMessage(this.error, ((unchosen !== undefined)
				? t({
					id: 'editor.tileReplace.chooseEach',
					defaultMessage: 'Choose a tile each region and area can take, or Inherit where it is offered.',
					description: 'Shown in the dialog replacing a default tile when Apply is pressed while a region or area has nothing chosen, or a tile that isn\'t for its areas'
				})
				: t({
					id: 'editor.tileReplace.cantApply',
					defaultMessage: 'These choices can\'t be applied; see what is listed above.',
					description: 'Shown in the dialog replacing a default tile when Apply is pressed while it lists places outside the builder\'s assignments, or problems the choices would leave'
				})));
			unchosen?.select.focus();
			return;
		}

		const changes = tileChanges(replacing.losing.places, this.choices());

		this.applied = true;
		this.changes.markSaved();
		this.dialog.close();
		this.onApply(changes);
	}
}
