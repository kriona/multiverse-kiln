import assert from 'assert';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import sharp from 'sharp';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Client as SDKClient } from '@colyseus/sdk';
import { avatarPath, avatarPreviewPath, characterPath, charactersPath, EDITOR_UNIVERSES_PATH, PROFILE_PATH, SESSION_ROOM_NAME, SessionServerMessageType, type AvatarManifest, type CharacterItemsPayload, type CharacterListPayload, type CharacterSheet, type CreatedPayload, type ItemSettings, type OwnProfilePayload } from '@multiverse-kiln/shared';

import { avatarStorageKey, useAvatarArt } from '../src/avatars/characterAvatars.js';
import { saveAvatarHash } from '../src/db/avatarRepo.js';
import { createCharacter, giveCharacterItems } from '../src/db/characterRepo.js';
import { createCustomItem, findDefaultItemIds } from '../src/db/itemRepo.js';
import { inTransaction } from '../src/db/transactions.js';
import { liveVersion } from '../src/db/universeVersions.js';
import { getObject } from '../src/storage/objectStorage.js';
import { addCharacter, defaultRaceId, dwarfFighter } from './db/fixtures.js';
import { Inbox } from './inbox.js';
import { addPlayer, logInBrowser, type TestBrowser } from './players.js';
import { getTestServer, testServerUrl } from './testServer.js';

/**
 * A color, as red, green and blue
 */
type Color = [number, number, number];

const BACKGROUND: Color = [10, 80, 10];
const OTHER_BACKGROUND: Color = [90, 10, 10];
const THICK_BASE: Color = [200, 200, 200];
const THIN_BASE: Color = [220, 180, 200];
const ARMOR: Color = [139, 69, 19];
const SWORD: Color = [180, 180, 255];

/**
 * Where the drawings go on the dwarves' bases
 */
const BASE_SQUARE = { x: 80, y: 20 };
const ARMOR_AT = { x: 70, y: 100 };
const SWORD_AT = { x: 150, y: 120 };
const OFF_HAND_SWORD_AT = { x: 40, y: 120 };

/**
 * Made-up art: the stick figure has a dwarf's femme thicc and femme thin bases, leather armor and a short
 * sword, which the off hand draws flipped
 */
const manifest: AvatarManifest = {
	artTypes: {
		stickFigure: {
			name: 'Stick figure',
			bases: {
				pf1e: {
					dwarf: {
						femmeThicc: 'bases/dwarf-femmeThicc.png',
						femmeThin: 'bases/dwarf-femmeThin.png'
					}
				},
				sf1e: {}
			},
			items: {
				pf1e: {
					leather_armor: [
						{
							races: ['dwarf'],
							parts: [
								{
									file: 'items/leather_armor.png',
									offsets: {
										dwarf: {
											femmeThicc: ARMOR_AT,
											femmeThin: ARMOR_AT
										}
									}
								}
							]
						}
					],
					short_sword: [
						{
							races: ['dwarf'],
							parts: [
								{
									file: 'items/short_sword.png',
									offsets: {
										dwarf: {
											femmeThicc: SWORD_AT
										}
									},
									mirroredOffsets: {
										dwarf: {
											femmeThicc: OFF_HAND_SWORD_AT
										}
									}
								}
							]
						}
					]
				},
				sf1e: {}
			}
		},
		lucia: {
			name: 'Lucia',
			bases: {
				pf1e: {},
				sf1e: {}
			},
			items: {
				pf1e: {},
				sf1e: {}
			}
		}
	},
	backgrounds: {
		darkGreen: 'backgrounds/darkGreen.png',
		darkRed: 'backgrounds/darkRed.png'
	}
};

/**
 * A PNG of a solid rectangle
 *
 * @param width Its width
 * @param height Its height
 * @param color Its color
 * @return The PNG
 */
async function rectangle(width: number, height: number, color: Color): Promise<Buffer>
{
	return(sharp({
		create: {
			width,
			height,
			channels: 4,
			background: {
				r: color[0],
				g: color[1],
				b: color[2],
				alpha: 1
			}
		}
	})
		.png()
		.toBuffer());
}

/**
 * A base: a see-through PNG the size of an avatar with a square of color on it
 *
 * @param color The square's color
 * @return The PNG
 */
