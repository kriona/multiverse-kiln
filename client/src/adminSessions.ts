import type { AdminSession } from '@multiverse-kiln/shared';

import { startAdminPage } from './AdminPage';
import { formatDateTime, t } from './localization';
import { AdminList, notesCell, playerCell, textCell, type AdminNote } from './ui/AdminList';

/**
 * Starts the admin page listing the login sessions still going (admin/sessions.html)
 */
void startAdminPage(async (api) =>
{
	const list = new AdminList<AdminSession>({
		prefix: 'session',
		load: async (query) =>
		{
			const page = await api.listSessions({
				search: query.search,
				connected: query.filter,
				offset: query.offset,
				limit: query.limit
			});

			return({
				rows: page.sessions,
				total: page.total
			});
		},
		render: sessionRow,
		loadFailed: {
			id: 'admin.sessions.loadFailed',
			defaultMessage: 'Could not load the sessions.',
			description: 'Shown on the admin page listing login sessions when the list couldn\'t be loaded'
		}
	});

	await list.load();
});

/**
 * A session's row in the table
 *
 * @param session The session
 * @return The row
 */
function sessionRow(session: AdminSession): HTMLTableRowElement
{
	const row = document.createElement('tr');
	const notes: AdminNote[] = [];

	if (session.current)
	{
		notes.push({
			text: t({
				id: 'admin.sessions.current',
				defaultMessage: 'This browser',
				description: 'Note in the admin page\'s list of sessions on the session of the browser the admin is using'
			}),
			tone: 'current'
		});
	}

	if (session.connected)
	{
		notes.push({
			text: t({
				id: 'admin.sessions.connectedNote',
				defaultMessage: 'Connected',
				description: 'Note in the admin page\'s list of sessions on a session with a window of the site open now'
			}),
			tone: 'online'
		});
	}

	if (session.rememberMe)
	{
		notes.push({
			text: t({
				id: 'admin.sessions.remembered',
				defaultMessage: 'Remembered',
				description: 'Note in the admin page\'s list of sessions on a session whose player checked "Remember me" when logging in, so it lasts longer'
			}),
			tone: 'remembered'
		});
	}

	row.append(
		playerCell(session.displayName, session.username),
		textCell(formatDateTime(session.createdAt)),
		textCell(formatDateTime(session.lastUsedAt)),
		textCell(formatDateTime(session.expiresAt)),
		notesCell(notes)
	);

	return(row);
}
