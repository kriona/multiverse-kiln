/**
 * The stick figure art type: its bases and item drawings, in shared/assets/avatars/stickFigure/. Every
 * other art type falls back to it for a character it has no base for
 *
 * Add a base under its ruleset, race and body type, and an item's drawings under its ruleset and key (see
 * ItemDrawing in manifest.ts). The positioning tool (client/avatar-positions.html, with dev tools on)
 * places a drawing's parts and copies their offsets to paste here
 */
import { ART_TYPE_MESSAGES, type ArtTypeManifest } from './manifest.js';

export const STICK_FIGURE_ART: ArtTypeManifest = {
	name: ART_TYPE_MESSAGES.stickFigure,
	bases: {
		pf1e: {
			elf: {
				femmeThicc: 'bases/pf1e/elf-thicc.png',
				femmeThin: 'bases/pf1e/elf-thin.png',
				mascThicc: 'bases/pf1e/elf-thicc.png',
				mascThin: 'bases/pf1e/elf-thin.png'
			},
			goblin: {
				femmeThicc: 'bases/pf1e/goblin-thicc.png',
				femmeThin: 'bases/pf1e/goblin-thin.png',
				mascThicc: 'bases/pf1e/goblin-thicc.png',
				mascThin: 'bases/pf1e/goblin-thin.png'
			},
			halfling: {
				femmeThicc: 'bases/pf1e/halfling-thicc.png',
				femmeThin: 'bases/pf1e/halfling-thin.png',
				mascThicc: 'bases/pf1e/halfling-thicc.png',
				mascThin: 'bases/pf1e/halfling-thin.png'
			},
			human: {
				femmeThicc: 'bases/pf1e/human-thicc.png',
				femmeThin: 'bases/pf1e/human-thin.png',
				mascThicc: 'bases/pf1e/human-thicc.png',
				mascThin: 'bases/pf1e/human-thin.png'
			},
			orc: {
				femmeThicc: 'bases/pf1e/orc-thicc.png',
				femmeThin: 'bases/pf1e/orc-thin.png',
				mascThicc: 'bases/pf1e/orc-thicc.png',
				mascThin: 'bases/pf1e/orc-thin.png'
			}
		},
		sf1e: {}
	},
	items: {
		pf1e: {},
		sf1e: {}
	}
};
