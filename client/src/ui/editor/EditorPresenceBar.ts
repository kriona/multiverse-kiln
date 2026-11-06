import type { EditorPresence, EditorWindow } from '@multiverse-kiln/shared';

import { currentLocale, t } from '../../localization';
import { getElement } from '../dom';

/**
 * The name of one of the editor's tabs as its tab shows it, in the player's language
 *
 * @param tab The tab
 * @return Its name, without the mark of unsaved changes
 */
function tabName(tab: string): string
{
	const button = document.getElementById(`editor-tab-${tab}`);

	return([...(button?.childNodes ?? [])]
		.filter((node) => (node.nodeType === Node.TEXT_NODE))
		.map((node) => (node.textContent ?? ''))
		.join('')
		.trim());
}

/**
 * The left of the editor's save bar: the other players who have the universe's editor open, each with
 * where their windows are (the tab, the area when this window knows its name, and whether it is the
 * draft). The chat panel lists everyone's names
 */
export class EditorPresenceBar
{
	private readonly presence = getElement('editor-presence', HTMLElement);
	private readonly list = getElement('editor-presence-list', HTMLUListElement);

	/**
	 * The editors last shown, for showing them again once more area names are known
	 */
	private editors: [string, EditorPresence][] = [];

	/**
	 * @param ownPlayerId The player whose page this is, who isn't listed
	 * @param areaName The name of an area of a version (live or draft), or undefined when this window doesn't know it
	 * @param shownChanged Called with whether the bar lists anyone, each time it is shown
	 */
	constructor(private readonly ownPlayerId: string, private readonly areaName: (version: string, areaId: string) => string | undefined, private readonly shownChanged: (shown: boolean) => void)
	{
	}

	/**
	 * Lists the other editors who have the editor open and where they are
	 *
	 * @param editors The room's state.editors: each player with the editor open, by player ID
	 */
	show(editors: Iterable<[string, EditorPresence]>): void
	{
		this.editors = [...editors]
			.filter(([playerId]) => (playerId !== this.ownPlayerId))
			.sort(([, a], [, b]) => a.name.localeCompare(b.name, currentLocale()));
		this.refresh();
	}

	/**
	 * Lists the editors last shown again, naming the areas this window has learned since
	 */
	refresh(): void
	{
		const items = this.editors.map(([, editor]) =>
		{
			const item = document.createElement('li');

			item.textContent = t({
				id: 'editor.presence.editor',
				defaultMessage: '{name}: {places}',
				description: 'In the bar at the bottom of the universe\'s editor, another editor who has it open; {name} is their display name and {places} where their windows are, such as "Areas - Forest (draft) and Items"'
			}, {
				name: editor.name,
				places: new Intl.ListFormat(currentLocale(), { type: 'conjunction' }).format(this.placesOf(editor))
			});
			item.translate = false;

			return(item);
		});

		this.list.replaceChildren(...items);
		// The bar keeps to one line, cutting the list short, so hovering shows all of it
		this.presence.title = new Intl.ListFormat(currentLocale(), { type: 'unit' }).format(items.map((item) => (item.textContent ?? '')));
		this.presence.hidden = (items.length === 0);
		this.shownChanged(items.length > 0);
	}

	/**
	 * Where an editor's windows are, each place once
	 *
	 * @param editor The editor
	 * @return The places, in the player's language
	 */
	private placesOf(editor: EditorPresence): string[]
	{
		const places = new Set<string>();

		for (const window of editor.windows.values())
		{
			places.add(this.placeOf(window));
		}

		return([...places]);
	}

	/**
	 * Where one window is: its tab, the area it shows when this window knows the area's name, and whether
	 * it shows the draft
	 *
	 * @param window The window
	 * @return The place, in the player's language
	 */
	private placeOf(window: EditorWindow): string
	{
		const area = ((window.areaId === '') ? undefined : this.areaName(window.version, window.areaId));
		const place = ((area === undefined) ? tabName(window.tab) : t({
			id: 'editor.presence.area',
			defaultMessage: '{tab} - {area}',
			description: 'In the bar at the bottom of the universe\'s editor, where another editor\'s window is: {tab} is the tab\'s name, such as Areas, and {area} the name of the area it shows'
		}, {
			tab: tabName(window.tab),
			area
		}));

		return(((window.version === 'draft') ? t({
			id: 'editor.presence.draft',
			defaultMessage: '{place} (draft)',
			description: 'In the bar at the bottom of the universe\'s editor, where another editor\'s window is when it shows the universe\'s draft (a copy players don\'t see until it is applied); {place} is the tab, or the tab and area, such as "Areas - Forest"'
		}, {
			place
		}) : place));
	}
}
