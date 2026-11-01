import { canManageEditors, canPlayUniverse, UNIVERSE_ROLE_NAMES, type EditableUniverse, type EditorChange, type EditorRoleSettings, type PlayerMatch, type UniverseEditorSummary } from '@multiverse-kiln/shared';
import leaveIcon from 'virtual:icon/ph:sign-out';
import undoIcon from 'virtual:icon/ph:arrow-u-up-left';

import { formatList, t } from '../../localization';
import { describeEditorError, type EditorApi } from '../../network/editorApi';
import { playerPageUrl } from '../../pages';
import { refreshUnsavedWork, watchUnsavedWork } from '../changeTracker';
import { askToConfirm, type Confirmation } from '../confirmDialog';
import { getElement, setButtonLabel, showMessage } from '../dom';
import { languageName } from '../languagePicker';
import { EditorDialog } from './EditorDialog';
import type { EditorSave } from './editorSave';
import type { SavableTab } from './SaveBar';
import type { ChangeSource, StagedState } from './stagedChanges';

/**
 * One editor's change kept on the tab until it is saved
 *
 * - added: a player given a role, with who they are
 * - settings: a new role and languages, for a new or saved editor
 * - removed: a saved editor whose role is taken away, or the player leaving
 */
interface StagedEditor
{
	added?: PlayerMatch;
	settings?: EditorRoleSettings;
	removed?: boolean;
}

/**
 * What the Editors tab saves, besides the editors: what the editor does once the player's own role changes
 */
export interface EditorsTabActions
{
	/**
	 * The player's own role or languages were changed and saved, so the editor opens the universe again
	 * to show what the new role may do
	 */
	ownRoleChanged(): void;

	/**
	 * The player left the universe, and the save was saved
	 */
	left(): void;
}

/**
 * The Editors tab: everyone with a role in the universe, with their role and, for translators, their
 * languages. Creators add players by username, change roles and remove editors; anyone can leave. Changes
 * wait on the page until the tab is saved
 */
export class EditorsTab implements SavableTab, ChangeSource
{
	private readonly addButton = getElement('editors-add', HTMLButtonElement);
	private readonly leaveButton = getElement('editors-leave', HTMLButtonElement);
	private readonly rows = getElement('editors-rows', HTMLTableSectionElement);
	private readonly error = getElement('editors-error', HTMLElement);
	private readonly dialog: EditorDialog;

	/**
	 * Itself, as the save bar follows its changes
	 */
	readonly changes: ChangeSource = this;

	/**
	 * The changes made since the editors were last saved, by player ID, in the order they were made
	 */
	private staged = new Map<string, StagedEditor>();

	/**
	 * The changes the save being sent holds
	 */
	private collected = new Map<string, StagedEditor>();

	private readonly listeners = new Set<(unsaved: boolean) => void>();

	private universe: EditableUniverse | undefined;

	/**
	 * The editors as they were last loaded
	 */
	private editors: UniverseEditorSummary[] = [];

	/**
	 * The player using the editor, once the editors have loaded and list them
	 */
	private ownPlayerId: string | undefined;

	/**
	 * Changes with every request for the list, so a list that arrives after a newer request is ignored
	 */
	private requestVersion = 0;

	/**
	 * @param api The editor's API
	 * @param actions What to do once the player's own role changes
	 */
	constructor(private readonly api: EditorApi, private readonly actions: EditorsTabActions)
	{
		this.dialog = new EditorDialog(api);
		watchUnsavedWork(this);

		this.addButton.addEventListener('click', () =>
		{
			this.openEditor(undefined);
		});

		this.leaveButton.addEventListener('click', () =>
		{
			void this.leave();
		});
	}

	/**
	 * Leaves the universe when the tab is saved, once the player confirms what that means, or takes
	 * leaving back
	 */
	private async leave(): Promise<void>
	{
		const universe = this.universe;
		const playerId = this.ownPlayerId;

		if (!universe || (playerId === undefined))
		{
			return;
		}

		if ((this.staged.get(playerId)?.removed !== true) && !await askToConfirm(this.leaveConfirmation(universe)))
		{
			return;
		}

		this.toggleRemoved(playerId);
	}

