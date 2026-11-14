import Phaser from 'phaser';
import { GRID_CELL_SIZE } from '@multiverse-kiln/shared';

/**
 * The start of a CellMaskShader's fragment shader: the mask and where it lies, and functions that read it
 *
 * The mask has one pixel per cell, red where a cell is covered. coverage() blends it smoothly between cell
 * centers, so the cells' squares round into one shape, and distanceInside() turns that into how far a
 * point is inside the shape's edge, for edges as sharp and as thick as each shader wants
 */
const CELL_MASK_GLSL = `
#pragma phaserTemplate(shaderName)
#pragma phaserTemplate(extensions)
#pragma phaserTemplate(features)
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
#pragma phaserTemplate(fragmentDefine)

uniform sampler2D uMask;
uniform vec2 uOrigin;
uniform vec2 uSize;
uniform vec2 uMaskOrigin;
uniform vec2 uMaskSize;
uniform float uCellSize;

varying vec2 outTexCoord;

#pragma phaserTemplate(outVariables)
#pragma phaserTemplate(fragmentHeader)

/**
 * Where the pixel being drawn is in the world
 *
 * @return The point, in world pixels
 */
vec2 worldPosition()
{
	return(uOrigin + (vec2(outTexCoord.x, 1.0 - outTexCoord.y) * uSize));
}

/**
 * A random number for a point; the same point always gives the same number
 *
 * @param p The point; whole numbers give unrelated results
 * @return From 0 to 1
 */
float hash(vec2 p)
{
	p = mod(p, 289.0);
	return(fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453));
}

/**
 * Smooth noise: random values at whole numbers, blended between them
 *
 * @param p The point
 * @return From 0 to 1
 */
float valueNoise(vec2 p)
{
	vec2 i = floor(p);
	vec2 f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	float a = hash(i);
	float b = hash(i + vec2(1.0, 0.0));
	float c = hash(i + vec2(0.0, 1.0));
	float d = hash(i + vec2(1.0, 1.0));
	return(mix(mix(a, b, f.x), mix(c, d, f.x), f.y));
}

/**
 * How covered a point is, blending the mask smoothly between cell centers so the cells' squares round
 * into one shape. Past the mask's edge, its edge cells carry on
 *
 * @param world The point, in world pixels
 * @return 1 at the center of a covered cell, 0 at the center of an uncovered one
 */
float coverage(vec2 world)
{
	vec2 p = ((world - uMaskOrigin) / uCellSize) + 0.5;
	vec2 i = floor(p);
	vec2 f = p - i;
	f = f * f * (3.0 - 2.0 * f);
	vec2 uv = (i + f - 0.5) / uMaskSize;
	return(texture2D(uMask, vec2(uv.x, 1.0 - uv.y)).r);
}

/**
 * How far a point is inside the edge where the blended mask reaches a level: the mask's level over how
 * fast it changes there
 *
 * @param world The point, in world pixels
 * @param edgeLevel The level the edge is drawn at, from 0 to 1; 0.5 follows the cells' sides
 * @return The distance, in pixels; negative outside the edge
 */
float distanceInside(vec2 world, float edgeLevel)
{
	float level = coverage(world);
	vec2 slope = vec2(coverage(world + vec2(1.0, 0.0)) - level, coverage(world + vec2(0.0, 1.0)) - level);
	return((level - edgeLevel) / max(length(slope), 0.00001));
}
`;

/**
 * How a CellMaskShader draws
 */
export interface CellMaskShaderConfig
{
	/**
	 * Names the shader and its mask's texture; each kind of CellMaskShader needs its own
	 */
	name: string;

	/**
	 * How many cells wide the shader covers
	 */
	columns: number;

	/**
	 * How many cells tall it covers
	 */
	rows: number;

	/**
	 * The depth it is drawn at
	 */
	depth: number;

	/**
	 * The fragment shader's own uniforms, functions and main(), which follow CELL_MASK_GLSL. It outputs
	 * premultiplied alpha
	 */
	fragmentSource: string;

	/**
	 * Keys of more textures the shader reads, bound to texture units 1 and up
	 */
	textures?: string[];

	/**
	 * Values of the shader's own uniforms, including the texture unit of each of its textures
	 */
	uniforms?: Record<string, unknown>;
}

/**
 * Draws a shader over a block of cells, given which of them are covered: a mask of the cells, one pixel
 * each, which the shader reads through CELL_MASK_GLSL's functions to draw rounded shapes rather than
 * squares
 */
export class CellMaskShader
{
	private readonly shader: Phaser.GameObjects.Shader;
	private readonly mask: Phaser.Textures.CanvasTexture;

	/**
	 * Pixels of the mask, reused for every drawing
	 */
	private readonly maskPixels: ImageData;

