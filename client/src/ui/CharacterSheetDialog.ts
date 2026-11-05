import { ABILITY_NAMES, DARKVISION_NAMES, pf1eAbilityModifier, RULESET_ABILITIES, SIZE_NAMES, type CharacterSheet } from '@multiverse-kiln/shared';
import lastRitesIcon from 'virtual:icon/game-icons:candle-light';
import signOutIcon from 'virtual:icon/ph:sign-out';

import { currentLocale, signedNumber, t } from '../localization';
import type { CharacterApi } from '../network/characterApi';
import { describeEditorError } from '../network/editorApi';
import type { GroupApi } from '../network/groupApi';
import { announce } from './announcer';
import { getElement, setButtonLabel, showMessage } from './dom';
import { createItemIcon, itemName } from './itemNames';
import { describeLeaving, leaveButtonLabel, leavingMessages } from './leavingGroup';
import { moneyElement } from './moneyField';
import { characterDescription, themeName } from './raceAndClassNames';

/**
 * A dialog showing one of the player's characters: their race and class, ability scores, size,
 * darkvision, light sensitivity, money and equipment (pages that use it include partials/character-sheet.html)
 *
 * It only shows the character, so there is nothing in it to save. Its Delete button asks twice before
 * deleting the character: the second question cremates them (deletes them immediately) or gives them
 * their last rites (deletes them the site's characterDeletionDays later, and isn't offered while that
 * is 0). A character given their last rites can be restored from their sheet until then. A character in
 * a group who can't play, because their race or class is disabled, can leave the group from their sheet
 */
export class CharacterSheetDialog
{
	private readonly dialog = getElement('character-sheet-dialog', HTMLDialogElement);
	private readonly title = getElement('character-sheet-title', HTMLElement);
	private readonly summary = getElement('character-sheet-summary', HTMLElement);
	private readonly status = getElement('character-sheet-status', HTMLElement);
	private readonly error = getElement('character-sheet-error', HTMLElement);
	private readonly pending = getElement('character-sheet-pending', HTMLElement);
	private readonly body = getElement('character-sheet-body', HTMLElement);
	private readonly abilityRows = getElement('character-sheet-ability-rows', HTMLTableSectionElement);
	private readonly traits = getElement('character-sheet-traits', HTMLDListElement);
	private readonly items = getElement('character-sheet-items', HTMLUListElement);
	private readonly noItems = getElement('character-sheet-no-items', HTMLElement);
	private readonly deleteButton = getElement('character-sheet-delete', HTMLButtonElement);
	private readonly restoreButton = getElement('character-sheet-restore', HTMLButtonElement);
	private readonly leaveButton = getElement('character-sheet-leave', HTMLButtonElement);
	private readonly leaveDialog = getElement('character-leave-dialog', HTMLDialogElement);
	private readonly leaveTitle = getElement('character-leave-title', HTMLElement);
	private readonly leaveQuestion = getElement('character-leave-question', HTMLElement);
	private readonly leaveError = getElement('character-leave-error', HTMLElement);
	private readonly leaveConfirm = getElement('character-leave-confirm', HTMLButtonElement);
	private readonly deleteDialog = getElement('character-delete-dialog', HTMLDialogElement);
	private readonly deleteQuestion = getElement('character-delete-question', HTMLElement);
	private readonly farewellDialog = getElement('character-farewell-dialog', HTMLDialogElement);
	private readonly farewellQuestion = getElement('character-farewell-question', HTMLElement);
	private readonly farewellError = getElement('character-farewell-error', HTMLElement);
	private readonly cremateButton = getElement('character-cremate', HTMLButtonElement);
	private readonly lastRitesButton = getElement('character-last-rites', HTMLButtonElement);
	private readonly farewellCancelButton = getElement('character-farewell-cancel', HTMLButtonElement);

	/**
	 * The character shown, once loaded, and the universe they are in
	 */
	private current: { universeId: string; sheet: CharacterSheet } | undefined;

	/**
	 * Whether a deletion or restoration has been sent and the server hasn't answered
	 */
	private busy = false;

	/**
	 * Changes every time the dialog opens, so a character that arrives for an earlier opening is ignored
	 */
	private version = 0;

