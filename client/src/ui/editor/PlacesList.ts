import { compareNumbers, placeKey, sortRows, type PlaceRef, type SortOrder } from '@multiverse-kiln/shared';

import { formatList, t } from '../../localization';
import { getElement } from '../dom';
import { TableSorter } from '../tableSorter';
import { deletedNote } from './stagedChanges';

/**
 * A region or area as the list shows it
 */
export interface ListedPlace
{
	place: PlaceRef;
	name: string;

	/**
	 * Its parents, in the order they were added
	 */
	parents: readonly PlaceRef[];

	/**
	 * What the list says of it, such as lobby or disabled
	 */
	tags: string[];

	/**
	 * Whether it will be deleted when the tab is saved
	 */
	deleted: boolean;
}

/**
 * The columns the table sorts by
 */
const COLUMNS = ['name', 'kind'] as const;

type Column = typeof COLUMNS[number];

/**
 * How a region's or area's kind reads
 *
 * @param place The region or area
 * @return Region or Area
 */
export function kindName(place: PlaceRef): string
{
	return(((place.kind === 'region')
		? t({
			id: 'editor.places.region',
			defaultMessage: 'Region',
			description: 'Says a row of the Areas tab\'s table is a region, which groups areas, in its column for whether each is a region or an area'
		})
		: t({
			id: 'editor.places.area',
			defaultMessage: 'Area',
			description: 'Says a row of the Areas tab\'s table is an area, in its column for whether each is a region or an area'
		})));
}

/**
 * The Areas tab's regions and areas, as a tree or a table (see Tab: Areas in STRUCTURE-OVERVIEW.md), with
 * a search narrowing both. In the tree each region or area is listed under each of its parents, with
 * everything inside it, the listings after the first starting collapsed
 */
export class PlacesList
{
	private readonly tree = getElement('area-list', HTMLUListElement);
	private readonly table = getElement('place-table', HTMLTableElement);
	private readonly rows = getElement('place-table-rows', HTMLTableSectionElement);
	private readonly search = getElement('place-search', HTMLInputElement);
	private readonly treeChoice = getElement('place-view-tree', HTMLInputElement);
	private readonly sorter: TableSorter<Column>;
	private places: readonly ListedPlace[] = [];

	/**
	 * Whether each listing in the tree is open, by its path from the top: the keys of the places down to
	 * it. Listings not in it are open for a place's first parent and collapsed for the others
	 */
	private readonly expanded = new Map<string, boolean>();

	/**
	 * @param onOpen Called when a region or area is chosen, to open its editor
	 * @param onShown Called after the list shows, with how many places it shows
	 */
	constructor(private readonly onOpen: (place: PlaceRef) => void, private readonly onShown: (count: number) => void)
	{
		this.sorter = new TableSorter(this.table, COLUMNS, { column: 'name', direction: 'ascending' }, () =>
		{
			this.render();
		});

		this.search.addEventListener('input', () =>
		{
			this.render();
		});

		for (const choice of [this.treeChoice, getElement('place-view-table', HTMLInputElement)])
		{
			choice.addEventListener('change', () =>
			{
				this.render();
			});
		}
	}

	/**
	 * Shows regions and areas
	 *
	 * @param places Every region and area, by name
	 */
	show(places: readonly ListedPlace[]): void
	{
		this.places = places;
		this.render();
	}

	/**
	 * Clears the list, for a role that can't load the areas
	 */
	clear(): void
	{
		this.places = [];
		this.tree.replaceChildren();
		this.rows.replaceChildren();
	}

	/**
	 * Shows the places as the tree or the table, narrowed by the search
	 */
	private render(): void
	{
		const asTree = this.treeChoice.checked;
		const query = this.search.value.trim().toLocaleLowerCase();
		const matches = this.places.filter((each) => ((query === '') || each.name.toLocaleLowerCase().includes(query)));

		this.tree.hidden = !asTree;
		this.table.hidden = asTree;

		if (asTree)
		{
			this.renderTree(matches, (query !== ''));
		}
		else
		{
			this.renderTable(matches);
		}

		this.onShown(matches.length);
	}

