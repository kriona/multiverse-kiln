import { AREA_LIGHT_LEVEL_NAMES, AREA_LIGHT_LEVELS, canPaintTile, FAERIE_MORNING_NAMES, FAERIE_MORNINGS, PASSAGE_OF_TIME_NAMES, PASSAGES_OF_TIME, resolvedValue, type AreaLightLevel, type EditorTile, type FaerieMorning, type InheritedSetting, type InheritedValues, type PassageOfTime, type PlaceResolution, type PlaceSettings, type Ruleset, type SettingResolution } from '@multiverse-kiln/shared';

import { formatList, t } from '../../localization';
import { getElement, namedOptions, setOptions, showMessage } from '../dom';
import { tileName } from '../tileNames';
import { FOG_OF_WAR_NAMES, inheritLabel, type PlaceNames } from './places';

/**
 * What the fields show beside a region's or area's own settings: what each inherits, the tiles it can
 * take as its default tile, and whether it is disabled from above
 */
export interface InheritedView
{
	/**
	 * Each setting worked out with the place's own settings left out
	 */
	inherited: PlaceResolution;

	/**
	 * Each setting worked out with them
	 */
	resolved: PlaceResolution;

	names: PlaceNames;

	/**
	 * Every tile the universe can use, with the Tilesets tab's changes
	 */
	tiles: readonly EditorTile[];

	/**
	 * The tiles the Tilesets tab will delete
	 */
	deletedTiles: ReadonlySet<number>;

	ruleset: Ruleset;

	/**
	 * Whether the place is a top-level region, with nothing above it to inherit from
	 */
	topLevel: boolean;

	/**
	 * Whether it is a region, whose kind may be left unknown, rather than an area
	 */
	region: boolean;
}

/**
 * The settings regions and areas share, in the region or area editor: enabled, indoors or outdoors,
 * light level, default tile, passage of time with where morning is, and fog of war, each with a choice
 * to inherit that shows what it inherits and from where
 */
export class PlaceFields
{
	private readonly enabled: HTMLSelectElement;
	private readonly disabledBy: HTMLElement;
	private readonly kindInherit: HTMLInputElement;
	private readonly kindInheritLabel: HTMLElement;
	private readonly outdoors: HTMLInputElement;
	private readonly indoors: HTMLInputElement;
	private readonly lightField: HTMLElement;
	private readonly lightLevel: HTMLSelectElement;
	private readonly defaultTile: HTMLSelectElement;
	private readonly time: HTMLSelectElement;
	private readonly faerieField: HTMLElement;
	private readonly faerie: HTMLSelectElement;
	private readonly fogOfWar: HTMLSelectElement;

	/**
	 * Whether the passage of time is hidden, since the Lobby tab sets it (see hideTime())
	 */
	private timeHidden = false;

	/**
	 * What was last shown of what the place inherits, to label the inherit choices with
	 */
	private view: InheritedView | undefined;

	/**
	 * @param prefix What the fields' IDs start with: area or region
	 * @param onChange Called as a setting changes, so the editor can show the problems it makes
	 */
	constructor(prefix: string, private readonly onChange: () => void)
	{
		this.enabled = getElement(`${prefix}-enabled`, HTMLSelectElement);
		this.disabledBy = getElement(`${prefix}-disabled-by`, HTMLElement);
		this.kindInherit = getElement(`${prefix}-kind-inherit`, HTMLInputElement);
		this.kindInheritLabel = getElement(`${prefix}-kind-inherit-label`, HTMLElement);
		this.outdoors = getElement(`${prefix}-outdoors`, HTMLInputElement);
		this.indoors = getElement(`${prefix}-indoors`, HTMLInputElement);
		this.lightField = getElement(`${prefix}-light-field`, HTMLElement);
		this.lightLevel = getElement(`${prefix}-light`, HTMLSelectElement);
		this.defaultTile = getElement(`${prefix}-default-tile`, HTMLSelectElement);
		this.time = getElement(`${prefix}-time`, HTMLSelectElement);
		this.faerieField = getElement(`${prefix}-faerie-field`, HTMLElement);
		this.faerie = getElement(`${prefix}-faerie`, HTMLSelectElement);
		this.fogOfWar = getElement(`${prefix}-fog`, HTMLSelectElement);

		setOptions(this.faerie, namedOptions(FAERIE_MORNINGS, FAERIE_MORNING_NAMES));

		for (const field of [this.enabled, this.kindInherit, this.outdoors, this.indoors, this.lightLevel, this.defaultTile, this.time, this.faerie, this.fogOfWar])
		{
			field.addEventListener('change', () =>
			{
				this.updateFields();
				this.onChange();
			});
		}
	}

