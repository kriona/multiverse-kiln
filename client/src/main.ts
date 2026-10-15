import Phaser from 'phaser';
import { WORLD_HEIGHT, WORLD_WIDTH } from '@multiverse-kiln/shared';

import { GameScene } from './scenes/GameScene';

// One world unit is one pixel, so the canvas shows the whole world
const config: Phaser.Types.Core.GameConfig = {
	type: Phaser.WEBGL,
	parent: 'game',
	width: WORLD_WIDTH,
	height: WORLD_HEIGHT,
	backgroundColor: '#1d1f27',
	scene: [GameScene]
};

new Phaser.Game(config);
