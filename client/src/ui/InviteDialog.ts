import { defineMessages, INVITE_DURATIONS, type InviteDuration } from '@multiverse-kiln/shared';

import { t } from '../localization';
import { describeEditorError } from '../network/editorApi';
import type { GroupApi } from '../network/groupApi';
import { inviteLinkUrl } from '../pages';
import { announce } from './announcer';
import { getElement, namedOptions, setOptions, showMessage } from './dom';

/**
 * The name of each InviteDuration in the dialog's choice
 */
const DURATION_NAMES = defineMessages({
	day: {
		id: 'inviteDialog.duration.day',
		defaultMessage: '1 day',
		description: 'Choice of how long an invite link works: one day from now'
	},
	week: {
		id: 'inviteDialog.duration.week',
		defaultMessage: '1 week',
		description: 'Choice of how long an invite link works: one week from now'
	},
	indefinite: {
		id: 'inviteDialog.duration.indefinite',
		defaultMessage: 'Until the group is disbanded',
		description: 'Choice of how long an invite link works: it never expires, but stops working when the group ends'
	}
}) satisfies Record<InviteDuration, unknown>;

/**
 * The Invite dialog (partials/group-dialogs.html), for the anchor being's player: makes an invite link,
 * single or multi-use, that works for a day, a week or until the group is disbanded, and copies it
 *
 * The server keeps only a hash of each link, so a link is shown once, when it is made
 */
export class InviteDialog
{
	private readonly dialog = getElement('invite-dialog', HTMLDialogElement);
	private readonly form = getElement('invite-form', HTMLFormElement);
	private readonly multiUse = getElement('invite-multi-use', HTMLInputElement);
	private readonly singleUse = getElement('invite-single-use', HTMLInputElement);
	private readonly duration = getElement('invite-duration', HTMLSelectElement);
	private readonly error = getElement('invite-dialog-error', HTMLElement);
	private readonly linkRow = getElement('invite-link-row', HTMLElement);
	private readonly link = getElement('invite-link', HTMLInputElement);
	private readonly expiry = getElement('invite-link-expiry', HTMLElement);
	private readonly status = getElement('invite-dialog-status', HTMLElement);
	private readonly copyButton = getElement('invite-copy', HTMLButtonElement);
	private readonly createButton = getElement('invite-create', HTMLButtonElement);

	/**
	 * The group links are made for, while the dialog is open
	 */
	private current: { universeId: string; universeSlug: string; groupId: string } | undefined;

	/**
	 * @param api The group routes
	 */
	constructor(private readonly api: GroupApi)
	{
		setOptions(this.duration, namedOptions(INVITE_DURATIONS, DURATION_NAMES));

		this.form.addEventListener('submit', (event) =>
		{
			event.preventDefault();
			void this.create();
		});

		this.copyButton.addEventListener('click', () =>
		{
			void this.copy();
		});

		getElement('invite-dialog-close', HTMLButtonElement).addEventListener('click', () =>
		{
			this.dialog.close();
		});

		this.dialog.addEventListener('close', () =>
		{
			this.current = undefined;
		});
	}

	/**
	 * Opens the dialog for a group
	 *
	 * @param universeId The universe's ID
	 * @param universeSlug The universe's slug, which invite links use
	 * @param groupId The group's ID
	 */
	open(universeId: string, universeSlug: string, groupId: string): void
	{
		this.current = { universeId, universeSlug, groupId };
		this.singleUse.checked = true;
		this.duration.value = 'day';
		this.createButton.disabled = false;
		this.linkRow.hidden = true;
		this.copyButton.hidden = true;
		this.link.value = '';
		this.status.textContent = '';
		showMessage(this.error, undefined);
		this.dialog.showModal();
		this.singleUse.focus();
	}

	/**
	 * Makes a link with the options chosen and shows it, ready to copy
	 */
	private async create(): Promise<void>
	{
		const current = this.current;

		if (!current || this.createButton.disabled)
		{
			return;
		}

		this.createButton.disabled = true;
		showMessage(this.error, undefined);
		this.status.textContent = '';

		try
		{
			const invite = await this.api.createInvite(current.universeId, current.groupId, {
				multiUse: this.multiUse.checked,
				duration: (this.duration.value as InviteDuration)
			});

			if (this.current !== current)
			{
				return;
			}

			this.link.value = inviteLinkUrl(current.universeSlug, invite.token);
			this.expiry.textContent = ((invite.expiresAt === null)
				? t({
					id: 'inviteDialog.neverExpires',
					defaultMessage: 'Works until the group is disbanded. This link is shown only once: copy it now.',
					description: 'Under an invite link that never expires'
				})
				: t({
					id: 'inviteDialog.expires',
					defaultMessage: 'Works until {expiresAt, date, medium} {expiresAt, time, short}. This link is shown only once: copy it now.',
					description: 'Under an invite link that expires; {expiresAt} is when it stops working'
				}, {
					expiresAt: Date.parse(invite.expiresAt)
				}));
			this.linkRow.hidden = false;
			this.copyButton.hidden = false;
			this.link.focus();
			this.link.select();
		}
		catch (error)
		{
			showMessage(this.error, describeEditorError(error, {
				id: 'inviteDialog.failed',
				defaultMessage: 'Could not make an invite link.',
				description: 'Shown in the Invite dialog when the link couldn\'t be made'
			}));
		}
		finally
		{
			this.createButton.disabled = false;
		}
	}

	/**
	 * Copies the link to the clipboard, or selects it to copy by hand when the browser won't allow that
	 */
	private async copy(): Promise<void>
	{
		try
		{
			await navigator.clipboard.writeText(this.link.value);
			this.status.textContent = t({
				id: 'inviteDialog.copied',
				defaultMessage: 'Link copied.',
				description: 'Shown in the Invite dialog when Copy Link has copied the invite link to the clipboard'
			});
			announce(this.status.textContent);
		}
		catch (error)
		{
			console.warn('Could not copy the invite link:', error);
			this.status.textContent = t({
				id: 'inviteDialog.copyFailed',
				defaultMessage: 'Your browser didn\'t allow copying. Select the link and copy it yourself.',
				description: 'Shown in the Invite dialog when the browser refused to copy the invite link'
			});
			this.link.focus();
			this.link.select();
		}
	}
}