	/**
	 * @param api The player's characters
	 * @param groupApi The routes that take characters out of groups
	 * @param charactersChanged Called after a character is deleted, given their last rites, restored or
	 * taken out of their group
	 */
	constructor(private readonly api: CharacterApi, private readonly groupApi: GroupApi, private readonly charactersChanged: () => void)
	{
		getElement('character-sheet-close', HTMLButtonElement).addEventListener('click', () =>
		{
			this.dialog.close();
		});

		this.dialog.addEventListener('close', () =>
		{
			this.version++;
			this.current = undefined;
		});

		this.deleteButton.addEventListener('click', () =>
		{
			this.askToDelete();
		});

		this.restoreButton.addEventListener('click', () =>
		{
			void this.restore();
		});

		this.leaveButton.addEventListener('click', () =>
		{
			this.askToLeave();
		});

		getElement('character-leave-cancel', HTMLButtonElement).addEventListener('click', () =>
		{
			this.leaveDialog.close();
		});

		this.leaveConfirm.addEventListener('click', () =>
		{
			void this.leave();
		});

		// Escape doesn't close the question while the answer is being sent
		this.leaveDialog.addEventListener('cancel', (event) =>
		{
			if (this.busy)
			{
				event.preventDefault();
			}
		});

		getElement('character-delete-cancel', HTMLButtonElement).addEventListener('click', () =>
		{
			this.deleteDialog.close();
		});

		getElement('character-delete-confirm', HTMLButtonElement).addEventListener('click', () =>
		{
			this.deleteDialog.close();
			this.askFarewell();
		});

		this.cremateButton.addEventListener('click', () =>
		{
			void this.cremate();
		});

		this.lastRitesButton.addEventListener('click', () =>
		{
			void this.giveLastRites();
		});

		this.farewellCancelButton.addEventListener('click', () =>
		{
			this.farewellDialog.close();
		});

		// Escape doesn't close the last question while its answer is being sent
		this.farewellDialog.addEventListener('cancel', (event) =>
		{
			if (this.busy)
			{
				event.preventDefault();
			}
		});
	}

	/**
	 * Opens the dialog and loads the character into it
	 *
	 * @param universeId The universe the character is in
	 * @param characterId The character's ID
	 * @param name The character's name, shown while the rest loads
	 */
	async open(universeId: string, characterId: string, name: string): Promise<void>
	{
		const version = ++this.version;

		this.title.textContent = name;
		this.summary.textContent = '';
		this.status.textContent = t({
			id: 'characterSheet.loading',
			defaultMessage: 'Loading the character sheet...',
			description: 'Shown in a character\'s sheet while the character loads'
		});
		this.body.hidden = true;
		this.pending.hidden = true;
		this.deleteButton.hidden = true;
		this.restoreButton.hidden = true;
		this.leaveButton.hidden = true;
		this.current = undefined;
		showMessage(this.error, undefined);
		this.dialog.showModal();
		this.title.focus();

		let sheet: CharacterSheet;

		try
		{
			sheet = await this.api.getCharacterSheet(universeId, characterId);
		}
		catch (error)
		{
			if (version === this.version)
			{
				this.status.textContent = '';
				showMessage(this.error, describeEditorError(error, {
					id: 'characterSheet.loadFailed',
					defaultMessage: 'Could not load the character sheet.',
					description: 'Shown in a character\'s sheet when the character couldn\'t be loaded'
				}));
			}

			return;
		}

		if (version === this.version)
		{
			this.current = {
				universeId,
				sheet
			};
			this.show(sheet);
		}
	}

	/**
	 * Fills the dialog with a character
	 *
	 * @param sheet The character
	 */
	private show(sheet: CharacterSheet): void
	{
		this.title.textContent = sheet.name;
		this.summary.textContent = characterDescription(sheet, sheet.ruleset);
		this.status.textContent = '';
		this.showAbilities(sheet);
		this.showTraits(sheet);
		this.showItems(sheet);
		this.showDeletion(sheet);
		this.body.hidden = false;
	}