	/**
	 * Shows the tree: the top-level regions (and anything inside nothing), each with what is inside it.
	 * While searching it shows each match with what is above it, open
	 *
	 * @param matches The places matching the search
	 * @param searching Whether there is a search
	 */
	private renderTree(matches: readonly ListedPlace[], searching: boolean): void
	{
		const byKey = new Map(this.places.map((each) => [placeKey(each.place), each]));
		const children = new Map<string, ListedPlace[]>();

		for (const each of this.places)
		{
			for (const parent of each.parents)
			{
				const key = placeKey(parent);

				if (byKey.has(key))
				{
					children.set(key, [...(children.get(key) ?? []), each]);
				}
			}
		}

		// While searching, only the matches and what is above them show
		const shown = new Set<string>();

		if (searching)
		{
			const waiting = matches.map((each) => placeKey(each.place));

			while (waiting.length > 0)
			{
				const key = waiting.pop() as string;

				if (!shown.has(key))
				{
					shown.add(key);
					waiting.push(...(byKey.get(key)?.parents.map(placeKey) ?? []));
				}
			}
		}

		const visible = (each: ListedPlace): boolean => (!searching || shown.has(placeKey(each.place)));
		const tops = this.places.filter((each) => (visible(each) && !each.parents.some((parent) => byKey.has(placeKey(parent)))));
		const sorted = (list: readonly ListedPlace[]): ListedPlace[] => [...list].sort((first, second) => ((first.place.kind === second.place.kind) ? first.name.localeCompare(second.name) : ((first.place.kind === 'region') ? -1 : 1)));

		/**
		 * One place's item in the tree, with what is inside it
		 *
		 * @param each The place
		 * @param path The keys of the places above it, top first
		 * @param primary Whether it is listed under its first parent, or at the top
		 * @return The item
		 */
		const itemOf = (each: ListedPlace, path: readonly string[], primary: boolean): HTMLLIElement =>
		{
			const key = placeKey(each.place);
			const pathKey = [...path, key].join('/');
			const inside = sorted((children.get(key) ?? []).filter((child) => (visible(child) && !path.includes(placeKey(child.place)) && (placeKey(child.place) !== key))));
			const item = document.createElement('li');
			const row = document.createElement('div');
			const open = (searching || (this.expanded.get(pathKey) ?? primary));

			item.setAttribute('role', 'treeitem');
			row.className = 'place-row';

			if (inside.length > 0)
			{
				const toggle = document.createElement('button');

				toggle.type = 'button';
				toggle.className = 'secondary place-toggle';
				toggle.setAttribute('aria-expanded', String(open));
				toggle.textContent = (open ? '-' : '+');
				toggle.setAttribute('aria-label', (open
					? t({
						id: 'editor.places.collapse',
						defaultMessage: 'Collapse {name}',
						description: 'Name of the button that hides what is inside a region or area in the Areas tab\'s tree, for screen readers; {name} is its name'
					}, {
						name: each.name
					})
					: t({
						id: 'editor.places.expand',
						defaultMessage: 'Expand {name}',
						description: 'Name of the button that shows what is inside a region or area in the Areas tab\'s tree, for screen readers; {name} is its name'
					}, {
						name: each.name
					})));
				toggle.addEventListener('click', () =>
				{
					this.expanded.set(pathKey, !open);
					this.render();
				});
				row.append(toggle);
			}
			else
			{
				// Keeps its name in line with the names of the places beside it that have a toggle
				const space = document.createElement('span');

				space.className = 'place-toggle-space';
				row.append(space);
			}

			row.append(this.openButton(each));
			item.append(row);

			if ((inside.length > 0) && open)
			{
				const list = document.createElement('ul');

				list.setAttribute('role', 'group');

				if (each.place.kind === 'region')
				{
					list.className = 'place-region-contents';
				}

				list.append(...inside.map((child) => itemOf(child, [...path, key], (placeKey(child.parents[0] ?? each.place) === key))));
				item.append(list);
			}

			return(item);
		};

		this.tree.setAttribute('role', 'tree');
		this.tree.replaceChildren(...sorted(tops).map((each) => itemOf(each, [], true)));
	}

	/**
	 * Shows the table: a row for each match, sorted as its headings say
	 *
	 * @param matches The places matching the search
	 */
	private renderTable(matches: readonly ListedPlace[]): void
	{
		const names = new Map(this.places.map((each) => [placeKey(each.place), each.name]));
		const order: SortOrder<Column> = this.sorter.order;
		const sorted = sortRows(matches, {
			name: (first, second) => first.name.localeCompare(second.name),
			kind: (first, second) => compareNumbers(((first.place.kind === 'region') ? 0 : 1), ((second.place.kind === 'region') ? 0 : 1))
		}, order);

		this.rows.replaceChildren(...sorted.map((each) =>
		{
			const row = document.createElement('tr');
			const name = document.createElement('td');
			const kind = document.createElement('td');
			const parents = document.createElement('td');
			const tags = document.createElement('td');

			name.append(this.openButton(each, false));
			kind.textContent = kindName(each.place);
			parents.textContent = formatList(each.parents.map((parent) => (names.get(placeKey(parent)) ?? '')), 'conjunction');
			tags.textContent = formatList(each.tags);

			if (each.deleted)
			{
				row.classList.add('staged-deleted');
			}

			row.append(name, kind, parents, tags);

			return(row);
		}));
	}

	/**
	 * The button opening a place's editor, with its name and tags
	 *
	 * @param each The place
	 * @param withTags Whether to show its tags under its name
	 * @return The button
	 */
	private openButton(each: ListedPlace, withTags: boolean = true): HTMLButtonElement
	{
		const button = document.createElement('button');
		const name = document.createElement('strong');

		button.type = 'button';
		button.className = `universe-item place-${each.place.kind}`;
		name.textContent = each.name;
		button.append(name);

		if (withTags)
		{
			const details = document.createElement('span');

			details.className = 'universe-ruleset';
			details.textContent = formatList([kindName(each.place), ...each.tags]);
			button.append(details);
		}

		if (each.deleted)
		{
			button.classList.add('staged-deleted');
			name.append(deletedNote());
		}

		button.addEventListener('click', () =>
		{
			this.onOpen(each.place);
		});

		return(button);
	}
}
