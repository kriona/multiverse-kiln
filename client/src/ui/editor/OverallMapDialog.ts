import loopArrowIcon from 'virtual:icon/ph:arrow-right';
import { areasWithMisalignedLoops, DEFAULT_TILE_CELL, NEIGHBOR_SIDES, overallMapLayout, seamSides, VOID_CELL, type EditorArea, type EditorTile, type MapPlacement, type NeighborGrid, type NeighborSide } from '@multiverse-kiln/shared';

import type { AreaCells } from '../../editor/AreaCells';
import { formatList, t } from '../../localization';
import { describeEditorError } from '../../network/editorApi';
import { getElement, showMessage } from '../dom';
import { areaEditorMessages } from './areaEditorMessages';

/**
 * How large the map is drawn at most, in pixels, before it scrolls
 */
const MAP_WIDTH = 900;
const MAP_HEIGHT = 600;

/**
 * The fewest and most pixels a cell takes on the map
 */
const MIN_CELL_PIXELS = 0.25;
const MAX_CELL_PIXELS = 4;

/**
 * The room left around the areas on the map, in pixels, when an edge loops, for the arrows drawn
 * outside the edges that loop
 */
const LOOP_MARGIN = 24;

/**
 * The color of Unexplored cells on the map: the paper of the game's unexplored cells
 */
const UNEXPLORED_COLOR = '#d8cfb8';

/**
 * What the map needs of each area it draws
 */
export interface OverallMapSource
{
	/**
	 * An area as the Areas tab has it, with this window's changes not yet saved
	 */
	area: (areaId: string) => EditorArea | undefined;

	/**
	 * An area's cells with every chunk loaded, with this window's painting not yet saved for the area open
	 */
	cells: (area: EditorArea) => Promise<AreaCells>;

	/**
	 * The tiles the universe can use, to draw the cells in their colors
	 */
	tiles: () => readonly EditorTile[];

	/**
	 * Opens an area's editor
	 */
	open: (areaId: string) => void;
}

/**
 * See Overall Map (see Editor: Area in STRUCTURE-OVERVIEW.md): the whole grid of neighboring areas an area
 * is in, each area drawn at scale in its place with its name, the area open marked. A ring's areas are
 * drawn once each, laid out from the area open, and the joins drawn apart are marked and listed. Clicking
 * an area, or Enter on it, opens its editor; the arrow keys move between areas, and screen readers hear
 * each area's name and where it is from the area open
 */
export class OverallMapDialog
{
	private readonly dialog = getElement('overall-map-dialog', HTMLDialogElement);
	private readonly map = getElement('overall-map', HTMLElement);
	private readonly seams = getElement('overall-map-seams', HTMLElement);
	private readonly loops = getElement('overall-map-loops', HTMLElement);
	private readonly misaligned = getElement('overall-map-misaligned', HTMLElement);

	/**
	 * Changes every time the dialog opens or closes, so cells that load for an earlier opening are ignored
	 */
	private version = 0;

	/**
	 * Sets up the dialog's Close button
	 */
	constructor()
	{
		getElement('overall-map-close', HTMLButtonElement).addEventListener('click', () =>
		{
			this.dialog.close();
		});

		this.dialog.addEventListener('close', () =>
		{
			this.version++;
			this.map.replaceChildren();
		});
	}

