/**
 * What disabling things players are using does to them, for one save of the world editor (see Disabling
 * things players are using in STRUCTURE-OVERVIEW.md). Each change notes what it enables or disables and
 * what the player chose should happen; once every change is saved, finish() compares each thing as the
 * save found it with how the save leaves it. Something disabled and enabled again in the same save
 * affects nobody, and something disabled more than once does what the last change chose, once. The
 * impact route (editorImpact.ts) warns about the same things, at the change whose choice is used
 */
import { isRulebookOn, isSf1eRaceRules, isShield, isUsable, RULESET_EQUIPMENT, type AreaEvacuation, type AreaEvacuations, type GroupSizeLowering, type ItemDisabling, type RaceRules, type Ruleset } from '@multiverse-kiln/shared';

import { listAreas } from '../db/areaRepo.js';
import { setCarriedItemsHidden } from '../db/characterRepo.js';
import { unequipItemsInUniverse, unequipSlotsOfRaces, type EquipmentOwner } from '../db/equipmentRepo.js';
import { clearGroupStartingAreas, deleteGroups, listGroupsLargerThan, listMembersInAreas, moveMembers, removeGroupMembers, type GroupCharacter, type LargerGroup } from '../db/groupRepo.js';
import { listEditorItems } from '../db/itemRepo.js';
import { loadEditorRaces } from '../db/raceRepo.js';
import { loadRulebookSettings } from '../db/rulesetRepo.js';
import { areasById, areasInTree, evacuatedPlaces, membersOverSize, type LinkInto } from '../logic/disabling.js';
import { characterItemChanges } from '../players/characterItemChanges.js';
import { groupChanges } from '../players/groupChanges.js';
import type { AreaPlace } from '../world/areaChanges.js';
import type { ChangeContext } from './editorChangeContext.js';
import { parentPlace } from './editorAreas.js';
import type { PlacesOutcome } from './editorPlaces.js';

/**
 * An item a save enables, disables or restores, or whose book it turns on or off: how the save found it,
 * and what the changes disabling it or turning its book off chose
 */
interface NotedItem
{
	/**
	 * Whether the item itself was enabled before the save, whatever its book
	 */
	wasEnabled: boolean;

	/**
	 * Whether its book was on before the save
	 */
	rulebookWasOn: boolean;

	/**
	 * What the last change disabling the item itself chose
	 */
	whenDisabled: ItemDisabling | undefined;

	/**
	 * What the last change turning its book off chose
	 */
	whenRulebookOff: ItemDisabling | undefined;
}

/**
 * An item as a change finds it
 */
interface ItemState
{
	id: number;
	enabled: boolean;
	rulebook: string | null;
}

/**
 * An item as a change finds it, as far as equipping it goes
 */
interface ItemEquipping
{
	id: number;
	types: readonly string[];
	equips: string;
}

/**
 * Some characters with their players, each once
 *
 * @param owners The characters, each any number of times
 * @return Each character once
 */
function uniqueOwners(owners: readonly EquipmentOwner[]): EquipmentOwner[]
{
	return([...new Map(owners.map((owner) => [owner.characterId, owner])).values()]);
}

/**
 * What a change chose for the characters carrying an item
 */
interface ItemChoices
{
	/**
	 * When the change disables the item itself
	 */
	whenDisabled?: ItemDisabling;

	/**
	 * When the change turns its book off
	 */
	whenRulebookOff?: ItemDisabling;
}

/**
 * An area whose characters a save sends elsewhere, and where they go
 */
interface Evacuation
{
	areaId: string;

	/**
	 * Where they all go, or null to send each where their group (or the lobby) starts
	 */
	destination: AreaPlace | null;

	/**
	 * Whether the group members saved in the area move: not from a disabled lobby area, which only the
	 * lobby walks (leaveLobbyAreas() moves those of an area the save puts below the lobby region)
	 */
	movesSaved: boolean;
}