	/**
	 * Whether the shader is drawn over a part of the world cover() gave, rather than over the mask's cells
	 */
	private covering = false;

	/**
	 * Sets up the shader, hidden until draw() finds covered cells
	 *
	 * @param scene The scene, once the shader's textures have loaded
	 * @param config How it draws
	 */
	constructor(scene: Phaser.Scene, config: CellMaskShaderConfig)
	{
		const { name, columns, rows } = config;
		const maskKey = `${name}-mask`;
		const existing = (scene.textures.exists(maskKey) ? scene.textures.get(maskKey) : undefined);

		// The game outlives the scene, so a mask made for an earlier run is reused
		if ((existing instanceof Phaser.Textures.CanvasTexture) && (existing.width === columns) && (existing.height === rows))
		{
			this.mask = existing;
		}
		else
		{
			if (existing)
			{
				scene.textures.remove(maskKey);
			}

			const created = scene.textures.createCanvas(maskKey, columns, rows);

			if (!created)
			{
				throw new Error(`The ${name} mask could not be made`);
			}

			this.mask = created;
		}

		// coverage() smooths between cell centers itself from linearly filtered samples
		this.mask.setFilter(Phaser.Textures.FilterMode.LINEAR);

		// Past its edge the mask's edge cells carry on (see cover())
		this.mask.setWrap(Phaser.Textures.WrapMode.CLAMP_TO_EDGE, Phaser.Textures.WrapMode.CLAMP_TO_EDGE);
		this.maskPixels = this.mask.context.createImageData(columns, rows);

		this.shader = scene.add.shader({
			name,
			fragmentSource: CELL_MASK_GLSL + config.fragmentSource,
			initialUniforms: {
				...config.uniforms,
				uMask: 0,
				uMaskSize: [columns, rows],
				uSize: [columns * GRID_CELL_SIZE, rows * GRID_CELL_SIZE],
				uCellSize: GRID_CELL_SIZE,
				uOrigin: [0, 0],
				uMaskOrigin: [0, 0]
			}
		}, 0, 0, columns * GRID_CELL_SIZE, rows * GRID_CELL_SIZE, [maskKey, ...(config.textures ?? [])])
			.setOrigin(0, 0)
			.setDepth(config.depth)
			.setVisible(false);
	}

	/**
	 * Draws the shader over a block of cells, or hides it when none of them are covered
	 *
	 * @param left The block's first column, in world cells
	 * @param top The block's first row, in world cells
	 * @param isCovered Whether the cell at a column and row of the block, counted from 0, is covered
	 */
	draw(left: number, top: number, isCovered: (column: number, row: number) => boolean): void
	{
		const { width, height, data } = this.maskPixels;
		let any = false;

		for (let row = 0; row < height; row++)
		{
			for (let column = 0; column < width; column++)
			{
				const covered = isCovered(column, row);
				const index = ((row * width) + column) * 4;

				data[index] = (covered ? 255 : 0);
				data[index + 1] = 0;
				data[index + 2] = 0;
				data[index + 3] = 255;
				any ||= covered;
			}
		}

		this.shader.setVisible(any);

		if (!any)
		{
			return;
		}

		this.mask.context.putImageData(this.maskPixels, 0, 0);
		this.mask.refresh();

		const x = left * GRID_CELL_SIZE;
		const y = top * GRID_CELL_SIZE;

		this.shader.setUniform('uMaskOrigin', [x, y]);

		if (!this.covering)
		{
			this.shader.setPosition(x, y);
			this.shader.setUniform('uOrigin', [x, y]);
		}
	}

	/**
	 * Draws the shader over a part of the world, such as the camera's view, rather than over the mask's
	 * cells. Past the mask's edge its edge cells carry on, so a mask whose edge cells are covered covers
	 * everything past it. Call it again whenever that part moves
	 *
	 * @param area The part of the world, in world pixels
	 */
	cover(area: Phaser.Geom.Rectangle): void
	{
		this.covering = true;
		this.shader
			.setPosition(area.x, area.y)
			.setDisplaySize(area.width, area.height);
		this.shader.setUniform('uOrigin', [area.x, area.y]);
		this.shader.setUniform('uSize', [area.width, area.height]);
	}

	/**
	 * Hides the shader until it is next drawn over covered cells, so it isn't run while it can't show
	 */
	hide(): void
	{
		this.shader.setVisible(false);
	}

	/**
	 * Changes one of the shader's own uniforms (see CellMaskShaderConfig.uniforms)
	 *
	 * @param name The uniform's name
	 * @param value Its new value
	 */
	setUniform(name: string, value: unknown): void
	{
		this.shader.setUniform(name, value);
	}

	/**
	 * Removes the shader from the scene
	 */
	destroy(): void
	{
		this.shader.destroy();
	}
}