	/**
	 * Shows whether the character is waiting to be deleted, with Restore for one who is. Delete is
	 * offered either way, so a character given their last rites can still be cremated, except to a
	 * character in a group, who has to leave it first. A character who can't play because their race or
	 * class is disabled can't leave their group from it, so their sheet offers Leave group
	 *
	 * @param sheet The character
	 */
	private showDeletion(sheet: CharacterSheet): void
	{
		const waiting = (sheet.deleteAt !== null);

		this.pending.textContent = (waiting
			? t({
				id: 'characterSheet.pending',
				defaultMessage: '{name} has had their last rites and will be deleted on {deleteAt, date, long}.',
				description: 'On the sheet of a character waiting to be deleted; {name} is the character\'s name and {deleteAt} the day they will be deleted'
			}, {
				name: sheet.name,
				deleteAt: Date.parse(sheet.deleteAt ?? '')
			})
			: '');
		this.pending.hidden = !waiting;
		this.restoreButton.hidden = !waiting;
		this.deleteButton.hidden = (sheet.group !== null);
		this.leaveButton.hidden = ((sheet.group === null) || (sheet.barredBy === null));

		if (sheet.group)
		{
			setButtonLabel(this.leaveButton, signOutIcon, leaveButtonLabel(sheet.group.isAnchor));
		}
	}

	/**
	 * Asks whether to take the character shown out of their group
	 */
	private askToLeave(): void
	{
		const sheet = this.current?.sheet;

		if (!sheet?.group)
		{
			return;
		}

		const { title, question, confirm } = describeLeaving(sheet.name, sheet.group.isAnchor);

		this.leaveTitle.textContent = title;
		this.leaveQuestion.textContent = question;
		setButtonLabel(this.leaveConfirm, signOutIcon, confirm);
		this.leaveConfirm.disabled = false;
		showMessage(this.leaveError, undefined);
		this.leaveDialog.showModal();
	}

	/**
	 * Takes the character shown out of their group, once the player has said so, and offers Delete
	 */
	private async leave(): Promise<void>
	{
		const current = this.current;
		const group = current?.sheet.group;

		if (!current || !group || this.busy)
		{
			return;
		}

		this.busy = true;
		this.leaveConfirm.disabled = true;

		try
		{
			await this.groupApi.leaveGroup(current.universeId, group.groupId, current.sheet.id);
		}
		catch (error)
		{
			showMessage(this.leaveError, describeEditorError(error, leavingMessages.leaveFailed));
			this.leaveConfirm.disabled = false;
			return;
		}
		finally
		{
			this.busy = false;
		}

		this.leaveDialog.close();

		if (this.current === current)
		{
			current.sheet = {
				...current.sheet,
				group: null
			};
			this.showDeletion(current.sheet);
			this.deleteButton.focus();
		}

		announce(t({
			id: 'characterSheet.leftGroup',
			defaultMessage: '{name} has left the group.',
			description: 'Read out by screen readers once a character who can\'t play, because their race or class is disabled, has been taken out of their group from their sheet; {name} is the character\'s name'
		}, {
			name: current.sheet.name
		}));
		this.charactersChanged();
	}

	/**
	 * Asks whether to delete the character shown
	 */
	private askToDelete(): void
	{
		const sheet = this.current?.sheet;

		if (!sheet)
		{
			return;
		}

		this.deleteQuestion.textContent = t({
			id: 'characterDelete.question',
			defaultMessage: 'Do you want to delete {name}?',
			description: 'In the dialog that asks whether to delete a character; {name} is the character\'s name'
		}, {
			name: sheet.name
		});
		this.deleteDialog.showModal();
	}

	/**
	 * Asks the last question before deleting the character shown: whether to cremate them, give them
	 * their last rites, or keep them. Keeping them is the button focused
	 */
	private askFarewell(): void
	{
		const sheet = this.current?.sheet;

		if (!sheet)
		{
			return;
		}

		this.farewellQuestion.textContent = t({
			id: 'characterDelete.farewell',
			defaultMessage: 'Are you absolutely sure you want to delete {name}? This is permanent (a very long time!) and cannot be undone.',
			description: 'In the last dialog before deleting a character; {name} is the character\'s name. Playful: "permanent" is joked about as a very long time'
		}, {
			name: sheet.name
		});
		setButtonLabel(this.lastRitesButton, lastRitesIcon, t({
			id: 'characterDelete.lastRites',
			defaultMessage: 'Last Rites (delete in {days, plural, one {# day} other {# days}})',
			description: 'Button that deletes a character after some days, and lets the player restore them until then. Last Rites is a playful way of saying it (the rites said for someone about to die); the words in parentheses say plainly what it does. {days} is how many days it waits'
		}, {
			days: sheet.deletionDays
		}));

		// Not offered when the site has turned last rites off, or the character already has them
		this.lastRitesButton.hidden = ((sheet.deletionDays === 0) || (sheet.deleteAt !== null));
		showMessage(this.farewellError, undefined);
		this.setBusy(false);
		this.farewellDialog.showModal();
		this.farewellCancelButton.focus();
	}