/**
 * The items, areas and group size one save enables, disables or lowers, and what happens to the players
 * using them once every change is saved. It also unequips the items whose place to equip, or whether they
 * are shields, the save changes, and the tail slots of the races it takes the tail from
 */
export class SaveDisablings
{
	private readonly items = new Map<number, NotedItem>();

	/**
	 * Where the characters in each area the save disables go, as the last change disabling it chose
	 */
	private readonly areaChoices = new Map<string, AreaEvacuation>();

	/**
	 * The group size before the save, and what the last change lowering it below that chose
	 */
	private groupSize: { before: number; choice: GroupSizeLowering | undefined } | undefined;

	/**
	 * Where each item the save changes or restores equipped, and whether it was a shield, as the save
	 * found it, by the item's ID
	 */
	private readonly equipping = new Map<number, { equips: string; shield: boolean }>();

	/**
	 * The races the save changes or restores that had a tail as the save found them, by ID; false for
	 * one that had none
	 */
	private readonly tails = new Map<number, boolean>();

	/**
	 * Notes how a change finds an item it changes or restores, for unequipping it once every change is
	 * saved if where it equips, or whether it is a shield, changed. How the save found it comes from the
	 * first change to it
	 *
	 * @param ruleset The universe's ruleset
	 * @param item The item before the change
	 */
	itemEquipping(ruleset: Ruleset, item: ItemEquipping): void
	{
		if (!this.equipping.has(item.id))
		{
			this.equipping.set(item.id, {
				equips: item.equips,
				shield: isShield(ruleset, item.types)
			});
		}
	}

	/**
	 * Notes how a change finds a race it changes or restores, for unequipping its characters' tail slots
	 * once every change is saved if it no longer has a tail. How the save found it comes from the first
	 * change to it
	 *
	 * @param raceId The race, by the ID characters hold
	 * @param rules Its rules before the change
	 */
	raceTail(raceId: number, rules: RaceRules): void
	{
		if (!this.tails.has(raceId))
		{
			this.tails.set(raceId, (!isSf1eRaceRules(rules) && rules.hasTail));
		}
	}

	/**
	 * Notes a change to an item that enables or disables it, restores it, or turns its book on or off. How
	 * the save found it comes from the first change to it, and each choice from the last change making one
	 *
	 * @param item The item before the change
	 * @param rulebooks The optional books on before the change
	 * @param choices What the change chose for the characters carrying it
	 */
	item(item: ItemState, rulebooks: readonly string[], choices: ItemChoices = {}): void
	{
		const earlier = this.items.get(item.id);

		this.items.set(item.id, {
			wasEnabled: (earlier?.wasEnabled ?? item.enabled),
			rulebookWasOn: (earlier?.rulebookWasOn ?? isRulebookOn(rulebooks, item.rulebook)),
			whenDisabled: (choices.whenDisabled ?? earlier?.whenDisabled),
			whenRulebookOff: (choices.whenRulebookOff ?? earlier?.whenRulebookOff)
		});
	}