	/**
	 * Fills the fields with a place's own settings, with the choices the view gives them
	 *
	 * @param settings The settings
	 * @param view What the place inherits
	 */
	fill(settings: PlaceSettings, view: InheritedView): void
	{
		this.view = view;
		this.fillChoices(settings);
		this.enabled.value = ((settings.enabled === null) ? '' : (settings.enabled ? 'on' : 'off'));
		this.kindInherit.checked = (settings.indoors === null);
		this.outdoors.checked = (settings.indoors === false);
		this.indoors.checked = (settings.indoors === true);
		this.lightLevel.value = (settings.lightLevel ?? '');
		this.time.value = (settings.passageOfTime ?? '');
		this.faerie.value = (settings.faerieMorning ?? FAERIE_MORNINGS[0]);
		this.fogOfWar.value = fogOfWarValue(settings.fogOfWar);
		this.fillDefaultTiles(settings.defaultTileId);
		this.updateFields();
	}

	/**
	 * Shows what the place inherits again, after a change to it or to what is above it, keeping the
	 * settings the fields show
	 *
	 * @param view What the place inherits
	 */
	showInherited(view: InheritedView): void
	{
		const settings = this.read();

		this.view = view;
		this.fillChoices(settings);
		this.fillDefaultTiles(settings.defaultTileId);
		this.updateFields();
	}

	/**
	 * The place's own settings as the fields show them
	 *
	 * @return The settings
	 */
	read(): PlaceSettings
	{
		const passageOfTime = ((this.time.value === '') ? null : this.time.value as PassageOfTime);

		return({
			enabled: ((this.enabled.value === '') ? null : (this.enabled.value === 'on')),
			indoors: (this.kindInherit.checked ? null : this.indoors.checked),
			lightLevel: ((this.lightLevel.value === '') ? null : this.lightLevel.value as AreaLightLevel),
			defaultTileId: ((this.defaultTile.value === '') ? null : Number(this.defaultTile.value)),
			passageOfTime,
			faerieMorning: ((passageOfTime === 'faerie') ? this.faerie.value as FaerieMorning : null),
			fogOfWar: ((this.fogOfWar.value === '') ? null : (this.fogOfWar.value === 'on'))
		});
	}

	/**
	 * Whether the place is indoors as the fields show it: its own choice, or what it inherits
	 *
	 * @return True or false, or undefined when it can't be told
	 */
	kind(): boolean | undefined
	{
		if (!this.kindInherit.checked)
		{
			return(this.indoors.checked);
		}

		return(((this.view === undefined) ? undefined : resolvedValue(this.view.inherited.indoors)));
	}

