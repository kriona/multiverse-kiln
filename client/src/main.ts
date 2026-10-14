import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';

const config: Phaser.Types.Core.GameConfig = {
	type: Phaser.WEBGL,
	parent: 'game',
	width: 960,
	height: 540,
	backgroundColor: '#1d1f27',
	scene: [BootScene]
};

new Phaser.Game(config);
