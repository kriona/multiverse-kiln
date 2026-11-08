import disableIcon from 'virtual:icon/ph:prohibit';
import enableIcon from 'virtual:icon/ph:check-circle';
import { defineMessages, MAX_DISABLED_REASON_LENGTH, RULESET_NAMES, UNIVERSE_STAGE_NAMES, type AdminUniverse, type AdminUniverseCreator } from '@multiverse-kiln/shared';

import { showAdminRefusal, startAdminPage } from './AdminPage';
import { formatDateTime, t } from './localization';
import type { AdminApi } from './network/adminApi';
import { describeEditorError } from './network/editorApi';
import { editPageUrl, playerPageUrl } from './pages';
import { AdminList, notesCell, textCell } from './ui/AdminList';
import { ChangeTracker } from './ui/changeTracker';
import { askToConfirm } from './ui/confirmDialog';
import { getElement, setButtonLabel, showMessage } from './ui/dom';
import { clearFieldErrors, reportFieldError, setFieldError } from './ui/fieldErrors';
import { showToast } from './ui/toast';

/**
 * Text the page shows in more than one place (see shared/src/localization.ts)
 */
const messages = defineMessages({
	enable: {
		id: 'admin.universes.enable',
		defaultMessage: 'Enable',
		description: 'Button in a row of the admin page\'s list of universes that enables a disabled universe again, and the button in the dialog that asks first'
	}
});

/**
 * Starts the admin page listing every universe (admin/universes.html), where admins disable and enable them
 */
void startAdminPage(async (api) =>
{
	const disableDialog = new UniverseDisableDialog(api);
	const list: AdminList<AdminUniverse> = new AdminList<AdminUniverse>({
		prefix: 'universe',
		load: async (query) =>
		{
			const page = await api.listUniverses({
				search: query.search,
				disabled: query.filter,
				offset: query.offset,
				limit: query.limit
			});

			return({
				rows: page.universes,
				total: page.total
			});
		},
		key: (universe) => universe.id,
		render: (universe) => universeRow(universe, {
			disable: () =>
			{
				disableDialog.open(universe, () =>
				{
					void list.reload();
				});
			},
			enable: () =>
			{
				void enableUniverse(api, universe, () => list.reload());
			}
		}),
		loadFailed: {
			id: 'admin.universes.loadFailed',
			defaultMessage: 'Could not load the universes.',
			description: 'Shown on the admin page listing universes when the list couldn\'t be loaded'
		}
	});

	await list.load();
});

/**
 * What a universe's row does when its buttons are pressed
 */
interface UniverseRowActions
{
	/**
	 * Opens the dialog that disables it
	 */
	disable: () => void;

	/**
	 * Enables it again, after asking
	 */
	enable: () => void;
}

/**
 * A universe's row in the table
 *
 * @param universe The universe
 * @param actions What its Disable or Enable button does
 * @return The row
 */