async function base(color: Color): Promise<Buffer>
{
	return(sharp({
		create: {
			width: 200,
			height: 300,
			channels: 4,
			background: {
				r: 0,
				g: 0,
				b: 0,
				alpha: 0
			}
		}
	})
		.composite([{
			input: await rectangle(40, 40, color),
			left: BASE_SQUARE.x,
			top: BASE_SQUARE.y
		}])
		.png()
		.toBuffer());
}

/**
 * The color of a pixel of a PNG
 *
 * @param png The PNG
 * @param at The pixel
 * @return Its red, green and blue
 */
async function pixelAt(png: Buffer, at: { x: number; y: number }): Promise<Color>
{
	const { data, info } = await sharp(png)
		.raw()
		.toBuffer({ resolveWithObject: true });
	const offset = ((at.y * info.width) + at.x) * info.channels;

	return([data[offset], data[offset + 1], data[offset + 2]]);
}

/**
 * Fetches a path of the test server
 *
 * @param browser The browser asking, if any
 * @param method The HTTP method
 * @param pathName The path
 * @param body The JSON body, if any
 * @param headers More headers
 * @return The response
 */
async function request(browser: TestBrowser | undefined, method: string, pathName: string, body?: unknown, headers: Record<string, string> = {}): Promise<Response>
{
	return(fetch(`${testServerUrl}${pathName}`, {
		method,
		headers: {
			...((browser === undefined) ? {} : { Cookie: browser.cookie }),
			...((body === undefined) ? {} : { 'Content-Type': 'application/json' }),
			...headers
		},
		body: ((body === undefined) ? undefined : JSON.stringify(body))
	}));
}

/**
 * Runs a function before each time a file is written to object storage under a key, until stopped
 *
 * @param key The key
 * @param onPut Runs before each write, which waits for it
 * @return Stops running it
 */
function beforePuts(key: string, onPut: () => Promise<void> | void): () => void
{
	const prototype = S3Client.prototype as unknown as { send: (this: S3Client, command: unknown, ...rest: unknown[]) => Promise<unknown> };
	const originalSend = prototype.send;

	prototype.send = async function watchedSend(this: S3Client, command: unknown, ...rest: unknown[]): Promise<unknown>
	{
		if ((command instanceof PutObjectCommand) && (command.input.Key === key))
		{
			await onPut();
		}

		return(originalSend.call(this, command, ...rest));
	};

	return(() =>
	{
		prototype.send = originalSend;
	});
}

