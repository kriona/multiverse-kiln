/**
 * What disabling things players are using does to them, for one save of the world editor (see Disabling
 * things players are using in STRUCTURE-OVERVIEW.md). Each change notes what it enables or disables and
 * what the player chose should happen; once every change is saved, finish() compares each thing as the
 * save found it with how the save leaves it. Something disabled and enabled again in the same save
 * affects nobody, and something disabled more than once does what the last change chose, once. The
 * impact route (editorImpact.ts) warns about the same things, at the change whose choice is used
 */
import type { AreaEvacuation, GroupSizeLowering, ItemDisabling } from '@multiverse-kiln/shared';

import { listAreas } from '../db/areaRepo.js';
import { setCarriedItemsHidden } from '../db/characterRepo.js';
import { deleteGroups, listGroupsLargerThan, listMembersInAreas, moveMembers, removeGroupMembers, type GroupCharacter, type LargerGroup } from '../db/groupRepo.js';
import { listEditorItems } from '../db/itemRepo.js';
import { evacuatedPlaces, membersOverSize, type LinkInto } from '../logic/disabling.js';
import { groupChanges } from '../players/groupChanges.js';
import type { AreaPlace } from '../world/areaChanges.js';
import type { ChangeContext } from './editorChangeContext.js';
import { parentPlace } from './editorAreas.js';

/**
 * Something a save enables or disables: whether it was enabled before the save, and what the last change
 * disabling it chose
 */
interface Noted<Choice>
{
	wasEnabled: boolean;
	choice: Choice | undefined;
}

/**
 * The items, areas and group size one save enables, disables or lowers, and what happens to the players
 * using them once every change is saved
 */
export class SaveDisablings
{
	private readonly items = new Map<number, Noted<ItemDisabling>>();
	private readonly areas = new Map<string, Noted<AreaEvacuation>>();

	/**
	 * The group size before the save, and what the last change lowering it below that chose
	 */
	private groupSize: { before: number; choice: GroupSizeLowering | undefined } | undefined;

	/**
	 * Notes a change to an item that enables or disables it, or restores it
	 *
	 * @param itemId The item
	 * @param wasEnabled Whether it is enabled before the change
	 * @param whenDisabled What the change chose for the characters carrying it, when it disables it
	 */
	item(itemId: number, wasEnabled: boolean, whenDisabled?: ItemDisabling): void
	{
		note(this.items, itemId, wasEnabled, whenDisabled);
	}

	/**
	 * Notes a change to whether an area is enabled
	 *
	 * @param areaId The area
	 * @param wasEnabled Whether it is enabled before the change
	 * @param moveTo Where the change chose to send the characters in it, when it disables it
	 */
	area(areaId: string, wasEnabled: boolean, moveTo?: AreaEvacuation): void
	{
		note(this.areas, areaId, wasEnabled, moveTo);
	}

	/**
	 * Notes a change to the universe's group size
	 *
	 * @param before The group size before the change
	 * @param size The group size the change sets
	 * @param largerGroups What the change chose for groups larger than it
	 */
	groupSizeChange(before: number, size: number, largerGroups: GroupSizeLowering): void
	{
		const first = (this.groupSize?.before ?? before);

		this.groupSize = {
			before: first,
			choice: ((size < first) ? largerGroups : this.groupSize?.choice)
		};
	}

	/**
	 * Once every change is saved: takes disabled items from the characters carrying them, or gives back
	 * those enabled again, moves the characters out of disabled areas and brings groups larger than a
	 * lowered group size down to it, as the changes chose
	 *
	 * @param context The save
	 */
	async finish(context: ChangeContext): Promise<void>
	{
		// The draft's characters are the live version's: applying the draft asks what happens to them
		if (context.version.draft)
		{
			return;
		}

		await this.finishItems(context);
		await this.finishAreas(context);
		await this.finishGroupSize(context);
	}

	/**
	 * Hides the items the save disables with remove on the characters carrying them, and shows those it
	 * enables again
	 *
	 * @param context The save
	 */
	private async finishItems(context: ChangeContext): Promise<void>
	{
		const { universe, transaction } = context;

		if (this.items.size === 0)
		{
			return;
		}

		// An item the save deleted isn't listed, and nobody carries it
		const { items } = await listEditorItems(context.version, universe.ruleset, { ids: [...this.items.keys()] }, transaction);
		const taken: number[] = [];
		const givenBack: number[] = [];

		for (const item of items)
		{
			const noted = this.items.get(item.id);

			if (noted?.wasEnabled && !item.enabled && (noted.choice === 'remove'))
			{
				taken.push(item.id);
			}
			else if ((noted !== undefined) && !noted.wasEnabled && item.enabled)
			{
				givenBack.push(item.id);
			}
		}

		await setCarriedItemsHidden(universe.id, taken, true, transaction);
		await setCarriedItemsHidden(universe.id, givenBack, false, transaction);
	}

