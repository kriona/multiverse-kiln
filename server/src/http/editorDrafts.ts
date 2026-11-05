/**
 * Starting, applying and discarding a universe's draft, as changes in a save of the world editor (see
 * Universe versions in STRUCTURE-OVERVIEW.md). They come after the save's other changes, so starting a
 * draft copies them and applying one includes them
 */
import { universeSlug, type DraftApplyChoices } from '@multiverse-kiln/shared';

import { listAreas } from '../db/areaRepo.js';
import { loadBarredOptions, sameBarred } from '../db/barredOptions.js';
import { hasCharactersOfClass, hasCharactersOfRace, hasCharactersOfTheme, isCarriedItem } from '../db/characterRepo.js';
import { findDefaultDifficultyLevel } from '../db/difficultyRepo.js';
import { moveGroupsToDifficultyLevel } from '../db/groupRepo.js';
import { loadEditorItems } from '../db/itemRepo.js';
import { applyDraft, deleteRemovedRows, disableLiveRows, discardDraft, setLiveKeepPlaying, startDraft, type RemovedRows } from '../db/universeDraftRepo.js';
import { findEditableUniverse, hasDraft, updateUniverseSettings } from '../db/universeRepo.js';
import { areas, classes, items, races, themes } from '../db/schema.js';
import { liveVersion } from '../db/universeVersions.js';
import { universeAccessChanges } from '../players/universeAccess.js';
import { refuse, type ChangeContext } from './editorChangeContext.js';
import { SaveDisablings } from './editorDisablings.js';
import { errorMessages } from './errors.js';

/**
 * Starts the universe's draft as a copy of its live version, as the save's other changes left it
 *
 * @param context The save
 */
export async function startDraftChange(context: ChangeContext): Promise<void>
{
	const { universe, transaction } = context;

	if (await hasDraft(universe.id, transaction))
	{
		refuse(409, {
			id: 'error.draftExists',
			defaultMessage: 'The universe already has a draft. Apply it or discard it before starting another.',
			description: 'Why a draft of the universe couldn\'t be started (see Universe versions): it has one already, perhaps started by another editor'
		});
	}

	await startDraft(universe.id, transaction);
}

/**
 * Discards the universe's draft; the images of the tilesets only it used are removed once the save commits
 *
 * @param context The save
 */
export async function discardDraftChange(context: ChangeContext): Promise<void>
{
	const { universe, transaction } = context;

	if (!await hasDraft(universe.id, transaction))
	{
		refuse(404, errorMessages.noSuchDraft);
	}

	context.deletedImages.push(...await discardDraft(universe.id, transaction));
}

/**
 * Applies the universe's draft to its live version for good, then does to the players using what it
 * disables or deletes what the choices say, as a save to the live version disabling them would. What it
 * deletes that characters still use is kept, disabled. Once the save commits, the rooms load the new world
 *
 * @param context The save
 * @param choices What happens to the players using what the draft disables or deletes
 */