	/**
	 * What the player is asked before leaving: what they lose once the tab is saved
	 *
	 * @param universe The universe
	 * @return The confirmation
	 */
	private leaveConfirmation(universe: EditableUniverse): Confirmation
	{
		const creators = this.view().filter(({ editor, state }) => ((editor.role === 'creator') && (state !== 'removed')));
		const lastCreator = ((universe.role === 'creator') && (creators.length <= 1));

		return({
			title: t({
				id: 'editor.editors.leaveTitle',
				defaultMessage: 'Leave {universe}?',
				description: 'Title of the dialog asking the player to confirm leaving a universe from the editor\'s Editors tab; {universe} is its name'
			}, {
				universe: universe.name
			}),
			question: t({
				id: 'editor.editors.leaveQuestion',
				defaultMessage: 'Once you save, you lose your role ({role}) in {universe} and can no longer open it in the editor. {play, select, yes {You can still play it, since it is open to everyone.} other {You can\'t play it until it opens to everyone, and you will be turned out of its lobby and your groups there.}} {lastCreator, select, yes {You are its only creator, so make another editor a creator first, or the save will be refused.} other {Only a creator can give you a role again.}} Until you save, Undo Leave keeps your role.',
				description: 'Asked before the player leaves a universe from the editor\'s Editors tab; {role} is their role, e.g. builder, and {universe} the universe\'s name. {play} is yes when the universe is open to everyone, so they can still play it without a role; {lastCreator} is yes when they are its only creator, who can\'t leave until someone else is one'
			}, {
				role: t(UNIVERSE_ROLE_NAMES[universe.role]),
				universe: universe.name,
				play: (canPlayUniverse(universe.stage, undefined) ? 'yes' : 'no'),
				lastCreator: (lastCreator ? 'yes' : 'no')
			}),
			confirmLabel: t({
				id: 'editor.editors.leave',
				defaultMessage: 'Leave Universe',
				description: 'Button on the editor\'s Editors tab that gives up the player\'s own role in the universe when the tab is saved'
			}),
			confirmIcon: leaveIcon
		});
	}

	/**
	 * Lists a universe's editors
	 *
	 * @param universe The universe
	 */
	open(universe: EditableUniverse): void
	{
		this.universe = universe;
		this.addButton.hidden = !canManageEditors(universe.role);
		this.editors = [];
		this.ownPlayerId = undefined;
		this.staged = new Map();
		this.changed();
		this.rows.replaceChildren();
		showMessage(this.error, undefined);
		void this.refresh();
	}

	/**
	 * Whether there are changes that haven't been saved
	 *
	 * @return True when there are
	 */
	hasUnsavedChanges(): boolean
	{
		return(this.staged.size > 0);
	}

	/**
	 * Hears when the tab starts or stops having unsaved changes, and when they change
	 *
	 * @param listener Called with whether it has them
	 * @return Stops listening
	 */
	subscribe(listener: (unsaved: boolean) => void): () => void
	{
		this.listeners.add(listener);

		return(() =>
		{
			this.listeners.delete(listener);
		});
	}

	/**
	 * Whether the player may save the tab: anyone may leave, so anyone may
	 *
	 * @return True once a universe is open
	 */
	canSave(): boolean
	{
		return(this.universe !== undefined);
	}

	/**
	 * Adds the changes to a save, in the order they were made
	 *
	 * @param save The save
	 * @return True
	 */
	collect(save: EditorSave): boolean
	{
		showMessage(this.error, undefined);
		this.collected = new Map(this.staged);

		for (const [playerId, staged] of this.collected)
		{
			const change = editorChange(playerId, staged);

			if (change)
			{
				save.add(change, (refusal) =>
				{
					showMessage(this.error, describeEditorError(refusal.error, {
						id: 'editor.editors.saveFailed',
						defaultMessage: 'Could not save the changes to {username}.',
						description: 'Shown on the editor\'s Editors tab when the server refused a change to one of the universe\'s editors, followed by why; {username} is their username. Nothing was saved'
					}, {
						username: (this.view().find((entry) => (entry.editor.playerId === playerId))?.editor.username ?? '')
					}));
				});
			}
		}

		return(true);
	}