describe('Avatars', () =>
{
	let folder: string;
	let ada: TestBrowser;
	let universeId: string;
	let brokkId: string;
	let leatherArmorId: number;
	let shortSwordId: number;
	let hideArmorId: number;
	let warhammerId: number;

	before(async () =>
	{
		await getTestServer();
		folder = await fs.mkdtemp(path.join(os.tmpdir(), 'kiln-avatars-'));

		const files: [string, Buffer][] = [
			['backgrounds/darkGreen.png', await rectangle(200, 300, BACKGROUND)],
			['backgrounds/darkRed.png', await rectangle(200, 300, OTHER_BACKGROUND)],
			['stickFigure/bases/dwarf-femmeThicc.png', await base(THICK_BASE)],
			['stickFigure/bases/dwarf-femmeThin.png', await base(THIN_BASE)],
			['stickFigure/items/leather_armor.png', await rectangle(60, 80, ARMOR)],
			['stickFigure/items/short_sword.png', await rectangle(10, 60, SWORD)]
		];

		for (const [file, png] of files)
		{
			await fs.mkdir(path.dirname(path.join(folder, file)), { recursive: true });
			await fs.writeFile(path.join(folder, file), png);
		}

		useAvatarArt({
			manifest,
			folder
		});
	});

	after(async () =>
	{
		useAvatarArt(undefined);
		await fs.rm(folder, {
			recursive: true,
			force: true
		});
	});

	beforeEach(async () =>
	{
		ada = await logInBrowser((await addPlayer('Ada')).id);

		const created = await request(ada, 'POST', EDITOR_UNIVERSES_PATH, {
			name: 'Kilnhaven',
			shortDescription: 'A small town.',
			ruleset: 'pf1e'
		});

		universeId = ((await created.json()) as CreatedPayload).id;
		brokkId = await addCharacter(ada.playerId, universeId, 'Brokk');

		const defaults = await findDefaultItemIds('pf1e');
		const custom = (name: string, settings: Pick<ItemSettings, 'category' | 'types' | 'equips'>): Promise<number> => createCustomItem(liveVersion(universeId), 'pf1e', {
			name,
			description: null,
			enabled: true,
			looksLikeItemId: null,
			...settings
		});

		leatherArmorId = defaults.get('leather_armor') ?? 0;
		shortSwordId = defaults.get('short_sword') ?? 0;
		hideArmorId = await custom('Hide armor', {
			category: 'armor',
			types: [],
			equips: 'armor'
		});
		warhammerId = await custom('Warhammer', {
			category: 'weapon',
			types: [],
			equips: 'oneHand'
		});
		await giveCharacterItems(brokkId, [
			{ itemId: leatherArmorId, quantity: 1 },
			{ itemId: shortSwordId, quantity: 2 },
			{ itemId: hideArmorId, quantity: 1 },
			{ itemId: warhammerId, quantity: 1 }
		]);
	});

	/**
	 * Brokk's sheet
	 *
	 * @return The sheet
	 */
	async function sheet(): Promise<CharacterSheet>
	{
		const response = await request(ada, 'GET', characterPath(universeId, brokkId));

		assert.strictEqual(response.status, 200);

		return((await response.json()) as CharacterSheet);
	}

	/**
	 * Brokk's avatar, as his sheet's hash asks for it
	 *
	 * @return The PNG
	 */
	async function avatar(): Promise<Buffer>
	{
		const { avatarHash } = await sheet();

		assert.notStrictEqual(avatarHash, null);

		const response = await request(undefined, 'GET', avatarPath(brokkId, avatarHash));

		assert.strictEqual(response.status, 200);
		assert.strictEqual(response.headers.get('content-type'), 'image/png');

		return(Buffer.from(await response.arrayBuffer()));
	}

	/**
	 * Sends a change to one of Brokk's routes, as his player
	 *
	 * @param method The HTTP method
	 * @param route The route under his path
	 * @param body The change
	 * @return The status
	 */
	async function change(method: string, route: string, body: unknown): Promise<number>
	{
		return((await request(ada, method, `${characterPath(universeId, brokkId)}/${route}`, body)).status);
	}

	it('draws the base over the background, and is kept for good when asked for with its hash', async () =>
	{
		const { avatarHash, appearance, avatarKey } = await sheet();

		assert.deepStrictEqual(appearance, {
			bodyType: 'femmeThicc',
			artType: 'stickFigure',
			background: 'darkGreen'
		});
		assert.strictEqual(avatarKey, 'dwarf');

		const response = await request(undefined, 'GET', avatarPath(brokkId, avatarHash));
		const png = Buffer.from(await response.arrayBuffer());
		const { width, height } = await sharp(png).metadata();

		assert.strictEqual(response.headers.get('cache-control'), 'public, max-age=31536000, immutable');
		assert.strictEqual(response.headers.get('x-content-type-options'), 'nosniff');
		assert.deepStrictEqual([width, height], [200, 300]);
		assert.deepStrictEqual(await pixelAt(png, { x: 5, y: 5 }), BACKGROUND);
		assert.deepStrictEqual(await pixelAt(png, { x: BASE_SQUARE.x + 1, y: BASE_SQUARE.y + 1 }), THICK_BASE);
		assert.ok(await getObject(avatarStorageKey(brokkId)));
	});

	it('draws what is equipped once the look changes, the off hand flipped', async () =>
	{
		const before = (await sheet()).avatarHash;

		assert.strictEqual(await change('POST', 'items/equip', { itemId: leatherArmorId, hand: null, ring: null }), 204);
		assert.strictEqual(await change('POST', 'items/equip', { itemId: shortSwordId, hand: 'main', ring: null }), 204);
		assert.strictEqual(await change('POST', 'items/equip', { itemId: shortSwordId, hand: 'off', ring: null }), 204);
		assert.notStrictEqual((await sheet()).avatarHash, before);

		const png = await avatar();

		assert.deepStrictEqual(await pixelAt(png, { x: ARMOR_AT.x + 1, y: ARMOR_AT.y + 1 }), ARMOR);
		assert.deepStrictEqual(await pixelAt(png, { x: SWORD_AT.x + 1, y: SWORD_AT.y + 1 }), SWORD);
		assert.deepStrictEqual(await pixelAt(png, { x: OFF_HAND_SWORD_AT.x + 1, y: OFF_HAND_SWORD_AT.y + 1 }), SWORD);
	});

	it('makes an out-of-date avatar once for requests that arrive together', async () =>
	{
		assert.strictEqual((await request(undefined, 'GET', avatarPath(brokkId, null))).status, 200);
		assert.strictEqual(await change('PUT', 'appearance', { bodyType: 'femmeThicc', artType: 'stickFigure', background: 'darkRed' }), 204);

		let puts = 0;
		const stopWatching = beforePuts(avatarStorageKey(brokkId), () =>
		{
			puts++;
		});
		let responses: Response[];

		try
		{
			responses = await Promise.all(Array.from({ length: 20 }, () => request(undefined, 'GET', avatarPath(brokkId, null))));
		}
		finally
		{
			stopWatching();
		}

		assert.deepStrictEqual(responses.map((response) => response.status), Array.from({ length: 20 }, () => 200));
		assert.deepStrictEqual(await pixelAt(Buffer.from(await responses[19].arrayBuffer()), { x: 5, y: 5 }), OTHER_BACKGROUND);
		assert.strictEqual(puts, 1);
	});

	it('makes the avatar again when the stored one isn\'t of the hash saved for it', async () =>
	{
		await avatar();
		assert.strictEqual(await change('PUT', 'appearance', { bodyType: 'femmeThicc', artType: 'stickFigure', background: 'darkRed' }), 204);

		// As when two requests overlap, and the one for the old look stores its PNG after the new look's
		// hash is saved
		const { avatarHash } = await sheet();

		assert.ok(avatarHash);
		assert.strictEqual(await saveAvatarHash(brokkId, avatarHash), true);
		assert.deepStrictEqual(await pixelAt(await avatar(), { x: 5, y: 5 }), OTHER_BACKGROUND);
	});

	it('deletes an avatar stored while its character was being deleted', async () =>
	{
		let reached = (): void => undefined;
		let release = (): void => undefined;
		const putReached = new Promise<void>((resolve) =>
		{
			reached = resolve;
		});
		const putReleased = new Promise<void>((resolve) =>
		{
			release = resolve;
		});
		const stopWatching = beforePuts(avatarStorageKey(brokkId), async () =>
		{
			reached();
			await putReleased;
		});

		try
		{
			const response = request(undefined, 'GET', avatarPath(brokkId, null));

			await putReached;
			assert.strictEqual((await request(ada, 'DELETE', characterPath(universeId, brokkId))).status, 204);
			release();
			assert.strictEqual((await response).status, 200);
		}
		finally
		{
			release();
			stopWatching();
		}

		assert.strictEqual(await getObject(avatarStorageKey(brokkId)), undefined);
	});

	it('answers 304 to a browser that has the avatar, and refuses one never drawn', async () =>
	{
		const first = await request(undefined, 'GET', avatarPath(brokkId, null));
		const etag = first.headers.get('etag') ?? '';

		assert.strictEqual(first.status, 200);
		assert.strictEqual(first.headers.get('cache-control'), 'no-cache');
		assert.strictEqual((await request(undefined, 'GET', avatarPath(brokkId, null), undefined, { 'If-None-Match': etag })).status, 304);
		assert.strictEqual((await request(undefined, 'GET', avatarPath('00000000-0000-4000-8000-000000000000', null))).status, 404);
		assert.strictEqual((await request(undefined, 'GET', '/avatars/not-a-character.png')).status, 404);

		// Nothing is drawn for humans
		const human = await dwarfFighter(ada.playerId, universeId, 'Hilde');
		const hildeId = await inTransaction(async (transaction) => createCharacter({
			...human,
			raceId: await defaultRaceId('human')
		}, transaction));
		const hildeSheet = await request(ada, 'GET', characterPath(universeId, hildeId));

		assert.strictEqual(((await hildeSheet.json()) as CharacterSheet).avatarHash, null);
		assert.strictEqual((await request(undefined, 'GET', avatarPath(hildeId, null))).status, 404);
	});

	it('draws a social item over the stats item, and refuses weapons and slots without a social layer', async () =>
	{
		assert.strictEqual(await change('POST', 'items/equip', { itemId: hideArmorId, hand: null, ring: null }), 204);
		assert.deepStrictEqual(await pixelAt(await avatar(), { x: ARMOR_AT.x + 1, y: ARMOR_AT.y + 1 }), BACKGROUND);

		assert.strictEqual(await change('POST', 'social', { slot: 'armor', itemId: leatherArmorId }), 204);
		assert.deepStrictEqual((await sheet()).socialEquipment, [{ slot: 'armor', itemId: leatherArmorId, bothHands: false }]);
		assert.deepStrictEqual((await sheet()).equipment, [{ slot: 'armor', itemId: hideArmorId, bothHands: false }]);
		assert.deepStrictEqual(await pixelAt(await avatar(), { x: ARMOR_AT.x + 1, y: ARMOR_AT.y + 1 }), ARMOR);

		assert.strictEqual(await change('POST', 'social', { slot: 'head', itemId: warhammerId }), 409);
		assert.strictEqual(await change('POST', 'social', { slot: 'mainHand', itemId: shortSwordId }), 400);
		assert.strictEqual(await change('POST', 'social', { slot: 'head', itemId: 999999 }), 409);

		assert.strictEqual(await change('POST', 'social', { slot: 'armor', itemId: null }), 204);
		assert.deepStrictEqual((await sheet()).socialEquipment, []);
	});

	it('hides a slot from the avatar until it is shown again', async () =>
	{
		assert.strictEqual(await change('POST', 'items/equip', { itemId: leatherArmorId, hand: null, ring: null }), 204);
		assert.strictEqual(await change('POST', 'hidden-slots', { slot: 'armor', hidden: true }), 204);
		assert.deepStrictEqual((await sheet()).hiddenSlots, ['armor']);
		assert.deepStrictEqual(await pixelAt(await avatar(), { x: ARMOR_AT.x + 1, y: ARMOR_AT.y + 1 }), BACKGROUND);

		// Hidden whatever is in it
		assert.strictEqual(await change('POST', 'social', { slot: 'armor', itemId: leatherArmorId }), 204);
		assert.deepStrictEqual(await pixelAt(await avatar(), { x: ARMOR_AT.x + 1, y: ARMOR_AT.y + 1 }), BACKGROUND);

		assert.strictEqual(await change('POST', 'hidden-slots', { slot: 'armor', hidden: false }), 204);
		assert.deepStrictEqual(await pixelAt(await avatar(), { x: ARMOR_AT.x + 1, y: ARMOR_AT.y + 1 }), ARMOR);
		assert.strictEqual(await change('POST', 'hidden-slots', { slot: 'wings', hidden: true }), 400);
	});

	it('lets the player change the art type and background, and only creators the body type', async () =>
	{
		assert.strictEqual(await change('PUT', 'appearance', { bodyType: 'femmeThicc', artType: 'stickFigure', background: 'darkRed' }), 204);
		assert.deepStrictEqual(await pixelAt(await avatar(), { x: 5, y: 5 }), OTHER_BACKGROUND);

		assert.strictEqual(await change('PUT', 'appearance', { bodyType: 'femmeThin', artType: 'stickFigure', background: 'darkRed' }), 403);
		assert.strictEqual(await change('PUT', 'appearance', { bodyType: 'femmeThin', artType: 'watercolor', background: 'darkRed' }), 400);

		const asCreator = await request(ada, 'PUT', `${EDITOR_UNIVERSES_PATH}/${universeId}/characters/${brokkId}/appearance`, {
			bodyType: 'femmeThin',
			artType: 'lucia',
			background: 'darkRed'
		});

		assert.strictEqual(asCreator.status, 204);
		assert.deepStrictEqual((await sheet()).appearance, {
			bodyType: 'femmeThin',
			artType: 'lucia',
			background: 'darkRed'
		});

		// Lucia hasn't drawn dwarves, so the stick figure draws her
		assert.deepStrictEqual(await pixelAt(await avatar(), { x: BASE_SQUARE.x + 1, y: BASE_SQUARE.y + 1 }), THIN_BASE);
	});

	it('serves previews of a base over a background, and 304 while they are the same', async () =>
	{
		const previewPath = avatarPreviewPath('stickFigure', 'pf1e', 'dwarf', 'femmeThin', 'darkRed');
		const first = await request(undefined, 'GET', previewPath);
		const png = Buffer.from(await first.arrayBuffer());
		const etag = first.headers.get('etag') ?? '';

		assert.strictEqual(first.status, 200);
		assert.deepStrictEqual(await pixelAt(png, { x: 5, y: 5 }), OTHER_BACKGROUND);
		assert.deepStrictEqual(await pixelAt(png, { x: BASE_SQUARE.x + 1, y: BASE_SQUARE.y + 1 }), THIN_BASE);
		assert.strictEqual((await request(undefined, 'GET', previewPath, undefined, { 'If-None-Match': etag })).status, 304);
		assert.strictEqual((await request(undefined, 'GET', avatarPreviewPath('stickFigure', 'pf1e', 'human', 'femmeThin', 'darkRed'))).status, 404);
		assert.strictEqual((await request(undefined, 'GET', avatarPreviewPath('stickFigure', 'pf1e', 'dwarf', 'femmeThin', 'plaid'))).status, 404);
		assert.strictEqual((await request(undefined, 'GET', avatarPreviewPath('oils', 'pf1e', 'dwarf', 'femmeThin', 'darkRed'))).status, 404);
	});

	it('tells the player\'s windows each time the look changes, where the lists give the new hash', async () =>
	{
		/**
		 * Brokk's avatar hash as the universe's list of Ada's characters and her own profile give it
		 *
		 * @return The two hashes
		 */
		async function listedHashes(): Promise<(string | null | undefined)[]>
		{
			const list = (await (await request(ada, 'GET', charactersPath(universeId))).json()) as CharacterListPayload;
			const profile = (await (await request(ada, 'GET', PROFILE_PATH)).json()) as OwnProfilePayload;

			return([
				list.characters.find((character) => (character.id === brokkId))?.avatarHash,
				profile.characters.find((character) => (character.id === brokkId))?.avatarHash
			]);
		}

		const sdk = new SDKClient(testServerUrl.replace(/^http/, 'ws'), { headers: { cookie: ada.cookie } });
		const room = await sdk.joinOrCreate(SESSION_ROOM_NAME);
		const inbox = new Inbox(room, Object.values(SessionServerMessageType));
		const changes: [string, string, unknown][] = [
			['PUT', 'appearance', { bodyType: 'femmeThicc', artType: 'stickFigure', background: 'darkRed' }],
			['POST', 'items/equip', { itemId: leatherArmorId, hand: null, ring: null }],
			['POST', 'hidden-slots', { slot: 'armor', hidden: true }],
			['POST', 'hidden-slots', { slot: 'armor', hidden: false }],
			['POST', 'social', { slot: 'armor', itemId: hideArmorId }],
			['POST', 'social', { slot: 'armor', itemId: null }],
			['POST', 'items/unequip', { itemId: leatherArmorId, slot: null }]
		];

		try
		{
			await inbox.take(SessionServerMessageType.Account);

			let before = (await sheet()).avatarHash;

			assert.deepStrictEqual(await listedHashes(), [before, before]);

			for (const [method, route, body] of changes)
			{
				assert.strictEqual(await change(method, route, body), 204, route);
				assert.deepStrictEqual(await inbox.take<CharacterItemsPayload>(SessionServerMessageType.CharacterItems), {
					universeId,
					characterId: brokkId
				}, route);

				const { avatarHash } = await sheet();

				assert.notStrictEqual(avatarHash, before, route);
				assert.deepStrictEqual(await listedHashes(), [avatarHash, avatarHash], route);
				before = avatarHash;
			}
		}
		finally
		{
			await room.leave();
		}
	});

	it('deletes the stored avatar with the character', async () =>
	{
		await avatar();
		assert.ok(await getObject(avatarStorageKey(brokkId)));
		assert.strictEqual((await request(ada, 'DELETE', characterPath(universeId, brokkId))).status, 204);
		assert.strictEqual(await getObject(avatarStorageKey(brokkId)), undefined);
	});
});
