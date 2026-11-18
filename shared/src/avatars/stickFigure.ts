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
		pf1e: {},
		sf1e: {}
	},
	items: {
		pf1e: {},
		sf1e: {}
	}
};
