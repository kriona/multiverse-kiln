This document describes the UI + game structure for the Multiverse Kiln. It describes the framework only: some systems (such as monsters and gaining experience) are left out, and not all settings are listed yet. Undecided items are collected in [Open questions](#open-questions).

# Pages
## Home
Lists all universes. In the beginning there will only be a few, but in the future there may be thousands, so we should be forward-thinking about the UI (even if advanced search filters don't exist yet). Each universe should show name, 1-sentence description, ruleset, and [languages](#tab-translations). Only universes in the `let there be light` [stage](#edit-universe) are listed for everyone. Anyone can see it; its toolbar links to the [login page](#login), or once logged in shows the player's name and a Log out button. A logged-in player also sees the universes they work on, and a button for [Create Universe](#create-universe). A player with a role in any universe in `prologue` sees those in a section of their own, for testing, which isn't shown to anyone else.

Each universe links to its [page](#universe-page).

## Universe page
Every universe on Home has a page of its own at `/universe/<slug>`, listing all details about the universe, with an [Enter Universe](#enter-universe) button. The page doesn't need a login; while the browser is logged in (in any tab), it also lists the player's characters in the universe, with each one's race and class; choosing one shows their [character sheet](#character-sheet). The slug is made from the universe's name: lowercase, with every run of characters other than letters and digits turned into a hyphen ("The Shattered Isles!" is `the-shattered-isles`). Letters of every alphabet are kept, so a name in any language reads in its address. `/universe/<id>` always works too, and changes the address to the slug.

Universe names are unique, and names that could be mistaken for each other count as the same, so one universe can't pass as another. Two names are the same when they have the same slug, or when they match once capitals, accents, letters from other alphabets that look like Latin ones, stand-ins such as "1" for "i", repeated letters and the spaces and punctuation between words are set aside (the same comparison player names get for reserved words, `shared/src/names.ts`). "Kilnhaven", "Kiln Haven", "K1lnhaven" and "Кilnhaven" (with a Cyrillic К) are all the same name. A name needs at least one letter or digit. Renaming a universe changes its slug, so links that used the old slug stop working; links by ID keep working.

## About
Free text. There will be many of these pages (like an FAQ or Help).

## Privacy
The privacy policy (`privacy.html`), linked from every page's footer and from the login and register pages: what the site keeps about players, why, who sees it, how long it is kept, and how to export or delete it. It names no hosting companies, since each site running the engine chooses its own; a site sets its contact address on the [admin page](#admin), and the policy leaves the contact line out until it does. The page shows the date it last changed, and the site emails players when it changes in a way that matters.

## Login
You select a login provider like Google or Discord, or you can make a local account. Local logins are based on email, not username (but email can be changed).

Local accounts are supported, but the login and register pages recommend a provider for security reasons.

Home, universe pages and the license and privacy pages don't need a login; the lobby, the game, the editor, Create Character and profiles (your own and other players') do. Those send a browser that isn't logged in to the login page (`/login`), which goes back to them once it is. Logging in in one tab reloads the browser's other logged-out pages, so they are logged in too, and logging out takes every window of that browser out with it.

A login starts a session, kept on the server and named by an HttpOnly cookie. A session ends after 1 hour without use, and after 24 hours in all. Checking "Remember me" makes it last 30 days without use and 90 days in all, after which the player logs in again. Being connected to a lobby or game counts as use. Logging out ends the session on the server. Changing the password or email address, or turning 2FA on, ends every other session of the account, and resetting the password ends all of them. Logging in again from a browser that's already logged in ends its old session, so a copy of its old cookie stops working. A password asked for again while logged in (to change it or the account's 2FA, or to delete the account) counts against the same limits as logging in to the account's address, so a stolen session can't guess it faster.

A player can be logged in from several browsers at once, each with a session of its own; every window of theirs, in any browser, is that player. Logging out ends only that browser's session, and its open windows are logged out with it.

Google and Discord logins use OAuth with PKCE, and the provider sends the browser back to the login page, which finishes the login. Only a provider account with a verified email address can log in, since every account has one. The first time, the login waits up to 10 minutes for one more step, from that browser only:
- if no account has its email address, the player chooses a username and name (the provider's name suggested) to create one. Emails them when they have a new account
- if a local account has it, the login isn't joined to the account automatically: the player is asked to log in to the local account (with its password, or an [email code](#email-codes)), which links them and emails the account. An account has at most one login from each provider

A logged-in player can also link providers from their profile. So a stolen session alone can't add a login that outlives a password change, they first confirm it's them with their password, or by entering a code emailed to the account's address when it has no password, and an authenticator or recovery code when the account has 2FA (a trusted browser still asks). The provider sends the browser back to the login page, which links the provider login to the account the browser is still logged in to (its email address needn't match the account's, but it must be verified, as for logging in), emails the account, and goes back to the profile. A site offers a provider once its OAuth client is set up (`server/.env.example`).

Local accounts can turn on 2FA with an authenticator app (TOTP), and get recovery codes for when they lose it. Accounts that only log in with a provider use the provider's 2FA. An account with 2FA asks for its code after a Google or Discord login too, so 2FA guards every way in, not only the password: a provider account without its own 2FA, or a provider login linked with a stolen session, still can't get past it.
- Turning it on, from the profile, asks for the password, then shows a QR code for the app (drawn in the page, and the secret as text for typing in by hand; the secret is never put in an address), then asks for the code the app shows. Then it shows 10 recovery codes, once, to copy or save as a text file. Every other browser logged in to the account is logged out, so one the player didn't know of has to log in again, with the code. The server keeps the secret encrypted (AES-256-GCM, with `TOTP_ENCRYPTION_KEY`, kept apart from the database) and the recovery codes as keyed hashes.
- With it on, logging in with the password, or with a linked Google or Discord login, asks for the app's code next, from the same browser, within 10 minutes. A recovery code works in place of the app's code, once, and the account is emailed how many are left. 5 wrong codes end the login, and an account can try 10 codes an hour wherever they are typed. After 20 wrong app codes in a day, only recovery codes are taken until the day's count drops, so guessing app codes stays slow without locking the owner out. The account is emailed at its 10th wrong app code of the day, saying so and, if it wasn't them, to log in and change the password. Each app code works once.
- At the code, "Don't ask again on this browser for 30 days" trusts the browser: its logins skip the code until then. The profile shows how many browsers are trusted, and can stop trusting them all.
- Resetting a forgotten password and linking a Google or Discord login (with the password or an email code) ask for the app's code too, unless the browser is trusted, so someone who gets into the player's email still can't take the account.
- Turning it off and making new recovery codes ask for the password and a code. Turning it on or off emails the account. A player who loses the app and every recovery code can't get back in on their own: only the site's contact can help.

### Login limits
An address can be tried 10 times an hour at login, and a network 30 times, so passwords can't be guessed quickly. Wrong passwords typed while logged in (changing the password or 2FA, deleting the account) count against the same limits. Anyone can use up an address's tries, so a browser that has logged in to the account (marked by a signed cookie that lasts 180 days after its last login and doesn't name the account) counts its own 10 tries an hour instead, and can still log in while others' guesses have used up the address's.

## Deleting an account
From the profile. Before deleting, the player decides for each universe they are the only creator of: hand it to another of its editors (whatever their role) as creator, or delete it, with its world, uploads and everyone's characters in it; nothing is chosen for them. They confirm with their password, and an authenticator or recovery code when the account has 2FA (a trusted browser still asks), or, when the account has no password, by typing their username and entering a code emailed to the account's address, so a stolen session alone can't delete it (an account with neither a password nor an address has only the username to check). Groups whose anchor being is one of their characters disband, and their other characters leave the groups they were in. The account, profile, characters, sessions and auth events are deleted, every window of the player is logged out, windows playing in a deleted universe are told it is gone, and the address the account had is emailed. Before deleting, the player can download their data as one JSON file (also offered on the profile at any time): the account and profile, linked logins, whether 2FA is on, sessions and auth events (without tokens or networks), roles in universes, characters with their sheets, and Create Character's progress.

## Register local account
Enter an email, it sends you an [email code](#email-codes), enter the code, then the email again with a password, username and name to create the account (the server keeps only a keyed hash of the address while it waits, so it asks for the address again). The username is checked as it's chosen, when the player leaves the field or pauses typing for 2 seconds. A circle turns at the right of the field while the server checks (it stays still for players who ask for less motion), and the line under the field says whether it's available or why not. The line keeps its space while empty, so the form doesn't move as it changes. Only a browser creating an account can ask (one that entered the code to register, or came back from Google or Discord with a login that has no account), at most 60 times an hour from one network, so the public can't ask which usernames exist. Choosing a username after a Google or Discord login checks it the same way. Recommend the user use a password manager, link to a couple prominent ones. Emails you when you have a new account. Then offers to set up 2FA now, which opens its dialog on the profile, or to go on to the page the player came from.

If the address already has an account, the page answers the same as for a new one, and the address is emailed a note saying it has an account and how to log in or reset the password, in place of a code.

## Forgot your password
Enter an email, it sends you an [email code](#email-codes), enter the code to change your password (with an authenticator or recovery code too, when the account has 2FA). Emails you when the password is changed, signs the account out everywhere, and stops trusting every browser that skipped the 2FA code.

## Email codes
Registering, resetting a password, changing an email and linking a Google or Discord login all send a code by email. Every code follows these rules:
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
	- one network may ask for 10 codes and make 30 guesses an hour, whatever addresses they are for. A network is an IPv4 address or an IPv6 /64. Behind a proxy (such as Colyseus Cloud's), the client address comes from the one forwarding header the server is configured to trust, and from X-Forwarded-For only the entry the first trusted proxy added, since anything else can come from the client
	- counters are updated atomically, so many requests sent at once can't each slip under a limit
- Privacy
	- the response is the same whether or not an account exists for the address, and takes the same time (the email is sent after the response)
	- what was typed and the network address are stored as keyed hashes, and only for as long as a limit still needs them
- Finishing
	- a correct code hands the next step (setting the password) to the browser session that entered it, through a new session ID in an httponly cookie, for 10 minutes. Another browser waiting on the same account can't use it. A step that needs two codes (changing the email address of an account without a password) gives the second the first's session ID, so it finds both
	- changing the account's password or email address, or resetting its password, ends every code sent for it and every next step waiting on one, so a reset sent to an old address can't undo the change

## Profile edit
Everything is optional except username and name.
- username (required, unique): how other players find you and tell you apart from others with the same name. 3 to 20 letters (a to z only, so no username can pass for another with look-alike letters from other alphabets), digits and underscores, compared ignoring capitals and checked against reserved words like player names
- the Google and Discord logins linked to the account, with buttons to link another
- photo (200px square, shown as a circle)
- email, with a change email button for local accounts. Enter an email, it sends you an [email code](#email-codes), enter the code to change your email. Since the new address can reset the password, a stolen session alone can't change it: the player also gives their password, or for an account without one, first enters a code emailed to the current address, and an authenticator or recovery code when the account has 2FA (a trusted browser still asks). Logs out every other browser, and emails both addresses letting them know that the email has changed.
- if a local account, a change password button. Emails you when the password is changed.
- if a local account, two-factor authentication: turn it on, or turn it off and make new recovery codes, with how many recovery codes are left and how many browsers are trusted (see [Login](#login))
- name (required, but it doesn't need to be your real name)
- pronouns
- location
- time zone, found by typing its city, its name (Pacific Time) or a major city in it (Seattle), and used to match you with players in time zones near yours
- languages you know, chosen from every ISO 639-1 language (up to 20) by searching and shown as chips, used to match you with other players who speak your language
- language, used for the pages and for universes translated into it (see [Localization](#localization))
- link to socials (Discord, Facebook, Insta, TikTok)
- "show my characters", checked by default. if unchecked, a "other players in your group will always be able to see a link to your profile, even if your character isn't shown on your profile".
- a list of your characters, grouped by universe
	- if "show my characters" is unchecked, show checkbox next to individual characters for "visible".
	- clicking on a character will show a modal dialog with their character sheet and a [Enter Universe](#enter-universe) button.

## Profile view
Shows every profile field the user has filled in (name, photo, pronouns, location, time zone, languages they know, socials) and their visible characters in universes anyone can play. Only logged-in players can see profiles. Fields are optional, so users control what others see by leaving them blank.

## Enter Universe
The lobby and the game are on a page of their own (`/game/<slug>`, or `/game/<universe ID>`, which changes to the slug), apart from Home, so a player can keep Home, their profile or the editor open in other tabs while they play.

If you have not created a character, you will go to the [lobby](#lobby).

If you have created a character, you will go to where your most recently played character is (either the lobby or the game itself). If that character's group has been disbanded, you go to the lobby as that character. A group's game doesn't need to be running: it starts from where the group was when everyone left. Each browser tab remembers the character it played, so reloading a tab plays that character again.

Opening an invite link (`/game/<slug>?invite=<token>`) shows the [invite](#create-group) instead.

## Lobby
The lobby runs the game engine. It will be a small area where many people (more than the 6-player group limit) can connect and chat.
- Some rules will be similar to the game itself - the graphic tile set, you can move around the space, you can enter houses.
- Some rules will be different - you cannot use items, time passes based on [lobby settings](#tab-lobby) and not game settings (it's not turn-based).
- A [Create Character](#create-character) button sits under the list of your characters, in the lobby and in a group, so a player whose characters are all in groups can still make another. You can create multiple characters.
- There will be a chat. You chat as your character.
- If you have not created a character, you will use a ghost icon and nobody can see you. You can walk around the space. You can read chat but not send messages. Ghosts don't block cells, and pass through other players. Other players aren't shown ghosts in the list of who's here; a ghost sees themself listed as one. The [Create Character](#create-character) button should be more prominent.
- If you have created a character, chat will be enabled. You will move about the space as your character, starting as the one you played or made most recently. You can switch characters at any time, and every window of yours in the lobby switches with you. Characters in a group play in their group, not the lobby; choosing one in the lobby's list goes to their group.
- Each of your characters has a button that shows their [character sheet](#character-sheet), and Alt+K shows the sheet of the one you're playing.
- You may create up to 20 characters per universe.
- If you have a character selected, a [Create Group](#create-group) button will be enabled.
- Groups can be listed in the lobby so players can find them without an invite. How a group manages its listing is not yet defined.

Colyseus has no built-in player limit for a room; we set it (`maxClients`). The real limit comes from the server's CPU and bandwidth: every movement is sent to every other player, so traffic grows with the square of the number of players. The number will come from load testing. When the lobby is full, another instance of it opens.

### Cross-universe play
This stays loosely defined until more of the infrastructure exists.

If a universe allows it, and you are in the universe's lobby, you may enter a portal room that lets you jump universes. The portal room is probably an auto-generated area showing each universe you can enter.
- Your name will be "[Name] of [Universe]" and "of [Universe]" should be styled italic / slightly darker than the rest of the text it displays with.
- You can enter even if your race or class is disabled in the other universe. Universes that allow cross-play need to work this out between themselves.
- Items work the same as in your home universe. Items may need a "source universe" setting.
- Your art is retained from your home universe. Each universe has its own artwork for characters and items. A character has:
	- a sprite, shown on the map. It may or may not be generated automatically from the avatar
	- an avatar, a larger view of the character showing all their worn items. Every item needs avatar art drawn by an artist

## Create Character
Based entirely on the universe's ruleset. It is a page of its own, reached from the lobby, that goes through steps (name, race, class, a theme in SF1E, ability scores, then a review) and returns to the lobby when the character is made. Rulesets will add more steps, so there may be a lot to work through:
- the player's progress is saved on the server a moment after each change and when the step changes, so they can go back to the lobby, close the browser, or switch browsers, and pick up on the step they were on. "Start over" throws the progress away
- progress is checked against the universe only when the character is made; a race or class that has since been disabled is left out when the progress loads

For PF1E, the server rolls the ability scores (or checks the point buy choices) using the universe's [stat rolling](#pf1e) setting; the client never sends ability scores of its own. The player can rearrange rolled scores among the abilities, with the class's primary ability as a hint.
- the server keeps a player's rolled scores until they make a character with them, so leaving Create Character or starting over doesn't roll again. If the universe changes how it rolls, the next visit rolls again
- the player chooses a name, an enabled race and an enabled class. A race with a floating ability bonus asks which ability gets it
- the character starts with the universe's, race's and class's starting money added coin by coin, and their starting equipment added together (enabled items only). Where they start is chosen when a group is made around them (see [starting area](#tab-characters))
- the lobby lists the player's characters in the universe
- a race, class, theme or item that characters have can't be deleted; it can be disabled instead

For SF1E, every ability score starts at 10, and the player spends the universe's [ability points](#sf1e) to raise them, one point for each +1. Points can't raise a score above 18 once the race's and theme's bonuses are added (bonuses alone can), and points left unspent are lost; the server checks both. The player also chooses an enabled [theme](#themes), whose +1 is added to its ability. The class's key ability is the hint.

## Character sheet
A modal dialog showing one of the player's characters, opened from the [lobby](#lobby) and the [universe page](#universe-page) (later the [profile](#profile-edit) too). Only the character's player can see it. For PF1E it shows:
- the name, race and class
- each ability score (with the race's modifiers added) and the modifier it gives
- size, darkvision and light sensitivity, from the race as the universe sets it now
- money, as a [money field](#field-money) writes it
- equipment, sorted by name, with how many of each

For SF1E it also shows the theme, hit points (the race's and the class's) and stamina points (the class's plus the Constitution modifier, at least 0), from the race and class as the universe sets them now.

### Deleting a character
The sheet's Delete button asks twice. "Delete Character" asks "Do you want to delete [character]?" (Cancel / Delete), then a second dialog asks "Are you absolutely sure you want to delete [character]? This is permanent (a very long time!) and cannot be undone.", with three buttons:
- **Cremate (delete immediately)** deletes the character immediately
- **Last Rites (delete in 7 days)** deletes them after the days the [admin](#admin) setting gives (7 by default), and isn't offered when it is 0. Until then they are listed, marked with the day they go, and count toward the 20 characters a universe allows, but can't be played. Their sheet says when they go and has a Restore button. A player playing them switches to their most recent other character, or becomes a ghost; restoring a character while a ghost plays them. A character already given their last rites can still be cremated
- **I've Made A Terrible Mistake** keeps the character, and is the button focused

A character in a group can't be deleted either way: their sheet says they have to leave the group first, in place of the Delete button, and the server refuses too.

The server deletes characters whose days are over once an hour, and hides them until it does.

## Create Group
The character creating the group is the "anchor being". This shows you a landing page for your new group. It explains that your character is the anchor being for this universe, and that the game is centered around them.
- The group starts in the anchor being's [starting area](#tab-characters), chosen from the universe's, race's and class's settings as they are when the group is made.
- If the anchor being leaves the group, the group is disbanded and its [world state](#world-state) is deleted. Every character keeps their items, money and experience. A character in a group can't be [deleted](#deleting-a-character) until they leave it.
- If the anchor being is offline, the group can't use [area links](#editor-map) that require the whole group (for example, leaving the city for the wilderness), but can use the ones that don't (entering a shop in the city).
- A group holds at most the universe's [group size](#tab-characters) characters. A character is in at most one group.

You can give the group a name. Create Group is a dialog in the lobby, made around the character you're playing there. It also asks for the group's [difficulty](#difficulty), starting on the universe's default level, and says what the level chosen does to mobs and whether it has permadeath. The group plays at that level from then on.

Only the anchor being's player sees the "Invite" button, which opens a modal dialog.
- Later, once [messages](#messages) exist: you can pick a user and send them an invite in a private message.
- You can create a link with the following options:
	- single use or multi-use
	- valid for 1 day, 1 week, indefinite (until the group is disbanded)
	- there will be a "Copy Link" button
- The link holds a random token the server keeps only a hash of, so a link is shown once, when it is made.

Opening an invite takes you to a character selection screen with an option to create a character (which comes back to the invite). It says the group's [difficulty](#difficulty) and what it does to mobs. A group with permadeath gets a warning that stands out (bold, bordered, with a skull), which Create Group also shows when a level with permadeath is chosen. Characters that are already in a group are grayed out and can't be selected. If the group is full, you get a message saying you can't join because it's full.

A player can have several characters in one group (a player could make a group of 6 of their own characters), and switches between them in the UI without changing browser tabs.
- Each window plays one character. Choosing another character in the same group switches the window to them; one in another group moves the window to that group; one not in a group moves it to the lobby. Several windows can play different characters of the same player side by side.
- While a player has any window in a group's game, all of their characters in it are on the map; the ones no window controls stand still. When their last window leaves, their characters leave the map, and where each one was is saved for when they come back.
- A character new to the group appears beside the anchor being.
- A member can leave from the group screen, after a question; they go to the lobby and need a new invite to come back. The anchor being leaving asks whether to disband the group.

The group screen lists the members, saying which is the anchor being, which are yours and which aren't here.

A link that requires the whole group works only while every member who can be played (and the anchor being, always) is in the game, in the same area as the character taking it, and not already on their way somewhere. Then the whole group goes through together, so a player with several characters doesn't walk each one through. Otherwise the player is told the whole group has to be there.

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
- creates a lobby area, and a default area that it sets as the starting area for all races
- makes you its creator

The [admin page](#admin) decides how many universes a user can create. The admin page can also turn off creating universes for everyone, which disables the Create Universe button.

## Admin
Settings for the whole site (`admin.html`), stored in one row of the `site_settings` table. Only server admins can see and use it, and only they see its link in Home's toolbar.

Whether a player is a server admin is stored in the database. The first admin is made by hand with a script run on the server; after that, admins add and remove other admins on this page. An admin must have 2FA on to use any of it.
- universe creation enabled: whether players can create universes
- universes per creator: the most universes one player may create, from 1 to 1000
- character deletion days: how many days [Last Rites](#deleting-a-character) waits before deleting a character, from 0 to 365 (7 by default). 0 turns Last Rites off. Characters already given their last rites keep their day
- social sites: links to the site's own pages on Discord, Facebook, Instagram, TikTok, X and YouTube, each optional. Every page's footer shows each one's logo, linking to it. A link must be https and on that site's hosts (`SITE_SOCIAL_HOSTS`), so it always goes to the site its logo says
- privacy contact: the email address the [privacy policy](#privacy) tells players to write to about their information. Empty leaves the line out of the policy

The universe settings don't change universes that already exist.

## Edit Universe
This lets you change anything about a universe. It will be a whole suite of tools unrelated to playing the game.
- name, unique among universes (see [Universe page](#universe-page))
- logo
- banner image
- 1-sentence description
- long description, written in markdown
- dropdown for "Stage"
	- `in the beginning` - still being created. Only creators and builders can play. Not listed on [Home](#home)
	- `prologue` - open for beta testers and every other editor. Not listed on [Home](#home) for everyone: its editors, beta testers included, see it in Home's section for universes in testing
	- `let there be light` - (ready for people to join. Listed on [Home](#home)
	- `end of time` - retired. Locked and view only. Not listed on [Home](#home)
		- the universe page can still be reached, and says the universe is locked
		- only creators can still edit it
		- the lobby can't be entered
		- groups can still be opened, read-only: their members can look at the map and chat in the group, but nothing in the game changes
- a dropdown for ruleset - no default, Pathfinder 1E or Starfinder 1E
- a dropdown for "passage of time", the default for every [area](#editor-area)
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
- a dropdown for "display time", how players are shown the time of day in the lobby and the game (see [time and distance](#time-and-distance)):
	- `precise` (the default): the time on the clock, to the second
	- `rough`: a word for the time of day, such as afternoon
	- `nothing`: no time at all
- Tabs:
	- [Editors](#tab-editors)
	- [Ruleset](#tab-ruleset)
	- [Lobby](#tab-lobby)
	- [Characters](#tab-characters), with [races](#races), [classes](#classes) and, for a ruleset that has them (SF1E), [themes](#themes)
	- [Tilesets](#tab-tilesets)
	- [Areas](#tab-areas)
	- [Items](#tab-items)
	- [Connect to the Multiverse](#tab-connect-to-the-multiverse)
	- [Translations](#tab-translations)

### Unsaved changes
Every change in the universe editor is staged: nothing a tab or its dialogs change (adding, changing or deleting anything, uploading a tileset or deleting one) is saved until the Save button (Alt+S) in the bar at the bottom of the editor is pressed. The bar stays in view while the tab scrolls, and above the map in full page. It saves every tab's changes together, all or nothing, in one request (POST `/:universeId/changes`, see `shared/src/editorChanges.ts`); reloading the page throws the changes away. When the server refuses a change it saves none of them: the editor shows the tab whose change it was, with the reason on that tab, and keeps every change. A field with a problem stops the save before it is sent, the same way. Each tab shows its changes as they will be once saved, including changes made on other tabs: the Areas tab's maps draw the Tilesets tab's unsaved tile changes (new and changed tiles, and tilesets staged to upload, from the page's own copy), with tiles staged for deletion drawn as their replacements. Enter in a tab's form saves too.
- The editor dialogs for races, classes, themes, difficulty levels, items, tiles and area links have Apply rather than Save: it keeps their changes on the tab, where the list shows them, tagging what was added as new and what will be restored "when saved", and striking through (in italics, faded) what will be deleted. One of the ruleset's defaults with changes is tagged edited, saved or not. Deleting or restoring is taken back with Undo Delete or Undo Restore in the dialog until the tab is saved. Saving sends each list's changes in the order they were made.
- The tabs save in this order, so a change can name something an earlier one adds: Tilesets (new tilesets, then tiles, then deleted tilesets), Items, Ruleset, Characters, Universe, Lobby, Areas, Editors. The Characters tab saves its settings, races, classes and themes, and the Ruleset tab its settings and difficulty levels.
- The Areas tab saves the areas deleted, then the areas added, then the area open in the area editor: its map's size, painting and links, then its settings. A new area is listed tagged new, and can be opened, painted, linked to and chosen as a parent before it is saved; its map is the size every new area starts with. Deleting an area asks first, then strikes it through in the list until the tab is saved; opening it shows it read-only with Undo Delete. Deleting a new area discards it immediately, after asking. Painting with, or a default tile of, a tile staged for deletion is saved as the tile chosen to replace it.
- The map editor's tile choices and an area's default tile choices list the Tilesets tab's unsaved new tiles and leave out tiles staged for deletion, and the area previews in the link and starting area dialogs draw the Tilesets tab's unsaved changes like the maps do. Other pickers (starting equipment, a class's races) list only what is saved.

The bar says "Unsaved changes" while any tab has some, and a tab with unsaved changes gets a dot. Closing a dialog (Cancel or Escape), leaving the area being edited, and leaving or reloading the page all ask first while there are unsaved changes.

### Universe versions
If a creator makes changes to the current version of the universe, they apply immediately for everyone.

A creator can choose to switch to a new version (e.g, 1.1) while making changes, then can switch the universe to 1.1 and all of the changes apply at once. A version includes its [translations](#tab-translations), so they switch over with it.

### Disabling things players are using
Disabling or limiting something that players are already using warns the editor and asks what should happen:
- a race: "allow them to continue to play, only disable the race for new characters" or "prevent them from playing"
- a class: "allow them to continue to play, only disable the class for new characters" or "prevent them from playing"
- an area with characters in it: "move everyone to the parent area" or "move everyone back to their start area"
- an item characters have: "allow them to continue to use it, prevent new copies of the item from being made" or "remove it from characters, it will be re-added when the item is re-enabled"
- lowering the group size below a group's current size: "allow those groups to continue to play, only limit the size for new groups", "disband larger groups" or "remove X number of group members, starting with those who joined most recently"

Changing the stat rolling method doesn't change existing characters.

### Tab: Editors
Lists the users who can work on the universe, and lets you add them with a role:
- `creator` (admin): can change everything
- `builder`: can make changes to the world, e.h. to areas or NPCs
- `beta tester`: can create characters and play while the universe is in `prologue`
- `translator`: can [translate](#tab-translations) the universe's text into the languages they are assigned, and can't change anything else. The role decides who may change translations however they are made, on the Translations tab or by importing a file

The table lists each editor's username, name, role and, for a translator, their languages. Creators add a player by searching for them (`PlayerSearch`): typing at least 3 characters of a name or username lists up to 10 matching players under the field, each as their name and @username, leaving out the universe's editors, and the player is chosen from the list. Text starting with @ matches usernames only. Creators then choose a role and, for a translator, at least one language. Creators change an editor's role and remove editors in the same dialog. Anyone can leave the universe with Leave Universe (Alt+L), which first asks them to confirm and explains what they lose once it is saved: their role and the editor, and the right to play while the universe isn't open to everyone, and that a last creator has to make another editor a creator first. Every change is staged until Save, like the other tabs (see [Unsaved changes](#unsaved-changes)), and saved as `addEditor`, `saveEditor` and `removeEditor` changes. A universe always keeps at least one creator: a save that would leave none, by changing roles, removing editors or its last creator leaving, is refused, but one save can make another editor a creator and then let the old one leave.

What each role sees in the editor: creators and builders see every tab (builders read the settings tabs without changing them), while beta testers and translators see only the Editors tab and the Universe tab, read-only. The server checks every change against the role the player has when the save starts (`mayMakeChange()` in `shared/src/editorChanges.ts`).

Losing a role takes effect at once. The player's next save in an open editor is refused, and a player who may no longer play the universe in its stage is turned out of its lobby and groups, with a message saying why. A player who changed their own role sees the editor again as the new role allows, and one who left goes Home.

A universe can have several creators. If you delete your account and your universe has no other creator, you choose what happens to it (see [Deleting an account](#deleting-an-account)): make another of its editors its creator, or delete it.

### Tab: Ruleset
What shows up here depends on what ruleset is chosen.

Below the ruleset's settings, the tab lists the universe's [difficulty](#difficulty) levels, easiest first, and saves them with the settings. Each level has:
- Default checkbox: the level Create Group starts on. Exactly one level is the default: checking it on another level unchecks the old one, and the default can't be unchecked or deleted
- Name
- Mob scale, a percentage from -1000% (easier) to +1000% (harder)
- Permadeath checkbox

Levels can be added (up to 20) and deleted. Deleting a level moves the groups playing at it to the default level. Changing a level changes it for the groups already playing at it. A new universe starts with:
- `Story`: mobs are 50% easier
- `Normal`, the default
- `Hard`: mobs are 50% harder
- `Hardcore`: mobs are 100% harder, and permadeath

Their names are shown in the player's language until a creator renames them. Like the rest of the tab, only creators can change them.

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

#### SF1E
Starfinder 1E's rules (races, classes, themes, abilities, ability points, sizes, credits and items) are Open Game Content from the Starfinder Core Rulebook, used under the Open Game License 1.0a, and the name "Starfinder" is used under Paizo's Community Use Policy, the same as [PF1E](#pf1e). Both notices are on the license page.

Only a few of each step's rules are modeled for now; the rest of the ruleset comes later.

- ability points: how many points players spend raising ability scores from 10, 0 to 48 (every score 18), default 10
- do characters get tired and require sleep?
- track ammo?

Money is credits (`cr`), the only coin.

### Tab: Lobby
- a dropdown for "passage of time". the options being:
	- `always dawn`
	- `always noon`
	- `always dusk`
	- `always midnight`
	- `real-time` (the default)
		- shows an additional option for "how quickly?" with a description of "how long in real-time does it take for 1 day in the lobby to pass?" minimum 1 hour, maximum 240 hours. Default 24. Current time of day is based on the Unix epoch, so a 24-hour day follows the time in UTC
	- `faerie`, with "where is morning?". The lobby's map can't loop while it is chosen
	- the lobby's area has no passage of time of its own: the area editor says it is set here
- a checkbox for "no vision cost in the lobby", checked by default: everyone in the lobby has the full daylight vision budget at any time of day, and every tile is seen past as if it had a 0% vision cost
- a button for "Edit Map" which takes you to the [area editor](#editor-area) for the lobby

### Tab: Characters
- Group size, minimum 1 (single player only) maximum 6 (infrastructure / server max), default server max
- Starting equipment, lets you [select items](#selection-item). A new universe starts with one dagger (PF1E) or survival knife (SF1E) for every character. An item in the starting equipment can't be deleted until it is taken out
- Starting [money](#field-money)
- Starting [area](#selection-area)

Below the settings, the tab lists the [races](#races), the [classes](#classes) and, for a ruleset with them, the [themes](#themes), each in a section of its own, and saves them with the settings. Each list is a table of names, summaries and notes (custom, edited, disabled, and changes not saved yet), sorted by name until the Name or Notes heading is clicked (see [sortable tables](#sortable-tables)); rows that tie are sorted by name. Each race and class can add to the starting money and equipment, and choose a starting area of its own.

A character's starting area is chosen each time a group is made around them, so a change to these settings applies to characters already made. It is chosen in this order, most specific first: the class's entry for their race, the class, the race, then the universe. A class with an area of its own has no entries for races, so the two never compete. Each starting area comes with the square characters start on (chosen with the [area](#selection-area)), which goes with it: a group starts at its anchor being's square, and its members are placed on the free square nearest it. A square the area's map no longer holds, after it was made smaller, counts as the nearest square on the map.

Races, classes and themes work like default items: the ruleset's defaults are in every universe, an edit applies to that universe only and can be undone to restore the default (losing its starting money, equipment and areas too), and a race, class or theme the universe added can be deleted. Like the Characters tab, only creators can change them.

#### Themes
Only for a ruleset with themes (SF1E), listed on the Characters tab after the races and classes. A theme is a character's background, which raises one ability score by 1. It belongs to neither race nor class: any theme goes with any race and class. The list is:
- `Ace Pilot` (Dexterity)
- `Bounty Hunter` (Constitution)
- `Icon` (Charisma)
- `Mercenary` (Strength)
- `Outlaw` (Dexterity)
- `Priest` (Wisdom)
- `Scholar` (Intelligence)
- `Spacefarer` (Constitution)
- `Xenoseeker` (Charisma)

Themeless, which lets the player choose the ability, isn't modeled yet.

You can add your own themes, and edit each one:
- Enabled? Checked by default. There must be at least 1 enabled theme in order to save changes
- the ability it raises

#### Races
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

For SF1E that list is `Android`, `Human`, `Kasatha`, `Lashunta`, `Shirren`, `Vesk` and `Ysoki`. Lashuntas' two kinds aren't modeled, so a lashunta gets only the +2 Charisma both share.

You can add your own races, but any unique abilities of a race must be coded by the site developers.

You can edit each race:
- Enabled? Checked by default. There must be at least 1 enabled race in order to save changes
- Additional starting equipment, lets you [select items](#selection-item)
- Additional starting [money](#field-money)
- Starting [area](#selection-area), lets you override
- for PF1E:
	- ability modifiers? lists abilities (`strength`, `dexterity`, `constitution`, `intelligence`, `wisdom`, `charisma`) and a number field for each (minimum -99, maximum 99)
	- floating ability bonus? a checkbox. When checked, the player chooses which ability gets the bonus (in PF1E, humans, half elves and half orcs get +2 to one ability of their choice)
	- darkvision: `none`, `darkvision (60 feet)` or `superior darkvision (120 feet)`. Drow have superior darkvision; dwarves, goblins, half-orcs, hobgoblins and ratfolk have darkvision
	- light sensitivity? a checkbox. Bright light dazzles the race's characters (see [Vision](#vision)). Drow have it
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
- for SF1E: the same ability modifiers, floating ability bonus (humans get +2 to one ability of their choice), darkvision, light sensitivity and size, and
	- hit points: the hit points the race gives on top of the class's, 0 to 99

#### Classes
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

For SF1E that list is `Envoy`, `Mechanic`, `Mystic`, `Operative`, `Solarian`, `Soldier` and `Technomancer`.

You can add your own classes, but any unique abilities of a race must be coded by the site developers.

You can edit each class:
- Enabled? Checked by default. There must be at least 1 enabled class in order to save changes
- Add starting equipment, note it is in addition to starting + racial equipment, lets you [select items](#selection-item)
- Add starting [money](#field-money), note it is in addition to starting + racial money
- Edit starting area button. If clicked:
	- [Area selection](#selection-area), default null. If an area is selected, the per-race entries for this class are disabled. Show a message: all members of this class, regardless of race, start here. The entries stay in the form while it is open, so clearing the area brings them back, but saving with an area selected discards them
	- An entry for each playable race (and any disabled race that has one). Default is the race's start area, can be overridden
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
- for SF1E:
	- key ability score, used as a hint when spending ability points. A soldier's is Strength or Dexterity; the default is Strength
	- hit points per level, 0 to 99
	- stamina points per level, 0 to 99

### Tab: Tilesets
shows you a table of all tiles in the game, populated from the default for your ruleset and any tiles you have created. Default tiles can be edited: the edit applies to your universe only, and can be undone to restore the default. Disabling a default tile is such an edit, so a universe can leave out the ruleset's tiles it doesn't want. A tile you created can be deleted once no map uses it.

It needs a filter control that includes:
- name search
- "is passable" toggle
- "used in" dropdown: any, indoors (only), outdoors (only), both or neither
- "is enabled" toggle
- "is custom" toggle
- "is edited from default" toggle
- pagination (500 by default)

the table contains:
- icon (or color)
- name, links to the [tile editor](#editor-tile)
- walk time
- vision cost
- used in: indoors, outdoors, indoors and outdoors, or neither
- notes: custom, edited, disabled, and whether it is new or restored when saved. A disabled tile's row is struck through

The table is sorted by name until another column's heading is clicked (see [sortable tables](#sortable-tables)). Name, walk time, vision cost and used in can sort it; impassable tiles count as the slowest, and used in sorts in the order indoors, outdoors, both, neither. Tiles that tie are sorted by name. The server sorts before paging, by the English names, as the name search matches them.

For PF1E, the default tiles are
- outdoors
	- Grass, color #7AFF3D, 0% vision cost, 10 minute walk time
	- Forest, color #0A1, 50% vision cost, 20 minute walk time
	- Desert, color #E5E500, 0% vision cost, 20 minute walk time
	- Mountains, color #777, 100% vision cost, impassable
	- Water, color #3D97FF, 0% vision cost, impassable
- indoors
	- Wood Floor, color #7A3202, 0% vision cost, 10 second walk time

For SF1E, the default tiles are
- outdoors
	- Grass, color #7AFF3D, 0% vision cost, 10 minute walk time
	- Sand, color #D9C27A, 0% vision cost, 20 minute walk time
	- Rock, color #6B6B6B, 100% vision cost, impassable
	- Water, color #3D97FF, 0% vision cost, impassable
- indoors
	- Metal Floor, color #9AA4AE, 0% vision cost, 10 second walk time
	- Bulkhead, color #4A5560, 100% vision cost, impassable

### Tab: Areas
lists all top-level areas for a universe, excluding the lobby.
- if there is only one area, show all child areas for that area. keep showing child areas until there are no children or there are more than 1 children.
- clicking on an area lets you [edit it](#editor-area).

button to Add Area

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
- notes: custom, edited, disabled, and changes not saved yet

The table is sorted by name until the Name or Notes heading is clicked (see [sortable tables](#sortable-tables)). The server sorts before paging: names by their English text, as the name search matches them, and notes by the items' flags, with items that have none first, then disabled, edited and custom ones. Items that tie are sorted by name.

For PF1E, the only default item for now is a dagger; for SF1E, a survival knife.

Default items work like default tiles: an edit applies to your universe only and can be undone to restore the default, and an item you created can be deleted.

Each ruleset groups its item types into categories, which the filters use. For PF1E:
- `weapons`: dagger, club, quarterstaff, spear, short sword, longsword, shortbow, longbow, light crossbow, arrows, crossbow bolts
- `armor`: padded armor, leather armor, chain shirt, light shield, heavy shield
- `gear`: rope, torch

For SF1E:
- `weapons`: survival knife, tactical baton, laser pistol, semi-auto pistol, laser rifle, frag grenade, battery, small arm rounds
- `armor`: second skin, light armor, heavy armor
- `gear`: comm unit, flashlight

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
	- where it comes from (e.g. "Area: Waterdeep, name")
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

Outside of combat, time is based on your actions - if you are standing still, no time passes. Walking a square takes the walk time of the tile walked into (10 seconds for an indoor tile and 10 minutes for an outdoor one, unless the creator sets another), and a diagonal step counts as one and a half squares. On screen, a player crosses a tile at full speed when it takes no longer than the default for the area (10 seconds indoors, 10 minutes outdoors) and a slower one at a matching fraction of it, so a 20 second tile indoors or a 20 minute tile outdoors is crossed at half speed. Outdoor travel takes longer in game time, but not on screen.

Each group has its own clock, which starts at 8 in the morning and is saved with the group. The whole group shares that one time: when one member walks, time passes for everyone, including members standing still. Members walking at the same time don't pass the time twice: a step is left out when another member's step was counted less than half a second (real time) before it, so two members walking side by side pass the time of one. Only walking in an area whose time `flows normally` passes the group's time: in an `always` area or a `faerie` one the time of day doesn't come from the clock, so the clock stands still there. The group's page shows the day and the time of day in the character's area, the way the universe's "display time" setting says: the clock's time to the second (precise), or a word for the time of day such as afternoon (rough). The time is the clock's, or the area's fixed time in an `always` area. In a `faerie` area it is never more than the word, in place of the clock's time. When the universe displays nothing, the group's page shows no clock, and asking where you are leaves the time out.

The time of day comes from the area's passage of time (see [Edit Universe](#edit-universe)): from the group's clock when time flows normally, fixed for the `always` settings, and from the cell's place on the map for `faerie`. It is light from 7 in the morning to 5 in the evening, dark from 7 in the evening to 5 in the morning, and the light changes over the two hours around dawn (6:00) and dusk (18:00). The map darkens with it, and screen readers are told as dawn breaks or night falls. An indoor area stays as light as its light level instead, and says nothing of dawn or dusk.

On the overworld map, squares are much bigger distances. The scale is not yet defined, but time will pass faster.

## Difficulty
Each group plays at one of its universe's difficulty levels (see [Tab: Ruleset](#tab-ruleset)), chosen when it is made. A level's mob scale makes mobs harder or easier by a percentage, and its permadeath setting decides whether a character who dies is gone for good. Neither does anything yet: mobs, hit points, attacks and death come later, and the rules are ready for them as pure functions (`server/src/logic/difficulty.ts`):
- A mob's hit points are multiplied by 100% plus the mob scale, rounded, and never go below 1. +50% makes 20 hit points 30, -50% makes them 10, and -100% or less leaves 1.
- A chance to hit is scaled the same way: a mob's chance to hit a character is multiplied by it, and a character's chance to hit a mob is divided by it, so harder mobs hit more often and are hit less often. At +100% a mob's 40% becomes 80%, and a character's 60% becomes 30%. At -100% or less, a character's attack hits whenever it could hit at all. No chance goes above 100%, and a chance that was at least 5% never drops below 5%.

## Offline group members
Offline characters don't move. One idea under consideration: every character gets a "ring of 'my friend' summoning". It lets a player unsummon friends who are offline, so their characters don't sit around idle, and when those friends log back in they are teleported to the group for an in-game reason.

## World state
Each group has its own world state, stored as a diff of the universe as it was built. If your group kills an NPC, your world state records that the NPC is dead, and only your group is affected. It also holds the areas you have explored, the results of NPC dialog, etc.

Disbanding a group deletes its world state. Characters (items, money, experience) are stored separately and kept.

What a group has explored is kept as the cells it has seen, area by area: a cell is seen once any member has had it in sight (see [Vision](#vision)). The group's room keeps them in memory and saves them every 30 seconds while anyone plays and when the last player leaves. A window in a group's room is only ever sent the tiles of cells the group has seen, and the links on them, so a script in the browser can't uncover the rest: every other cell comes as unseen, and its tile is sent as soon as a member first sees it. The fog follows where players are drawn, a moment behind the server, so those tiles have usually arrived before the fog uncovers them. Cells out of sight that the group has seen are drawn dimmed, and cells it has never seen are black. A lobby remembers nothing, so there everything out of sight is only dimmed. Deleting an area deletes what every group has seen of it.

## Vision
Each character has a vision budget, in squares. A character looks along straight lines from their cell, and each step along a line spends its length (a diagonal step counts as one and a half squares, as in movement), more when it leaves a tile with a vision cost: 50% spends twice as much. A 100% tile can be seen but not seen past, so a line of mountains blocks your view. It is also seen when open ground on one of its sides is, so the walls lining a tunnel show along its length, while the inside of a thick wall and its far side stay hidden. Open ground diagonally beside it only counts at an inside corner, where the cells on both sides between them can't be seen past either, so a room's corners show but the tip of a mountain range doesn't light up when the ground around it is out of sight. The character's own cell never gets in the way. Void cells are seen past.
- The budget is 20 squares in full daylight and 4 at night, changing with the light around dawn and dusk. An indoor area is lit (20 squares) or dark (4) at any time of day, by its light level. Darkvision sees at least 12 squares (60 feet), day or night, and superior darkvision at least 24 (120 feet). Light sensitivity (being dazzled, a house rule standing in for PF1E's penalties until there is combat) halves the budget in full daylight or a lit indoor area, and takes less away as the light fades, so a drow sees 24 squares at night and 12 at noon.
- In a group's room, the group sees whatever any of its members in the area sees, so members always see each other. In a lobby each player sees only what they see themselves, and unless the universe turns it off on the [Lobby tab](#tab-lobby), they see as far as in full daylight at any time of day and its tiles have no vision cost.
- The server works out what each player can see and only shows them the players in sight. The client runs the same function (`/shared`) to draw fog over the cells out of sight. Screen readers are told how many squares the player can see when they ask where they are.
- A character's darkvision and light sensitivity come from their race as the universe set it when the room started.

## Moderation
- Player and character names can't pass as the game's staff: words such as `admin`, `moderator`, `staff` and `system`, and the game's name, are kept back (`isReservedName()` in `/shared`, checked as the player types and again on the server). Names are compared in a reduced form that sees through capitals, accents, look-alike letters from other alphabets, leetspeak, separators, repeated letters and added digits, and words are found at spaces, punctuation and changes of case, so "TheAdm1n" is refused but "Quarterstaff" isn't.
- Still to come: a profanity filter matching whole words with an allow list (to avoid blocking names like Cockburn or Assassin), slurs blocked everywhere but milder words left to each universe, each universe's own blocked words, and reporting a name so a moderator can force a rename.
- Users can report content and players.
- Copyright holders can report infringement.
- Server admins can disable universes.
- Uploading an image requires checking "I have the rights to use this image".
- Each ruleset comes with a set of stock graphics, so universes don't need their own art.

# Controls

## Field: Money
Freetext but requires a format like "1pp 2gp 2sp 4cp" (PF1E) or "250cr" (SF1E), in the universe's ruleset's coins only

Money is kept as individual pieces of each coin, the way a purse holds them, and is never converted automatically: gaining 5sp twice is 10sp, not 1gp, and starting money from the universe, race and class adds up coin by coin. A character can hold 1pp 302gp 4444sp 10cp. A money changer converts coins into the fewest coins of the same worth (that purse becomes 75pp 6gp 5sp). Who offers money changing, and whether it costs a fee, comes with NPCs.

## Selection: Item
modal dialog, lets you type to search, shows you the top results, with name + stats + picture. Each selected item has a quantity (for example, 20 arrows), from 1 to 999. Disabled items can be selected and are marked as disabled; characters are only given enabled items.

## Editor: Item
- name
- type (e.g., "longsword"), one of the ruleset's item types
- a checkbox for "Enabled?", checked by default

## Selection: Area
modal dialog, lets you type to search, shows the top results, shows you a small preview image of the area

Every area chosen here is a starting area (the universe's, a race's, a class's, or a class's for one race), so the preview also chooses the square characters start on: clicking a square, or Space or Enter on the keyboard's cursor, highlights it. A newly chosen area starts on its center (column 0, row 0). The choice shows as e.g. "Town, from 3, -2".

## Editor: Area
Lets you edit details about the area
- name
- enabled?
	- For new areas, if the universe stage is `in the beginning`, default checked, otherwise default unchecked.
	- if any parent area is not enabled, show a message
- parent area. Parent areas mostly give areas a structure; a child area inherits only its passage of time
- indoors / outdoors
	- indoors shows "light level": `lit` (the default) is as light as full daylight at any time of day, and `dark` as dark as night. The map is drawn that light and vision follows it (see [vision](#vision)). Outdoor areas follow the time of day; the setting is kept while an area is outdoors but has no effect
- default tile, which defaults to "grass" if outdoors and "wood floor" if indoors. It lists the tiles for the area's kind (see [tile editor](#editor-tile)), plus the area's current default tile, so switching between indoors and outdoors doesn't change it
- passage of time, the same options as the universe's plus `inherit` (the default). `inherit` uses the parent area's setting, and an area with no parent uses the universe's
- checkbox for "loops east-west"
- checkbox for "loops north-south"
	- an area whose passage of time is `faerie` can't loop
- [map editor](#editor-map)

## Editor: Map
This is a component included in the [area editor](#editor-area). It shows you the same grid as gameplay.
- the center of map is x = 0, y = 0
- Ctrl+wheel zooms the map; the wheel alone scrolls the page
- a Full Page button (Alt+P) makes the map editor fill the browser window, with the map taking all the space its tools leave; the button, or Escape, puts it back
- each side of the map (top, right, bottom, left) has a button with an arrow pointing away from the editor. clicking it allows you to add the specified number of grid coordinates in that direction, expanding the map
- a map can be at most 50,000 tiles in each direction
- a button to edit size
	- a 3x3 grid, 4 input fields (each in north, east, south, west), showing the number of tiles in that direction
	- a readonly sentence shows the total dimensions (e.g., 1200 tall x 800 wide)
	- shrinking the dimensions will show a warning if you delete any tiles that aren't the default tile
- there is a [draw tool](#tool-draw)
- undo / redo
	- clicking and dragging counts all changes during that as 1 for the purpose of undo/redo
	- each use of an expand button or Edit Size is 1 step too. Making the map smaller sets the cells it cuts off to the default tile, so undoing it brings them back, even after it is saved
- painting, changes to the map's size and links (and return links placed in other areas) are kept in the editor until the editor's Save button saves them along with the area's settings, and the map is read-only while it is being saved. Links are saved after the map's new size, so a link can go on cells the map has grown to include
- links on or into cells a smaller map cuts off are deleted when the smaller map is saved, after asking; undo doesn't bring them back
- maps have multiple layers, such as the ground and objects on it
- area links, a layer independent of the artwork. Any cell can link to a cell in another area
	- `automatic`: entering the cell moves you to the target area
	- `manual`: you are offered the option to enter the area
	- "requires the whole group": the link can only be used when every member of the group is present, including the anchor being. For example, the city -> wilderness link requires the whole group, but the city -> shop link doesn't
	- "select destination coordinates": shows a preview of the target area's map. Clicking a cell marks it as the destination, then lets you place a return link (optional)
	- since links are separate from the artwork, you also need to draw a door (or similar) so players know where to walk

### Tool: Draw
- lets you select a tile, e.g. "Grass" or "Wood Floor": the enabled tiles for the area's kind, indoors or outdoors, and the area's default tile. The list follows the area editor's indoors / outdoors choice before it is saved. Switching an area between them leaves the tiles already painted as they are. Also lets you select "Void" which is just black
- lets you select a size (1 for a single tile, up to 100 tiles)
- brush shape - circle or square

## Editor: Tile
- Delete Tile (a tile the universe added) asks first in a dialog. When maps use the tile, the dialog names their areas and asks for a tile to replace it with, which must be chosen. The tile is struck through until the Tilesets tab is saved; saving paints every cell holding it, and every area whose default tile it is, with the replacement, then deletes it. Undo Delete takes it back. A default tile the universe edited has Restore instead, which keeps it on the maps
- name
- enabled: an area's [draw tool](#tool-draw) and default tile only offer enabled tiles. Maps that already use a disabled tile keep it, and an area whose default tile is disabled keeps it until another is chosen. The tiles new areas start with (`DEFAULT_AREA_TILE_KEYS`: Grass outdoors, and Wood Floor or Metal Floor indoors) can't be disabled
- "used in": checkboxes for indoors and outdoors; a tile can be for either, both or neither. An area's [draw tool](#tool-draw) and default tile only offer the tiles for its kind. A tile for neither can't be painted anywhere, but maps that already use it keep it
- color (used if there are no graphics), accepts hex + has a color picker
- graphic (image). A cell is 32x32 pixels. Graphics only change how the map is drawn; walk time and vision cost still come from the tile
	- each layer has one format, never a mix within a layer, since formats draw on different grids. The format doesn't depend on whether an area is indoors or outdoors, since a tile can be for both
	- the ground layer uses the Dual-Grid System. A Dual-Grid graphic is a 128x128 sheet of 16 frames, each 32x32 (one cell), in a 4x4 grid read left to right, top to bottom. Each frame is drawn on a corner where 4 cells meet, half a cell up and left of the cells, and its number is the sum of the corners holding the tile: top-left 1, top-right 2, bottom-left 4, bottom-right 8. Frame 0 is never drawn. `client/src/assets/tilesets/grass.png` is a sample
	- the tile editor picks a graphic that ships with the engine (`TILE_GRAPHICS` in `/shared`), one of the universe's uploaded tilesets, or none. The hint under the list says how the chosen one is drawn, ending with its tile system: "Blends with neighboring tiles; higher draw order on top. Draw order: 60 (Dual-Grid).", "Drawn over the area's default tile, joining up with its neighbors (47-Tile Blob).", or with none "Drawn in its color."
	- "Upload Tileset Image" (Alt+U) in the tile editor opens a dialog: the layout ("15 tiles, blending with the ground", a Dual-Grid sheet, or "47 tiles, drawn over the ground", a blob sheet; choosing an image of the other layout's size switches to it), the image (a PNG of the layout's size, 128x128 or 256x192 pixels, at most 256 KB), a name, for a Dual-Grid sheet a draw order from 1 to 99 (the engine's own are listed: Grass 30, Forest 40, Mountains 50, Stone Wall 60), and "I have the rights to use this image", which must be checked. The dialog checks the image in the browser and chooses it for the tile, and the graphic list shows it like any uploaded tileset; saving the Tilesets tab uploads it (the server checks it again and stores it re-encoded, without its metadata) before saving the tiles that use it. A universe can have at most 200 uploaded tilesets. Maps draw a tile with an uploaded tileset in its color until the tileset has loaded
	- with an uploaded tileset chosen, "Delete Tileset Image" asks first in a dialog, then takes it off the graphic list and puts the tile back to its color. Tiles drawn with it show their colors on the tab from then on. Saving the Tilesets tab deletes it after saving the tiles, and every tile drawn with it is drawn in its color after; leaving the tab without saving keeps it. One not uploaded yet is simply discarded
	- where different tiles meet, each graphic's draw order decides whose edges overlap whose, since a sheet's edges are drawn for the ground below it; tiles drawn in their colors go below every graphic. Past an edge of a map that doesn't loop, the map ends square
	- players are drawn over the tiles they can walk on. A forest is one sheet, its treetops drawn over its floor; the treetops can rise half a cell above the forest's north edge within ordinary 32x32 frames, since the frames on that edge cover half of the cells north of it, and taller trees need taller frames
	- an impassable tile's graphic, such as mountains whose peaks rise half a cell over the cells north of them, is also drawn over the players standing in the cell just north of it, so they are behind it. No player stands on the tile, and nothing of it is drawn over a player beside or south of it
	- tiles drawn over the ground can use the 47-Tile Blob Set, for things seen from straight above such as hedges, rooftops and rugs. Each quarter of a blob frame depends only on the 4 cells around that corner, as a Dual-Grid frame does, so anything whose look is made of edges and corners can be drawn either way; the blob layout is needed only for art centered on a cell or tied to whole cells. Walls are drawn as their tops, with no front face (which would need more than a cell of height, and reads as a raised floor). A blob graphic is a 256x192 sheet of 47 frames, each 32x32, in 8 columns and 6 rows read left to right, top to bottom; the last place is empty. Each cell holding the tile gets one frame, picked from which of its 8 neighbors hold the same tile: north 1, north-east 2, east 4, south-east 8, south 16, south-west 32, west 64, north-west 128, with a diagonal counting only when both neighbors beside it hold the tile too. The 47 masks that leaves are the frames in ascending order (`BLOB_FRAME_MASKS` in `/shared`), so frame 0 is a cell alone and frame 46 (mask 255) is the tile on every side. Past an edge of a map that doesn't loop, the cell on the edge carries on, so a wall along it runs off the map. Blob tiles are drawn in a walls layer over the ground, under the players, and the ground under them is drawn as the area's default tile. `client/src/assets/tilesets/hedge.png` is a sample; the stone wall (`stoneWall.png`, rubble with cut stones along its edges) is a Dual-Grid sheet with draw order 60, over every ground graphic. An uploaded tileset is either format, as its uploader chose; a blob sheet has no draw order
	- distinctive buildings and lone trees are placed objects rather than tiles (see [Open questions](#open-questions))
- Vision cost - 0% to 100% (cannot see through). See [vision](#vision)
- Walk time - seconds of game time walking a square takes, 0 to 36000. A new tile gets 600 (10 minutes) when it is for outdoors and 10 when it is only for indoors, following the checkboxes until another walk time is typed. Twice the default takes twice as long (PF1E difficult terrain), 0 is impassable
- Has a preview section for day + night

# Localization
Players choose the language they play in, and universes can be translated. There are two kinds of text, and each is looked up in the player's language separately:
- **engine text**, written by the site developers: the pages and editors, messages from the server, emails, and each ruleset's defaults (such as PF1E's races, classes, items and tiles). Its translations ship with the engine
- **universe text**, written by a universe's editors: the universe's name and descriptions, and the names of its areas, tiles, races, classes and items (later NPCs and dialog). Translated in the [Translations](#tab-translations) tab

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
- A shortcut's letter is in its button's English text, so it can be underlined there. The keys follow one pattern: Alt+S submits the form or dialog showing when its button has an S (Save, Send code, Resize); one without takes a letter of its own word, preferably its first (Alt+C for Create, Choose and Continue, Alt+L for Log in and Create Link, Alt+A for Add). Alt+A applies an editor dialog's changes to its tab (Apply), Alt+N adds something new (on the Characters tab, which adds races, classes and themes, Alt+R adds a race, Alt+L a class and Alt+T a theme), Alt+L leaves (the lobby or group) or picks the Links tool in the map editor, Alt+U enters a universe, Alt+H goes Home from a message filling the page, Alt+B goes back, Alt+M moves focus to the map, and Alt+P makes the map editor full page.

## Screen readers
- When a screen changes, focus moves to its heading, so the screen is read out.
- The game's map is a focusable application with its keys described. A screen reader is told the area the player enters, players coming into and going out of view, a door or path underfoot that E takes, and when something is in the way. Alt+P reads out the player's area and cell, the tile they stand on, and each player they can see with their distance and compass direction, and shows the same in a toast at the top of the page.
- A toast (`showToast()` in `client/src/ui/toast.ts`) shows a short message at the top of the page for a few seconds (longer while the pointer rests on it), and screen readers read it out through the announcer; the toast itself is hidden from them, so it isn't read twice.
- The map editor's map (and the link dialog's preview) can be focused and worked with a cursor: the arrow keys move it, Space or Enter paints or picks its cell, holding Space while moving paints a stroke, + and - zoom and Home returns to the center cell. Each cell the cursor reaches is read out with what it holds.
- Colors are never the only way information is shown: the tile table's swatches carry the color's hex code.

## Sortable tables
A table that can be sorted has a button in each heading that sorts it (`TableSorter` in `client/src/ui/tableSorter.ts`, with `sortRows()` and `SortOrder` in `/shared`). Clicking a heading sorts going up, and clicking it again going down. The heading sorted by has `aria-sort` and an arrow showing which way; the others show an arrow both ways. Screen readers are told how the table is now sorted. A list paged on the server sends the order as the `sort` and `direction` query parameters, and the server sorts before paging; ties are kept in the list's own order.

# Open questions
- **Time:** the overworld map's scale.
- **Offline group members:** whether to use the summoning ring.
- **Lobby:** the player limit (from load testing), and how groups manage their lobby listing.
- **Cross-universe play:** art style, and whether items need a "source universe" setting.
- **Accounts:**
	- which email sending service to use in production (email goes out over SMTP, so it's configuration)
	- whether to add a CAPTCHA (such as Cloudflare Turnstile on sending a code). The code limits stop guessing, but someone who knows an address can make 15 wrong guesses and block that address's codes for a day
- **Messages:** blocking, reporting and who can message whom, before messaging is supported.
- **Universe versions:** how versions are built and switched.
- **Objects:** how placed objects such as houses and lone trees work. The likely shape: an object is made once and placed in any number of areas, with an image, the cells it covers (each with its own walk time and vision cost, read by the server), the part drawn above players so a player walking behind it is hidden, and door cells for area links into its interior, which is an indoor area
- **Maps:** a map 50,000 tiles in each direction could hold billions of cells, so maps need to be stored sparsely or in chunks rather than as one full grid.
- **Characters:** whether character names must be unique within a universe.
- **Localization:**
	- whether a universe can rename engine terms (calling gold "crowns"), which changes the pages' wording in that universe
	- fonts for map text in scripts the default font doesn't cover, such as Chinese and Japanese
	- whether to offer machine translation of chat
- **Licensing:** how to use Pathfinder content within its open license and Paizo's terms for the "Pathfinder" name, alongside the project's AGPL license.
