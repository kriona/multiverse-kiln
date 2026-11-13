/**
 * The Areas tab's regions and areas as the editor shows them (see Regions in STRUCTURE-OVERVIEW.md): the
 * world it works their settings out from, staged changes included, and how a worked-out setting and a
 * problem read
 */
import { AREA_LIGHT_LEVEL_NAMES, defineMessages, FAERIE_MORNING_NAMES, PASSAGE_OF_TIME_NAMES, placeKey, type AreaLightLevel, type EditorTile, type FaerieMorning, type InheritedSetting, type InheritedValues, type MessageDescriptor, type PassageOfTime, type PlaceProblem, type PlaceRef, type Ruleset, type SettingResolution } from '@multiverse-kiln/shared';

import { formatList, t } from '../../localization';
import { tileName } from '../tileNames';

/**
 * Names a region or area by its key (placeKey()), for describing them
 */
export type PlaceNames = (place: PlaceRef) => string;

/**
 * Each value of fog of war: the region and area editors' choices for it, what a setting set to inherit
 * shows it inherits, and the value on the Audit tab
 */
export const FOG_OF_WAR_NAMES: Record<'on' | 'off', MessageDescriptor> = defineMessages({
	on: {
		id: 'editor.place.fogOfWarOn',
		defaultMessage: 'On',
		description: 'Fog of war turned on for a region or area: players see only what is in their sight, and what they haven\'t seen is hidden. A choice in the region and area editors\' Fog of war field, and its value in what a setting inherits and on the editor\'s Audit tab'
	},
	off: {
		id: 'editor.place.fogOfWarOff',
		defaultMessage: 'Off',
		description: 'Fog of war turned off for a region or area: players see everything near them and everyone in the area, at any time of day. A choice in the region and area editors\' Fog of war field, and its value in what a setting inherits and on the editor\'s Audit tab'
	}
});

/**
 * How the value of an inherited setting reads
 *
 * @param setting The setting
 * @param value Its value
 * @param tiles The tiles the universe can use, for naming a default tile
 * @param ruleset The universe's ruleset
 * @return The value
 */
export function describeValue<Setting extends InheritedSetting>(setting: Setting, value: InheritedValues[Setting], tiles: readonly EditorTile[], ruleset: Ruleset): string
{
	switch (setting)
	{
		case 'indoors':
			return((value
				? t({
					id: 'form.indoors',
					defaultMessage: 'Indoors',
					description: 'Choice for an area or tile that is indoors; also names the setting in the list of what a save changed, on the editor\'s Audit tab'
				})
				: t({
					id: 'form.outdoors',
					defaultMessage: 'Outdoors',
					description: 'Choice for an area or tile that is outdoors; also names the setting in the list of what a save changed, on the editor\'s Audit tab'
				})));

		case 'lightLevel':
			return(t(AREA_LIGHT_LEVEL_NAMES[value as AreaLightLevel]));

		case 'defaultTileId':
		{
			const tileId = value as number;
			const tile = tiles.find((each) => (each.id === tileId));

			return(((tile === undefined) ? String(tileId) : tileName(tile, ruleset)));
		}

		case 'fogOfWar':
			return(t(FOG_OF_WAR_NAMES[value ? 'on' : 'off']));

		default:
		{
			const passage = value as InheritedValues['passageOfTime'];

			return(describePassage(passage.passageOfTime, passage.faerieMorning));
		}
	}
}

/**
 * How a passage of time reads, with where morning is in faerie time
 *
 * @param passage The passage of time
 * @param morning Where morning is, for faerie
 * @return The description
 */
export function describePassage(passage: PassageOfTime, morning: FaerieMorning | null): string
{
	const name = t(PASSAGE_OF_TIME_NAMES[passage]);

	if ((passage !== 'faerie') || (morning === null))
	{
		return(name);
	}

	return(t({
		id: 'editor.place.faerieTime',
		defaultMessage: '{time}, morning: {morning}',
		description: 'A passage of time in the region and area editors, when it is faerie time: {time} is the passage of time (faerie) and {morning} the side of the area that has morning, such as north'
	}, {
		time: name,
		morning: t(FAERIE_MORNING_NAMES[morning])
	}));
}

/**
 * What a setting set to inherit shows, as the choice for inherit: the value it inherits and the places
 * giving it, or what keeps it from inheriting one
 *
 * @param setting The setting
 * @param resolution How it was worked out with the place's own value left out
 * @param names Names the places
 * @param tiles The tiles the universe can use
 * @param ruleset The universe's ruleset
 * @param topLevel Whether the place is a top-level region, with nothing above it to inherit from
 * @return The choice's label
 */
export function inheritLabel<Setting extends InheritedSetting>(setting: Setting, resolution: SettingResolution<InheritedValues[Setting]>, names: PlaceNames, tiles: readonly EditorTile[], ruleset: Ruleset, topLevel: boolean): string
{
	if (topLevel)
	{
		return(t({
			id: 'editor.place.notSet',
			defaultMessage: 'Not set',
			description: 'The choice for a setting a top-level region leaves to the regions and areas below it, which have nothing above them to inherit from, in the region editor'
		}));
	}

	switch (resolution.kind)
	{
		case 'inherited':
			return(t({
				id: 'editor.place.inherit',
				defaultMessage: 'Inherit ({value}, from {places})',
				description: 'The choice for a region\'s or area\'s setting that takes its value from the regions and areas above it, showing what it takes: {value} is the value, such as Always noon, and {places} the regions or areas it comes from, e.g. "Inherit (Always noon, from Capitol City)"'
			}, {
				value: describeValue(setting, resolution.value, tiles, ruleset),
				places: formatList(resolution.from.map(names), 'conjunction')
			}));

		case 'conflict':
			return(t({
				id: 'editor.place.inheritConflict',
				defaultMessage: 'Inherit (different in {places})',
				description: 'The choice for a region\'s or area\'s setting that takes its value from above, when the regions or areas at the nearest level above give different values; {places} names them'
			}, {
				places: formatList(resolution.values.map(({ place }) => names(place)), 'conjunction')
			}));

		case 'missing':
			return(t({
				id: 'editor.place.inheritMissing',
				defaultMessage: 'Inherit (nothing above sets it)',
				description: 'The choice for a region\'s or area\'s setting that takes its value from above, when no region or area above it sets one'
			}));

		default:
			return(t({
				id: 'editor.place.inheritPlain',
				defaultMessage: 'Inherit',
				description: 'The choice for a region\'s or area\'s setting that takes its value from the regions and areas above it, when there is nothing to show of what it takes'
			}));
	}
}

