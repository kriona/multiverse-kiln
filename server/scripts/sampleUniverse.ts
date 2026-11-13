/**
 * The sample universe `npm run db:seed -w server` creates: a city lobby, and a planet whose kingdom
 * groups start in, with a market district in its capitol city, a shop in the market, and a cellar under
 * the shop (see the seed world in PLAN.md, phase 16)
 *
 * Regions group the areas and set what they inherit (see Regions in STRUCTURE-OVERVIEW.md). Areas are
 * drawn one character per cell, row by row, and centered on column 0, row 0:
 *
 *   .  the area's default tile        g  grass        f  forest     d  desert
 *   ^  mountains                      ~  water        =  wood floor
 *   #  stone wall    w  wood wall     h  hedge      (tiles of this universe's own)
 *   (space)  void
 *
 * Digits mark cells that links start from or arrive at. Each area says which tile its digits are
 */
import { IMPASSABLE_WALK_SECONDS, type PassageOfTime, type UniverseStage, type AreaLightLevel, type AreaLinkMode } from '@multiverse-kiln/shared';

/**
 * A region to create. Settings left out inherit
 */
export interface SampleRegion
{
	/**
	 * Name other regions and areas use for it
	 */
	key: string;

	name: string;

	/**
	 * Keys of the regions it is inside, each created before it; none for a top-level region
	 */
	parents: string[];

	indoors?: boolean;
	lightLevel?: AreaLightLevel;

	/**
	 * Key of its default tile
	 */
	defaultTile?: string;

	passageOfTime?: PassageOfTime;
}

/**
 * An area to create. Settings left out inherit
 */
export interface SampleArea
{
	/**
	 * Name other areas and links use for it
	 */
	key: string;

	name: string;

	/**
	 * Keys of the regions it is in
	 */
	regions: string[];

	/**
	 * Key of the area it sits inside, created before it
	 */
	parentArea?: string;

	indoors?: boolean;
	lightLevel?: AreaLightLevel;

	/**
	 * Key of its own default tile, which `.` stands for; left out, `.` is the tile it inherits
	 */
	defaultTile?: string;

	loopsEastWest?: boolean;

	/**
	 * Key of the tile each digit stands for
	 */
	markers: Record<string, string>;

	cells: string[];
}

/**
 * A link to create, from a marked cell of one area to a marked cell of another
 */
export interface SampleLink
{
	from: [area: string, marker: string];
	to: [area: string, marker: string];
	mode: AreaLinkMode;
}

/**
 * Fixed, so seeding again replaces this universe rather than adding another
 */
export const SAMPLE_UNIVERSE_ID = '6b0f8a52-3c1e-4d7a-9f20-5e8b1c4d2a07';

export const sampleUniverse = {
	name: 'Kilnhaven',
	shortDescription: 'A small world for trying out the engine.',
	longDescription: 'Walk around the city in the lobby, then set out across the kingdom, into the market district of its capitol, through the shop and down into its cellar.',
	stage: 'let_there_be_light' as UniverseStage,
	lobbyArea: 'lobby',
	startingArea: 'kingdom'
};

/**
 * The universe's own tiles, by the character that stands for each in the areas: stone walls (`#`), wood
 * walls (`w`) and hedges (`h`)
 */
export const sampleTiles = {
	'#': {
		key: 'stone_wall',
		name: 'Stone Wall',
		indoors: true,
		outdoors: true,
		color: 0x8a8a8a,
		graphic: 'stoneWall',
		visionCost: 100,
		walkSeconds: IMPASSABLE_WALK_SECONDS
	},
	'w': {
		key: 'wood_wall',
		name: 'Wood Wall',
		indoors: true,
		outdoors: true,
		color: 0x7a5230,
		graphic: 'woodWall',
		visionCost: 100,
		walkSeconds: IMPASSABLE_WALK_SECONDS
	},
	'h': {
		key: 'hedge',
		name: 'Hedge',
		indoors: false,
		outdoors: true,
		color: 0x3c7a32,
		graphic: 'hedge',
		visionCost: 100,
		walkSeconds: IMPASSABLE_WALK_SECONDS
	}
};

export const sampleRegions: SampleRegion[] = [
	{
		key: 'lobby',
		name: 'Lobby',
		parents: [],
		indoors: false
	},
	{
		key: 'planet',
		name: 'Planet',
		parents: [],
		indoors: false,
		lightLevel: 'lit',
		defaultTile: 'grass',
		passageOfTime: 'flows_normally'
	},
	{
		key: 'capitol-city',
		name: 'Capitol City',
		parents: ['planet']
	}
];