	/**
	 * Opens the map of the grid an area is in
	 *
	 * @param grid The areas, with this window's changes not yet saved
	 * @param areaId The area open
	 * @param source What the map draws the areas from
	 */
	open(grid: NeighborGrid, areaId: string, source: OverallMapSource): void
	{
		const version = ++this.version;
		const layout = overallMapLayout(grid, areaId);
		const scale = Math.min(MAX_CELL_PIXELS, Math.max(MIN_CELL_PIXELS, Math.min(MAP_WIDTH / Math.max(layout.width, 1), MAP_HEIGHT / Math.max(layout.height, 1))));
		const nameOf = (id: string): string => (source.area(id)?.name ?? id);
		const buttons = new Map<string, HTMLButtonElement>();

		// The ends of a row or column that loops, where walking off comes back on at its other end
		const loops: { placement: MapPlacement; side: NeighborSide; targetId: string }[] = [];

		for (const placement of layout.placements)
		{
			const own = grid.get(placement.areaId);
			const sides = seamSides(grid, placement.areaId);

			for (const side of NEIGHBOR_SIDES)
			{
				const targetId = sides[side];

				if (own && (own.neighbors[side] === null) && (targetId !== null))
				{
					loops.push({ placement, side, targetId });
				}
			}
		}

		// The areas are drawn on a plane inside the map, leaving room around it for the loops' arrows
		const margin = ((loops.length === 0) ? 0 : LOOP_MARGIN);
		const plane = document.createElement('div');
		const planeWidth = Math.ceil(layout.width * scale);
		const planeHeight = Math.ceil(layout.height * scale);

		plane.className = 'overall-map-plane';
		plane.style.width = `${planeWidth}px`;
		plane.style.height = `${planeHeight}px`;
		plane.style.margin = `${margin}px`;
		this.map.replaceChildren(plane);
		this.map.style.width = `${planeWidth + (margin * 2) + 2}px`;
		this.map.style.height = `${planeHeight + (margin * 2) + 2}px`;

		for (const placement of layout.placements)
		{
			const button = this.areaButton(placement, scale, (placement.areaId === areaId), nameOf);

			button.addEventListener('click', () =>
			{
				this.dialog.close();
				source.open(placement.areaId);
			});

			button.addEventListener('keydown', (event) =>
			{
				const next = this.areaToward(layout.placements, placement, event.key);

				if (next)
				{
					event.preventDefault();
					buttons.get(next.areaId)?.focus();
				}
			});

			buttons.set(placement.areaId, button);
			plane.append(button);

			const area = source.area(placement.areaId);

			if (area)
			{
				void this.drawArea(version, button, area, source);
			}
		}

		for (const seam of layout.seams)
		{
			const placement = layout.placements.find((each) => (each.areaId === seam.areaId));

			if (placement)
			{
				plane.append(seamMarker(placement, seam.side, scale));
			}
		}

		for (const loop of loops)
		{
			plane.append(loopMarker(loop.placement, loop.side, scale));
		}

		// Screen readers hear where each area's edges loop to on its own button
		for (const [placementAreaId, button] of buttons)
		{
			const own = loops.filter((loop) => (loop.placement.areaId === placementAreaId));

			if (own.length > 0)
			{
				button.setAttribute('aria-label', t({
					id: 'editor.overallMap.areaLoops',
					defaultMessage: '{place}. Loops {loops}',
					description: 'What screen readers hear for an area on the Overall Map with edges that loop (a row or column of neighboring areas whose ends join, marked with arrows): {place} is the area\'s name and where it is, and {loops} lists its edges that loop and where each comes back on, e.g. "west to Northeast March"'
				}, {
					place: button.getAttribute('aria-label') ?? '',
					loops: formatList(own.map((loop) => t({
						id: 'editor.overallMap.loop',
						defaultMessage: '{side, select, north {north} east {east} south {south} other {west}} to {target}',
						description: 'One edge of an area on the Overall Map that loops, in the list screen readers hear for the area: {side} is the edge, and {target} the area at the other end of its row or column, where walking off the edge comes back on, which may be the same area'
					}, {
						side: loop.side,
						target: nameOf(loop.targetId)
					})), 'conjunction')
				}));
			}
		}

		// The areas in rows or columns that loop unlike those beside them, marked with a warning sign
		const misaligned = areasWithMisalignedLoops(grid);

		for (const misalignedId of misaligned)
		{
			const button = buttons.get(misalignedId);

			if (button)
			{
				const sign = document.createElement('span');

				sign.className = 'overall-map-warning';
				sign.setAttribute('aria-hidden', 'true');
				sign.textContent = '⚠️';
				button.append(sign);
				button.setAttribute('aria-label', t({
					id: 'editor.overallMap.areaMisaligned',
					defaultMessage: '{place}. Warning: doesn\'t loop like the areas beside it',
					description: 'What screen readers hear for an area on the Overall Map whose row or column of neighboring areas loops differently from the one beside it, marked on the map with a warning sign: {place} is everything else said about the area, its name and where it is'
				}, {
					place: button.getAttribute('aria-label') ?? ''
				}));
			}
		}

		showMessage(this.loops, ((loops.length === 0)
			? undefined
			: t({
				id: 'editor.overallMap.loops',
				defaultMessage: 'The arrows mark edges that loop. Walking off one brings you back at the other end of its row or column.',
				description: 'Under the Overall Map, when rows or columns of neighboring areas loop, explaining the arrows drawn outside the edges that loop'
			})));
		showMessage(this.misaligned, ((misaligned.length === 0)
			? undefined
			: `⚠️ ${t({
				id: 'editor.overallMap.misaligned',
				defaultMessage: 'The areas marked with a warning sign are in rows or columns side by side where some loop and others don\'t. Walking where they meet reaches different areas depending on the route taken. Make all rows or columns side by side loop.',
				description: 'Warning under the Overall Map when rows or columns of neighboring areas side by side loop differently: one loops and the other doesn\'t, or their ends aren\'t lined up. The areas in them are marked on the map with a warning sign, ⚠️, which also starts this text'
			})}`));

		showMessage(this.seams, ((layout.seams.length === 0)
			? undefined
			: t({
				id: 'editor.overallMap.seams',
				defaultMessage: 'The dashed lines mark where areas drawn apart are neighbors: {joins}.',
				description: 'Under the Overall Map, when areas of the grid are neighbors but drawn apart, such as where a ring of areas joins back: {joins} lists each, e.g. "the east side of Plains joins Town"'
			}, {
				joins: formatList(layout.seams.map((seam) => t({
					id: 'editor.overallMap.seam',
					defaultMessage: 'the {side, select, north {north} east {east} south {south} other {west}} side of {area} joins {neighbor}',
					description: 'One join between neighboring areas drawn apart on the Overall Map, in its list of them: {side} is the side of {area} that {neighbor} is on'
				}, {
					side: seam.side,
					area: nameOf(seam.areaId),
					neighbor: nameOf(seam.neighborAreaId)
				})), 'conjunction')
			})));

		this.dialog.showModal();
		buttons.get(areaId)?.focus();
	}

