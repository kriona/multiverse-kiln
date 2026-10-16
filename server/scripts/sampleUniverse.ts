/**
 * The sample universe `npm run db:seed -w server` creates: a small town lobby with a cottage and a
 * cellar to walk into, and a crossroads for groups to start in
 *
 * Maps are drawn one character per cell, row by row, and centered on column 0, row 0:
 *
 *   .  the zone's default tile        g  grass        f  forest     d  desert
 *   ^  mountains                      ~  water        =  wood floor
 *   #  stone wall (a tile of this universe's own)
 *   (space)  void
 *
 * Digits mark cells that links start from or arrive at. Each zone says which tile its digits are
 */
import type { PassageOfTime, UniverseStage, ZoneLinkMode } from '@multiverse-kiln/shared';

/**
 * A zone to create
 */
export interface SampleZone
{
	/**
	 * Name other zones and links use for it
	 */
	key: string;

	name: string;

	/**
	 * Key of the zone it sits inside
	 */
	parent?: string;

	indoors: boolean;

	/**
	 * Key of the tile `.` stands for
	 */
	defaultTile: string;

	loopsEastWest?: boolean;

	/**
	 * Key of the tile each digit stands for
	 */
	markers: Record<string, string>;

	map: string[];
}

/**
 * A link to create, from a marked cell of one zone to a marked cell of another
 */
export interface SampleLink
{
	from: [zone: string, marker: string];
	to: [zone: string, marker: string];
	mode: ZoneLinkMode;
}

/**
 * Fixed, so seeding again replaces this universe rather than adding another
 */
export const SAMPLE_UNIVERSE_ID = '6b0f8a52-3c1e-4d7a-9f20-5e8b1c4d2a07';

export const sampleUniverse = {
	name: 'Kilnhaven',
	shortDescription: 'A small town for trying out the engine.',
	longDescription: 'Walk around the town square, step into the cottage, and climb down into its cellar.',
	stage: 'let_there_be_light' as UniverseStage,
	passageOfTime: 'flows_normally' as PassageOfTime,
	lobbyZone: 'town-square',
	startingZone: 'crossroads'
};

/**
 * The universe's own tile, used for the stone walls (`#`)
 */
export const stoneWall = {
	key: 'stone_wall',
	name: 'Stone Wall',
	indoors: true,
	color: 0x8a8a8a,
	visionCost: 100,
	movementCost: 100
};

export const sampleZones: SampleZone[] = [
	{
		key: 'town-square',
		name: 'Town Square',
		indoors: false,
		defaultTile: 'grass',
		markers: { 1: 'wood_floor', 2: 'grass' },
		map: [
			'^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^',
			'^^ff.....................fff..^^',
			'^f.......#########........ff...^',
			'^........#########.............^',
			'^........#########.....~~~.....^',
			'^...ff...#########....~~~~~....^',
			'^..fff...####1####....~~~~~....^',
			'^...f........2.........~~~.....^',
			'^..............................^',
			'^.........dddd.................^',
			'^........dddddd................^',
			'^.....ff..dddd.........ff......^',
			'^....ffff.............ffff.....^',
			'^.....ff...~~..........ff......^',
			'^.........~~~~.................^',
			'^..........~~..............^^..^',
			'^^........................^^^^^^',
			'^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^'
		]
	},
	{
		key: 'cottage',
		name: 'Cottage',
		parent: 'town-square',
		indoors: true,
		defaultTile: 'wood_floor',
		markers: { 3: 'wood_floor', 4: 'wood_floor', 5: 'wood_floor' },
		map: [
			'###########',
			'#.........#',
			'#...3.....#',
			'#.........#',
			'#.........#',
			'#....5....#',
			'#####4#####'
		]
	},
	{
		key: 'cellar',
		name: 'Cellar',
		parent: 'cottage',
		indoors: true,
		defaultTile: 'wood_floor',
		markers: { 6: 'wood_floor' },
		map: [
			'#########',
			'#.......#',
			'#.6.....#',
			'#.......#',
			'#########'
		]
	},
	{
		key: 'crossroads',
		name: 'Crossroads',
		indoors: false,
		defaultTile: 'grass',
		loopsEastWest: true,
		markers: {},
		map: [
			'^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^',
			'^^^^......fff..........^^^^.........^^^^',
			'..........ffff...........^^.............',
			'...ff......ff.................fff.......',
			'..ffff.........~~~~..........fffff......',
			'...ff.........~~~~~~..........fff.......',
			'...............~~~~.....................',
			'........................................',
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
	}
];

export const sampleLinks: SampleLink[] = [
	// The cottage door, both ways
	{ from: ['town-square', '1'], to: ['cottage', '5'], mode: 'automatic' },
	{ from: ['cottage', '4'], to: ['town-square', '2'], mode: 'automatic' },

	// The trapdoor and the ladder back up, each arriving on the other
	{ from: ['cottage', '3'], to: ['cellar', '6'], mode: 'manual' },
	{ from: ['cellar', '6'], to: ['cottage', '3'], mode: 'manual' }
];
