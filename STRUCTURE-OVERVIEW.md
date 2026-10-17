This document describes the UI + game structure for the Multiverse Kiln. It describes the framework only: some systems (such as monsters and gaining experience) are left out, and not all settings are listed yet. Undecided items are collected in [Open questions](#open-questions).

# Pages
## Home
Lists all universes. In the beginning there will only be a few, but in the future there may be thousands, so we should be forward-thinking about the UI (even if advanced search filters don't exist yet). Each universe should show name, 1-sentence description, ruleset, and [languages](#tab-translations). Only universes in the `prologue` or `let there be light` [stage](#edit-universe) are listed. Shows a button for [Create Universe](#create-universe).

Selecting a universe to join will show you a modal overview for the universe. The modal will list all details about the universe. There will be an [Enter Universe](#enter-universe) button.

## About
Free text. There will be many of these pages (like an FAQ or Help).

## Login
You select a login provider like Google or Discord, or you can make a local account. Local logins are based on email, not username (but email can be changed).

Local accounts are supported, but the login and register pages recommend a provider for security reasons.

## Register local account
Enter an email, it sends you an [email code](#email-codes), enter the code to create an account / set your password. Recommend the user use a password manager, link to a couple prominent ones. Emails you when you have a new account. Optional - set up 2FA now.

## Forgot your password
Enter an email, it sends you an [email code](#email-codes), enter the code to change your password. Emails you when the password is changed, and signs the account out everywhere.

## Email codes
Registering, resetting a password and changing an email all send a code by email. Every code follows these rules:
- Sending
	- generated with a cryptographically secure random number generator
	- 6 characters from Crockford's base32 alphabet (the digits and capital letters except I, L, O and U), a little over a billion possible codes
	- typing is forgiving: case is ignored, spaces and dashes are removed, and O, I and L are read as 0, 1 and 1
	- stored only as a keyed hash (HMAC), never in plain text
	- valid for 15 minutes, and works once
	- a new code can be sent once every 60 seconds, and at most 5 times an hour per address. A new code replaces the old one
- Guessing
	- 5 wrong guesses end a code
	- 15 wrong guesses in a day, across every code for that address, stop new codes from being sent to it until the oldest guess is a day old
	- one network may ask for 10 codes and make 30 guesses an hour, whatever addresses they are for. A network is an IPv4 address or an IPv6 /64. Behind a proxy (such as Colyseus Cloud's), the client address comes from the proxy's forwarding header, trusted only from the proxy
	- counters are updated atomically, so many requests sent at once can't each slip under a limit
- Privacy
	- the response is the same whether or not an account exists for the address, and takes the same time (the email is sent after the response)
	- what was typed and the network address are stored as keyed hashes, and only for as long as a limit still needs them
- Finishing
	- a correct code hands the next step (setting the password) to the browser session that entered it, through a new session ID in an httponly cookie, for 10 minutes. Another browser waiting on the same account can't use it

## Profile edit
Everything is optional except name.
- photo (200px square, shown as a circle)
- email, with a change email button for local accounts. Enter an email, it sends you an [email code](#email-codes), enter the code to change your email. Email both addresses letting them know that the email has changed.
- if a local account, a change password button. Emails you when the password is changed.
- Optional - set up 2FA
- name (required, but it doesn't need to be your real name)
- pronouns
- location / time zone
- language, used for the pages and for universes translated into it (see [Localization](#localization))
- link to socials (Discord, Facebook, Insta, TikTok)
- "show my characters", checked by default. if unchecked, a "other players in your group will always be able to see a link to your profile, even if your character isn't shown on your profile".
- a list of your characters, grouped by universe
	- if "show my characters" is unchecked, show checkbox next to individual characters for "visible".
	- clicking on a character will show a modal dialog with their character sheet and a [Enter Universe](#enter-universe) button.

## Profile view
Shows every profile field the user has filled in (name, photo, pronouns, location, time zone, socials) and their visible characters. Fields are optional, so users control what others see by leaving them blank.

## Enter Universe
If you have not created a character, you will go to the [lobby](#lobby).

If you have created a character, you will go to where your most recently played character is (either the lobby or the game itself). If that character's group isn't running or has been disbanded, you go to the lobby as that character.

## Lobby
The lobby runs the game engine. It will be a small area where many people (more than the 6-player group limit) can connect and chat.
- Some rules will be similar to the game itself - the graphic tile set, you can move around the space, you can enter houses.
- Some rules will be different - you cannot use items, time passes based on [lobby settings](#tab-lobby) and not game settings (it's not turn-based).
- There will be a button for [Create Character](#create-character). You can create multiple characters.
- There will be a chat. You chat as your character.
- If you have not created a character, you will use a ghost icon and nobody can see you. You can walk around the space. You can read chat but not send messages. Ghosts don't block cells. The [Create Character](#create-character) button should be more prominent.
- If you have created a character, chat will be enabled. You will move about the space as your character. You can switch characters at any time.
- You may create up to 20 characters per universe.
- If you have a character selected, a [Create Group](#create-group) button will be enabled.
- Groups can be listed in the lobby so players can find them without an invite. How a group manages its listing is not yet defined.

Colyseus has no built-in player limit for a room; we set it (`maxClients`). The real limit comes from the server's CPU and bandwidth: every movement is sent to every other player, so traffic grows with the square of the number of players. The number will come from load testing. When the lobby is full, another instance of it opens.

### Cross-universe play
This stays loosely defined until more of the infrastructure exists.

If a universe allows it, and you are in the universe's lobby, you may enter a portal room that lets you jump universes. The portal room is probably an auto-generated zone showing each universe you can enter.
- Your name will be "[Name] of [Universe]" and "of [Universe]" should be styled italic / slightly darker than the rest of the text it displays with.
- You can enter even if your race or class is disabled in the other universe. Universes that allow cross-play need to work this out between themselves.
- Items work the same as in your home universe. Items may need a "source universe" setting.
- Your art is retained from your home universe. Each universe has its own artwork for characters and items. A character has:
	- a sprite, shown on the map. It may or may not be generated automatically from the avatar
	- an avatar, a larger view of the character showing all their worn items. Every item needs avatar art drawn by an artist

## Create Character
Based entirely on the universe's ruleset. It is a page of its own, reached from the lobby, that goes through steps (name, race, class, ability scores, then a review) and returns to the lobby when the character is made. Rulesets will add more steps, so there may be a lot to work through:
- the player's progress is saved on the server a moment after each change and when the step changes, so they can go back to the lobby, close the browser, or switch browsers, and pick up on the step they were on. "Start over" throws the progress away
- progress is checked against the universe only when the character is made; a race or class that has since been disabled is left out when the progress loads

For PF1E, the server rolls the ability scores (or checks the point buy choices) using the universe's [stat rolling](#pf1e) setting; the client never sends ability scores of its own. The player can rearrange rolled scores among the abilities, with the class's primary ability as a hint.
- the server keeps a player's rolled scores until they make a character with them, so leaving Create Character or starting over doesn't roll again. If the universe changes how it rolls, the next visit rolls again
- the player chooses a name, an enabled race and an enabled class. A race with a floating ability bonus asks which ability gets it
- the character starts with the universe's, race's and class's starting money added coin by coin, their starting equipment added together (enabled items only), and the [starting zone](#tab-characters) the precedence picks
- the lobby lists the player's characters in the universe
- a race, class or item that characters have can't be deleted; it can be disabled instead

## Create Group
The character creating the group is the "anchor being". This shows you a landing page for your new group. It explains that your character is the anchor being for this universe, and that the game is centered around them.
- The group starts in the anchor being's [starting zone](#tab-characters).
- If the anchor being leaves the group, the group is disbanded and its [world state](#world-state) is deleted. Every character keeps their items, money and experience.
- If the anchor being is offline, the group can't use [zone links](#editor-map) that require the whole group (for example, leaving the city for the wilderness), but can use the ones that don't (entering a shop in the city).

You can give the group a name.

There's a "Invite" button that opens a modal dialog.
- You can pick a user and send them an invite in a private message.
- You can create a link with the following options:
	- single use or multi-use
	- valid for 1 day, 1 week, indefinite
	- there will be a "Copy Link" button

Opening an invite takes you to a character selection screen with an option to create a character. Characters that are already in a group are grayed out and can't be selected. If the group is full, you get a message saying you can't join because it's full.

A player can have several characters in one group (a player could make a group of 6 of their own characters), and switches between them in the UI without changing browser tabs.

## Messages
You can send messages to other users (or yourself).

Before messaging is supported, it needs:
- blocking
- reporting
- rules for who is allowed to message whom

## Create Universe
This is a modal dialog on the home page that asks for some basic info before creating a universe. These fields will be identical to the ones on the [Edit Universe](#edit-universe) page.
- name
- 1-sentence description

Creating a universe
- creates a lobby zone, and a default zone that it sets as the starting zone for all races
- makes you its creator

A user may create up to 5 universes.

## Edit Universe
This lets you change anything about a universe. It will be a whole suite of tools unrelated to playing the game.
- name
- logo
- banner image
- 1-sentence description
- long description, written in markdown
- dropdown for "Stage"
	- `in the beginning` - still being created. Only creators and builders can play. Not listed on [Home](#home)
	- `prologue` - open for beta testers. Not listed on [Home](#home)
	- `let there be light` - (ready for people to join. Listed on [Home](#home)
	- `end of time` - retired. Locked and view only. Not listed on [Home](#home)
- a dropdown for ruleset - no default, the only option for now is Pathfinder 1E
- a dropdown for "passage of time", the default for every [zone](#editor-zone)
	- `flows normally` (based on character actions, see [time and distance](#time-and-distance))
	- `always dawn`
	- `always noon`
	- `always dusk`
	- `always midnight`
	- `faerie`: the time of day depends on where you are on the map. If morning is to the west, the furthest west point is sunrise and the furthest east point is midnight. Selecting `faerie` shows an option for "where is morning?" with a dropdown for:
		- `north`
		- `northeast`
		- `east`
		- `southeast`
		- `south`
		- `southwest`
		- `west`
		- `northwest`
		- `center`
		- `horizon` (the center is night)
	- there is no `real-time` option: it would need time to keep running while nobody is logged on, which is expensive. The lobby can use it because only the time of day changes there, and that is calculated from the Unix epoch
- Tabs:
	- [Editors](#tab-editors)
	- [Ruleset](#tab-ruleset)
	- [Lobby](#tab-lobby)
	- [Characters](#tab-characters)
	- [Races](#tab-races)
	- [Classes](#tab-classes)
	- [Tilesets](#tab-tilesets)
	- [Zones](#tab-zones)
	- [Items](#tab-items)
	- [Connect to the Multiverse](#tab-connect-to-the-multiverse)
	- [Translations](#tab-translations)

### Unsaved changes
The editor makes it hard to lose work by accident. A form or dialog with changes that haven't been saved says "Unsaved changes" next to its Save button, and its tab gets a dot. Closing a dialog (Cancel or Escape), leaving the zone being edited, and leaving or reloading the page all ask first while there are unsaved changes, and so does leaving the page while painting is still being saved.

### Universe versions
If a creator makes changes to the current version of the universe, they apply immediately for everyone.

A creator can choose to switch to a new version (e.g, 1.1) while making changes, then can switch the universe to 1.1 and all of the changes apply at once. A version includes its [translations](#tab-translations), so they switch over with it.

### Disabling things players are using
Disabling or limiting something that players are already using warns the editor and asks what should happen:
- a race: "allow them to continue to play, only disable the race for new characters" or "prevent them from playing"
- a class: "allow them to continue to play, only disable the class for new characters" or "prevent them from playing"
- a zone with characters in it: "move everyone to the parent zone" or "move everyone back to their start zone"
- an item characters have: "allow them to continue to use it, prevent new copies of the item from being made" or "remove it from characters, it will be re-added when the item is re-enabled"
- lowering the group size below a group's current size: "allow those groups to continue to play, only limit the size for new groups", "disband larger groups" or "remove X number of group members, starting with those who joined most recently"

Changing the stat rolling method doesn't change existing characters.

### Tab: Editors
Lists the users who can work on the universe, and lets you add them with a role:
- `creator` (admin): can change everything
- `builder`: can make changes to the world, e.h. to zones or NPCs
- `beta tester`: can create characters and play while the universe is in `prologue`
- `translator`: can [translate](#tab-translations) the universe's text into the languages they are assigned, and can't change anything else

A universe can have several creators. If you delete your account and your universe has no other creator, you choose what happens to it:
- promote a builder to creator
- the universe goes dormant: people can keep playing, but only server admins can edit it

### Tab: Ruleset
What shows up here depends on what ruleset is chosen.

#### PF1E
Pathfinder 1E's rules (races, classes, abilities, point buy, sizes and items) are Open Game Content used under the Open Game License 1.0a, and the name "Pathfinder" is used under Paizo's Community Use Policy. Both notices are on the license page. The Community Use Policy only covers a game that is free to play (donations and ads are allowed, a paywall isn't).

- dropdown for "rolling for stats"
	- 3d6
	- 3d6 reroll 1s
	- 4d6 drop lowest
	- 4d6 reroll 1s drop lowest
	- point buy `low fantasy` (10)
	- point buy`standard fantasy` (15)
	- point buy `high fantasy` (20)
	- point buy `epic fantasy` (25)
	- point buy (you define the #)
	- rolling makes six scores, which the player can rearrange among the abilities. Rerolling 1s rolls each 1 again until it isn't one
	- point buy uses PF1E's costs: 7 = -4, 8 = -2, 9 = -1, 10 = 0, 11 = 1, 12 = 2, 13 = 3, 14 = 5, 15 = 7, 16 = 10, 17 = 13, 18 = 17. Each score is 7 to 18 before racial modifiers, and the total can't be more than the budget. A custom budget is 0 to 102 (every score 18)
- do characters get tired and require sleep?
- does gold count towards weight?
- track ammo?

### Tab: Lobby
- a dropdown for "passage of time". the options being:
	- `always dawn`
	- `always noon`
	- `always dusk`
	- `always midnight`
	- `real-time`
		- shows an additional option for "how quickly?" with a description of "how long in real-time does it take for 1 day in the lobby to pass?" minimum 1 hour, maximum 240 hours. Default 24. Current time of day is based on the Unix epoch
	- `faerie`
- a button for "Edit Map" which takes you to the [zone editor](#editor-zone) for the lobby

### Tab: Characters
- Group size, minimum 1 (single player only) maximum 6 (infrastructure / server max), default server max
- Starting equipment, lets you [select items](#selection-item). A new universe starts with one dagger for every character. An item in the starting equipment can't be deleted until it is taken out
- Starting [money](#field-money)
- Starting [zone](#selection-zone)

Each [race](#tab-races) and [class](#tab-classes) can add to the starting money and equipment, and choose a starting zone of its own.

A character's starting zone is chosen in this order, most specific first: the class's entry for their race, the class, the race, then the universe. A class with a zone of its own has no entries for races, so the two never compete.

Races and classes work like default items: the ruleset's defaults are in every universe, an edit applies to that universe only and can be undone to restore the default (losing its starting money, equipment and zones too), and a race or class the universe added can be deleted. Like the Characters tab, only creators can change them.

### Tab: Races
based on the ruleset, show a list of races.

For PF1E that list is:
- `Catfolk`
- `Drow`
- `Dwarf`
- `Elf`
- `Goblin`
- `Gnome`
- `Half Elf`
- `Half Orc`
- `Halfling`
- `Hobgoblin`
- `Human`
- `Ratfolk`

You can add your own races, but any unique abilities of a race must be coded by the site developers.

You can edit each race:
- Enabled? Checked by default. There must be at least 1 enabled race in order to save changes
- Additional starting equipment, lets you [select items](#selection-item)
- Additional starting [money](#field-money)
- Starting [zone](#selection-zone), lets you override
- for PF1E:
	- ability modifiers? lists abilities (`strength`, `dexterity`, `constitution`, `intelligence`, `wisdom`, `charisma`) and a number field for each (minimum -99, maximum 99)
	- floating ability bonus? a checkbox. When checked, the player chooses which ability gets the bonus (in PF1E, humans, half elves and half orcs get +2 to one ability of their choice)
	- has darkvision? a checkbox
	- size
		- `fine`
		- `diminutive`
		- `tiny`
		- `small`
		- `medium`
		- `large`
		- `huge`
		- `gargantuan`
		- `colossal`

### Tab: Classes
based on the ruleset, show a list of classes.

For PF1E that list is:
- `Alchemist`
- `Barbarian`
- `Bard`
- `Cavalier`
- `Cleric`
- `Druid`
- `Fighter`
- `Inquisitor`
- `Monk`
- `Oracle`
- `Paladin`
- `Ranger`
- `Rogue`
- `Sorcerer`
- `Summoner`
- `Witch`
- `Wizard`

You can add your own classes, but any unique abilities of a race must be coded by the site developers.

You can edit each class:
- Enabled? Checked by default. There must be at least 1 enabled class in order to save changes
- Add starting equipment, note it is in addition to starting + racial equipment, lets you [select items](#selection-item)
- Add starting [money](#field-money), note it is in addition to starting + racial money
- Edit starting zone button. If clicked:
	- [Zone selection](#selection-zone), default null. If a zone is selected, the per-race entries for this class are disabled. Show a message: all members of this class, regardless of race, start here. The entries stay in the form while it is open, so clearing the zone brings them back, but saving with a zone selected discards them
	- An entry for each playable race (and any disabled race that has one). Default is the race's start zone, can be overridden
- for PF1E:
	- primary ability score (`strength`, `dexterity`, `constitution`, `intelligence`, `wisdom`, `charisma`), used as a hint when assigning stats
	- magic tradition
		- `none`
		- `arcane`
		- `divine`
	- spellcasting style
		- `none`
		- `prepared`
		- `spontaneous`

### Tab: Tilesets
shows you a table of all tiles in the game, populated from the default for your ruleset and any tiles you have created. Default tiles can be edited: the edit applies to your universe only, and can be undone to restore the default. A tile you created can be deleted once no map uses it.

It needs a filter control that includes:
- name search
- "is passable" toggle
- "is custom" toggle
- "is edited from default" toggle
- pagination (500 by default)

the table contains:
- icon (or color)
- name, links to the [tile editor](#editor-tile)
- movement cost

For PF1E, the default tiles are
- outdoors
	- Grass, color #7AFF3D, 0% vision cost, 0% movement cost
	- Forest, color #0A1, 50% vision cost, 50% movement cost
	- Desert, color #E5E500, 0% vision cost, 50% movement cost
	- Mountains, color #777, 100% vision cost, 100% movement cost
	- Water, color #3D97FF, 0% vision cost, 100% movement cost
- indoors
	- Wood Floor, color #7A3202, 0% vision cost, 0% movement cost

### Tab: Zones
lists all top-level zones for a universe, excluding the lobby.
- if there is only one zone, show all child zones for that zone. keep showing child zones until there are no children or there are more than 1 children.
- clicking on a zone lets you [edit it](#editor-zone).

button to Add Zone

### Tab: Items
shows you a table of all items in the game, populated from the default for your ruleset and any items you have created.

It needs a filter control that includes:
- name search
- "is enabled" toggle
- "is custom" toggle
- "is edited from default" toggle
- toggles for each property
	- for example, a toggle for `weapons`, and then a toggle for `longswords`
	- note that these toggles will be based on the ruleset
- pagination (500 by default)

the table contains:
- icon
- name, links to the [item editor](#editor-item)
- summary (item type, properties, etc)

For PF1E, the only default item for now is a dagger.

Default items work like default tiles: an edit applies to your universe only and can be undone to restore the default, and an item you created can be deleted.

Each ruleset groups its item types into categories, which the filters use. For PF1E:
- `weapons`: dagger, club, quarterstaff, spear, short sword, longsword, shortbow, longbow, light crossbow, arrows, crossbow bolts
- `armor`: padded armor, leather armor, chain shirt, light shield, heavy shield
- `gear`: rope, torch

Until items have pictures, the icon is the item's category's.

### Tab: Connect to the Multiverse
Explain that this allows characters to move freely between universes with the same ruleset. If no other universes with this ruleset exist, say that you're alone in the multiverse.

- There's an option for "any universe with this ruleset", which connects only to other universes that have also chosen it.
- There's an option to list a specific universe, which requires you to work with the creators of that universe (they must list you, too).

### Tab: Translations
Lets the universe be played in more than one language. See [Localization](#localization) for how a player's language is chosen.
- source language, the language the universe's editors write in. Defaults to the creator's language
- languages, the languages the universe is translated into. [Home](#home) shows the source language and these
- choosing a language shows a table of every piece of universe text:
	- where it comes from (e.g. "Zone: Waterdeep, name")
	- the source text
	- a note for translators, written by the universe's editors (e.g. "a pun on the town's founder; keep the joke rather than the words")
	- the translation
- filters:
	- search
	- "is missing" toggle
	- "is out of date" toggle
- a translation that is [out of date](#out-of-date-translations) can be updated, or confirmed as still correct
- export and import, for translators working outside the editor
- long descriptions are translated as markdown, and sanitized the same way as the source

# Gameplay
## Time and distance
In the lobby, actions take no time. The lobby's time of day comes from its [passage of time](#tab-lobby) setting.

Combat is turn-based.
- A square is 5 feet, matching PF1E's movement, reach and spell areas.
- A PF1E combat round is 6 seconds, so the time combat took is added when it ends.

Outside of combat, time is based on your actions - if you are standing still, no time passes. Walking a square takes a set amount of time (still to be defined - tiles need to be given a size).

On the overworld map, squares are much bigger distances. The scale is not yet defined, but time will pass faster.

## Offline group members
Offline characters don't move. One idea under consideration: every character gets a "ring of 'my friend' summoning". It lets a player unsummon friends who are offline, so their characters don't sit around idle, and when those friends log back in they are teleported to the group for an in-game reason.

## World state
Each group has its own world state, stored as a diff of the universe as it was built. If your group kills an NPC, your world state records that the NPC is dead, and only your group is affected. It also holds the areas you have explored, the results of NPC dialog, etc.

Disbanding a group deletes its world state. Characters (items, money, experience) are stored separately and kept.

## Vision
Each character has a vision budget. Looking across a tile spends its vision cost, and once the budget runs out you can't see past that tile, so a line of mountains blocks your view.
- Night lowers the vision budget unless the character has darkvision.
- Ideally the server works out what each player can see and only sends them that. If that turns out to be too expensive, the client does it. To be decided during implementation.

## Moderation
- Users can report content and players.
- Copyright holders can report infringement.
- Server admins can disable universes.
- Uploading an image requires checking "I have the rights to use this image".
- Each ruleset comes with a set of stock graphics, so universes don't need their own art.

# Controls

## Field: Money
Freetext but requires a format like "1pp 2gp 2sp 4cp"

Money is kept as individual pieces of each coin, the way a purse holds them, and is never converted automatically: gaining 5sp twice is 10sp, not 1gp, and starting money from the universe, race and class adds up coin by coin. A character can hold 1pp 302gp 4444sp 10cp. A money changer converts coins into the fewest coins of the same worth (that purse becomes 75pp 6gp 5sp). Who offers money changing, and whether it costs a fee, comes with NPCs.

## Selection: Item
modal dialog, lets you type to search, shows you the top results, with name + stats + picture. Each selected item has a quantity (for example, 20 arrows), from 1 to 999. Disabled items can be selected and are marked as disabled; characters are only given enabled items.

## Editor: Item
- name
- type (e.g., "longsword"), one of the ruleset's item types
- a checkbox for "Enabled?", checked by default

## Selection: Zone
modal dialog, lets you type to search, shows the top results, shows you a small preview image of the zone

## Editor: Zone
Lets you edit details about the zone
- name
- enabled?
	- For new zones, if the universe stage is `in the beginning`, default checked, otherwise default unchecked.
	- if any parent zone is not enabled, show a message
- parent zone. Parent zones mostly give zones a structure; a child zone inherits only its passage of time
- indoors / outdoors
- default tile, which defaults to "grass" if outdoors and "wood floor" if indoors
- passage of time, the same options as the universe's plus `inherit` (the default). `inherit` uses the parent zone's setting, and a zone with no parent uses the universe's
- checkbox for "loops east-west"
- checkbox for "loops north-south"
	- a zone whose passage of time is `faerie` can't loop
- [map editor](#editor-map)

## Editor: Map
This is a component included in the [zone editor](#editor-zone). It shows you the same grid as gameplay.
- the center of map is x = 0, y = 0
- each side of the map (top, right, bottom, left) has a button with an arrow pointing away from the editor. clicking it allows you to add the specified number of grid coordinates in that direction, expanding the map
- a map can be at most 50,000 tiles in each direction
- a button to edit size
	- a 3x3 grid, 4 input fields (each in north, east, south, west), showing the number of tiles in that direction
	- a readonly sentence shows the total dimensions (e.g., 1200 tall x 800 wide)
	- shrinking the dimensions will show a warning if you delete any tiles that aren't the default tile
- there is a [draw tool](#tool-draw)
- undo / redo
	- clicking and dragging counts all changes during that as 1 for the purpose of undo/redo
- maps have multiple layers, such as the ground and objects on it
- zone links, a layer independent of the artwork. Any cell can link to a cell in another zone
	- `automatic`: entering the cell moves you to the target zone
	- `manual`: you are offered the option to enter the zone
	- "requires the whole group": the link can only be used when every member of the group is present, including the anchor being. For example, the city -> wilderness link requires the whole group, but the city -> shop link doesn't
	- "select destination coordinates": shows a preview of the target zone's map. Clicking a cell marks it as the destination, then lets you place a return link (optional)
	- since links are separate from the artwork, you also need to draw a door (or similar) so players know where to walk

### Tool: Draw
- lets you select a tile, e.g. "Grass" or "Wood Floor". Also lets you select "Void" which is just black
- lets you select a size (1 for a single tile, up to 100 tiles)
- brush shape - circle or square

## Editor: Tile
- name
- indoors / outdoors. This is a preference, not a restriction: any tile can be used in any zone, but outdoor zones get the outdoor tileset first
- color (used if there are no graphics), accepts hex + has a color picker
- graphic (image)
	- outdoors uses the Dual-Grid System
	- indoors uses the 47-Tile Blob Set
	- or maybe each layer has its own format, e.g. the ground layer is Dual-Grid and another layer is set differently
- Vision cost - 0% to 100% (cannot see through). See [vision](#vision)
- Movement cost - 0% to 100%. 0% is normal movement, 50% costs double (PF1E difficult terrain), 100% is impassable
- Has a preview section for day + night

# Localization
Players choose the language they play in, and universes can be translated. There are two kinds of text, and each is looked up in the player's language separately:
- **engine text**, written by the site developers: the pages and editors, messages from the server, emails, and each ruleset's defaults (such as PF1E's races, classes, items and tiles). Its translations ship with the engine
- **universe text**, written by a universe's editors: the universe's name and descriptions, and the names of its zones, tiles, races, classes and items (later NPCs and dialog). Translated in the [Translations](#tab-translations) tab

Text players write is never translated: character names, group names and chat.

Translators get context for every piece of text, because one English word can need several translations (German has several words for "Save", and a button that stores changes needs "Speichern"). Each engine message has a description written next to it in the code, and the same English used for two purposes is two messages. Universe text shows where it comes from, and editors can add a note.

## Choosing a language
- A player's language comes from their [profile](#profile-edit), then the language picker at the bottom of every page (which the browser remembers, so it works without a profile), then the browser's settings, then English. The picker names each language in that language.
- The pages and editors use the player's language if the engine has it. Universe text uses the closest language the universe has, so a French player sees French pages even in a universe written only in English.

## Finding a translation
Universe text uses the first of these that exists:
1. the universe's translation in the player's language (`pt-BR`)
2. the universe's translation in that language without its region (`pt`)
3. the text in the universe's source language

A ruleset default the universe hasn't renamed (such as a default tile whose color was edited but not its name) is engine text instead.

Engine text uses the player's language, then that language without its region, then English.

## Out-of-date translations
Each translation remembers the source text it was made from. When the source text changes, the translation is still shown, but the [Translations](#tab-translations) tab marks it out of date until a translator updates it or confirms it is still correct.

## Formatting
- Numbers, dates, times ("5 minutes ago") and lists follow the player's language, and names are sorted the way that language sorts them.
- Plurals and other grammar that changes with a number or a person are part of each translated message, never built from pieces.
- [Money](#field-money) denominations ("pp", "gp") are ruleset text, so they are translated.
- Pages support right-to-left languages, and layouts leave room for text longer than English (German runs about 30% longer).

## Testing
A pseudo-language for development shows every piece of engine text with accented vowels and extra length (`Saved` becomes `[Såvéd ~~]`), so text that skipped translation, or a layout that can't fit longer text, stands out.

Pirate (`en-x-pirate`) is a real translation that ships with the engine, for testing the way languages are loaded and switched without a real language's translation to keep up. Its untranslated or out-of-date messages are reported, like any language's.

# Accessibility
Every page, editor and game screen can be used with only a keyboard and with a screen reader.

## Keyboard shortcuts
- A button's shortcut letter is underlined in its text, preferring the letter at the start of a word (the S of Save); it is pressed with Alt (Option on a Mac). When a translation's text doesn't have the letter, "(S)" is added after it with the letter underlined. Screen readers announce the shortcut through `aria-keyshortcuts`.
- `?` (when not typing) or the footer's "Keyboard shortcuts" button lists the shortcuts that work on the screen showing, including keys that aren't buttons, such as movement.
- A shortcut only works while its button can be seen and used, and while a dialog is open only the dialog's shortcuts work, so screens and dialogs reuse keys. The keys are the same in every language. Alt+D, Alt+E and Alt+F aren't used, since browsers take them, and deleting has no shortcut.
- The keys follow one pattern: Alt+S submits the form or dialog showing (Save, Create, Add, Resize), Alt+N adds something new, Alt+L leaves (the lobby or group) or picks the Links tool in the map editor, Alt+U enters a universe, Alt+H goes Home, Alt+B goes back, and Alt+M moves focus to the map.

## Screen readers
- When a screen changes, focus moves to its heading, so the screen is read out.
- The game's map is a focusable application with its keys described. A screen reader is told the zone the player enters, players coming into and going out of view, a door or path underfoot that E takes, and when something is in the way. Alt+P reads out the player's zone and cell, the tile they stand on, and each player they can see with their distance and compass direction.
- The map editor's map (and the link dialog's preview) can be focused and worked with a cursor: the arrow keys move it, Space or Enter paints or picks its cell, holding Space while moving paints a stroke, + and - zoom and Home returns to the center cell. Each cell the cursor reaches is read out with what it holds.
- Colors are never the only way information is shown: the tile table's swatches carry the color's hex code.

# Open questions
- **Time:** how long walking a square takes, and the overworld map's scale.
- **Offline group members:** whether to use the summoning ring.
- **Lobby:** the player limit (from load testing), and how groups manage their lobby listing.
- **Cross-universe play:** art style, and whether items need a "source universe" setting.
- **Users:** how to tell two users with the same name apart (unique usernames, or showing an immutable user ID), which user search for invites depends on.
- **Accounts:**
	- what happens when a provider login and a local account share an email (account linking)
	- which email sending service to use
	- whether to add a CAPTCHA. The code limits stop guessing, but someone who knows an address can make 15 wrong guesses and block that address's codes for a day
- **Messages:** blocking, reporting and who can message whom, before messaging is supported.
- **Universe versions:** how versions are built and switched.
- **Vision:** whether the server or the client works out what each player can see.
- **Tiles:**
	- Dual-Grid vs. 47-Tile Blob, possibly per layer
	- how large objects such as trees and houses work, since a player walking behind one should be hidden
- **Maps:** a map 50,000 tiles in each direction could hold billions of cells, so maps need to be stored sparsely or in chunks rather than as one full grid.
- **Characters:** whether character names must be unique within a universe.
- **Localization:**
	- whether a universe can rename engine terms (calling gold "crowns"), which changes the pages' wording in that universe
	- fonts for map text in scripts the default font doesn't cover, such as Chinese and Japanese
	- whether to offer machine translation of chat
- **Licensing:** how to use Pathfinder content within its open license and Paizo's terms for the "Pathfinder" name, alongside the project's AGPL license.
