import Phaser from 'phaser';
import { GAME_ROOM_NAME } from '@multiverse-kiln/shared';

/**
 * Placeholder scene confirming Phaser renders and the shared package resolves
 */
export class BootScene extends Phaser.Scene
{
	constructor()
	{
		super('BootScene');
	}

	create(): void
	{
		const { width, height } = this.scale;

		this.add.text(width / 2, height / 2, `Multiverse Kiln - room: ${GAME_ROOM_NAME}`, {
			fontFamily: 'sans-serif',
			fontSize: '32px',
			color: '#ffffff'
		}).setOrigin(0.5);
	}
}