export const sampleAreas: SampleArea[] = [
	{
		key: 'lobby',
		name: 'Lobby',
		regions: ['lobby'],
		defaultTile: 'grass',
		markers: {},
		cells: [
			'^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^',
			'^^ff.....................fff..^^',
			'^f.......#########........ff...^',
			'^........#########.............^',
			'^........#########.....~~~.....^',
			'^...ff...#########....~~~~~....^',
			'^..fff...#########....~~~~~....^',
			'^...f..................~~~.....^',
			'^..............................^',
			'^.........dddd.hhhhhhh.........^',
			'^........ddddddh.....h.........^',
			'^.....ff..dddd.h.....h.ff......^',
			'^....ffff......hhh.hhhffff.....^',
			'^.....ff...~~..........ff......^',
			'^.........~~~~.................^',
			'^..........~~..............^^..^',
			'^^........................^^^^^^',
			'^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^'
		]
	},
	{
		key: 'kingdom',
		name: 'Kingdom',
		regions: ['planet'],
		indoors: false,
		loopsEastWest: true,
		markers: { 1: 'desert', 2: 'grass' },
		cells: [
			'^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^',
			'^^^^......fff..........^^^^.........^^^^',
			'..........ffff...........^^.............',
			'...ff......ff.................fff.......',
			'..ffff.........~~~~..........fffff......',
			'...ff.........~~~~~~..........fff.......',
			'...............~~~~...1.................',
			'......................2.................',
			'............dddd........................',
			'...........dddddd.......................',
			'............dddd........................',
			'......fff..................ff...........',
			'.....fffff........^^......ffff..........',
			'......fff........^^^^......ff...........',
			'..................^^....................',
			'........................................',
			'~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~',
			'~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~'
		]
	},
	{
		key: 'market-district',
		name: 'Market District',
		regions: ['capitol-city'],
		markers: { 1: 'wood_floor', 2: 'grass', 4: 'grass', 5: 'grass', 6: 'grass' },
		cells: [
			'########################',
			'#......................#',
			'#..wwwwwww....hhhhhh...#',
			'#..wwwwwww....h....h...#',
			'#..wwwwwww....h....h...#',
			'#..www1www....hhhhhh...#',
			'#.....2................#',
			'#......................#',
			'#..ff..........ff......#',
			'#.ffff........ffff.....#',
			'#..ff..........ff......#',
			'#......................#',
			'#..........4...........#',
			'##########56############'
		]
	},
	{
		key: 'shop',
		name: 'Shop',
		regions: [],
		parentArea: 'market-district',
		indoors: true,
		defaultTile: 'wood_floor',
		markers: { 3: 'wood_floor', 4: 'wood_floor', 5: 'wood_floor' },
		cells: [
			'wwwwwwwwwww',
			'w.........w',
			'w...3.....w',
			'w.........w',
			'w.........w',
			'w....5....w',
			'wwwww4wwwww'
		]
	},
	{
		key: 'cellar',
		name: 'Cellar',
		regions: [],
		parentArea: 'shop',
		lightLevel: 'dark',
		markers: { 6: 'wood_floor' },
		cells: [
			'wwwwwwwww',
			'w.......w',
			'w.6.....w',
			'w.......w',
			'wwwwwwwww'
		]
	}
];

export const sampleLinks: SampleLink[] = [
	// Into the market district from the desert cell, and back out through its gate, two cells wide
	{ from: ['kingdom', '1'], to: ['market-district', '4'], mode: 'automatic' },
	{ from: ['market-district', '5'], to: ['kingdom', '2'], mode: 'automatic' },
	{ from: ['market-district', '6'], to: ['kingdom', '2'], mode: 'automatic' },

	// The shop door, both ways
	{ from: ['market-district', '1'], to: ['shop', '5'], mode: 'automatic' },
	{ from: ['shop', '4'], to: ['market-district', '2'], mode: 'automatic' },

	// The trapdoor and the ladder back up, each arriving on the other
	{ from: ['shop', '3'], to: ['cellar', '6'], mode: 'manual' },
	{ from: ['cellar', '6'], to: ['shop', '3'], mode: 'manual' }
];
