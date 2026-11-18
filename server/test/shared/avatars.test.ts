import assert from 'assert';
import { artTypesFor, artTypesForRace, avatarPicture, drawnBodyType, fitsSocialSlot, matchingDrawing, socialSlotFor, socialSlots, type AvatarEquippedItem, type AvatarLook, type AvatarManifest, type ItemDrawing } from '@multiverse-kiln/shared';

/**
 * A manifest of made-up files: the stick figure has every human base and a dwarf base, and Lucia only
 * the femme thin human
 */
const manifest: AvatarManifest = {
	artTypes: {
		stickFigure: {
			name: 'Stick figure',
			bases: {
				pf1e: {
					human: {
						mascThick: 'bases/human-mascThick.png',
						mascThin: 'bases/human-mascThin.png',
						femmeThick: 'bases/human-femmeThick.png',
						femmeThin: 'bases/human-femmeThin.png'
					},
					dwarf: {
						mascThick: 'bases/dwarf-mascThick.png'
					}
				},
				sf1e: {}
			},
			items: {
				pf1e: {},
				sf1e: {}
			}
		},
		lucia: {
			name: 'Lucia',
			bases: {
				pf1e: {
					human: {
						femmeThin: 'bases/human-femmeThin.png'
					}
				},
				sf1e: {}
			},
			items: {
				pf1e: {
					short_sword: [
						{
							races: ['human'],
							parts: [
								{
									file: 'items/short_sword.png',
									offsets: {
										human: {
											femmeThin: { x: 120, y: 150 }
										}
									},
									mirroredOffsets: {
										human: {
											femmeThin: { x: 30, y: 152 }
										}
									}
								}
							]
						}
					],
					longsword: [
						{
							races: ['human'],
							parts: [
								{
									file: 'items/longsword.png',
									offsets: {
										human: {
											femmeThin: { x: 110, y: 140 }
										}
									}
								}
							]
						},
						{
							races: ['human'],
							slots: ['bothHands'],
							parts: [
								{
									file: 'items/longsword-both.png',
									offsets: {
										human: {
											femmeThin: { x: 90, y: 130 }
										}
									}
								}
							]
						}
					],
					leather_armor: [
						{
							races: ['human'],
							parts: [
								{
									file: 'items/leather_armor.png',
									offsets: {
										human: {
											femmeThin: { x: 50, y: 80 }
										}
									}
								}
							]
						}
					],
					cloak: [
						{
							races: ['human'],
							parts: [
								{
									file: 'items/cloak-back.png',
									layer: 'behindBase',
									offsets: {
										human: {
											femmeThin: { x: 40, y: 60 }
										}
									}
								},
								{
									file: 'items/cloak-front.png',
									offsets: {
										human: {
											femmeThin: { x: 45, y: 62 }
										}
									}
								}
							]
						}
					],
					ring: [
						{
							races: ['human'],
							parts: [
								{
									file: 'items/ring.png',
									offsets: {
										human: {
											femmeThin: { x: 140, y: 170 }
										}
									},
									mirroredOffsets: {
										human: {
											femmeThin: { x: 50, y: 171 }
										}
									}
								}
							]
						}
					]
				},
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
 * A femme thin human drawn by Lucia over the dark red background
 *
 * @param equipment What she has in her slots
 * @param hiddenSlots The slots drawn empty
 * @return Her look
 */
function lookOf(equipment: AvatarEquippedItem[] = [], hiddenSlots: string[] = []): AvatarLook
{
	return({
		ruleset: 'pf1e',
		raceKey: 'human',
		bodyType: 'femmeThin',
		artType: 'lucia',
		background: 'darkRed',
		equipment,
		hiddenSlots
	});
}

/**
 * An item in a slot
 *
 * @param slot The slot
 * @param itemKey The default item it draws as
 * @param layer The slot's layer
 * @param bothHands Whether it is held in both hands
 * @return The equipped item
 */
function inSlot(slot: string, itemKey: string | null, layer: 'stats' | 'social' = 'stats', bothHands = false): AvatarEquippedItem
{
	return({
		slot,
		layer,
		itemKey,
		bothHands
	});
}

/**
 * The files an avatar draws, in order, with flipped ones marked
 *
 * @param look The look
 * @return The files, or null for no avatar
 */
function filesOf(look: AvatarLook): string[] | null
{
	const picture = avatarPicture(manifest, look);

	return(((picture === null) ? null : picture.layers.map((layer) => (layer.flipped ? `${layer.file} (flipped)` : layer.file))));
}

describe('avatars', () =>
{
	describe('avatarPicture', () =>
	{
		it('draws the background and the base', () =>
		{
			const picture = avatarPicture(manifest, lookOf());

			assert.deepStrictEqual(picture?.layers, [
				{
					file: 'backgrounds/darkRed.png',
					x: 0,
					y: 0,
					flipped: false
				},
				{
					file: 'lucia/bases/human-femmeThin.png',
					x: 0,
					y: 0,
					flipped: false
				}
			]);
			assert.strictEqual(picture?.artType, 'lucia');
			assert.strictEqual(picture?.bodyType, 'femmeThin');
		});

		it('draws an item at its offset for the base', () =>
		{
			const picture = avatarPicture(manifest, lookOf([inSlot('armor', 'leather_armor')]));

			assert.deepStrictEqual(picture?.layers.at(-1), {
				file: 'lucia/items/leather_armor.png',
				x: 50,
				y: 80,
				flipped: false
			});
		});

		it('draws the off hand flipped, with its own offsets', () =>
		{
			const picture = avatarPicture(manifest, lookOf([inSlot('mainHand', 'short_sword'), inSlot('offHand', 'short_sword')]));

			assert.deepStrictEqual(picture?.layers.slice(2), [
				{
					file: 'lucia/items/short_sword.png',
					x: 30,
					y: 152,
					flipped: true
				},
				{
					file: 'lucia/items/short_sword.png',
					x: 120,
					y: 150,
					flipped: false
				}
			]);
		});

		it('draws nothing in the off hand for a drawing without mirrored offsets', () =>
		{
			assert.deepStrictEqual(filesOf(lookOf([inSlot('offHand', 'longsword')])), ['backgrounds/darkRed.png', 'lucia/bases/human-femmeThin.png']);
		});

		it('draws the right ring flipped from the left ring\'s drawing', () =>
		{
			const picture = avatarPicture(manifest, lookOf([inSlot('ringLeft', 'ring'), inSlot('ringRight', 'ring')]));

			assert.deepStrictEqual(picture?.layers.slice(2).map(({ x, flipped }) => ({ x, flipped })), [
				{
					x: 140,
					flipped: false
				},
				{
					x: 50,
					flipped: true
				}
			]);
		});

		it('uses the two-handed grip\'s drawing for an item held in both hands', () =>
		{
			assert.deepStrictEqual(filesOf(lookOf([inSlot('mainHand', 'longsword', 'stats', true)]))?.at(-1), 'lucia/items/longsword-both.png');
			assert.deepStrictEqual(filesOf(lookOf([inSlot('mainHand', 'longsword')]))?.at(-1), 'lucia/items/longsword.png');
		});

		it('draws a part behind the base, and the rest in the slots\' draw order', () =>
		{
			assert.deepStrictEqual(filesOf(lookOf([inSlot('mainHand', 'short_sword'), inSlot('shoulders', 'cloak'), inSlot('armor', 'leather_armor')])), [
				'backgrounds/darkRed.png',
				'lucia/items/cloak-back.png',
				'lucia/bases/human-femmeThin.png',
				'lucia/items/leather_armor.png',
				'lucia/items/cloak-front.png',
				'lucia/items/short_sword.png'
			]);
		});

		it('draws a slot\'s social item in place of its stats item', () =>
		{
			assert.deepStrictEqual(filesOf(lookOf([inSlot('armor', 'ring', 'stats'), inSlot('armor', 'leather_armor', 'social')]))?.at(-1), 'lucia/items/leather_armor.png');
		});

		it('draws nothing in a hidden slot, social or stats', () =>
		{
			assert.deepStrictEqual(filesOf(lookOf([inSlot('armor', 'leather_armor', 'stats'), inSlot('shoulders', 'cloak', 'social')], ['armor', 'shoulders'])), ['backgrounds/darkRed.png', 'lucia/bases/human-femmeThin.png']);
		});

		it('draws nothing for an item with no drawing, or none it looks like', () =>
		{
			assert.deepStrictEqual(filesOf(lookOf([inSlot('feet', 'boots'), inSlot('head', null)])), ['backgrounds/darkRed.png', 'lucia/bases/human-femmeThin.png']);
		});

		it('falls back to the stick figure when the art type has no base for the character', () =>
		{
			assert.deepStrictEqual(filesOf({
				...lookOf([inSlot('armor', 'leather_armor')]),
				bodyType: 'mascThick'
			}), ['backgrounds/darkRed.png', 'stickFigure/bases/human-mascThick.png']);
		});

		it('draws a body type the race\'s list doesn\'t have as its first', () =>
		{
			assert.strictEqual(drawnBodyType('pf1e', 'human', 'notABodyType'), 'mascThick');
			assert.strictEqual(avatarPicture(manifest, {
				...lookOf(),
				bodyType: 'notABodyType'
			})?.bodyType, 'mascThick');
		});

		it('has no avatar for a race that looks like none, or one no art type has drawn', () =>
		{
			assert.strictEqual(avatarPicture(manifest, {
				...lookOf(),
				raceKey: null
			}), null);
			assert.strictEqual(avatarPicture(manifest, {
				...lookOf(),
				raceKey: 'elf'
			}), null);
		});

		it('changes the hash when the layers or the files\' versions change', () =>
		{
			const plain = avatarPicture(manifest, lookOf());
			const equipped = avatarPicture(manifest, lookOf([inSlot('armor', 'leather_armor')]));
			const redrawn = avatarPicture(manifest, lookOf(), new Map([['lucia/bases/human-femmeThin.png', 'v2']]));

			assert.match(plain?.hash ?? '', /^[0-9a-f]{16}$/);
			assert.strictEqual(avatarPicture(manifest, lookOf())?.hash, plain?.hash);
			assert.notStrictEqual(equipped?.hash, plain?.hash);
			assert.notStrictEqual(redrawn?.hash, plain?.hash);
		});
	});

	describe('matchingDrawing', () =>
	{
		const drawing = (races: string[], bodyTypes?: ('mascThick' | 'femmeThin')[], slots?: string[]): ItemDrawing => ({
			races,
			bodyTypes,
			slots,
			parts: []
		});

		it('picks the most specific drawing that matches', () =>
		{
			const anyone = drawing(['human', 'elf']);
			const bySlot = drawing(['human'], undefined, ['mainHand']);
			const byBody = drawing(['human'], ['femmeThin']);
			const both = drawing(['human'], ['femmeThin'], ['mainHand']);

			assert.strictEqual(matchingDrawing([anyone, bySlot, byBody, both], 'human', 'femmeThin', 'mainHand'), both);
			assert.strictEqual(matchingDrawing([anyone, bySlot, byBody], 'human', 'femmeThin', 'mainHand'), byBody);
			assert.strictEqual(matchingDrawing([anyone, bySlot], 'human', 'mascThick', 'mainHand'), bySlot);
			assert.strictEqual(matchingDrawing([anyone, bySlot], 'elf', 'mascThick', 'mainHand'), anyone);
			assert.strictEqual(matchingDrawing([anyone], 'halfling', 'mascThick', 'mainHand'), undefined);
		});
	});

	describe('art types', () =>
	{
		it('offers the art types with a base for the race and body type', () =>
		{
			assert.deepStrictEqual(artTypesFor(manifest, 'pf1e', 'human', 'femmeThin'), ['stickFigure', 'lucia']);
			assert.deepStrictEqual(artTypesFor(manifest, 'pf1e', 'human', 'mascThick'), ['stickFigure']);
			assert.deepStrictEqual(artTypesFor(manifest, 'pf1e', null, 'mascThick'), []);
			assert.deepStrictEqual(artTypesForRace(manifest, 'pf1e', 'dwarf'), ['stickFigure']);
			assert.deepStrictEqual(artTypesForRace(manifest, 'pf1e', 'elf'), []);
		});
	});

	describe('social slots', () =>
	{
		const cloak = {
			id: 1,
			category: 'gear',
			types: ['clothing'],
			equips: 'shoulders'
		};
		const boulderHelmet = {
			id: 2,
			category: 'weapon',
			types: [],
			equips: 'head'
		};
		const ring = {
			id: 3,
			category: 'gear',
			types: [],
			equips: 'ring'
		};

		it('are the worn slots, but the tail and the off arm', () =>
		{
			const slots = socialSlots('pf1e');

			assert.ok(slots.includes('hands'));
			assert.ok(slots.includes('ringRight'));
			assert.ok(!slots.includes('tail'));
			assert.ok(!slots.includes('offArm'));
			assert.ok(!slots.includes('mainHand'));
			assert.deepStrictEqual(socialSlots('sf1e'), ['armor', 'clothing']);
		});

		it('take items that fit, but no weapons or shields', () =>
		{
			assert.ok(fitsSocialSlot('pf1e', cloak, 'shoulders'));
			assert.ok(!fitsSocialSlot('pf1e', cloak, 'head'));
			assert.ok(!fitsSocialSlot('pf1e', boulderHelmet, 'head'));
			assert.ok(!fitsSocialSlot('pf1e', {
				category: 'armor',
				types: ['shields'],
				equips: 'offArm'
			}, 'offArm'));
		});

		it('put a ring in the first free ring slot, or the first', () =>
		{
			assert.strictEqual(socialSlotFor('pf1e', [], ring), 'ringLeft');
			assert.strictEqual(socialSlotFor('pf1e', [{
				slot: 'ringLeft',
				itemId: 9,
				bothHands: false
			}], ring), 'ringRight');
			assert.strictEqual(socialSlotFor('pf1e', [], boulderHelmet), undefined);
		});
	});
});