	/**
	 * Takes the changes as saved, and loads the editors afresh, unless the player changed their own role
	 * or left, when the editor opens the universe again or goes
	 */
	async saved(): Promise<void>
	{
		const own = ((this.ownPlayerId === undefined) ? undefined : this.collected.get(this.ownPlayerId));

		for (const [playerId, staged] of this.collected)
		{
			if (this.staged.get(playerId) === staged)
			{
				this.staged.delete(playerId);
			}
		}

		this.collected = new Map();
		this.changed();

		if (own?.removed)
		{
			this.actions.left();
			return;
		}

		if (own?.settings)
		{
			this.actions.ownRoleChanged();
			return;
		}

		await this.refresh();
	}

	/**
	 * Loads the editors, then shows them with the changes made since
	 */
	private async refresh(): Promise<void>
	{
		const universe = this.universe;
		const version = ++this.requestVersion;

		if (!universe)
		{
			return;
		}

		try
		{
			const editors = await this.api.listEditors(universe.id);

			if (version === this.requestVersion)
			{
				this.editors = editors;
				this.ownPlayerId = editors.find((editor) => (editor.playerId === universe.playerId))?.playerId;
				this.render();
			}
		}
		catch (error)
		{
			if (version === this.requestVersion)
			{
				showMessage(this.error, describeEditorError(error, {
					id: 'editor.editors.listFailed',
					defaultMessage: 'Could not list the editors.',
					description: 'Shown on the editor\'s Editors tab when the universe\'s editors couldn\'t be loaded'
				}));
			}
		}
	}

	/**
	 * The editors with the changes made since they were last saved, those added last
	 *
	 * @return Each editor, with how they differ from what is saved
	 */
	private view(): { editor: UniverseEditorSummary; state: StagedState }[]
	{
		const saved = this.editors.map((editor) =>
		{
			const staged = this.staged.get(editor.playerId);
			let state: StagedState;

			if (staged?.removed)
			{
				state = 'removed';
			}
			else if (staged?.settings)
			{
				state = 'changed';
			}

			return({
				editor: {
					...editor,
					...staged?.settings
				},
				state
			});
		});
		const added = [...this.staged.values()].flatMap((staged) => ((staged.added && staged.settings)
			? [{
				editor: {
					...staged.added,
					...staged.settings
				},
				state: 'new' as const
			}]
			: []));

		return([...saved, ...added]);
	}

	/**
	 * Shows the editors, and whether the player is leaving
	 */
	private render(): void
	{
		const universe = this.universe;
		const manages = ((universe !== undefined) && canManageEditors(universe.role));
		const leaving = ((this.ownPlayerId !== undefined) && (this.staged.get(this.ownPlayerId)?.removed === true));

		this.rows.replaceChildren(...this.view().map(({ editor, state }) => this.createRow(editor, state, manages)));
		this.leaveButton.hidden = (this.ownPlayerId === undefined);

		if (leaving)
		{
			setButtonLabel(this.leaveButton, undoIcon, t({
				id: 'editor.editors.undoLeave',
				defaultMessage: 'Undo Leave',
				description: 'Button on the editor\'s Editors tab once the player has chosen to leave the universe, before saving: keeps their role instead'
			}));
		}
		else
		{
			setButtonLabel(this.leaveButton, leaveIcon, t({
				id: 'editor.editors.leave',
				defaultMessage: 'Leave Universe',
				description: 'Button on the editor\'s Editors tab that gives up the player\'s own role in the universe when the tab is saved'
			}));
		}
	}