export async function applyDraftChange(context: ChangeContext, choices: DraftApplyChoices): Promise<void>
{
	const { universe, transaction } = context;
	const universeId = universe.id;
	const live = liveVersion(universeId);

	if (!await hasDraft(universeId, transaction))
	{
		refuse(404, errorMessages.noSuchDraft);
	}

	const before = await findEditableUniverse(live, transaction);

	if (!before)
	{
		refuse(404, errorMessages.noSuchUniverse);
	}

	const barredBefore = await loadBarredOptions(universeId, transaction);
	const disablings = new SaveDisablings();
	const areasBefore = await listAreas(live, transaction);

	for (const item of await loadEditorItems(live, universe.ruleset, transaction))
	{
		disablings.item(item.id, item.enabled, choices.items[String(item.id)]);
	}

	for (const area of areasBefore)
	{
		disablings.area(area.id, area.enabled, choices.areas[area.id]);
	}

	const removed = await applyDraft(universeId, transaction);
	const applied = await findEditableUniverse(live, transaction);

	if (!applied)
	{
		refuse(404, errorMessages.noSuchUniverse);
	}

	// The draft's name was checked when it was saved, but another universe may have taken one like it
	// since; renaming checks again, refusing the whole save then, and gives the universe its new address
	if (applied.name !== before.name)
	{
		await updateUniverseSettings(live, { name: applied.name }, transaction);
	}

	const after = { ...applied, slug: universeSlug(applied.name) };

	disablings.groupSizeChange(before.groupSize, after.groupSize, (choices.largerGroups ?? 'keep'));

	// What the draft deleted counts as disabled, so it is treated as disabled until it is deleted
	const kept = await keptRows(removed, transaction);

	await disableLiveRows(universeId, areas, removed.areaIds, transaction);
	await disableLiveRows(universeId, races, kept.raceIds, transaction);
	await disableLiveRows(universeId, classes, kept.classIds, transaction);
	await disableLiveRows(universeId, themes, kept.themeIds, transaction);
	await disableLiveRows(universeId, items, kept.itemIds, transaction);
	await setLiveKeepPlaying(universeId, races, keepPlayingOf(choices.races), transaction);
	await setLiveKeepPlaying(universeId, classes, keepPlayingOf(choices.classes), transaction);

	// The draft's changes were to rows the rooms don't have; once applied, the rooms load the live version again
	context.published.length = 0;
	context.draftApplied = true;

	const liveContext: ChangeContext = {
		...context,
		universe: after,
		version: live
	};

	await disablings.finish(liveContext);

	const defaultLevel = await findDefaultDifficultyLevel(live, transaction);

	if (defaultLevel)
	{
		for (const levelId of removed.difficultyLevelIds)
		{
			await moveGroupsToDifficultyLevel(levelId, defaultLevel.id, transaction);
		}
	}

	context.deletedImages.push(...await deleteRemovedRows(universeId, {
		...removed,
		raceIds: removed.raceIds.filter((id) => !kept.raceIds.includes(id)),
		classIds: removed.classIds.filter((id) => !kept.classIds.includes(id)),
		themeIds: removed.themeIds.filter((id) => !kept.themeIds.includes(id)),
		itemIds: removed.itemIds.filter((id) => !kept.itemIds.includes(id))
	}, transaction));

	const barred = await loadBarredOptions(universeId, transaction);

	if (!sameBarred(barredBefore, barred))
	{
		context.onCommit.push(() =>
		{
			universeAccessChanges.publishBarred({
				universeId,
				barred
			});
		});
	}

	for (const areaId of removed.areaIds)
	{
		context.published.push({ kind: 'deleted', areaId });
	}

	for (const area of await listAreas(live, transaction))
	{
		context.published.push({ kind: 'area', areaId: area.id });
	}

	context.published.push(
		{ kind: 'tiles', universeId },
		{ kind: 'time', universeId },
		{ kind: 'lobby', universeId },
		{ kind: 'text', universeId }
	);
	context.universe = after;
}

/**
 * Of the live rows a draft applied didn't have, the races, classes, themes and items characters still
 * use, which are kept disabled rather than deleted
 *
 * @param removed The rows the draft didn't have
 * @param transaction The save's transaction
 * @return The rows to keep
 */
async function keptRows(removed: RemovedRows, transaction: ChangeContext['transaction']): Promise<Pick<RemovedRows, 'raceIds' | 'classIds' | 'themeIds' | 'itemIds'>>
{
	const kept = {
		raceIds: [] as number[],
		classIds: [] as number[],
		themeIds: [] as number[],
		itemIds: [] as number[]
	};

	// One after another, since a transaction runs one query at a time
	for (const id of removed.raceIds)
	{
		if (await hasCharactersOfRace(id, transaction))
		{
			kept.raceIds.push(id);
		}
	}

	for (const id of removed.classIds)
	{
		if (await hasCharactersOfClass(id, transaction))
		{
			kept.classIds.push(id);
		}
	}

	for (const id of removed.themeIds)
	{
		if (await hasCharactersOfTheme(id, transaction))
		{
			kept.themeIds.push(id);
		}
	}

	for (const id of removed.itemIds)
	{
		if (await isCarriedItem(id, transaction))
		{
			kept.itemIds.push(id);
		}
	}

	return(kept);
}

/**
 * The keep-playing choices of an applyDraft change, by race or class ID
 *
 * @param choices The choices, by ID written as text
 * @return The choices, by ID
 */
function keepPlayingOf(choices: Readonly<Record<string, boolean>>): Map<number, boolean>
{
	return(new Map(Object.entries(choices).map(([id, keep]) => [Number(id), keep])));
}