	/**
	 * Deletes the character shown immediately, then closes the sheet
	 */
	private async cremate(): Promise<void>
	{
		const current = this.current;

		if (!current || this.busy)
		{
			return;
		}

		this.setBusy(true);

		try
		{
			await this.api.deleteCharacter(current.universeId, current.sheet.id);
		}
		catch (error)
		{
			this.setBusy(false);
			showMessage(this.farewellError, describeEditorError(error, {
				id: 'characterDelete.failed',
				defaultMessage: 'Could not delete the character.',
				description: 'Shown in the last dialog before deleting a character when the deletion failed'
			}));
			return;
		}

		this.setBusy(false);
		this.farewellDialog.close();
		this.dialog.close();
		announce(t({
			id: 'characterDelete.cremated',
			defaultMessage: '{name} has been deleted.',
			description: 'Read out by screen readers once a character has been deleted immediately; {name} is the character\'s name'
		}, {
			name: current.sheet.name
		}));
		this.charactersChanged();
	}

	/**
	 * Gives the character shown their last rites, and shows when they will be deleted
	 */
	private async giveLastRites(): Promise<void>
	{
		const current = this.current;

		if (!current || this.busy)
		{
			return;
		}

		let deleteAt: string;

		this.setBusy(true);

		try
		{
			deleteAt = await this.api.scheduleCharacterDeletion(current.universeId, current.sheet.id);
		}
		catch (error)
		{
			this.setBusy(false);
			showMessage(this.farewellError, describeEditorError(error, {
				id: 'characterDelete.lastRitesFailed',
				defaultMessage: 'Could not give the character their last rites.',
				description: 'Shown in the last dialog before deleting a character when scheduling the deletion failed'
			}));
			return;
		}

		this.setBusy(false);
		this.farewellDialog.close();

		if (this.current === current)
		{
			current.sheet = {
				...current.sheet,
				deleteAt
			};
			this.showDeletion(current.sheet);
			announce(this.pending.textContent ?? '');
		}

		this.charactersChanged();
	}

	/**
	 * Restores the character shown, who has had their last rites
	 */
	private async restore(): Promise<void>
	{
		const current = this.current;

		if (!current || this.busy)
		{
			return;
		}

		this.busy = true;
		this.restoreButton.disabled = true;

		try
		{
			await this.api.restoreCharacter(current.universeId, current.sheet.id);
		}
		catch (error)
		{
			showMessage(this.error, describeEditorError(error, {
				id: 'characterSheet.restoreFailed',
				defaultMessage: 'Could not restore the character.',
				description: 'Shown on the sheet of a character waiting to be deleted when taking back the deletion failed'
			}));
			return;
		}
		finally
		{
			this.busy = false;
			this.restoreButton.disabled = false;
		}

		showMessage(this.error, undefined);

		if (this.current === current)
		{
			current.sheet = {
				...current.sheet,
				deleteAt: null
			};
			this.showDeletion(current.sheet);
			this.deleteButton.focus();
		}

		announce(t({
			id: 'characterSheet.restored',
			defaultMessage: '{name} has been restored.',
			description: 'Read out by screen readers once a character waiting to be deleted has been restored; {name} is the character\'s name'
		}, {
			name: current.sheet.name
		}));
		this.charactersChanged();
	}

	/**
	 * Turns the last question's buttons off while its answer is being sent
	 *
	 * @param busy Whether an answer is being sent
	 */
	private setBusy(busy: boolean): void
	{
		this.busy = busy;
		this.cremateButton.disabled = busy;
		this.lastRitesButton.disabled = busy;
		this.farewellCancelButton.disabled = busy;
	}

	/**
	 * Lists each ability with its score and the bonus or penalty it gives
	 *
	 * @param sheet The character
	 */
	private showAbilities(sheet: CharacterSheet): void
	{
		this.abilityRows.replaceChildren(...RULESET_ABILITIES[sheet.ruleset].map((ability) =>
		{
			const row = document.createElement('tr');
			const name = document.createElement('th');
			const score = document.createElement('td');
			const modifier = document.createElement('td');
			const value = sheet.abilityScores[ability];

			name.scope = 'row';
			name.textContent = t(ABILITY_NAMES[sheet.ruleset][ability]);
			score.textContent = value.toLocaleString(currentLocale());
			modifier.textContent = signedNumber(pf1eAbilityModifier(value));
			row.append(name, score, modifier);

			return(row);
		}));
	}

