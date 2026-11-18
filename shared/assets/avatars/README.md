# Avatar art

The pictures characters' avatars are drawn from. Every piece is drawn by a person. The server puts
them together into each character's avatar (see Avatars in `STRUCTURE-OVERVIEW.md`).

```
shared/assets/avatars/
	backgrounds/          made by a script, not drawn (npm run avatars:backgrounds -w server)
	stickFigure/          the Stick figure art type
		bases/
		items/
	lucia/                the Lucia art type
		bases/
		items/
```

Each art type's folder has a file in `shared/src/avatars/` that lists what is drawn: `stickFigure.ts`
and `lucia.ts`. A PNG that isn't listed there isn't used.

## Drawing a base

A base is one race in one body type, with nothing equipped.

- PNG, exactly 200 pixels wide and 300 tall, with a transparent background.
- Keep every base of a body type in the same pose and place, so one item drawing fits them all with
  small shifts.
- The body types are masc thick, masc thin, femme thick and femme thin (`mascThick`, `mascThin`,
  `femmeThick`, `femmeThin`). A race's list is in its ruleset's races file
  (`PF1E_RACE_BODY_TYPES` in `shared/src/rulesets/pf1e/races.ts`, `SF1E_RACE_BODY_TYPES` in
  `shared/src/rulesets/sf1e/races.ts`). Change a race's list there if it needs other body types.

Save it as, for example, `lucia/bases/pf1e/human-femmeThin.png`, and list it in `lucia.ts`:

```ts
bases: {
	pf1e: {
		human: {
			femmeThin: 'bases/pf1e/human-femmeThin.png'
		}
	},
	sf1e: {}
},
```

The race is its key in the ruleset (`human`, `half_elf`, `ysoki`...). Once a base is listed, Create
Character offers its art type for that race and body type.

## Drawing an item

- PNG cropped close to the item, with a transparent background. It can be any size.
- Draw what goes in the main hand as if held in the main hand, and a ring as the left ring. The off
  hand and the right ring use the same drawing, flipped, so there is no second file.
- A two-handed grip (a greatsword, or a longsword held in both hands) is a drawing of its own, listed
  with `slots: ['bothHands']`.
- Something that goes both in front of and behind the body, such as a cloak, is two files: one part
  for the front and one for the back with `layer: 'behindBase'`.

List it under the item's key in the ruleset (`longsword`, `leather_armor`...; see the items files in
`shared/src/rulesets/`):

```ts
items: {
	pf1e: {
		short_sword: [
			{
				races: ['human', 'elf', 'half_elf'],
				parts: [
					{
						file: 'items/short_sword.png',
						offsets: {},
						mirroredOffsets: {}
					}
				]
			}
		]
	},
	sf1e: {}
}
```

A drawing can narrow itself:

- `races`: the races it is drawn for (needed).
- `bodyTypes`: only some body types, such as leather armor drawn for each body type.
- `slots`: only some slots, such as `['bothHands']`.

When several drawings match, the most specific one wins. Several items, or drawings, can use the
same file.

Layers follow the order in each ruleset's `equipment.ts` (`PF1E_SLOT_DRAW_ORDER`,
`SF1E_SLOT_DRAW_ORDER`): later slots are drawn in front. A part can set `layer` to another slot to be
drawn with it, or to `'behindBase'`.

## Placing an item on the bases

`offsets` says where the top left corner of each part goes on each base, and `mirroredOffsets` where it
goes flipped, in the off hand or right ring. They are set by hand with the positioning tool:

1. Turn on dev tools: `ENABLE_DEV_TOOLS=true` in `server/.env`.
2. Run the game (`start.bat`, or `npm run dev`) and open
   `https://www.multiversekiln.localhost:5173/avatar-positions`.
3. Choose the art type, item, drawing, race and body type. Drag each part into place, or move it with
   the arrow keys (Shift moves 10 pixels). The off hand and right ring copies are there to place too.
4. The tool lists the bases the drawing still has no place on.
5. Press Copy drawing (Alt+C), and paste it over the same drawing in the art type's file.

A base with no offset for a part doesn't draw that part. A drawing with no mirrored offset draws
nothing in the off hand or right ring on that base.

## Seeing it in the game

The server reads the files as they change, so the next time an avatar or preview is shown it is drawn
again with the new art. Nothing needs to be cleared. Browsers keep each avatar under the hash of what it
draws, so a changed file shows as soon as the page loads the character again.

## Before committing

Run `npm run build -w shared` and `npm run lint`. The art is shipped with the server (Phase 21 checks the
deploy includes this folder), so a file missing from the commit shows as no art on the live site.
