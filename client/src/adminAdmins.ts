import removeIcon from 'virtual:icon/ph:user-minus';
import { defineMessages, MIN_PLAYER_SEARCH_LENGTH, type ServerAdminSummary } from '@multiverse-kiln/shared';

import { showAdminRefusal, startAdminPage } from './AdminPage';
import { formatDateTime, t } from './localization';
import type { AdminApi } from './network/adminApi';
import { describeEditorError } from './network/editorApi';
import { adminNoteMessages, notesCell, replaceRows, textCell, type AdminNote } from './ui/AdminList';
import { playerCell } from './ui/playerCell';
import { ChangeTracker } from './ui/changeTracker';
import { askToConfirm } from './ui/confirmDialog';
import { getElement, setButtonLabel, showMessage } from './ui/dom';
import { reportFieldError } from './ui/fieldErrors';
import { PlayerSearch } from './ui/PlayerSearch';
import { showToast } from './ui/toast';

/**
 * Text the page shows in more than one place (see shared/src/localization.ts)
 */
const messages = defineMessages({
	remove: {
		id: 'admin.admins.remove',
		defaultMessage: 'Remove',
		description: 'Button in a row of the admin page\'s list of server admins that takes their admin role away, and the button in the dialog that asks first'
	}
});

/**
 * Starts the admin page listing the site's server admins (admin/admins.html), where admins add other
 * admins and remove them
 */
void startAdminPage(async (api) =>
{
	await new AdminsPage(api).load();
});

/**
 * The Admins admin page: the list of server admins, each with Remove, and a field for finding a player
 * to add. The server keeps the last admin, and the page doesn't offer to remove them
 */
class AdminsPage
{
	private readonly form = getElement('admin-add-form', HTMLFormElement);
	private readonly field = getElement('admin-player', HTMLInputElement);
	private readonly addButton = getElement('admin-add', HTMLButtonElement);
	private readonly addError = getElement('admin-add-error', HTMLElement);
	private readonly rows = getElement('admin-rows', HTMLTableSectionElement);
	private readonly loading = getElement('admin-loading', HTMLElement);
	private readonly listError = getElement('admin-list-error', HTMLElement);
	private readonly playerSearch: PlayerSearch;
	private readonly changes: ChangeTracker;

	/**
	 * @param api The admin routes
	 */
	constructor(private readonly api: AdminApi)
	{
		this.playerSearch = new PlayerSearch({
			searchId: 'admin-player',
			listboxId: 'admin-player-options',
			search: (query) => this.api.searchAdminCandidates({ query }),
			minLength: MIN_PLAYER_SEARCH_LENGTH
		});
		// What is typed to search isn't a change, but the player chosen is
		this.changes = new ChangeTracker({
			root: this.form,
			state: () => (this.playerSearch.player?.playerId ?? null)
		});

		this.form.addEventListener('submit', (event) =>
		{
			event.preventDefault();
			void this.add();
		});
	}

	/**
	 * Loads the admins and shows them
	 */
	async load(): Promise<void>
	{
		let admins: ServerAdminSummary[];

		try
		{
			admins = await this.api.listAdmins();
		}
		catch (error)
		{
			this.loading.hidden = true;

			if (!showAdminRefusal(error))
			{
				showMessage(this.listError, describeEditorError(error, {
					id: 'admin.admins.loadFailed',
					defaultMessage: 'Could not load the server admins.',
					description: 'Shown on the admin page listing the site\'s server admins when the list couldn\'t be loaded'
				}));
			}

			return;
		}

		showMessage(this.listError, undefined);
		this.loading.hidden = true;
		replaceRows(this.rows, admins.map((admin) => this.adminRow(admin, (admins.length > 1))));
	}