	/**
	 * Labels the inherit choices with what the place inherits
	 *
	 * @param settings The settings to keep selected
	 */
	private fillChoices(settings: PlaceSettings): void
	{
		const view = this.view;

		if (!view)
		{
			return;
		}

		const label = <Setting extends InheritedSetting>(setting: Setting): string => inheritLabel(setting, view.inherited[setting] as SettingResolution<InheritedValues[Setting]>, view.names, view.tiles, view.ruleset, view.topLevel);
		const on = t({
			id: 'editor.place.on',
			defaultMessage: 'On',
			description: 'Choice for a region or area that is enabled. It sets nothing: the region or area is still disabled while something above it is'
		});
		const off = t({
			id: 'editor.place.off',
			defaultMessage: 'Off',
			description: 'Choice for a region or area that is disabled, disabling everything below it'
		});

		// Enabled works as a gate, so inheriting it shows nothing but whether anything above is off
		setOptions(this.enabled, [
			{ value: '', label: inheritLabel('indoors', { kind: 'ignored' }, view.names, view.tiles, view.ruleset, view.topLevel) },
			{ value: 'on', label: on },
			{ value: 'off', label: off }
		]);
		this.enabled.value = ((settings.enabled === null) ? '' : (settings.enabled ? 'on' : 'off'));
		this.kindInheritLabel.textContent = label('indoors');
		setOptions(this.lightLevel, [{ value: '', label: label('lightLevel') }, ...namedOptions(AREA_LIGHT_LEVELS, AREA_LIGHT_LEVEL_NAMES)]);
		this.lightLevel.value = (settings.lightLevel ?? '');
		setOptions(this.time, [{ value: '', label: label('passageOfTime') }, ...namedOptions(PASSAGES_OF_TIME, PASSAGE_OF_TIME_NAMES)]);
		this.time.value = (settings.passageOfTime ?? '');
		setOptions(this.fogOfWar, [{ value: '', label: label('fogOfWar') }, ...namedOptions(['on', 'off'] as const, FOG_OF_WAR_NAMES)]);
		this.fogOfWar.value = fogOfWarValue(settings.fogOfWar);

		const disabledBy = view.inherited.enabled.disabledBy;

		showMessage(this.disabledBy, ((disabledBy.length === 0)
			? undefined
			: t({
				id: 'editor.place.disabledBy',
				defaultMessage: 'Disabled while {places} {count, plural, one {is} other {are}} disabled, above it.',
				description: 'Shown under the Enabled choice of a region or area while something above it is disabled, which disables it too; {places} names the disabled regions and areas, and {count} is how many'
			}, {
				places: formatList(disabledBy.map(view.names), 'conjunction'),
				count: disabledBy.length
			})));
	}

	/**
	 * Lists the tiles the place can take as its default tile: the enabled tiles for its kind, leaving out
	 * tiles the Tilesets tab will delete, every one while its kind can't be told, and the selected tile
	 * even when it is disabled or for the other kind
	 *
	 * @param selectedTileId The tile to select, or null for inherit
	 */
	private fillDefaultTiles(selectedTileId: number | null): void
	{
		const view = this.view;

		if (!view)
		{
			return;
		}

		const kind = this.kind();

		setOptions(this.defaultTile, [
			{
				value: '',
				label: inheritLabel('defaultTileId', view.inherited.defaultTileId, view.names, view.tiles, view.ruleset, view.topLevel)
			},
			...view.tiles
				.filter((tile) => ((tile.id === selectedTileId) || ((kind === undefined) ? (tile.enabled && !view.deletedTiles.has(tile.id)) : (canPaintTile(tile, kind) && !view.deletedTiles.has(tile.id)))))
				.map((tile) => ({
					value: String(tile.id),
					label: tileName(tile, view.ruleset)
				}))
		]);
		this.defaultTile.value = ((selectedTileId === null) ? '' : String(selectedTileId));
	}

	/**
	 * Shows the light level unless the place is outdoors, and where morning is for faerie time
	 */
	private updateFields(): void
	{
		const kind = this.kind();
		const selected = this.read().defaultTileId;

		this.lightField.hidden = (kind === false);
		this.faerieField.hidden = (this.timeHidden || (this.time.value !== 'faerie'));
		this.fillDefaultTiles(selected);
	}

	/**
	 * Hides the passage of time, as the lobby areas and the regions at and below the lobby region do,
	 * whose time the Lobby tab sets
	 *
	 * @param hidden Whether to hide it
	 */
	hideTime(hidden: boolean): void
	{
		const field = this.time.closest('label');

		this.timeHidden = hidden;

		if (field)
		{
			field.hidden = hidden;
		}

		this.faerieField.hidden = (hidden || (this.time.value !== 'faerie'));
	}

	/**
	 * Whether the passage of time chosen is faerie, own or inherited
	 *
	 * @return True when it is
	 */
	isFaerie(): boolean
	{
		if (this.time.value !== '')
		{
			return(this.time.value === 'faerie');
		}

		return((this.view !== undefined) && (resolvedValue(this.view.inherited.passageOfTime)?.passageOfTime === 'faerie'));
	}
}

/**
 * The fog of war select's value for a place's own setting
 *
 * @param fogOfWar The setting, null for inherit
 * @return '' for inherit, 'on' or 'off'
 */
function fogOfWarValue(fogOfWar: boolean | null): string
{
	return(((fogOfWar === null) ? '' : (fogOfWar ? 'on' : 'off')));
}
