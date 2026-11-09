import Phaser from 'phaser';

import paperUrl from '../assets/paper.png';
import { CellMaskShader } from './CellMaskShader';

/**
 * Key the paper's image is loaded under
 */
const PAPER_TEXTURE_KEY = 'unexplored-paper';

/**
 * How wide and tall the paper's image is, in pixels; it repeats across the area
 */
const PAPER_SIZE = 256;

/**
 * The color the paper's edge is drawn in, as red, green and blue from 0 to 1
 */
const PENCIL_COLOR = [0.42, 0.33, 0.22];

/**
 * Draws the cells the group hasn't explored as hand-drawn paper: rounded shapes whose edges wobble, with a
 * pencil line along them
 *
 * The paper is drawn where the blended mask is above EDGE_LEVEL. It reaches a little past the unexplored
 * cells, so their corners stay covered where the shape rounds them off
 */
const FRAGMENT_SHADER = `
uniform sampler2D uPaper;
uniform float uPaperSize;
uniform vec3 uPencil;

/* How far the blended mask must reach for the paper to be drawn: low enough to cover the corners of unexplored cells */
const float EDGE_LEVEL = 0.2;

/* How far, in pixels, the edge wobbles either way */
const float WOBBLE_PIXELS = 2.5;

/**
 * Draws the paper inside the edge, with the pencil line along it and a fainter sketched line inside that
 */
void main()
{
	vec2 world = worldPosition();
	float wobble = (valueNoise(world / 22.0) - 0.5) * 2.0 + (valueNoise(world / 7.0) - 0.5) * 0.6;
	float edge = distanceInside(world, EDGE_LEVEL) + wobble * WOBBLE_PIXELS;
	float alpha = smoothstep(-0.75, 0.75, edge);

	if (alpha <= 0.0)
	{
		discard;
	}

	vec3 color = texture2D(uPaper, vec2(world.x, -world.y) / uPaperSize).rgb;

	// Paper darkens toward its edge, and the pencil presses unevenly along it
	color = mix(color, uPencil, exp(-max(edge, 0.0) / 7.0) * 0.28);

	float grain = mix(0.55, 1.0, hash(floor(world)));
	float pressure = mix(0.6, 1.0, valueNoise(world / 9.0 + 31.0));
	float line = (1.0 - smoothstep(0.6, 1.5, abs(edge - 1.0))) * grain * pressure;
	float sketch = (1.0 - smoothstep(0.3, 0.9, abs(edge - 3.6 - (valueNoise(world / 13.0 + 57.0) - 0.5) * 3.0))) * grain * 0.45;

	color = mix(color, uPencil * 0.7, clamp(line + sketch, 0.0, 1.0));
	gl_FragColor = vec4(color * alpha, alpha);
}
`;

/**
 * Queues loading the paper's image the game doesn't have yet; call it from the scene's preload()
 *
 * @param scene The scene
 */
export function preloadUnexploredPaper(scene: Phaser.Scene): void
{
	if (!scene.textures.exists(PAPER_TEXTURE_KEY))
	{
		scene.load.image(PAPER_TEXTURE_KEY, paperUrl);
	}
}

/**
 * Sets up hand-drawn paper over the cells a group hasn't explored, in place of the tiles under them; draw
 * it with the cells that are unexplored covered
 *
 * @param scene The scene, once preloadUnexploredPaper() has loaded the paper's image
 * @param columns How many cells wide the paper covers at most
 * @param rows How many cells tall it covers at most
 * @param depth The depth it is drawn at
 * @return The paper, hidden until drawn over unexplored cells
 */
export function createUnexploredPaper(scene: Phaser.Scene, columns: number, rows: number, depth: number): CellMaskShader
{
	scene.textures.get(PAPER_TEXTURE_KEY).setWrap(Phaser.Textures.WrapMode.REPEAT, Phaser.Textures.WrapMode.REPEAT);

	return(new CellMaskShader(scene, {
		name: 'unexplored-paper',
		columns,
		rows,
		depth,
		fragmentSource: FRAGMENT_SHADER,
		textures: [PAPER_TEXTURE_KEY],
		uniforms: {
			uPaper: 1,
			uPaperSize: PAPER_SIZE,
			uPencil: PENCIL_COLOR
		}
	}));
}