	/**
	 * Moves the characters out of the areas the save disables, other than the lobby's
	 *
	 * @param context The save
	 */
	private async finishAreas(context: ChangeContext): Promise<void>
	{
		if (this.areas.size === 0)
		{
			return;
		}

		const { universe, transaction } = context;

		// An area the save deleted isn't listed
		const areas = await listAreas(context.version, transaction);
		const loadedLinks = new Map<string, readonly LinkInto[]>();

		for (const area of areas)
		{
			const noted = this.areas.get(area.id);

			// The lobby's players are always in its area, and have nowhere else to start
			if (noted?.wasEnabled && !area.enabled && (area.id !== universe.lobbyAreaId))
			{
				const moveTo = (noted.choice ?? 'start');
				const destination = ((moveTo === 'parent') ? await parentPlace(transaction, areas, area.id, loadedLinks) : null);

				await evacuateArea(context, area.id, destination);
			}
		}
	}

	/**
	 * Brings the groups larger than a group size the save lowers down to it, unless the change lowering it
	 * chose to keep them
	 *
	 * @param context The save
	 */
	private async finishGroupSize(context: ChangeContext): Promise<void>
	{
		const size = context.universe.groupSize;
		const choice = this.groupSize?.choice;

		if ((this.groupSize !== undefined) && (size < this.groupSize.before) && (choice !== undefined) && (choice !== 'keep'))
		{
			await shrinkGroups(context, size, choice);
		}
	}
}

/**
 * Notes a change enabling or disabling something: whether it was enabled before the save, from the
 * first change to it, and the choice of the last change disabling it
 *
 * @param noted What is noted so far, by ID
 * @param id The thing
 * @param wasEnabled Whether it is enabled before the change
 * @param choice The change's choice, when it disables it
 */
function note<Id, Choice>(noted: Map<Id, Noted<Choice>>, id: Id, wasEnabled: boolean, choice: Choice | undefined): void
{
	const earlier = noted.get(id);

	noted.set(id, {
		wasEnabled: (earlier?.wasEnabled ?? wasEnabled),
		choice: (choice ?? earlier?.choice)
	});
}

/**
 * Sends the characters in a disabled area to a destination: those saved there by their group now, and
 * those playing there once the save commits
 *
 * @param context The save
 * @param areaId The area
 * @param destination Where they all go, or null to send each where their group starts
 */
async function evacuateArea(context: ChangeContext, areaId: string, destination: AreaPlace | null): Promise<void>
{
	const { universe, transaction } = context;
	const universeStart = ((universe.startingAreaId === null)
		? null
		: {
			areaId: universe.startingAreaId,
			column: universe.startingColumn,
			row: universe.startingRow
		});

	await moveMembers(evacuatedPlaces(await listMembersInAreas([areaId], transaction), destination, universeStart), transaction);
	context.published.push({ kind: 'evacuated', areaId, destination });
}

/**
 * Brings the universe's groups larger than a new group size down to it: disbands them, or takes out
 * their most recently joined members, and tells their rooms once the save commits
 *
 * @param context The save
 * @param size The new group size
 * @param largerGroups What happens to them
 */
async function shrinkGroups(context: ChangeContext, size: number, largerGroups: Exclude<GroupSizeLowering, 'keep'>): Promise<void>
{
	const { universe, transaction } = context;
	const larger = await listGroupsLargerThan(universe.id, size, transaction);
	const asCharacter = ({ joinedAt: _joinedAt, ...character }: LargerGroup['members'][number]): GroupCharacter => character;

	if (largerGroups === 'disband')
	{
		await deleteGroups(larger.map((group) => group.groupId), transaction);

		for (const group of larger)
		{
			context.onCommit.push(() =>
			{
				groupChanges.publish({
					kind: 'disbanded',
					groupId: group.groupId,
					universeId: universe.id,
					members: group.members.map(asCharacter),
					groupSizeLowered: true
				});
			});
		}

		return;
	}

	for (const group of larger)
	{
		const leaving = new Set(membersOverSize(group.members, group.anchorCharacterId, size));

		await removeGroupMembers(group.groupId, [...leaving], transaction);

		for (const member of group.members.filter((each) => leaving.has(each.characterId)))
		{
			context.onCommit.push(() =>
			{
				groupChanges.publish({
					kind: 'left',
					groupId: group.groupId,
					universeId: universe.id,
					character: asCharacter(member),
					groupSizeLowered: true
				});
			});
		}
	}
}