	/**
	 * Lists the character's theme, hit points and stamina points in a ruleset that has them, their size,
	 * their darkvision and light sensitivity, and their money
	 *
	 * @param sheet The character
	 */
	private showTraits(sheet: CharacterSheet): void
	{
		const entries: [string, string | Node][] = [];

		if (sheet.theme !== null)
		{
			entries.push([t({
				id: 'characterSheet.theme',
				defaultMessage: 'Theme',
				description: 'On a character\'s sheet in Starfinder, the label of their theme: a background such as ace pilot'
			}), themeName(sheet.theme, sheet.ruleset)]);
		}

		if (sheet.hitPoints !== null)
		{
			entries.push([t({
				id: 'characterSheet.hitPoints',
				defaultMessage: 'Hit points',
				description: 'On a character\'s sheet in Starfinder, the label of their hit points'
			}), sheet.hitPoints.toLocaleString(currentLocale())]);
		}

		if (sheet.staminaPoints !== null)
		{
			entries.push([t({
				id: 'characterSheet.staminaPoints',
				defaultMessage: 'Stamina points',
				description: 'On a character\'s sheet in Starfinder, the label of their stamina points, which are lost before hit points and come back with rest'
			}), sheet.staminaPoints.toLocaleString(currentLocale())]);
		}

		entries.push(
			[t({
				id: 'characterSheet.size',
				defaultMessage: 'Size',
				description: 'On a character\'s sheet, the label of their size, such as Medium'
			}), t(SIZE_NAMES[sheet.ruleset][sheet.size])],
			[t({
				id: 'character.darkvision',
				defaultMessage: 'Darkvision',
				description: 'How far a character can see in the dark, if at all: the label on a character\'s sheet, and of the race editor\'s field for how far the race\'s characters can; also names the setting in the list of what a save changed, on the editor\'s Audit tab'
			}), t(DARKVISION_NAMES[sheet.darkvision])],
			[t({
				id: 'character.lightSensitivity',
				defaultMessage: 'Light sensitivity',
				description: 'Whether bright light dazzles a character: the label on a character\'s sheet, and the race editor\'s checkbox for whether it dazzles the race\'s characters; also names the setting in the list of what a save changed, on the editor\'s Audit tab'
			}), t({
				id: 'characterSheet.lightSensitivityValue',
				defaultMessage: '{lightSensitivity, select, true {Yes} other {No}}',
				description: 'On a character\'s sheet, whether bright light dazzles them'
			}, {
				lightSensitivity: String(sheet.lightSensitivity)
			})],
			[t({
				id: 'characterSheet.money',
				defaultMessage: 'Money',
				description: 'On a character\'s sheet, the label of the coins they carry, such as 15gp 5sp'
			}), moneyElement(sheet.money, sheet.ruleset, sheet.coinNames, sheet.coinAbbreviations)]
		);

		this.traits.replaceChildren(...entries.flatMap(([term, value]) =>
		{
			const termElement = document.createElement('dt');
			const valueElement = document.createElement('dd');

			termElement.textContent = term;
			valueElement.append(value);

			return([termElement, valueElement]);
		}));
	}

	/**
	 * Lists the items the character carries by name, the way the player's language sorts them, with how
	 * many of each
	 *
	 * @param sheet The character
	 */
	private showItems(sheet: CharacterSheet): void
	{
		const items = sheet.items
			.map((item) => ({
				item,
				name: itemName(item, sheet.ruleset)
			}))
			.sort((a, b) => a.name.localeCompare(b.name, currentLocale()));

		this.items.replaceChildren(...items.map(({ item, name }) =>
		{
			const row = document.createElement('li');
			const text = document.createElement('span');

			text.textContent = t({
				id: 'characterSheet.item',
				defaultMessage: '{quantity, plural, =1 {{item}} other {{item} x#}}',
				description: 'On a character\'s sheet, an item they carry, with how many when there is more than one; {item} is the item\'s name, e.g. "Arrow x20"'
			}, {
				item: name,
				quantity: item.quantity
			});
			row.append(createItemIcon(item.type, sheet.ruleset), text);

			return(row);
		}));
		this.noItems.hidden = (items.length > 0);
	}
}