	/**
	 * An area's button on the map, at its place and size, naming it and where it is from the area open
	 *
	 * @param placement Where it is
	 * @param scale Pixels a cell takes
	 * @param isOpen Whether it is the area open
	 * @param nameOf Names an area
	 * @return The button
	 */
	private areaButton(placement: MapPlacement, scale: number, isOpen: boolean, nameOf: (areaId: string) => string): HTMLButtonElement
	{
		const button = document.createElement('button');
		const label = document.createElement('span');
		const name = nameOf(placement.areaId);

		button.type = 'button';
		button.className = 'overall-map-area';
		button.classList.toggle('open', isOpen);
		button.style.left = `${placement.x * scale}px`;
		button.style.top = `${placement.y * scale}px`;
		button.style.width = `${placement.width * scale}px`;
		button.style.height = `${placement.height * scale}px`;
		label.textContent = (isOpen
			? t({
				id: 'editor.overallMap.openArea',
				defaultMessage: '{area} (open)',
				description: 'The name of the area being edited on the Overall Map, which marks it'
			}, {
				area: name
			})
			: name);
		button.setAttribute('aria-label', describePlace(placement, name, isOpen));
		button.append(label);

		return(button);
	}

	/**
	 * The area next to another on the map in an arrow key's direction: the nearest in that direction
	 *
	 * @param placements Every area on the map
	 * @param from The area
	 * @param key The key pressed
	 * @return The area, or undefined for a key that isn't an arrow or nothing that way
	 */
	private areaToward(placements: readonly MapPlacement[], from: MapPlacement, key: string): MapPlacement | undefined
	{
		const steps: Record<string, { columns: number; rows: number }> = {
			ArrowUp: { columns: 0, rows: -1 },
			ArrowDown: { columns: 0, rows: 1 },
			ArrowLeft: { columns: -1, rows: 0 },
			ArrowRight: { columns: 1, rows: 0 }
		};
		const step = steps[key];

		if (!step)
		{
			return(undefined);
		}

		return(placements
			.filter((each) => (((step.columns === 0) || (Math.sign(each.gridColumn - from.gridColumn) === step.columns)) && ((step.rows === 0) || (Math.sign(each.gridRow - from.gridRow) === step.rows)) && (each !== from)))
			.sort((first, second) => (gridDistance(first, from) - gridDistance(second, from)))[0]);
	}

	/**
	 * Draws an area's cells in their tiles' colors on its button, once they have loaded
	 *
	 * @param version The dialog's version when it opened
	 * @param button The area's button
	 * @param area The area
	 * @param source What the map draws the areas from
	 */
	private async drawArea(version: number, button: HTMLButtonElement, area: EditorArea, source: OverallMapSource): Promise<void>
	{
		let cells: AreaCells;

		try
		{
			cells = await source.cells(area);
		}
		catch (error)
		{
			if (version === this.version)
			{
				showMessage(this.seams, describeEditorError(error, areaEditorMessages.loadFailed));
			}

			return;
		}

		if (version !== this.version)
		{
			return;
		}

		const { bounds } = area;
		const width = (bounds.maxColumn - bounds.minColumn) + 1;
		const height = (bounds.maxRow - bounds.minRow) + 1;
		const canvas = document.createElement('canvas');
		const context = canvas.getContext('2d');
		const colors = new Map(source.tiles().map((tile) => [tile.id, `#${tile.color.toString(16).padStart(6, '0')}`]));

		canvas.width = width;
		canvas.height = height;

		if (!context)
		{
			return;
		}

		for (let row = bounds.minRow; row <= bounds.maxRow; row++)
		{
			for (let column = bounds.minColumn; column <= bounds.maxColumn; column++)
			{
				const value = (cells.valueAt(column, row) ?? DEFAULT_TILE_CELL);
				const tileId = ((value === DEFAULT_TILE_CELL) ? area.resolved.defaultTileId : value);

				context.fillStyle = ((value === VOID_CELL) ? UNEXPLORED_COLOR : (colors.get(tileId) ?? UNEXPLORED_COLOR));
				context.fillRect(column - bounds.minColumn, row - bounds.minRow, 1, 1);
			}
		}

		canvas.setAttribute('aria-hidden', 'true');
		button.prepend(canvas);
	}
}

