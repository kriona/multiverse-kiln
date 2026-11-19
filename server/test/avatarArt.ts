import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import sharp from 'sharp';
import type { AvatarManifest } from '@multiverse-kiln/shared';

import { useAvatarArt } from '../src/avatars/characterAvatars.js';

/**
 * Made-up art for tests that need characters to have avatars: the stick figure has a dwarf's femme thicc
 * and femme thin bases, and there are two backgrounds
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
				pf1e: {},
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
 * A PNG the size of an avatar, of one gray
 *
 * @return The PNG
 */
function grayPicture(): Promise<Buffer>
{
	return(sharp({
		create: {
			width: 200,
			height: 300,
			channels: 4,
			background: {
				r: 100,
				g: 100,
				b: 100,
				alpha: 1
			}
		}
	})
		.png()
		.toBuffer());
}

/**
 * Draws avatars from made-up art in a folder of its own, so the test database's dwarves (addCharacter())
 * have avatars, until the function returned is called
 *
 * @return Goes back to the engine's art and deletes the folder
 */
export async function useTestAvatarArt(): Promise<() => Promise<void>>
{
	const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'kiln-avatar-art-'));
	const picture = await grayPicture();

	for (const file of ['backgrounds/darkGreen.png', 'backgrounds/darkRed.png', 'stickFigure/bases/dwarf-femmeThicc.png', 'stickFigure/bases/dwarf-femmeThin.png'])
	{
		await fs.mkdir(path.dirname(path.join(folder, file)), { recursive: true });
		await fs.writeFile(path.join(folder, file), picture);
	}

	useAvatarArt({
		manifest,
		folder
	});

	return(async () =>
	{
		useAvatarArt(undefined);
		await fs.rm(folder, {
			recursive: true,
			force: true
		});
	});
}
