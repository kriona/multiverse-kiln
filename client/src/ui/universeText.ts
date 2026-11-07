import type { Client } from '@colyseus/sdk';
import type { AreaPayload, AreaTile, Ruleset, UniverseTextPayload } from '@multiverse-kiln/shared';

import { getUniverseText } from '../network/serverConnection';
import { tileName } from './tileNames';

/**
 * Longest a window waits to load the text again after a room says it changed, in milliseconds. Every
 * window of the universe hears it at once, so each waits a random time up to this, and the server isn't
 * asked by all of them together
 */
const RELOAD_SPREAD_MS = 5000;

/**
 * The names a universe's rooms leave the game to look up by ID, in the player's language: a room sends
 * the same areas to every player, with their names in the universe's source language
 */
export class UniverseText
{
	private text: UniverseTextPayload = {
		areas: {},
		tiles: {}
	};

	/**
	 * Changes with every load, so text that arrives for an earlier one is ignored
	 */
	private version = 0;

	/**
	 * The load waiting to start after a room said the text changed, if there is one
	 */
	private reloadTimer: number | undefined;

	/**
	 * @param client Client for the server
	 * @param universeId The universe's ID
	 */
	constructor(private readonly client: Client, readonly universeId: string)
	{
	}

	/**
	 * Loads the text, as on entering the universe and when a room says it changed. Text that can't be
	 * loaded leaves the names as they were, in the universe's source language at first
	 */
	async load(): Promise<void>
	{
		const version = ++this.version;

		try
		{
			const text = await getUniverseText(this.client, this.universeId);

			if (version === this.version)
			{
				this.text = text;
			}
		}
		catch (error)
		{
			console.error('Could not load the universe\'s text; showing its names as its editors wrote them:', error);
		}
	}

	/**
	 * Loads the text again after a room says it changed, after waiting a random time up to
	 * RELOAD_SPREAD_MS. Saying so again while it waits loads it once
	 */
	reloadSoon(): void
	{
		if (this.reloadTimer !== undefined)
		{
			return;
		}

		this.reloadTimer = window.setTimeout(() =>
		{
			this.reloadTimer = undefined;
			void this.load();
		}, (Math.random() * RELOAD_SPREAD_MS));
	}

	/**
	 * An area's name in the player's language
	 *
	 * @param area The area as a room sent it
	 * @return The name
	 */
	areaName(area: Pick<AreaPayload, 'areaId' | 'name'>): string
	{
		return((this.text.areas[area.areaId] ?? area.name));
	}

	/**
	 * A tile's name in the player's language: the universe's name for it, or a default tile's name
	 *
	 * @param tile The tile as a room sent it
	 * @param ruleset The universe's ruleset, which names its default tiles
	 * @return The name
	 */
	tileName(tile: AreaTile, ruleset: Ruleset): string
	{
		return((this.text.tiles[String(tile.id)] ?? tileName(tile, ruleset)));
	}
}