/**
 * How far apart two areas are in the grid
 *
 * @param first One area
 * @param second The other
 * @return The number of areas between them, across and down
 */
function gridDistance(first: MapPlacement, second: MapPlacement): number
{
	return(Math.abs(first.gridColumn - second.gridColumn) + Math.abs(first.gridRow - second.gridRow));
}

/**
 * What screen readers hear for an area on the map: its name and where it is from the area open
 *
 * @param placement Where it is
 * @param name Its name
 * @param isOpen Whether it is the area open
 * @return The label
 */
function describePlace(placement: MapPlacement, name: string, isOpen: boolean): string
{
	if (isOpen)
	{
		return(t({
			id: 'editor.overallMap.openPlace',
			defaultMessage: '{area}, the open area',
			description: 'What screen readers hear for the area being edited on the Overall Map; {area} is its name'
		}, {
			area: name
		}));
	}

	const parts: string[] = [];
	const part = (count: number, direction: NeighborSide): void =>
	{
		parts.push(t({
			id: 'editor.overallMap.direction',
			defaultMessage: '{count, plural, one {# area {direction, select, north {north} east {east} south {south} other {west}}} other {# areas {direction, select, north {north} east {east} south {south} other {west}}}}',
			description: 'Part of where an area is on the Overall Map from the area being edited, for screen readers, e.g. "2 areas east"; {count} is how many areas away and {direction} which way'
		}, {
			count,
			direction
		}));
	};

	if (placement.gridColumn !== 0)
	{
		part(Math.abs(placement.gridColumn), ((placement.gridColumn > 0) ? 'east' : 'west'));
	}

	if (placement.gridRow !== 0)
	{
		part(Math.abs(placement.gridRow), ((placement.gridRow > 0) ? 'south' : 'north'));
	}

	return(t({
		id: 'editor.overallMap.place',
		defaultMessage: '{area}, {place} of the open area',
		description: 'What screen readers hear for an area on the Overall Map: {area} is its name, and {place} where it is from the area being edited, e.g. "Forest, 1 area east and 2 areas south of the area open"'
	}, {
		area: name,
		place: formatList(parts, 'conjunction')
	}));
}

/**
 * A small arrow just outside the side of an area on the map that loops, pointing off it
 *
 * @param placement Where the area is
 * @param side The side
 * @param scale Pixels a cell takes
 * @return The arrow
 */
function loopMarker(placement: MapPlacement, side: NeighborSide, scale: number): HTMLElement
{
	const marker = document.createElement('div');
	const template = document.createElement('template');
	const left = placement.x * scale;
	const top = placement.y * scale;
	const width = placement.width * scale;
	const height = placement.height * scale;
	const outset = LOOP_MARGIN / 2;

	template.innerHTML = loopArrowIcon;
	marker.className = `overall-map-loop overall-map-loop-${side}`;
	marker.setAttribute('aria-hidden', 'true');
	marker.style.left = `${((side === 'east') ? (left + width + outset) : ((side === 'west') ? (left - outset) : (left + (width / 2))))}px`;
	marker.style.top = `${((side === 'south') ? (top + height + outset) : ((side === 'north') ? (top - outset) : (top + (height / 2))))}px`;
	marker.append(template.content);

	return(marker);
}

/**
 * A dashed line along the side of an area on the map where it is a neighbor of an area drawn apart from it
 *
 * @param placement Where the area is
 * @param side The side
 * @param scale Pixels a cell takes
 * @return The line
 */
function seamMarker(placement: MapPlacement, side: NeighborSide, scale: number): HTMLElement
{
	const marker = document.createElement('div');
	const left = placement.x * scale;
	const top = placement.y * scale;
	const width = placement.width * scale;
	const height = placement.height * scale;

	marker.className = 'overall-map-seam';
	marker.setAttribute('aria-hidden', 'true');
	marker.style.left = `${((side === 'east') ? ((left + width) - 2) : left)}px`;
	marker.style.top = `${((side === 'south') ? ((top + height) - 2) : top)}px`;
	marker.style.width = `${(((side === 'east') || (side === 'west')) ? 0 : width)}px`;
	marker.style.height = `${(((side === 'north') || (side === 'south')) ? 0 : height)}px`;

	return(marker);
}
