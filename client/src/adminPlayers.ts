import { LOGIN_PROVIDER_NAMES, type AdminPlayer } from '@multiverse-kiln/shared';

import { startAdminPage } from './AdminPage';
import { formatDateTime, t } from './localization';
import { AdminList, notesCell, playerCell, textCell, type AdminNote } from './ui/AdminList';

/**
 * Starts the admin page listing every player account (admin/players.html)
 */
void startAdminPage(async (api) =>
{
	const list = new AdminList<AdminPlayer>({
		prefix: 'player',
		load: async (query) =>
		{
			const page = await api.listPlayers({
				search: query.search,
				serverAdmin: query.filter,
				offset: query.offset,
				limit: query.limit
			});

			return({
				rows: page.players,
				total: page.total
			});
		},
		render: playerRow,
		loadFailed: {
			id: 'admin.players.loadFailed',
			defaultMessage: 'Could not load the players.',
			description: 'Shown on the admin page listing player accounts when the list couldn\'t be loaded'
		}
	});

	await list.load();
});

/**
 * A player's row in the table
 *
 * @param player The player
 * @return The row
 */
function playerRow(player: AdminPlayer): HTMLTableRowElement
{
	const row = document.createElement('tr');
	const email = textCell((player.email ?? ''));
	const logins: AdminNote[] = [];
	const notes: AdminNote[] = [];

	if (player.password)
	{
		logins.push({
			text: t({
				id: 'admin.players.password',
				defaultMessage: 'Password',
				description: 'In the admin page\'s list of players, under Logs in with: the account logs in with an email address and password'
			}),
			tone: 'password'
		});
	}

	for (const provider of player.providers)
	{
		logins.push({
			text: LOGIN_PROVIDER_NAMES[provider],
			tone: provider
		});
	}

	if (player.active)
	{
		notes.push({
			text: t({
				id: 'admin.players.active',
				defaultMessage: 'Active',
				description: 'Note in the admin page\'s list of players on an account with a window of the site open right now'
			}),
			tone: 'online'
		});
	}

	if (player.serverAdmin)
	{
		notes.push({
			text: t({
				id: 'admin.players.serverAdminNote',
				defaultMessage: 'Server admin',
				description: 'Note in the admin page\'s list of players on a player who is one of the site\'s admins'
			}),
			tone: 'serverAdmin'
		});
	}

	if (player.twoFactor)
	{
		notes.push({
			text: t({
				id: 'admin.players.twoFactor',
				defaultMessage: '2FA',
				description: 'Note in the admin page\'s list of players on an account with two-factor authentication on'
			}),
			tone: 'twoFactor'
		});
	}

	email.translate = false;
	row.append(
		playerCell(player.displayName, player.username),
		email,
		textCell(formatDateTime(player.createdAt)),
		textCell(((player.lastLoginAt === null)
			? t({
				id: 'admin.players.neverLoggedIn',
				defaultMessage: 'Never',
				description: 'In the admin page\'s list of players, under Last login, for an account that has never logged in'
			})
			: formatDateTime(player.lastLoginAt))),
		notesCell(logins),
		notesCell(notes)
	);

	return(row);
}