function universeRow(universe: AdminUniverse, actions: UniverseRowActions): HTMLTableRowElement
{
	const row = document.createElement('tr');
	const notes = notesCell(((universe.disabledAt === null)
		? []
		: [
			{
				text: t({
					id: 'admin.universes.disabledNote',
					defaultMessage: 'Disabled',
					description: 'Note in the admin page\'s list of universes on a universe a server admin has disabled, above when and why'
				}),
				tone: 'warning'
			}
		]));
	const actionCell = document.createElement('td');
	const button = document.createElement('button');

	if ((universe.disabledAt !== null) && (universe.disabledReason !== null))
	{
		const reason = document.createElement('p');

		reason.className = 'admin-reason';
		reason.textContent = t({
			id: 'admin.universes.disabledSince',
			defaultMessage: 'Since {date}: {reason}',
			description: 'Under the Disabled note in the admin page\'s list of universes: when the universe was disabled, and the reason the admin gave; {date} is a date and time, and {reason} the reason as the admin typed it'
		}, {
			date: formatDateTime(universe.disabledAt),
			reason: universe.disabledReason
		});
		notes.append(reason);
	}

	if ((universe.disabledAt !== null) && universe.deletionPrevented)
	{
		const prevented = document.createElement('p');

		prevented.className = 'admin-reason';
		prevented.textContent = t({
			id: 'admin.universes.deletionPreventedNote',
			defaultMessage: 'Its creators can\'t delete it.',
			description: 'Under when and why a universe was disabled in the admin page\'s list of universes, when the admin who disabled it kept its creators from deleting it'
		});
		notes.append(prevented);
	}

	button.type = 'button';
	actionCell.className = 'admin-actions';

	if (universe.disabledAt === null)
	{
		button.className = 'danger';
		setButtonLabel(button, disableIcon, t({
			id: 'admin.universes.disable',
			defaultMessage: 'Disable',
			description: 'Button in a row of the admin page\'s list of universes that opens the dialog disabling it, and the button in that dialog that disables it'
		}));
		button.setAttribute('aria-label', t({
			id: 'admin.universes.disableLabel',
			defaultMessage: 'Disable {universe}',
			description: 'Name of the Disable button in a row of the admin page\'s list of universes, for screen readers; {universe} is the universe\'s name'
		}, {
			universe: universe.name
		}));
		button.addEventListener('click', actions.disable);
	}
	else
	{
		button.className = 'secondary';
		setButtonLabel(button, enableIcon, t(messages.enable));
		button.setAttribute('aria-label', t({
			id: 'admin.universes.enableLabel',
			defaultMessage: 'Enable {universe}',
			description: 'Name of the Enable button in a row of the admin page\'s list of universes, for screen readers; {universe} is the universe\'s name'
		}, {
			universe: universe.name
		}));
		button.addEventListener('click', actions.enable);
	}

	actionCell.append(button);
	row.append(
		universeCell(universe),
		textCell(t(RULESET_NAMES[universe.ruleset])),
		textCell(t(UNIVERSE_STAGE_NAMES[universe.stage])),
		creatorsCell(universe.creators),
		textCell(formatDateTime(universe.createdAt)),
		notes,
		actionCell
	);

	return(row);
}

/**
 * A table cell naming a universe, linking to its editor, which a server admin opens with the site admin
 * role unless they are one of its creators
 *
 * @param universe The universe
 * @return The cell
 */
function universeCell(universe: AdminUniverse): HTMLTableCellElement
{
	const cell = document.createElement('td');
	const link = document.createElement('a');

	link.href = editPageUrl(universe.id);
	link.textContent = universe.name;
	link.translate = false;
	cell.append(link);

	return(cell);
}

/**
 * A table cell naming a universe's creators, each linking to their profile
 *
 * @param creators The creators
 * @return The cell
 */
function creatorsCell(creators: readonly AdminUniverseCreator[]): HTMLTableCellElement
{
	const cell = document.createElement('td');

	creators.forEach((creator, index) =>
	{
		const link = document.createElement('a');

		if (index > 0)
		{
			cell.append(document.createElement('br'));
		}

		link.href = playerPageUrl(creator.username);
		link.textContent = creator.displayName;
		link.translate = false;
		link.title = `@${creator.username}`;
		cell.append(link);
	});

	return(cell);
}

/**
 * Enables a disabled universe again, after asking
 *
 * @param api The admin routes
 * @param universe The universe
 * @param changed Called once it is enabled, or the server refused because it changed meanwhile, to load the
 * list again
 */
async function enableUniverse(api: AdminApi, universe: AdminUniverse, changed: () => Promise<void>): Promise<void>
{
	let failure: string | undefined;

	const confirmed = await askToConfirm({
		title: t({
			id: 'admin.universes.enableTitle',
			defaultMessage: 'Enable Universe',
			description: 'Title of the dialog that asks before enabling a disabled universe on the admin page listing universes'
		}),
		question: t({
			id: 'admin.universes.enableQuestion',
			defaultMessage: 'Enable {universe}? It can be played and saved again.',
			description: 'Asked before enabling a disabled universe on the admin page listing universes; {universe} is its name'
		}, {
			universe: universe.name
		}),
		confirmLabel: t(messages.enable),
		confirmIcon: enableIcon,
		harmless: true
	});

	if (!confirmed)
	{
		return;
	}

	try
	{
		await api.enableUniverse(universe.id);
		showToast(t({
			id: 'admin.universes.enabled',
			defaultMessage: '{universe} is enabled.',
			description: 'Shown, and read out by screen readers, once a disabled universe was enabled again on the admin page listing universes; {universe} is its name'
		}, {
			universe: universe.name
		}));
	}
	catch (error)
	{
		if (showAdminRefusal(error))
		{
			return;
		}

		failure = describeEditorError(error, {
			id: 'admin.universes.enableFailed',
			defaultMessage: 'Could not enable {universe}.',
			description: 'Shown on the admin page listing universes when a disabled universe couldn\'t be enabled; {universe} is its name'
		}, {
			universe: universe.name
		});
	}

	// The failure shares the list's error element, which loading the list clears, so it is shown after
	await changed();

	if (failure !== undefined)
	{
		showMessage(getElement('universe-list-error', HTMLElement), failure);
	}
}

