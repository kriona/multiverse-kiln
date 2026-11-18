/**
 * The Lucia art type, drawn by Lucia Pan: its bases and item drawings, in shared/assets/avatars/lucia/.
 * Its name is the artist's, so it isn't a message
 *
 * Add a base under its ruleset, race and body type, and an item's drawings under its ruleset and key (see
 * ItemDrawing in manifest.ts). The positioning tool (client/avatar-positions.html, with dev tools on)
 * places a drawing's parts and copies their offsets to paste here
 */
import type { ArtTypeManifest } from './manifest.js';

export const LUCIA_ART: ArtTypeManifest = {
	name: 'Lucia',
	bases: {
		pf1e: {},
		sf1e: {}
	},
	items: {
		pf1e: {},
		sf1e: {}
	}
};