	/**
	 * Notes where a change to regions or areas chose to send the characters in the areas it disables.
	 * Which areas the save disables is worked out once every change is made (SavePlaces.finish())
	 *
	 * @param moveTo Where they go, by area
	 */
	areas(moveTo: AreaEvacuations): void
	{
		for (const [areaId, choice] of Object.entries(moveTo))
		{
			this.areaChoices.set(areaId, choice);
		}
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
	 * those enabled again, unequips what the changes made equip differently, moves the characters out of
	 * disabled areas and group characters out of areas put below the lobby region, and brings groups
	 * larger than a lowered group size down to it, as the changes chose. The players of the characters
	 * whose equipment changed are told once the save commits
	 *
	 * @param context The save
	 * @param places The areas the save disables, and those it puts below the lobby region
	 */
	async finish(context: ChangeContext, places: PlacesOutcome): Promise<void>
	{
		// The draft's characters are the live version's: applying the draft asks what happens to them
		if (context.version.draft)
		{
			return;
		}

		const unequipped = [
			...await this.finishItems(context),
			...await this.finishEquipping(context),
			...await this.finishTails(context)
		];

		await this.finishAreas(context, places.disabled);
		await leaveLobbyAreas(context, places.enteredLobby);
		await this.finishGroupSize(context);

		if (unequipped.length > 0)
		{
			const universeId = context.universe.id;

			context.onCommit.push(() =>
			{
				characterItemChanges.publishChanged(universeId, uniqueOwners(unequipped));
			});
		}
	}

	/**
	 * Unequips the items the save changed where they equip, or whether they are shields, from every
	 * character, without asking: their players equip them again
	 *
	 * @param context The save
	 * @return The characters who had one equipped
	 */
	private async finishEquipping(context: ChangeContext): Promise<EquipmentOwner[]>
	{
		const { universe, transaction } = context;

		if (this.equipping.size === 0)
		{
			return([]);
		}

		// An item the save deleted isn't listed, and nobody carries it
		const { items } = await listEditorItems(context.version, universe.ruleset, { ids: [...this.equipping.keys()] }, transaction);
		const changed = items
			.filter((item) =>
			{
				const before = this.equipping.get(item.id);

				return((before !== undefined) && ((before.equips !== item.equips) || (before.shield !== isShield(universe.ruleset, item.types))));
			})
			.map((item) => item.id);

		return(unequipItemsInUniverse(universe.id, changed, transaction));
	}

	/**
	 * Unequips the tail slots of the characters of the races the save took the tail from
	 *
	 * @param context The save
	 * @return The characters who had something there
	 */
	private async finishTails(context: ChangeContext): Promise<EquipmentOwner[]>
	{
		const { universe, transaction } = context;
		const { tailLocation, wornSlots } = RULESET_EQUIPMENT[universe.ruleset];
		const hadTails = [...this.tails]
			.filter(([, hadTail]) => hadTail)
			.map(([raceId]) => raceId);

		if ((tailLocation === null) || (hadTails.length === 0))
		{
			return([]);
		}

		// A race the save deleted isn't listed, and no character is of it
		const races = new Map((await loadEditorRaces(context.version, universe.ruleset, transaction)).map((race) => [race.id, race]));
		const lostTails = hadTails.filter((raceId) =>
		{
			const rules = races.get(raceId)?.rules;

			return((rules !== undefined) && (isSf1eRaceRules(rules) || !rules.hasTail));
		});

		return(unequipSlotsOfRaces(universe.id, lostTails, wornSlots[tailLocation], transaction));
	}

	/**
	 * Hides the items the save disables with remove on the characters carrying them, and shows those it
	 * makes usable again. An item disabled with remove is taken whatever its book, and turning a book off
	 * with remove takes the items enabled in it, as the impact route asks about them. A taken item is
	 * unequipped too, and comes back unequipped
	 *
	 * @param context The save
	 * @return The characters who had a taken item equipped
	 */
	private async finishItems(context: ChangeContext): Promise<EquipmentOwner[]>
	{
		const { universe, transaction } = context;

		if (this.items.size === 0)
		{
			return([]);
		}

		// An item the save deleted isn't listed, and nobody carries it
		const { items } = await listEditorItems(context.version, universe.ruleset, { ids: [...this.items.keys()] }, transaction);
		const { rulebooks } = await loadRulebookSettings(context.version, universe.ruleset, transaction);
		const taken: number[] = [];
		const givenBack: number[] = [];

		for (const item of items)
		{
			const noted = this.items.get(item.id);

			if (noted === undefined)
			{
				continue;
			}

			const usable = isUsable(item, rulebooks);
			const disabledWithRemove = (!item.enabled && (noted.whenDisabled === 'remove'));
			const rulebookOffWithRemove = (noted.rulebookWasOn && !isRulebookOn(rulebooks, item.rulebook) && (noted.whenRulebookOff === 'remove'));

			if (noted.wasEnabled && !usable && (disabledWithRemove || rulebookOffWithRemove))
			{
				taken.push(item.id);
			}
			else if (!(noted.wasEnabled && noted.rulebookWasOn) && usable)
			{
				givenBack.push(item.id);
			}
		}

		await setCarriedItemsHidden(universe.id, taken, true, transaction);
		await setCarriedItemsHidden(universe.id, givenBack, false, transaction);

		return(unequipItemsInUniverse(universe.id, taken, transaction));
	}

	/**
	 * Moves the characters out of the areas the save disables. Lobby players in a lobby area go back to
	 * the lobby's starting square, unless it is in that area, when the lobby has no area to walk in
	 *
	 * @param context The save
	 * @param disabledAreaIds The areas the save found enabled and leaves disabled
	 */
	private async finishAreas(context: ChangeContext, disabledAreaIds: readonly string[]): Promise<void>
	{
		if (disabledAreaIds.length === 0)
		{
			return;
		}

		const { universe, transaction } = context;

		// An area the save deleted isn't listed
		const listed = await listAreas(context.version, transaction);
		const lobbyAreaIds = new Set(listed
			.filter((area) => area.resolved.lobby)
			.map((area) => area.id));
		const byId = areasById(areasInTree(listed));
		const loadedLinks = new Map<string, readonly LinkInto[]>();
		const evacuations: Evacuation[] = [];

		for (const areaId of disabledAreaIds)
		{
			if (areaId === universe.lobbyAreaId)
			{
				continue;
			}

			// Only the lobby walks a lobby area, and it sends its players back to its starting square
			if (lobbyAreaIds.has(areaId))
			{
				evacuations.push({
					areaId,
					destination: null,
					movesSaved: false
				});
				continue;
			}

			const moveTo = (this.areaChoices.get(areaId) ?? 'start');
			const destination = ((moveTo === 'parent') ? await parentPlace(transaction, byId, areaId, loadedLinks) : null);

			evacuations.push({
				areaId,
				destination,
				movesSaved: true
			});
		}

		await evacuateAreas(context, evacuations);
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
 * Sends the group characters in areas the save puts below the lobby region back to where their groups
 * start: only the lobby walks the lobby areas. A group starting in one of the areas starts in the
 * universe's starting area from then on, which is never a lobby area
 *
 * @param context The save
 * @param areaIds The areas
 */
async function leaveLobbyAreas(context: ChangeContext, areaIds: readonly string[]): Promise<void>
{
	await clearGroupStartingAreas(areaIds, context.transaction);
	await evacuateAreas(context, areaIds.map((areaId) => ({
		areaId,
		destination: null,
		movesSaved: true
	})));
}

/**
 * Sends the characters in areas to their destinations: those saved there by their group now, all in one
 * query and one update, and those playing there once the save commits, area by area in order
 *
 * @param context The save
 * @param evacuations The areas, in the order the rooms hear of them
 */
async function evacuateAreas(context: ChangeContext, evacuations: readonly Evacuation[]): Promise<void>
{
	const { universe, transaction } = context;
	const universeStart = ((universe.startingAreaId === null)
		? null
		: {
			areaId: universe.startingAreaId,
			column: universe.startingColumn,
			row: universe.startingRow
		});
	const destinations = new Map(evacuations.map(({ areaId, destination }) => [areaId, destination]));
	const savedAreaIds = evacuations
		.filter((evacuation) => evacuation.movesSaved)
		.map((evacuation) => evacuation.areaId);
	const members = await listMembersInAreas(savedAreaIds, transaction);

	await moveMembers(members.flatMap((member) => evacuatedPlaces([member], (destinations.get(member.areaId) ?? null), universeStart)), transaction);

	for (const { areaId, destination } of evacuations)
	{
		context.published.push({ kind: 'evacuated', areaId, destination });
	}
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

	const leaving = new Set(larger.flatMap((group) => membersOverSize(group.members, group.anchorCharacterId, size)));

	await removeGroupMembers([...leaving], transaction);

	for (const group of larger)
	{
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
