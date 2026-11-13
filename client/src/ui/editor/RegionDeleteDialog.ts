import { PlaceGraph, placeKey, resolveAreaSettings, samePlace, type AreaNode, type EditorRegion, type PlaceNode, type PlaceRef, type PlaceWorld } from '@multiverse-kiln/shared';

import { formatList, t } from '../../localization';
import { getElement, setOptions, showMessage } from '../dom';
import type { PlacesHost } from './AreasTab';
import { describeProblem, problemPlaces } from './places';

/**
 * The Delete Region dialog (see Deleting a region in STRUCTURE-OVERVIEW.md): what happens to the regions
 * and areas whose only parent is the region, moved to another region or deleted with everything inside
 * them, and to those with other parents too, left with them or given another region. It checks that what
 * is left still has a value for each setting before it goes on, then stages it all with the region's
 * deletion until the Areas tab is saved
 */
export class RegionDeleteDialog
{
	private readonly dialog = getElement('region-delete-dialog', HTMLDialogElement);
	private readonly form = getElement('region-delete-form', HTMLFormElement);
	private readonly title = getElement('region-delete-title', HTMLElement);
	private readonly only = getElement('region-delete-only', HTMLElement);
	private readonly onlyIntro = getElement('region-delete-only-intro', HTMLElement);
	private readonly onlyList = getElement('region-delete-only-list', HTMLUListElement);
	private readonly move = getElement('region-delete-move', HTMLInputElement);
	private readonly moveTo = getElement('region-delete-move-to', HTMLSelectElement);
	private readonly shared = getElement('region-delete-shared', HTMLElement);
	private readonly sharedIntro = getElement('region-delete-shared-intro', HTMLElement);
	private readonly sharedList = getElement('region-delete-shared-list', HTMLUListElement);
	private readonly add = getElement('region-delete-add', HTMLInputElement);
	private readonly addTo = getElement('region-delete-add-to', HTMLSelectElement);
	private readonly problems = getElement('region-delete-problems', HTMLElement);

	/**
	 * The region being deleted
	 */
	private region: EditorRegion | undefined;

	/**
	 * @param host The Areas tab
	 * @param onDeleted Called once the region is staged for deletion
	 */
	constructor(private readonly host: PlacesHost, private readonly onDeleted: () => void)
	{
		getElement('region-delete-cancel', HTMLButtonElement).addEventListener('click', () =>
		{
			this.dialog.close();
		});

		this.form.addEventListener('submit', (event) =>
		{
			event.preventDefault();
			this.confirm();
		});

		for (const choice of [this.moveTo, this.addTo])
		{
			choice.addEventListener('change', () =>
			{
				showMessage(this.problems, undefined);
			});
		}
	}

	/**
	 * Opens the dialog for a region, listing what is in it
	 *
	 * @param region The region
	 */
	open(region: EditorRegion): void
	{
		const world = this.host.world();
		const graph = new PlaceGraph(world.regions, world.areas);
		const place: PlaceRef = { kind: 'region', id: region.id };
		const names = this.host.names();
		const { only, shared } = this.childrenOf(world, graph, place);
		const below = new Set([placeKey(place), ...graph.descendantsOf(place).map(placeKey)]);

		// The region's parents first, then the others it doesn't hold
		const regions = [
			...region.parents,
			...world.regions
				.map((each): PlaceRef => ({ kind: 'region', id: each.id }))
				.filter((each) => !below.has(placeKey(each)) && !region.parents.some((parent) => samePlace(parent, each)))
				.sort((first, second) => names(first).localeCompare(names(second)))
		].filter((each) => this.host.canEditPlace(each));
		const options = regions.map((each) => ({ value: each.id, label: names(each) }));
		const listOf = (places: readonly PlaceRef[]): HTMLLIElement[] => places.map((each) =>
		{
			const item = document.createElement('li');

			item.textContent = names(each);

			return(item);
		});

		this.region = region;
		this.form.reset();
		this.title.textContent = t({
			id: 'editor.regionDelete.title',
			defaultMessage: 'Delete {region}',
			description: 'Title of the dialog deleting a region; {region} is its name'
		}, {
			region: region.name
		});
		this.only.hidden = (only.length === 0);
		this.onlyIntro.textContent = t({
			id: 'editor.regionDelete.onlyIntro',
			defaultMessage: '{count, plural, one {This is inside nothing but {region}:} other {These are inside nothing but {region}:}}',
			description: 'Heads the list, in the Delete Region dialog, of the regions and areas whose only parent is the region being deleted; {region} is its name and {count} how many'
		}, {
			region: region.name,
			count: only.length
		});
		this.onlyList.replaceChildren(...listOf(only));
		setOptions(this.moveTo, [
			...options,
			{
				value: '',
				label: t({
					id: 'editor.regionDelete.topLevel',
					defaultMessage: 'nothing (top-level regions)',
					description: 'Choice of the region the Delete Region dialog moves things into, for making the regions in it top-level; an area must be inside a region, so it is refused for areas'
				})
			}
		]);
		this.shared.hidden = (shared.length === 0);
		this.sharedIntro.textContent = t({
			id: 'editor.regionDelete.sharedIntro',
			defaultMessage: '{count, plural, one {This is also inside other regions or areas:} other {These are also inside other regions or areas:}}',
			description: 'Heads the list, in the Delete Region dialog, of the regions and areas inside the region being deleted that have other parents too; {count} is how many'
		}, {
			count: shared.length
		});
		this.sharedList.replaceChildren(...listOf(shared));
		setOptions(this.addTo, options);
		this.add.disabled = (options.length === 0);
		showMessage(this.problems, undefined);
		this.dialog.showModal();
	}

