import Phaser from 'phaser';

import { CellMaskShader } from './CellMaskShader';

/**
 * Lays a flat color over the covered cells, with their squares rounded into smooth shapes that follow
 * the cells' sides
 */
const FRAGMENT_SHADER = `
uniform vec3 uColor;
uniform float uAlpha;

/**
 * Draws the color inside the edge, smoothed over a pixel and a half
 */
void main()
{
	float alpha = smoothstep(-0.75, 0.75, distanceInside(worldPosition(), 0.5)) * uAlpha;

	if (alpha <= 0.0)
	{
		discard;
	}

	gl_FragColor = vec4(uColor * alpha, alpha);
}
`;

/**
 * Sets up fog with rounded edges; draw it with the cells out of sight covered
 *
 * @param scene The scene
 * @param columns How many cells wide the fog covers at most
 * @param rows How many cells tall it covers at most
 * @param depth The depth it is drawn at
 * @param color The fog's color, such as 0x000000
 * @param alpha How opaque it is, from 0 to 1
 * @return The fog, hidden until drawn over cells out of sight
 */
export function createRoundedFog(scene: Phaser.Scene, columns: number, rows: number, depth: number, color: number, alpha: number): CellMaskShader
{
	const rgb = Phaser.Display.Color.IntegerToColor(color);

	return(new CellMaskShader(scene, {
		name: 'rounded-fog',
		columns,
		rows,
		depth,
		fragmentSource: FRAGMENT_SHADER,
		uniforms: {
			uColor: [rgb.redGL, rgb.greenGL, rgb.blueGL],
			uAlpha: alpha
		}
	}));
}