/**
 * The name of a setting a problem names, in a sentence
 *
 * @param setting The setting
 * @return Its name
 */
function settingInSentence(setting: InheritedSetting): string
{
	return(t({
		id: 'editor.place.settingName',
		defaultMessage: '{setting, select, indoors {indoors or outdoors} lightLevel {light level} defaultTileId {default tile} fogOfWar {fog of war} other {passage of time}}',
		description: 'A setting of a region or area, named in the middle of a sentence about a problem with it, e.g. "nothing above it sets a default tile"; {setting} is which one'
	}, {
		setting
	}));
}

/**
 * What a problem with regions and areas says, naming the places in it
 *
 * @param problem The problem
 * @param names Names the places
 * @param tiles The tiles the universe can use
 * @param ruleset The universe's ruleset
 * @return The message
 */
export function describeProblem(problem: PlaceProblem, names: PlaceNames, tiles: readonly EditorTile[], ruleset: Ruleset): string
{
	switch (problem.kind)
	{
		case 'conflict':
		{
			const values = problem.values.map(({ place, value }) => t({
				id: 'editor.place.valueIn',
				defaultMessage: '{value} in {place}',
				description: 'One of the different values regions or areas give a setting, in a problem the editor shows, e.g. "Always noon in Capitol City"'
			}, {
				value: describeValue(problem.setting, value, tiles, ruleset),
				place: names(place)
			}));

			return(t({
				id: 'editor.place.conflict',
				defaultMessage: '{area}: {setting} is {values}',
				description: 'A problem keeping a save, shown by the region and area editors: the regions or areas an area inherits a setting from give it different values; {area} is the area, {setting} the setting, and {values} the values with where each comes from, joined, e.g. "Market District: passage of time is Always noon in Capitol City but Always dusk in Bea\'s areas"'
			}, {
				area: names({ kind: 'area', id: problem.areaId }),
				setting: settingInSentence(problem.setting),
				values: formatList(values, 'conjunction')
			}));
		}

		case 'missing':
			return(t({
				id: 'editor.place.missing',
				defaultMessage: '{area}: nothing above it sets {setting, select, indoors {whether it is indoors or outdoors} lightLevel {a light level} defaultTileId {a default tile} fogOfWar {whether it has fog of war} other {a passage of time}}',
				description: 'A problem keeping a save, shown by the region and area editors: no region or area above an area sets one of its settings, and it doesn\'t set it itself; {area} is the area and {setting} which setting'
			}, {
				area: names({ kind: 'area', id: problem.areaId }),
				setting: problem.setting
			}));

		case 'faerieLoops':
			return(t({
				id: 'editor.place.faerieLoops',
				defaultMessage: '{area}: its passage of time is faerie, so it can\'t loop',
				description: 'A problem keeping a save, shown by the region and area editors: an area that loops takes faerie time from above it; {area} is the area'
			}, {
				area: names({ kind: 'area', id: problem.areaId })
			}));

		case 'noRegion':
			return(t({
				id: 'editor.place.noRegion',
				defaultMessage: '{area} isn\'t in any region',
				description: 'A problem keeping a save, shown by the region and area editors: every area must be in a region, directly or through the area it is inside; {area} is the area'
			}, {
				area: names({ kind: 'area', id: problem.areaId })
			}));

		case 'insideItself':
			return(t({
				id: 'editor.place.insideItself',
				defaultMessage: '{place} is inside itself',
				description: 'A problem keeping a save, shown by the region and area editors: following a region\'s or area\'s parents up leads back to it; {place} is its name'
			}, {
				place: names(problem.place)
			}));

		default:
			return(t({
				id: 'editor.place.tooDeep',
				defaultMessage: '{place} is nested more than ten levels deep',
				description: 'A problem keeping a save, shown by the region and area editors: regions and areas nest at most ten levels deep along their longest path; {place} is the region or area past the tenth level'
			}, {
				place: names(problem.place)
			}));
	}
}

/**
 * The places a problem is about, which a region's or area's editor shows it for when it is one of them or
 * below one
 *
 * @param problem The problem
 * @return The places
 */
export function problemPlaces(problem: PlaceProblem): PlaceRef[]
{
	switch (problem.kind)
	{
		case 'conflict':
			return([{ kind: 'area', id: problem.areaId }, ...problem.values.map(({ place }) => place)]);
		case 'insideItself':
		case 'tooDeep':
			return([problem.place]);
		default:
			return([{ kind: 'area', id: problem.areaId }]);
	}
}

/**
 * Names places from a list of regions and areas
 *
 * @param places The regions and areas, with their names
 * @return Names a place, or its ID while it isn't listed
 */
export function placeNamer(places: Iterable<{ kind: PlaceRef['kind']; id: string; name: string }>): PlaceNames
{
	const names = new Map([...places].map((place) => [placeKey(place), place.name]));

	return((place) => (names.get(placeKey(place)) ?? place.id));
}
