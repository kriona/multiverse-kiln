import { playerPageUrl } from '../pages';

/**
 * A table cell naming a player: their name, linking to their profile, and their username, as the admin
 * pages and the editor's Character List tab list them
 *
 * @param displayName The player's name
 * @param username Their username
 * @return The cell
 */
export function playerCell(displayName: string, username: string): HTMLTableCellElement
{
	const cell = document.createElement('td');
	const link = document.createElement('a');
	const handle = document.createElement('span');

	link.href = playerPageUrl(username);
	link.textContent = displayName;
	link.translate = false;
	handle.className = 'player-username';
	handle.textContent = `@${username}`;
	handle.translate = false;
	cell.append(link, ' ', handle);

	return(cell);
}