	/**
	 * One editor's row: their username (opening the editor dialog for a creator, or their profile for
	 * anyone else), name, role and languages, and whether it is the player's own
	 *
	 * @param editor The editor, with the changes made since the last save
	 * @param state How they differ from what is saved
	 * @param manages Whether the player may change the editors
	 * @return The row
	 */
	private createRow(editor: UniverseEditorSummary, state: StagedState, manages: boolean): HTMLTableRowElement
	{
		const row = document.createElement('tr');
		const name = (manages ? document.createElement('button') : document.createElement('a'));
		const languages = formatList(editor.languages.map((language) => languageName(language)));
		const tag = ((editor.playerId === this.ownPlayerId)
			? t({
				id: 'editor.editors.youTag',
				defaultMessage: 'you',
				description: 'In the last column of the editor\'s Editors table, for the row of the player using the editor'
			})
			: '');

		name.textContent = editor.username;

		if (name instanceof HTMLButtonElement)
		{
			name.type = 'button';
			name.className = 'link-button';
			name.addEventListener('click', () =>
			{
				this.openEditor(editor);
			});
		}
		else
		{
			name.href = playerPageUrl(editor.username);
		}

		if (state === 'removed')
		{
			const note = document.createElement('span');

			row.classList.add('staged-deleted');
			note.className = 'visually-hidden';
			note.textContent = ` ${t({
				id: 'editor.editors.removedNote',
				defaultMessage: '(loses their role when saved)',
				description: 'Read out by screen readers after the username of an editor on the editor\'s Editors tab who will be removed, or is leaving, when the tab is saved; on screen the row is struck through'
			})}`;
			name.append(note);
		}

		for (const content of [name, editor.displayName, t(UNIVERSE_ROLE_NAMES[editor.role]), languages, tag])
		{
			const cell = document.createElement('td');

			cell.append(content);
			row.append(cell);
		}

		return(row);
	}

	/**
	 * Opens the editor dialog, showing its changes in the list
	 *
	 * @param editor The editor, or undefined to add one
	 */
	private openEditor(editor: UniverseEditorSummary | undefined): void
	{
		const universe = this.universe;

		if (!universe)
		{
			return;
		}

		const removed = ((editor !== undefined) && (this.staged.get(editor.playerId)?.removed === true));

		this.dialog.open(universe.id, editor, {
			removed,
			isEditor: (playerId) => (this.editors.some((each) => (each.playerId === playerId)) || this.staged.has(playerId)),
			apply: (player, settings) =>
			{
				this.apply(player, settings);
			},
			toggleRemoved: () =>
			{
				if (editor)
				{
					this.toggleRemoved(editor.playerId);
				}
			}
		}, () =>
		{
			this.render();
		});
	}

	/**
	 * Keeps a new editor, or an editor's new role, until the tab is saved. A role changed back to the
	 * saved one is no change
	 *
	 * @param player The player
	 * @param settings Their role and languages
	 */
	private apply(player: PlayerMatch, settings: EditorRoleSettings): void
	{
		const saved = this.editors.find((editor) => (editor.playerId === player.playerId));
		const staged = this.staged.get(player.playerId);

		if (saved && (saved.role === settings.role) && (saved.languages.join() === settings.languages.join()))
		{
			this.staged.delete(player.playerId);
		}
		else
		{
			this.staged.delete(player.playerId);
			this.staged.set(player.playerId, {
				added: (saved ? undefined : (staged?.added ?? player)),
				settings
			});
		}

		this.changed();
	}

	/**
	 * Takes an editor's role away when the tab is saved, or takes that back. A player added since the
	 * last save just goes
	 *
	 * @param playerId The editor's player ID
	 */
	private toggleRemoved(playerId: string): void
	{
		const staged = this.staged.get(playerId);

		if (staged?.removed || staged?.added)
		{
			this.staged.delete(playerId);
		}
		else
		{
			this.staged.delete(playerId);
			this.staged.set(playerId, { removed: true });
		}

		this.changed();
	}

	/**
	 * Shows the changes, and tells the listeners and the page that they changed
	 */
	private changed(): void
	{
		const unsaved = this.hasUnsavedChanges();

		if (this.universe)
		{
			this.render();
		}

		refreshUnsavedWork();

		for (const listener of this.listeners)
		{
			listener(unsaved);
		}
	}
}

/**
 * The change a save sends for one editor's staged change
 *
 * @param playerId The editor's player ID
 * @param staged The change
 * @return The change to send, or undefined for none
 */
function editorChange(playerId: string, staged: StagedEditor): EditorChange | undefined
{
	if (staged.removed)
	{
		return({ kind: 'removeEditor', playerId });
	}

	if (!staged.settings)
	{
		return(undefined);
	}

	if (staged.added)
	{
		return({ kind: 'addEditor', username: staged.added.username, settings: staged.settings });
	}

	return({ kind: 'saveEditor', playerId, settings: staged.settings });
}