/**
 * The dialog that disables a universe, asking why (the reason is shown to its editors) and whether its
 * creators are kept from deleting it
 */
class UniverseDisableDialog
{
	private readonly dialog = getElement('universe-disable-dialog', HTMLDialogElement);
	private readonly form = getElement('universe-disable-form', HTMLFormElement);
	private readonly intro = getElement('universe-disable-intro', HTMLElement);
	private readonly reason = getElement('universe-disable-reason', HTMLTextAreaElement);
	private readonly preventDeletion = getElement('universe-disable-prevent-deletion', HTMLInputElement);
	private readonly error = getElement('universe-disable-error', HTMLElement);
	private readonly submitButton = getElement('universe-disable-submit', HTMLButtonElement);
	private readonly changes: ChangeTracker;

	/**
	 * The universe being disabled
	 */
	private universe: AdminUniverse | undefined;

	/**
	 * Called once the universe is disabled
	 */
	private onDisabled: () => void = () => undefined;

	/**
	 * @param api The admin routes
	 */
	constructor(private readonly api: AdminApi)
	{
		this.reason.maxLength = MAX_DISABLED_REASON_LENGTH;
		this.changes = new ChangeTracker({
			root: this.form
		});
		this.changes.guardDialog(this.dialog);

		this.reason.addEventListener('input', () =>
		{
			setFieldError(this.reason, undefined);
		});

		this.form.addEventListener('submit', (event) =>
		{
			event.preventDefault();
			void this.submit();
		});

		getElement('universe-disable-cancel', HTMLButtonElement).addEventListener('click', () =>
		{
			if (this.changes.confirmDiscard())
			{
				this.dialog.close();
			}
		});
	}

	/**
	 * Opens the dialog for a universe
	 *
	 * @param universe The universe
	 * @param onDisabled Called once it is disabled
	 */
	open(universe: AdminUniverse, onDisabled: () => void): void
	{
		this.universe = universe;
		this.onDisabled = onDisabled;
		this.intro.textContent = t({
			id: 'admin.universes.disableIntro',
			defaultMessage: 'Disable {universe}? It stops being listed and can\'t be played, and its editors can\'t save until it is enabled again.',
			description: 'In the dialog that disables a universe on the admin page listing universes; {universe} is its name'
		}, {
			universe: universe.name
		});
		this.reason.value = '';
		this.preventDeletion.checked = true;
		clearFieldErrors(this.form);
		showMessage(this.error, undefined);
		this.changes.markSaved();
		this.dialog.showModal();
		this.reason.focus();
	}

	/**
	 * Disables the universe with the reason typed
	 */
	private async submit(): Promise<void>
	{
		const universe = this.universe;
		const reason = this.reason.value.trim();

		if (!universe || this.submitButton.disabled)
		{
			return;
		}

		showMessage(this.error, undefined);

		if (reason === '')
		{
			reportFieldError(this.reason, t({
				id: 'admin.universes.reasonNeeded',
				defaultMessage: 'Say why the universe is disabled. Its editors are shown the reason.',
				description: 'Shown under the reason field in the dialog that disables a universe when it was left empty'
			}));
			return;
		}

		this.submitButton.disabled = true;

		try
		{
			await this.api.disableUniverse(universe.id, {
				reason,
				preventDeletion: this.preventDeletion.checked
			});
			this.changes.markSaved();
			this.dialog.close();
			showToast(t({
				id: 'admin.universes.disabled',
				defaultMessage: '{universe} is disabled.',
				description: 'Shown, and read out by screen readers, once a universe was disabled on the admin page listing universes; {universe} is its name'
			}, {
				universe: universe.name
			}));
			this.onDisabled();
		}
		catch (error)
		{
			if (showAdminRefusal(error))
			{
				this.changes.markSaved();
				this.dialog.close();
				return;
			}

			showMessage(this.error, describeEditorError(error, {
				id: 'admin.universes.disableFailed',
				defaultMessage: 'Could not disable {universe}.',
				description: 'Shown in the dialog that disables a universe when it couldn\'t be disabled; {universe} is its name'
			}, {
				universe: universe.name
			}));
		}
		finally
		{
			this.submitButton.disabled = false;
		}
	}
}