	/**
	 * What a region holds directly: those whose only parent it is, and those with other parents too
	 *
	 * @param world The regions and areas
	 * @param graph The same, indexed
	 * @param place The region
	 * @return The two lists
	 */
	private childrenOf(world: PlaceWorld, graph: PlaceGraph, place: PlaceRef): { only: PlaceRef[]; shared: PlaceRef[] }
	{
		const children = graph.childrenOf(place);

		return({
			only: children.filter((child) => (graph.parentsOf(child).length === 1)),
			shared: children.filter((child) => (graph.parentsOf(child).length > 1))
		});
	}

	/**
	 * Works out what the choices do, checks that it leaves nothing without a value for a setting, then
	 * stages it, asking twice before deleting what the region holds
	 */
	private confirm(): void
	{
		const region = this.region;
		const universe = this.host.universe();

		if (!region || !universe)
		{
			return;
		}

		const world = this.host.world();
		const graph = new PlaceGraph(world.regions, world.areas);
		const place: PlaceRef = { kind: 'region', id: region.id };
		const { only, shared } = this.childrenOf(world, graph, place);
		const moves = new Map<string, { place: PlaceRef; parents: PlaceRef[] }>();
		const deleted = new Set<string>([placeKey(place)]);
		const target = (id: string): PlaceRef[] => ((id === '') ? [] : [{ kind: 'region', id }]);

		if (this.move.checked)
		{
			for (const child of only)
			{
				moves.set(placeKey(child), { place: child, parents: target(this.moveTo.value) });
			}
		}
		else
		{
			// What is inside nothing but what goes goes too
			let grew = true;

			for (const child of only)
			{
				deleted.add(placeKey(child));
			}

			while (grew)
			{
				grew = false;

				for (const each of graph.descendantsOf(place))
				{
					if (!deleted.has(placeKey(each)) && graph.parentsOf(each).every((parent) => deleted.has(placeKey(parent))))
					{
						deleted.add(placeKey(each));
						grew = true;
					}
				}
			}
		}

		if (this.add.checked)
		{
			for (const child of shared)
			{
				const parents = graph.parentsOf(child).filter((parent) => !samePlace(parent, place));

				if (!parents.some((parent) => (parent.id === this.addTo.value)))
				{
					parents.push(...target(this.addTo.value));
				}

				moves.set(placeKey(child), { place: child, parents });
			}
		}

		const after = this.simulate(world, moves, deleted);
		const touched = new Set([...only, ...shared, ...graph.descendantsOf(place)].map(placeKey));
		const problems = resolveAreaSettings(after).problems.filter((problem) => problemPlaces(problem).some((each) => touched.has(placeKey(each))));

		if (problems.length > 0)
		{
			showMessage(this.problems, t({
				id: 'editor.regionDelete.problems',
				defaultMessage: 'Deleting it this way would leave problems: {problems}',
				description: 'Shown in the Delete Region dialog when the choices would leave areas without a setting or with different values from above, which keeps it from going on; {problems} lists them'
			}, {
				problems: formatList(problems.map((problem) => describeProblem(problem, this.host.names(), this.host.tiles(), universe.ruleset)), 'conjunction')
			}));
			return;
		}

		const deletes = [...deleted].filter((key) => (key !== placeKey(place)));

		if (deletes.length > 0)
		{
			const names = this.host.names();
			const listed = graph.places().filter((each) => deletes.includes(placeKey(each)));
			const first = t({
				id: 'editor.regionDelete.confirmDeleteAll',
				defaultMessage: 'Delete {region} and {places}, with everything inside them, when the Areas tab is saved?',
				description: 'First of two questions before the Delete Region dialog deletes what the region holds; {region} is the region and {places} lists what goes with it'
			}, {
				region: region.name,
				places: formatList(listed.map(names), 'conjunction')
			});
			const second = t({
				id: 'editor.regionDelete.confirmDeleteAllAgain',
				defaultMessage: 'Are you sure? Their cells, links and translations will be deleted for good once the Areas tab is saved.',
				description: 'Second of two questions before the Delete Region dialog deletes what the region holds'
			});

			if (!window.confirm(first) || !window.confirm(second))
			{
				return;
			}

			for (const each of listed)
			{
				this.host.staged.deletePlace(each);
			}
		}

		for (const { place: moved, parents } of moves.values())
		{
			if (!deleted.has(placeKey(moved)))
			{
				this.host.staged.move(moved, parents);
			}
		}

		this.host.staged.deletePlace(place);
		this.dialog.close();
		this.onDeleted();
	}

	/**
	 * The regions and areas as the deletion leaves them
	 *
	 * @param world The regions and areas now
	 * @param moves The places given other parents, by placeKey()
	 * @param deleted The places deleted, by placeKey()
	 * @return The world after
	 */
	private simulate(world: PlaceWorld, moves: ReadonlyMap<string, { parents: PlaceRef[] }>, deleted: ReadonlySet<string>): PlaceWorld
	{
		const keep = (kind: PlaceRef['kind']) => <Node extends PlaceNode | AreaNode>(node: Node): boolean => !deleted.has(placeKey({ kind, id: node.id }));
		const moved = (kind: PlaceRef['kind']) => <Node extends PlaceNode | AreaNode>(node: Node): Node =>
		{
			const parents = (moves.get(placeKey({ kind, id: node.id }))?.parents ?? node.parents);

			return({ ...node, parents: parents.filter((parent) => !deleted.has(placeKey(parent))) });
		};

		return({
			...world,
			regions: world.regions.filter(keep('region')).map(moved('region')),
			areas: world.areas.filter(keep('area')).map(moved('area'))
		});
	}
}