	/**
	 * An admin's row in the table
	 *
	 * @param admin The admin
	 * @param removable Whether they can be removed: false for the last admin
	 * @return The row
	 */
	private adminRow(admin: ServerAdminSummary, removable: boolean): HTMLTableRowElement
	{
		const row = document.createElement('tr');
		const actions = document.createElement('td');
		const notes: AdminNote[] = [];

		row.dataset.key = admin.username;

		if (admin.current)
		{
			notes.push({
				text: t({
					id: 'admin.admins.you',
					defaultMessage: 'You',
					description: 'Note in the admin page\'s list of server admins on the player looking at it'
				}),
				tone: 'current'
			});
		}

		notes.push((admin.twoFactor
			? {
				text: t(adminNoteMessages.twoFactor),
				tone: 'twoFactor'
			}
			: {
				text: t({
					id: 'admin.admins.noTwoFactor',
					defaultMessage: 'No 2FA: can\'t use the admin pages',
					description: 'Note in the admin page\'s list of server admins on an admin without two-factor authentication, who can\'t use the admin pages until they turn it on'
				}),
				tone: 'warning'
			}));

		actions.className = 'admin-actions';

		if (removable)
		{
			const remove = document.createElement('button');

			remove.type = 'button';
			remove.className = 'secondary';
			setButtonLabel(remove, removeIcon, t(messages.remove));
			remove.setAttribute('aria-label', t({
				id: 'admin.admins.removeLabel',
				defaultMessage: 'Remove {name} (@{username}) as an admin',
				description: 'Name of the Remove button in a row of the admin page\'s list of server admins, for screen readers; {name} is the admin\'s name and {username} their username'
			}, {
				name: admin.displayName,
				username: admin.username
			}));
			remove.addEventListener('click', () =>
			{
				void this.remove(admin);
			});
			actions.append(remove);
		}

		row.append(
			playerCell(admin.displayName, admin.username),
			textCell(formatDateTime(admin.addedAt)),
			notesCell(notes),
			actions
		);

		return(row);
	}

	/**
	 * Makes the player chosen in the field a server admin
	 */
	private async add(): Promise<void>
	{
		const player = this.playerSearch.player;

		if (this.addButton.disabled)
		{
			return;
		}

		showMessage(this.addError, undefined);

		if (!player)
		{
			reportFieldError(this.field, t({
				id: 'admin.admins.choosePlayer',
				defaultMessage: 'Choose a player from the list.',
				description: 'Shown under the field on the admin page listing the site\'s server admins when Add Admin is pressed before a player was chosen from the list of matches'
			}));
			return;
		}

		this.addButton.disabled = true;

		try
		{
			await this.api.addAdmin({ username: player.username });
			this.playerSearch.reset();
			this.changes.markSaved();
			showToast(t({
				id: 'admin.admins.nowAdmin',
				defaultMessage: '{name} (@{username}) is now a server admin.',
				description: 'Shown, and read out by screen readers, once a player was made one of the site\'s admins on the admin page listing them; {name} is their name and {username} their username'
			}, {
				name: player.displayName,
				username: player.username
			}));
			await this.load();
		}
		catch (error)
		{
			if (!showAdminRefusal(error))
			{
				showMessage(this.addError, describeEditorError(error, {
					id: 'admin.admins.addFailed',
					defaultMessage: 'Could not add the admin.',
					description: 'Shown on the admin page listing the site\'s server admins when a player couldn\'t be made an admin'
				}));
			}
		}
		finally
		{
			this.addButton.disabled = false;
		}
	}

	/**
	 * Takes away an admin's role, after asking. Removing themself takes the player off the admin pages
	 *
	 * @param admin The admin
	 */
	private async remove(admin: ServerAdminSummary): Promise<void>
	{
		const confirmed = await askToConfirm({
			title: t({
				id: 'admin.admins.removeTitle',
				defaultMessage: 'Remove Admin',
				description: 'Title of the dialog that asks before taking away a server admin\'s role'
			}),
			question: (admin.current
				? t({
					id: 'admin.admins.removeSelfQuestion',
					defaultMessage: 'Stop being one of the site\'s admins? You won\'t be able to use the admin pages, unless another admin adds you again.',
					description: 'Asked before an admin takes away their own server admin role on the admin page listing the site\'s admins'
				})
				: t({
					id: 'admin.admins.removeQuestion',
					defaultMessage: 'Stop {name} (@{username}) being one of the site\'s admins? They won\'t be able to use the admin pages.',
					description: 'Asked before taking away another player\'s server admin role on the admin page listing the site\'s admins; {name} is their name and {username} their username'
				}, {
					name: admin.displayName,
					username: admin.username
				})),
			confirmLabel: t(messages.remove),
			confirmIcon: removeIcon
		});

		if (!confirmed)
		{
			return;
		}

		try
		{
			await this.api.removeAdmin(admin.username);
		}
		catch (error)
		{
			if (!showAdminRefusal(error))
			{
				showMessage(this.listError, describeEditorError(error, {
					id: 'admin.admins.removeFailed',
					defaultMessage: 'Could not remove the admin.',
					description: 'Shown on the admin page listing the site\'s server admins when an admin\'s role couldn\'t be taken away'
				}));
			}

			return;
		}

		showToast(t({
			id: 'admin.admins.removed',
			defaultMessage: '{name} (@{username}) is no longer a server admin.',
			description: 'Shown, and read out by screen readers, once a server admin\'s role was taken away on the admin page listing the site\'s admins; {name} is their name and {username} their username'
		}, {
			name: admin.displayName,
			username: admin.username
		}));

		// Without the role, the next request is refused, and the page says why
		await this.load();
	}
}
