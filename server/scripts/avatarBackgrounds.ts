/**
 * Makes the avatar backgrounds (BACKGROUNDS in /shared) from gradient stops: a PNG for each in
 * shared/assets/avatars/backgrounds/, the size of an avatar. They are made, not drawn, so changing a
 * background is changing its stops here and running npm run avatars:backgrounds -w server
 */
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import { AVATAR_HEIGHT, AVATAR_MANIFEST, AVATAR_WIDTH, type AvatarBackground } from '@multiverse-kiln/shared';

/**
 * One color of a gradient, at a fraction of the way from its top to its bottom
 */
interface GradientStop
{
	offset: number;
	color: string;
}

/**
 * Each background's gradient, from top to bottom
 */
const GRADIENTS: Record<AvatarBackground, GradientStop[]> = {
	darkGreen: [
		{
			offset: 0,
			color: '#2f5a3c'
		},
		{
			offset: 0.55,
			color: '#1a3524'
		},
		{
			offset: 1,
			color: '#0b1a10'
		}
	],
	darkRed: [
		{
			offset: 0,
			color: '#6a2a2a'
		},
		{
			offset: 0.55,
			color: '#3d1717'
		},
		{
			offset: 1,
			color: '#1c0909'
		}
	]
};

/**
 * The shared package's avatar art folder
 */
const AVATARS_FOLDER = path.resolve(path.dirname(fileURLToPath(import.meta.resolve('@multiverse-kiln/shared'))), '../assets/avatars');

/**
 * An SVG of a vertical gradient the size of an avatar
 *
 * @param stops The gradient's stops
 * @return The SVG
 */
function gradientSvg(stops: readonly GradientStop[]): string
{
	const stopTags = stops
		.map(({ offset, color }) => `<stop offset="${offset}" stop-color="${color}"/>`)
		.join('');

	return(`<svg xmlns="http://www.w3.org/2000/svg" width="${AVATAR_WIDTH}" height="${AVATAR_HEIGHT}"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">${stopTags}</linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`);
}

for (const [background, stops] of Object.entries(GRADIENTS) as [AvatarBackground, GradientStop[]][])
{
	const file = path.join(AVATARS_FOLDER, AVATAR_MANIFEST.backgrounds[background]);

	await fs.mkdir(path.dirname(file), { recursive: true });
	await sharp(Buffer.from(gradientSvg(stops)))
		.png({ compressionLevel: 9 })
		.toFile(file);
	console.log(`Wrote ${path.relative(process.cwd(), file)}`);
}
