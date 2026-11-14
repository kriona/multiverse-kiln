This document describes the UI + game structure for the Multiverse Kiln. It describes the framework only: some systems (such as monsters and gaining experience) are left out, and not all settings are listed yet. Undecided items are collected in [Open questions](#open-questions).

# Pages
## Home
Lists all universes. In the beginning there will only be a few, but in the future there may be thousands, so we should be forward-thinking about the UI (even if advanced search filters don't exist yet). Each universe should show name, 1-sentence description, ruleset, and [languages](#tab-translations). Only universes in the `let there be light` [stage](#edit-universe) are listed for everyone. Anyone can see it; its toolbar links to the [login page](#login), or once logged in shows the player's name and a Log out button. A logged-in player also sees the universes they work on, and a button for [Create Universe](#create-universe). A player with a role in any universe in `prologue` sees those in a section of their own, for testing, which isn't shown to anyone else. The lists are stacked: Universes, then those open for testing, then the player's own. A list with nothing in it is left out, except the player's own, which then asks "Try your hand at the act of creation?". Create Universe is centered under the player's own list, or under that question, and is left out while the site's admins have turned off creating universes or the player has created the most they may; a player with no universes of their own who can't create one isn't shown the section at all. When there is nothing to play and nothing of the player's own, and universes can't be created (or the browser isn't logged in), Home says "The stars are still being forged." in place of the lists.

Each universe links to its [page](#universe-page).

## Universe page
Every universe on Home has a page of its own at `/universe/<slug>`, listing all details about the universe, with an [Enter Universe](#enter-universe) button. A universe at the `end of time` has one too, which says it is locked; one in `prologue` or `in the beginning` has one only for players whose role lets them play it in that stage (`canViewUniverse()` in `shared/src/universes.ts`), and a disabled universe has none. The page doesn't need a login; while the browser is logged in (in any tab), it also lists the player's characters in the universe, with each one's race and class; choosing one shows their [character sheet](#character-sheet). Its creators, builders and translators, and server admins with 2FA on (everyone the editor lets in but beta testers, who only play), also get an [Edit Universe](#edit-universe) button (Alt+I) beside Enter Universe, in the draft purple, which opens the universe in the editor; the server says whether the player may (`editable`), and the button hides once the browser logs out. The slug is made from the universe's name: lowercase, with every run of characters other than letters and digits turned into a hyphen ("The Shattered Isles!" is `the-shattered-isles`). Letters of every alphabet are kept, so a name in any language reads in its address. `/universe/<id>` always works too, and changes the address to the slug.

Its Languages section lists the languages the universe can be played in (its source language, then those it is translated into), each named in its own language and in the page's, and marks the one the player sees its text in now. Choosing one plays the universe in it, the way the language picker at the bottom of the page does (see [Choosing a language](#choosing-a-language)), and lets players choose languages the site itself isn't translated into: those are marked "(universe text only)", and a note under the list explains that choosing one shows universes' own text in it while the site's buttons and menus stay in the language they are in. Choosing a language the site is translated into switches the site to it too, and once the page has loaded again a green message says so ("The site is now in Deutsch."). While the browser is logged in and the player's profile names a language, choosing one changes the profile's language too (`PUT /profile/locale`), since universe text is looked up in the profile's language first, and the section says so.

Universe names are unique, and names that could be mistaken for each other count as the same, so one universe can't pass as another. Two names are the same when they have the same slug, or when they match once capitals, accents, letters from other alphabets that look like Latin ones, stand-ins such as "1" for "i", repeated letters and the spaces and punctuation between words are set aside (the same comparison player names get for reserved words, `shared/src/names.ts`). "Kilnhaven", "Kiln Haven", "K1lnhaven" and "Кilnhaven" (with a Cyrillic К) are all the same name. A name needs at least one letter or digit. It can't hold anything a mail client could make into a link or read as markup, since emails sent from the site's own address name the universe: angle brackets, `://`, `mailto:`, `tel:` or `sms:`, or text shaped like a domain or an email address (a letter or digit, then a dot and two letters, as in `evil.example`; "St. Louis" is fine, "St.Louis" isn't). Full-width and other look-alike forms count, and invisible characters between a domain's parts don't hide it (`hasLinkLikeText()` in `shared/src/universes.ts`). Renaming a universe changes its slug, so links that used the old slug stop working; links by ID keep working.

## About
Free text. There will be many of these pages (like an FAQ or Help).

## Privacy
The privacy policy (`privacy.html`), linked from every page's footer and from the login and register pages: what the site keeps about players, why, who sees it, how long it is kept, and how to export or delete it. It names no hosting companies, since each site running the engine chooses its own; a site sets its contact address on the [admin page](#admin), and the policy leaves the contact line out until it does. The page shows the date it last changed, and the site emails players when it changes in a way that matters.

## Login
You select a login provider like Google or Discord, or you can make a local account. Local logins are based on email, not username (but email can be changed).

Local accounts are supported, but the login and register pages recommend a provider for security reasons.

Home, universe pages and the license and privacy pages don't need a login; the lobby, the game, the editor, Create Character and profiles (your own and other players') do. Those send a browser that isn't logged in to the login page (`/login`), which goes back to them once it is. Logging in in one tab reloads the browser's other logged-out pages, so they are logged in too, and logging out takes every window of that browser out with it.

A login starts a session, kept on the server and named by an HttpOnly cookie. A session ends after 1 hour without use, and after 24 hours in all. Checking "Remember me" makes it last 30 days without use and 90 days in all, after which the player logs in again. Having any page of the site open counts as use: every page but the login page joins the session room as it loads. Logging out ends the session on the server. Changing the password or email address, or turning 2FA on, ends every other session of the account, and resetting the password ends all of them. Logging in again from a browser that's already logged in ends its old session, so a copy of its old cookie stops working. A password asked for again while logged in (to change it or the account's 2FA, or to delete the account) counts against the same limits as logging in to the account's address, so a stolen session can't guess it faster.

A player can be logged in from several browsers at once, each with a session of its own; every window of theirs, in any browser, is that player. Logging out ends only that browser's session, and its open windows are logged out with it.

Google and Discord logins use OAuth with PKCE, and the provider sends the browser back to the login page, which finishes the login. Only a provider account with a verified email address can log in, since every account has one. The first time, the login waits up to 10 minutes for one more step, from that browser only:
- if no account has its email address, the player chooses a username and name (the provider's name suggested) to create one. Emails them when they have a new account
- if a local account has it, the login isn't joined to the account automatically: the player is asked to log in to the local account (with its password, or an [email code](#email-codes)), which links them and emails the account. An account has at most one login from each provider

A logged-in player can also link providers from their profile. So a stolen session alone can't add a login that outlives a password change, they first confirm it's them with their password, or by entering a code emailed to the account's address when it has no password, and an authenticator or recovery code when the account has 2FA (a trusted browser still asks). The provider sends the browser back to the login page, which links the provider login to the account the browser is still logged in to (its email address needn't match the account's, but it must be verified, as for logging in), emails the account, and goes back to the profile. A site offers a provider once its OAuth client is set up (`server/.env.example`).

Accounts can turn on 2FA with an authenticator app (TOTP), and get recovery codes for when they lose it. Turning it on or off, and making new recovery codes, asks for the account's password, or for an account that only logs in with a provider, a code emailed to its address, so a stolen session alone can't turn 2FA on and lock the owner out, or turn it off; an account with neither a password nor an address can't have it. An account with 2FA asks for its code after a Google or Discord login too, so 2FA guards every way in, not only the password: a provider account without its own 2FA, or a provider login linked with a stolen session, still can't get past it.
- Turning it on, from the profile, asks for the password, then shows a QR code for the app (drawn in the page, and the secret as text for typing in by hand; the secret is never put in an address), then asks for the code the app shows. Then it shows 10 recovery codes, once, to copy or save as a text file. Every other browser logged in to the account is logged out, so one the player didn't know of has to log in again, with the code. The server keeps the secret encrypted (AES-256-GCM, with `TOTP_ENCRYPTION_KEY`, kept apart from the database) and the recovery codes as keyed hashes.
- With it on, logging in with the password, or with a linked Google or Discord login, asks for the app's code next, from the same browser, within 10 minutes. A recovery code works in place of the app's code, once, and the account is emailed how many are left. 5 wrong codes end the login, and an account can try 10 codes an hour wherever they are typed. After 20 wrong app codes in a day, only recovery codes are taken until the day's count drops, so guessing app codes stays slow without locking the owner out. The account is emailed at its 10th wrong app code of the day, saying so and, if it wasn't them, to log in and change the password. Each app code works once.
- At the code, "Don't ask again on this browser for 30 days" trusts the browser: its logins skip the code until then. The profile shows how many browsers are trusted, and can stop trusting them all.
- Resetting a forgotten password and linking a Google or Discord login (with the password or an email code) ask for the app's code too, unless the browser is trusted, so someone who gets into the player's email still can't take the account.
- Turning it off and making new recovery codes ask for the password and a code. Turning it on or off emails the account. A player who loses the app and every recovery code can't get back in on their own: only the site's contact can help.

### Dormant accounts
An account without 2FA that hasn't logged in for 180 days (`DORMANT_LOGIN_DAYS`, longer than a remembered session lasts, so a player who keeps playing never sees it; counted from when the account was made if it never has) needs an [email code](#email-codes) to log in with its password, in case the password leaked while nobody used it. After the right password, the login page asks for the code sent to the account's address, and once that browser has entered it, logs in with the password again. Sending another code logs in again too, since nothing else sends this code. The email says someone is logging in with the password and, if it isn't the owner, to reset it. Accounts with 2FA already check it's the owner, and Google and Discord logins already confirmed the address, so neither is asked.

### Login limits
An address can be tried 10 times an hour at login, and a network 30 times, so passwords can't be guessed quickly. Wrong passwords typed while logged in (changing the password or 2FA, deleting the account) count against the same limits. Anyone can use up an address's tries, so a browser that has logged in to the account (marked by a signed cookie that lasts 180 days after its last login and doesn't name the account) counts its own 10 tries an hour instead, and can still log in while others' guesses have used up the address's.

## Deleting an account
From the profile, in two dialogs. The first says what deleting the account does (that groups whose anchor being is one of the player's characters disband only when there are any) and suggests downloading their data first. The site's only server admin can't delete their account until another player is made one; the dialog says so in place of what it asks. Before deleting, the player decides for each universe they are the only creator of: hand it to another of its editors (whatever their role) as creator, or delete it, with its world, uploads and everyone's characters in it, which emails its other editors as [deleting a universe](#deleting-a-universe) does; nothing is chosen for them. A universe the site's admins disabled and prevented its creators from deleting (see [Universes](#universes)) has no choice to delete it, and a note says why; when it has no other editors, the dialog says the account can't be deleted until the admins enable it, in place of what it asks. A universe that requires its editors to have 2FA on (see [Tab: Editors](#tab-editors)) is the same for an account without it on, since deleting it would otherwise do what the editor refuses that account: it can only be handed on, and with no other editors the account can't be deleted until 2FA is on. Handing it on is still allowed, since the new creator needs 2FA on to open the editor. The server checks both again once the universe is locked. Its Delete my account and Cancel buttons sit together at the right. Delete my account closes it and opens the second dialog, which asks "Are you absolutely sure you want to delete your account? This is permanent (a very long time!) and cannot be undone." and has Delete my account at the left and I've Made A Terrible Mistake (which closes it) at the right; if the universes changed in between, the first dialog opens again and lists them anew. In the second dialog they confirm with their password, and an authenticator or recovery code when the account has 2FA (a trusted browser still asks), or, when the account has no password, by typing their username and entering a code emailed to the account's address, so a stolen session alone can't delete it (an account with neither a password nor an address has only the username to check). Groups whose anchor being is one of their characters disband, and their other characters leave the groups they were in. The account, profile, characters, sessions and auth events are deleted, every window of the player is logged out, windows playing in a deleted universe are told it is gone, and the address the account had is emailed. Before deleting, the player can download their data as one JSON file (also offered on the profile at any time): the account and profile, linked logins, whether 2FA is on, sessions and auth events (without tokens or networks), roles in universes, characters with their sheets, Create Character's progress, the messages they wrote that the [kept chats](#chat) still hold, the saves they made in universes' editors that are still kept ([Audit](#tab-audit)), and of other players' saves, what those that gave them a role, changed it or took it away did to them (without who saved), and the admin records they did or were made or removed as an admin in (without the other admin). Their messages stay in those chats, shown as written by "[deleted user]".

## Register local account
Enter an email, it sends you an [email code](#email-codes), enter the code, then the email again with a password, username and name to create the account (the server keeps only a keyed hash of the address while it waits, so it asks for the address again). The username is checked as it's chosen, when the player leaves the field or pauses typing for 2 seconds. A circle turns at the right of the field while the server checks (it stays still for players who ask for less motion), and the line to the right of the field (under it on a narrow screen) says whether it's available or why not. The line keeps its space while empty, so the form doesn't move as it changes. Only a browser creating an account can ask (one that entered the code to register, or came back from Google or Discord with a login that has no account), at most 60 times an hour from one network, so the public can't ask which usernames exist. Choosing a username after a Google or Discord login checks it the same way. Recommend the user use a password manager, link to a couple prominent ones. Emails you when you have a new account. Then a check mark welcomes the player by name and says they're logged in to their new account, and under a Set Up Two-Factor Authentication heading the screen offers to set up 2FA now, which opens its dialog on the profile, or to go on to the page the player came from.

If the address already has an account, the page answers the same as for a new one, and the address is emailed a note saying it has an account and how to log in or reset the password, in place of a code.

## Forgot your password
Enter an email, it sends you an [email code](#email-codes), enter the code to change your password (with an authenticator or recovery code too, when the account has 2FA). Emails you when the password is changed, signs the account out everywhere, and stops trusting every browser that skipped the 2FA code.

## Email codes
Registering, resetting a password, changing an email and linking a Google or Discord login all send a code by email, as do deleting an account, changing 2FA and [deleting a universe](#deleting-a-universe) when the account has no password, and logging in to a [dormant account](#dormant-accounts). Every code follows these rules:
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
- for an account with a password or an email address, two-factor authentication: turn it on, or turn it off and make new recovery codes (each confirmed with the password, or without one, an emailed code), with how many recovery codes are left and how many browsers are trusted (see [Login](#login)). A server admin can't turn it off, so their profile says they can't turn it off while they are a site admin, in place of Turn off (see [Admin](#admin)). Turning it off names the universes the player has a role in that require their editors to have it on, which they can't open in the editor until it is back on (see [Tab: Editors](#tab-editors))
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
- dismissed notices: the notices the player dismissed with their X (such as the editor's notices about the [version open](#universe-versions)), which the account remembers so they don't show again, each listed by its text with a Show again button, and a Show all notices again button below the list

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
- There will be a [chat](#chat). You chat as your character.
- If you have not created a character, you will use a ghost icon and nobody can see you. You can walk around the space. You can read chat but not send messages. Ghosts don't block cells, and pass through other players. Other players aren't shown ghosts in the list of who's here; a ghost sees themself listed as one. The [Create Character](#create-character) button should be more prominent.
- If you have created a character, chat will be enabled. You will move about the space as your character, starting as the one you played or made most recently. You can switch characters at any time, and every window of yours in the lobby switches with you. Characters in a group play in their group, not the lobby; choosing one in the lobby's list goes to their group.
- Each of your characters has a button that shows their [character sheet](#character-sheet), and Alt+K shows the sheet of the one you're playing.
- You may create up to 20 characters per universe (the [admin](#settings) setting, 20 by default).
- The space to walk around is the universe's lobby region (see [Tab: Lobby](#tab-lobby)). The lobby areas are the areas below it, at any depth: the areas in it, in the [regions](#regions) inside it, and inside those areas, whatever other regions they are in too. Players start on the lobby's starting square, in one of them, and walk all of them, through links and [neighbors](#neighboring-areas), each lobby area taking its passage of time from the [Lobby tab](#tab-lobby). A universe with no lobby region or starting square, or whose starting square's area is disabled, has a lobby with no area to walk in: the chat, who's here and your characters work as usual, but there is nowhere to walk. The area comes and goes as the Lobby tab's settings change, without leaving the lobby.
	- the lobby areas are never connected to the game world, whatever anyone's role. The server refuses every save that would connect them, applying the draft and importing included: a link or neighbor between a lobby area and an area outside the lobby region, either way; a starting area (the universe's, a race's or a class's) below the lobby region; and a change of parents, or of which region is the lobby's, that would leave either. The rooms hold to it too: a group's room treats a lobby area as an edge and never moves anyone into one, and a lobby never moves anyone out of them
	- a save that puts an area holding group characters (playing there, or saved there by their group) below the lobby region warns about them in Save's dialog, as [disabling](#disabling-things-players-are-using) does, and moves them back to their start area. Lobby players in an area that leaves the lobby region go back to the lobby's starting square
- If you have a character selected, a [Create Group](#create-group) button will be enabled.
- Groups can be listed in the lobby so players can find them without an invite. How a group manages its listing is not yet defined.
- Leave lobby goes back to the universe's [page](#universe-page).

Colyseus has no built-in player limit for a room; we set it (`maxClients`). The real limit comes from the server's CPU and bandwidth: every movement is sent to every other player, so traffic grows with the square of the number of players. The number will come from load testing. When the lobby is full, another instance of it opens.

### Cross-universe play
This stays loosely defined until more of the infrastructure exists.

If a universe allows it, and you are in the universe's lobby, you may enter a portal room that lets you jump universes. The portal room is probably an auto-generated area showing each universe you can enter.
- Your name will be "[Name] of [Universe]" and "of [Universe]" should be styled italic / slightly darker than the rest of the text it displays with.
- You can enter even if your race or class is disabled in the other universe. Universes that allow cross-play need to work this out between themselves.
- Items work the same as in your home universe. Items may need a "source universe" setting.
- Your art is retained from your home universe. Each universe has its own artwork for characters and items. A character has:
	- a sprite, shown in the area. It may or may not be generated automatically from the avatar
	- an avatar, a larger view of the character showing all their worn items. Every item needs avatar art drawn by an artist

## Create Character
Based entirely on the universe's ruleset. It is a page of its own, reached from the lobby, that goes through steps (name, race, class, a theme in SF1E, ability scores, then a review) and returns to the lobby when the character is made. Rulesets will add more steps, so there may be a lot to work through:
- the player's progress is saved on the server a moment after each change and when the step changes, so they can go back to the lobby, close the browser, or switch browsers, and pick up on the step they were on. "Start over" throws the progress away
- progress is checked against the universe only when the character is made; a race or class that has since been disabled is left out when the progress loads

For PF1E, the server rolls the ability scores (or checks the point buy choices) using the universe's [stat rolling](#pf1e) setting; the client never sends ability scores of its own. The player can rearrange rolled scores among the abilities, with the class's primary ability as a hint.
- the server keeps a player's rolled scores until they make a character with them, so leaving Create Character or starting over doesn't roll again. If the universe changes how it rolls, the next visit rolls again
- the player chooses a name, an enabled race and an enabled class. The race, class and theme fields start blank, so the player must choose each rather than taking whatever is first. A race with a floating ability bonus asks which ability gets it
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
- **Last Rites (delete in 7 days)** deletes them after the days the [admin](#admin) setting gives (7 by default), and isn't offered when it is 0. Until then they are listed, marked with the day they go, and count toward the characters a universe allows, but can't be played. Their sheet says when they go and has a Restore button. A player playing them switches to their most recent other character, or becomes a ghost; restoring a character while a ghost plays them. A character already given their last rites can still be cremated
- **I've Made A Terrible Mistake** keeps the character, and is the button focused

A character in a group can't be deleted either way, and the server refuses. Their sheet's Delete button says so instead, in the dialog that asks whether to leave the group (Disband the Group? for the anchor being), and once they have left goes on to the questions above; a window playing them in the group goes to the lobby with them, as the group's Leave group does. A character in a group who can't play because their race or class is disabled (see [Disabling things players are using](#disabling-things-players-are-using)) can't reach the group's Leave group button, so their sheet offers it instead, asking first like the group's (Disband Group for the anchor being).

The server deletes characters whose days are over once an hour, and hides them until it does.

## Create Group
The character creating the group is the "anchor being". This shows you a landing page for your new group. It explains that your character is the anchor being for this universe, and that the game is centered around them.
- The group starts in the anchor being's [starting area](#tab-characters), chosen from the universe's, race's and class's settings as they are when the group is made.
- If the anchor being leaves the group, the group is disbanded and its [world state](#world-state) is deleted. Every character keeps their items, money and experience. A character in a group can't be [deleted](#deleting-a-character) until they leave it.
- If the anchor being is offline, the group can't use [area links](#editor-area-cells) that require the whole group (for example, leaving the city for the wilderness), but can use the ones that don't (entering a shop in the city).
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
- While a player has any window in a group's game, all of their characters in it are in their areas; the ones no window controls stand still. When their last window leaves, their characters leave their areas, and where each one was is saved for when they come back.
- A character new to the group appears beside the anchor being.
- A member can leave from the group screen, after a question; they go to the lobby and need a new invite to come back. The anchor being leaving asks whether to disband the group.

The group screen lists the members, saying which is the anchor being, which are yours and which aren't here. It has the group's [chat](#chat), in character, with a line above it naming the members who are here.

A link that requires the whole group works only while every member who can be played (and the anchor being, always) is in the game, in the same area as the character taking it, and not already on their way somewhere. Then the whole group goes through together, so a player with several characters doesn't walk each one through. Otherwise the player is told the whole group has to be there.

## Chat
A lobby, each group and each universe's editors have a chat. Chat is text players write, so it is never translated, and each room limits how fast a player may send to it (5 messages every 3 seconds; a message sent faster is dropped, and the player is told). Lobby and group chat is in character, written as the character being played. The editors' chat is written as the player, with their display name and @username.
- Lobby chat isn't kept: it lives in the lobby's room, and a window joining sees the last 50 messages since the room opened.
- The editors' chat and each group's chat are kept, with their newest 200 messages: writing another deletes the oldest. A window joining sees all of them. The room writes new messages to the database every few seconds and as it closes; a room opening for the same chat while one closes loads it once that last write is done. A group's chat is deleted when the group disbands, and the editors' chat with the universe. Deleting an account leaves its messages where they were written, shown as written by "[deleted user]", and the data download includes the messages the player wrote that are still kept. The open rooms take the name off at once, in the lobby's chat too: in what they hold, in messages not yet written to the database, and in the windows open, which show "[deleted user]" in its place (`server/src/players/accountDeletions.ts`).
- The editors' chat remembers how far each player has read it (`chat_reads`: one row per player and kept chat, the chat being its universe and group, with the group empty for the editors' chat), so messages written while they were away count as new when they come back, in any browser. A player new to a chat starts with what it held as they first joined read. A window tells the room each time the player sees newer messages, the room tells the player's other windows, and writes the records with its messages. The records go with the player, the universe or the group, and are in the data download. Group chats can use the same records; a group's chat is always on screen, so it doesn't yet.
- A group's chat says who is in the group as it changes, each in a sentence all in blue, set apart from players' messages: "[character] created the group." as its first line, "[character] joined the group." when a character joins through an invite link, and "[character] has left this group." when one leaves, however they leave (from the group or their sheet, because the [group size](#tab-characters) was lowered, or because their player deleted their account). Each is a notice the server writes, kept with the chat's messages (`chat_messages.notice`, with no text), and each window writes it in its player's language. The room that has the chat open sends it to its windows and writes it with its messages; with no room open, it goes to the database as it happens (`server/src/rooms/groupChatNotices.ts`). A disbanded group's chat is deleted with it, so disbanding writes none. Notices aren't in the data download's messages the player wrote.
- A line above a kept chat names who is here: for the editors' chat, every player with the universe's editor open; for a group's, the members with a window in its game. A lobby may hold many more players, so how it shows who is online is still open (see [Open questions](#open-questions)); its list of who's here stays as it is.

## Messages
You can send messages to other users (or yourself).

Messages reach a player on whatever page they have open, through the session room, which every page but the login page joins. They are kept apart from the [chats](#chat) of a lobby, group or universe's editors, which stay with those rooms. A message goes to every window of the player it's for, as a one-off message rather than synced state (the session room is shared by every window), and is saved in the database. Each page joins the session room as it loads, so a page asks for recent messages and unread counts once it has joined.

Before messaging is supported, it needs:
- blocking
- reporting
- rules for who is allowed to message whom

## Create Universe
This is a modal dialog on the home page that asks for some basic info before creating a universe. These fields will be identical to the ones on the [Edit Universe](#edit-universe) page.
- name
- 1-sentence description

Creating a universe
- creates a Lobby region holding a lobby area, which it makes the lobby region and the area of the lobby's starting square, and a World region holding a default area that it sets as the starting area for all races (see [Regions](#regions))
- makes you its creator

When the player's account can have 2FA (it has a password or an email address, see [Login](#login)) and it is off, the dialog also has a "Turn on two-factor authentication" checkbox, checked by default, explaining that the universe is only as safe as the account: anyone who learns the password could change or delete everything built in it, and 2FA asks for a code from an app as well. With it checked, Create makes the universe and then opens the dialog that sets up 2FA (the profile's, see [Login](#login)), with Skip Setup in place of Cancel. Skipping it, or closing it any other way, opens the new universe in the editor; turning 2FA on shows the recovery codes first, then opens it. For an account without a password (one that only logs in with Google or Discord), the setup dialog emails a code to the account's address in place of asking for the password.

The [admin page](#admin) decides how many universes a user can create. The admin page can also turn off creating universes for everyone, which disables the Create Universe button.

## Admin
Pages for the site's server admins. The admin page (`/admin`, `client/admin.html`) links to the tools (`client/admin/`): Players, Server Admins, Sessions, Settings, Translations and Universes, each a card saying what it does, in alphabetical order by their names in the player's language. Each tool's toolbar reads like a path back to it, such as Multiverse Kiln | Site Admin | Settings, with Site Admin linking to the admin page. Only server admins can see and use them, and only they see Site admin in the account menu at the end of every toolbar, which goes to the admin page.

Whether a player is a server admin is stored in the database (`server_admins`). The first admin is made by hand with a script run on the server (`npm run admin:add -w server -- <username>`); after that, admins add and remove other admins on the [Server Admins](#server-admins) page. Both connect to the database as its admin role (`kiln_admin`), the only role that can change who is an admin, the site's settings, the admin events and whether a universe is disabled or kept from being deleted; the rest of the server's role can only read them, so a bug anywhere else can't make someone an admin, change the settings or undo a universe's disabling. An admin must have 2FA on to be logged in at all, not only to use the admin pages: a session of an admin without it doesn't count, and is ended when it's next used (`resolveSession()` in `server/src/auth/sessions.ts`), and making a player without it an admin logs them out everywhere at once. Their next login, with a password, Google or Discord, after resetting the password or when linking a provider login, doesn't finish until they turn 2FA on: in place of the authenticator code, the login page opens the dialog that sets it up at the QR code (the login has shown it's them, so it asks for no password or emailed code), with a paragraph saying admins need it to log in, then shows the recovery codes and goes on (`startLogin()` in `server/src/http/twoFactorAuth.ts`). The login waits 10 minutes, from that browser only, and 5 wrong codes end it, as for the authenticator code; closing the dialog goes back to the login screen, saying why. An admin can't turn 2FA off: the profile has no Turn off button for them, saying they can't turn it off while they are a site admin, and the server refuses it, so to turn it off another admin first removes them. A player who isn't an admin is told the pages are only for admins, and a browser that isn't logged in goes to the login page.

What admins do as admins (adding and removing admins, disabling and enabling universes on the admin pages, and [deleting a universe](#deleting-a-universe) as an admin from its editor) is recorded in `admin_events`, in the same transaction as the change: the admin, what they did, the player or universe, the reason given for disabling a universe, and when. The records are kept; deleting an account or a universe empties its columns in them rather than deleting them, and the record of deleting a universe keeps its name. A player's data download includes the records they did or were the subject of. Saves an admin makes in the world editor are recorded with everyone else's, on the editor's [Audit tab](#tab-audit).

### Settings
Settings for the whole site (`/admin/settings`), stored in one row of the `site_settings` table. Anyone can read the ones the pages show (the character deletion days, the social sites and the privacy contact) through a public route of their own.
- universe creation enabled: whether players can create universes
- universes per creator: the most universes one player may create, from 1 to 1000
- areas per universe: the most areas each version of a universe (its live version and its draft, counted apart) may have, from 2 to 10000 (1000 by default). Making an area past it is refused, and so is importing a file listing more. A universe with more keeps them, but can't add any until it has fewer
- characters per universe: the most characters one player may have in one universe, from 1 to 100 (20 by default), counting those given their [last rites](#deleting-a-character) until they are deleted. Making a character past it is refused, and Create Character says so as it opens. A player with more keeps them, but can't make any until they have fewer
- character deletion days: how many days [Last Rites](#deleting-a-character) waits before deleting a character, from 0 to 365 (7 by default). 0 turns Last Rites off. Characters already given their last rites keep their day
- social sites: links to the site's own pages on Discord, Facebook, Instagram, TikTok, X and YouTube, each optional. Every page's footer shows each one's logo, linking to it. A link must be https and on that site's hosts (`SITE_SOCIAL_HOSTS`), so it always goes to the site its logo says
- privacy contact: the email address the [privacy policy](#privacy) tells players to write to about their information. Empty leaves the line out of the policy

The universe settings don't change universes that already exist.

### Sessions
The login sessions still going (`/admin/sessions`), most recently used first, 50 to a page: each one's player (name and username, linking to their profile), when it logged in, when it was last used and when it ends if it isn't used again, and notes: This browser, Connected (a window of the site is open now) and Remembered ("Remember me"). A search narrows them by the player's name or username, and a filter to those connected or not.

### Players
Every player account (`/admin/players`), by username, 50 to a page: name and username (linking to their profile), email address, when they joined, when they last logged in (`players.last_login_at`, set whenever a session starts), how they log in (Password, Google, Discord), and notes: Active (a window of the site open right now), Server admin and 2FA. A search narrows them by name, username or email address, and a filter to server admins or other players.

### Server Admins
The site's server admins (`/admin/admins`), by username: name and username (linking to their profile), when they became one, and notes: You, and 2FA, or a warning that an admin without it (such as one just added) is logged out until they turn it on. A field finds a player who isn't an admin by name, or @ and a username, the way the [Editors tab](#tab-editors) finds players, and Add Admin makes them one. Each admin's Remove asks first, and removing yourself warns that you lose the admin pages. The site always keeps at least one admin: the last has no Remove, and the server refuses to remove them, even when two admins remove each other at once.

### Universes
Every universe (`/admin/universes`), by name, 50 to a page: its name (linking to its editor), its ruleset, its stage, its creators (linking to their profiles), when it was made, and notes: Disabled, with when and why. A search narrows them by name, and a filter to disabled universes or others.

Disable asks for a reason, up to 500 characters, which the universe's editors are shown, and has a checkbox, checked at first, to prevent its creators from deleting the universe, so what it was disabled for isn't deleted: its creators can't [delete it](#deleting-a-universe) from the editor, which only a server admin then can, and a creator deleting their account has to make another of its editors its creator, and with none, can't delete their account until it is enabled (see [Deleting an account](#deleting-an-account)). Its notes then say its creators can't delete it, and the admin records say whether it was prevented. A disabled universe:
- isn't listed on Home, its page and lobby answer as if it didn't exist, and other players' profiles leave out characters in it
- can't be played: its lobby and groups turn everyone out at once and refuse windows, the game page saying the site's admins disabled it, and Create Character, Create Group and invites are refused
- shows its editors the reason above the editor's tabs, with Save turned off except for leaving the universe and View Universe hidden; the server refuses every save but one that only leaves it, and the player's own universes on Home mark it disabled

Enable, after asking, makes it as it was before, which lets its creators delete it again. Its settings, world and characters are untouched while it is disabled.

A universe's name opens it in the editor. A server admin with 2FA on can open any universe's editor, and edits it with the site admin role (`ADMIN_ROLE`, `editorAccessOf()` in `shared/src/universes.ts`) whenever that allows more than their own role in it, which is any role but creator. The site admin role may do everything a creator may, but isn't stored in `universe_editors`: the admin isn't one of the universe's editors, isn't listed on the Editors tab, and has nothing to leave. The editor's toolbar names the role, and a notice says the admin can change everything a creator can. The [Audit tab](#tab-audit) lists each save made with it, as it lists every other save, naming the site admin role. A server admin can also save a disabled universe, with either role, to fix what it was disabled for; the notice says so.

### Translations
The translation files of the engine text (`/admin/translations`), for translators working outside the repository, in the formats of the [Translations tab](#tab-translations) (`shared/src/translationFiles.ts`): Gettext PO, XLIFF 2.0, CSV or JSON. Everything happens in the browser, from the English catalog (`shared/locales/en.json`) and the language files the build holds, so the tool sends nothing to the server and changes nothing on the site (`shared/src/engineTranslations.ts`). It has an Export section, then an Import section. Export's field takes the language as a tag (`de`, `pt-BR`, `en-x-pirate`), suggesting the languages the site and universes can be translated into, and says under it whether the site has a translation into it. English and the pseudo-language are refused.
- Export (Alt+X) saves every English message as a file into the language, in the format chosen. Each entry is named by its message ID, with its description as the note for translators, its English and the language's translation so far; out-of-date translations are fuzzy in PO and in the initial state in XLIFF
- Import (Alt+I), in a section of its own, reads a file in the format its name says, or the format chosen above, into the language chosen above, or the language the file names when the field is empty; a file naming another language is refused. It makes the language's file from the site's one and the file's translations: each keeps the English the file holds, so one made from English that has changed since is out of date, and one that comes back as the site has it is left alone. Translations marked fuzzy, of messages the English doesn't have, that aren't ICU MessageFormat, or whose arguments and tags differ from the English's are skipped, as the tests would refuse them, and translations of messages the English no longer has are left out. The tool says how many were imported, how much of the English the file translates and how much of it is out of date, and lists the skipped with why
- The language's file only reaches the site once it is committed to the repository, so the tool says to download it (Download, Alt+W) and commit it as `shared/locales/<language>.json`, and the browser asks before leaving the page until it is downloaded. The file is written the way the catalog is: sorted by ID, indented with tabs, with CRLF line endings

## Edit Universe
This lets you change anything about a universe. It will be a whole suite of tools unrelated to playing the game. View Universe in its toolbar opens the universe's [page](#universe-page), shown while the editor's role lets them view it in its stage and it isn't disabled.
- name, unique among universes (see [Universe page](#universe-page))
- logo
- banner image
- 1-sentence description
- long description, written in markdown
- dropdown for "Stage"
	- `in the beginning` - still being created. Only creators and builders can play. Not listed on [Home](#home)
	- `prologue` - open for beta testers and every other editor. Not listed on [Home](#home) for everyone: its editors, beta testers included, see it in Home's section for universes in testing
	- `let there be light` - (ready for people to join. Listed on [Home](#home)
		- a checkbox under the stage, shown while it is chosen, "Builders make their changes in a draft", checked by default: builders can start a draft and choose between it and the live version, but save nothing to the live version but starting a draft and leaving the universe. The live version opens read-only for them, with a notice above the tabs saying to start the draft or choose it, and the server refuses their other saves to it (`mustEditInDraft()` in `shared/src/universes.ts`). Like the stage, the universe holds it once for both versions. Changing it, or the stage, so builders must or needn't use the draft loads the universe again in builders' open editors
	- `end of time` - retired. Locked and view only. Not listed on [Home](#home)
		- the universe page can still be reached, and says the universe is locked
		- only creators (and server admins) can still edit it: the server refuses every other editor's save, except one that only leaves the universe, and the editor says so above its tabs
		- the lobby can't be entered: Enter Universe without a character in a group says why, and players in the lobby when the stage changes are turned out with that message
		- groups can still be opened, read-only: their members can look around their area, switch between their characters and chat in the group, but nothing in the game changes. The room refuses moving and links, and the group screen says it is locked and hides Invite, Leave group and Create Character
		- Create Character, Create Group, invites and leaving a group are refused; players can still list their characters and open their character sheets
	- changing the stage takes effect at once: players the new stage doesn't let play are turned out of the lobby and groups with a message saying the stage changed, as when losing a role, and groups lock as the universe reaches the `end of time` and unlock as it leaves it
	- choosing another stage for a universe still `in the beginning` warns that new areas will start disabled from then on (see [the area editor](#editor-area))
- a dropdown for ruleset - no default, Pathfinder 1E or Starfinder 1E
- Start Draft, Apply Draft and Discard Draft, in the editor's toolbar (see [Universe versions](#universe-versions)): Start Draft for creators and builders, Apply Draft and Discard Draft for creators only
- Delete Universe, under the Universe tab's settings (see [Deleting a universe](#deleting-a-universe)), for creators and the site admin role
- Export Universe, left of Delete Universe (see [Exporting a universe](#exporting-a-universe)), for every role but beta tester
- Import Universe, between Export Universe and Delete Universe (see [Importing a universe](#importing-a-universe)), for every role but beta tester, into the draft
- the editors' chat, with who has the editor open (see [Editing together](#editing-together))
- a dropdown for "display time", how players are shown the time of day in the lobby and the game (see [time and distance](#time-and-distance)):
	- `precise` (the default): the time on the clock, to the second
	- `rough`: a word for the time of day, such as afternoon
	- `nothing`: no time at all
- Tabs:
	- [Editors](#tab-editors)
	- [Ruleset](#tab-ruleset)
	- [Lobby](#tab-lobby)
	- [Characters](#tab-characters), with [races](#races), [classes](#classes) and, for a ruleset that has them (SF1E), [themes](#themes)
	- [Character List](#tab-character-list)
	- [Tilesets](#tab-tilesets)
	- [Areas](#tab-areas)
	- [Items](#tab-items)
	- [Audit](#tab-audit)
	- [Connect to the Multiverse](#tab-connect-to-the-multiverse)
	- [Translations](#tab-translations)

### Unsaved changes
Every change in the universe editor is staged: nothing a tab or its dialogs change (adding, changing or deleting anything, uploading a tileset or deleting one) is saved until the Save button (Alt+S) in the bar at the bottom of the editor is pressed. Only what changes the universe as a whole is done at once, after asking: starting, applying and discarding the [draft](#universe-versions), [importing a file into the draft](#importing-a-universe), and [deleting the universe](#deleting-a-universe). The bar stays in view while the tab scrolls, and above the area editor's cells in full page. It saves every tab's changes together, all or nothing, in one request (POST `/:universeId/changes`, see `shared/src/editorChanges.ts`); reloading the page throws the changes away. When the server refuses a change it saves none of them: the editor shows the tab whose change it was, with the reason on that tab, and keeps every change. A field with a problem stops the save before it is sent, the same way. Each tab shows its changes as they will be once saved, including changes made on other tabs: the areas the Areas tab draws show the Tilesets tab's unsaved tile changes (new and changed tiles, and tilesets staged to upload, from the page's own copy), with tiles staged for deletion drawn as their replacements. Enter in a tab's form saves too.
- The editor dialogs for races, classes, themes, difficulty levels, items, tiles and area links have Apply rather than Save: it keeps their changes on the tab, where the list shows them, tagging what was added as new and what will be restored "when saved", and striking through (in italics, faded) what will be deleted. One of the ruleset's defaults with changes is tagged edited, saved or not. Deleting or restoring is taken back with Undo Delete or Undo Restore in the dialog until the tab is saved. Saving sends each list's changes in the order they were made.
- The tabs save in this order, so a change can name something an earlier one adds: Tilesets (new tilesets, then tiles, each deleted tile or one with a kind unchecked after the default tiles its [replacement dialog](#replacing-a-default-tile) gave saved regions and areas, then deleted tilesets), Items, Ruleset, Characters, Universe, Lobby, Areas, Editors, then starting, applying or discarding the [draft](#universe-versions), so starting a draft copies the save's other changes and applying it includes them. The Characters tab saves its settings, races, classes and themes, and the Ruleset tab its settings and difficulty levels.
- The Areas tab saves the regions added (each after the new regions it is inside), the regions and areas moved, the areas deleted, the areas added, the regions deleted, then the region open in the region editor, then the area open in the area editor: its size, painting and links, then its settings. A new region or area is listed tagged new, and can be opened, painted, linked to and chosen as a parent before it is saved; a new area is the size every new area starts with. Deleting an area asks first, then strikes it through in the list until the tab is saved; opening it shows it read-only with Undo Delete. Deleting a new area discards it immediately, after asking. Painting with a tile staged for deletion is saved as the tile chosen to replace it in the cells, and a new region or area setting a default tile the Tilesets tab is replacing is saved with what its replacement dialog chose.
- The area editor's draw tool and an area's default tile choices list the Tilesets tab's unsaved new tiles and leave out tiles staged for deletion, and the area previews in the link and starting area dialogs draw the Tilesets tab's unsaved changes like the area editor does. Other pickers (starting equipment, a class's races) list only what is saved.

The bar says "Unsaved changes" while any tab has some, and a tab with unsaved changes gets a dot. Closing a dialog (Cancel or Escape), leaving the area being edited, and leaving or reloading the page all ask first while there are unsaved changes.

### Universe versions
A universe has its live version, which players play, and at most one draft being built beside it. Changes saved to the live version reach players at once, as every save does. Changes saved to the draft reach no one until the draft is applied, when all of them reach players at once. Applying a draft can't be undone.

What the draft holds a copy of, and what the universe holds once:
- the draft: the name, the short and long descriptions, the source language and the languages the universe is translated into, the display of time, the lobby (its region, starting square and time), the starting area and square, the group size, the starting coins and items, the Ruleset tab's settings and difficulty levels, races, classes and themes, items, tilesets and tiles, [regions](#regions), areas with their cells and links, and the universe text's [translations](#tab-translations), translator notes and needs-no-translation marks
- the universe: its address, logo and banner, stage, whether builders make their changes in a draft, whether its editors need 2FA, ruleset, its editors with their builder permissions and [region assignments](#regions) (by the live region; a region the draft added can be assigned once the draft is applied, and until then is covered by the assignments above it), and whether a server admin disabled it. Taking a language off the languages the universe is translated into deletes that version's translations into it
- the draft's name is checked against other universes' names when it is saved, without keeping it from them, and again when the draft is applied, which refuses the save when another universe has taken a name too much like it. The address follows the live name, so it changes when the draft is applied. Home, the universe page and the game show the live name and languages
- neither: characters, groups, character items and saved positions belong to the universe and refer only to the live version. Applying the draft keeps the live version's IDs, so they never change

Creators (and the site admin role) start, apply and discard the draft, and builders start it, with buttons in the editor's toolbar, left of View Universe, purple for starting and applying and red for discarding. Each asks first, then saves at once: the exception to staging, since a draft is started, applied or discarded as a whole, and it is saved after the save's other changes. None says the changes were saved unless other changes were saved with it:
- Start Draft, while there is no draft, opens a dialog explaining drafts: a copy of the whole universe players don't see, applied or discarded with the toolbar's buttons. It warns, in a box that stands out, that applying a draft overwrites the entire universe, including changes saved to the live version while the draft is open, and can't be undone. Its button is Start Draft, or Save Changes And Start Draft while there are unsaved changes, which saves them to the live version in the same save, before the copy is made. The editor then opens the draft
- Apply Draft, while there is a draft, says it can't be undone and that changes saved to the live version since the draft started are replaced by the draft's; then the warnings below are asked. The editor then opens the live version
- Discard Draft, while there is a draft, asks first, and deletes the draft, with the tilesets uploaded to it. The editor then opens the live version
- Apply Draft and Discard Draft name the other editors with the draft open who have changes not saved yet ("Bea has changes to the draft that aren't saved yet"), which can't be saved once the draft is gone. Each window tells the editor room whether it holds unsaved work, as it tells it where it is. It is a warning, not a lock, and the player's own other windows don't count
- Apply Draft and Discard Draft wait until no other change is unsaved: the draft is applied as it is saved, and discarding it would throw the changes away. Their dialogs say so, with the button turned off. The server refuses a save that applies or discards the draft along with any other change, or starts it before another
- Cancelling the warnings asked on the way takes the action back. One whose save the server refuses waits in a section of the Universe tab saying why, with Undo, and is sent with the next save

The editor edits the live version or the draft, chosen beside the player's role in the editor's toolbar once there is a draft (the address says `?version=draft` for the draft. An address that names no version opens the one the player last chose in this browser, by choosing it there or by starting, applying, discarding or importing into the draft, kept for the logged-in player and forgotten when the browser logs out (`client/src/ui/editor/versionMemory.ts`); with none chosen, a builder who must make their changes in the draft opens it, and everyone else the live version. An address naming a draft that no longer exists opens the live version, saying why, and forgets the draft was chosen). Choosing the other while there are unsaved changes asks first, as leaving the page does, and closes the area open in the area editor, since the draft's areas have IDs of their own. Every request the editor sends names the version open (`EDITOR_VERSION_PARAM`): changes to what the draft holds go to the one open, and changes to what the universe holds (the Editors tab, the stage, and starting, applying or discarding the draft) apply to the universe whichever is open; the Editors tab says so while the draft is open, to those who may change the editors. A save to the draft tells no room anything and warns about nothing, since no player plays it, and a draft save naming a live row is refused as naming nothing. A notice above the tabs says when the draft is open, and, while the live version is open and there is a draft, that changes saved to it are replaced when the draft is applied unless they are made in the draft too (not shown to those who can't save to the live version: beta testers, and builders who must make their changes in the draft). Each has an X at its right (Dismiss, for screen readers) that hides it, moving focus to the tab showing; the player's account remembers it, each notice on its own, so it doesn't show again in any universe or browser until they show their dismissed notices again from their profile (see [Profile edit](#profile-edit)). While the draft is open, the tabs' borders, the line under them and the save bar's top border are the purple of the draft's buttons, so the version being edited shows whether or not the notice does. The Character List tab lists the live version's characters whichever is open. The [Audit tab](#tab-audit) marks saves to the draft with a small Draft tag in the draft's purple after their time (read out as "Saved to the draft", which the pointer resting on it shows too), and lists starting, applying and discarding it.

Builders and translators edit the live version or the draft, as they edit now, except that while the universe is `let there be light` its creators can have builders make their changes only in the draft (see the stage under [Edit Universe](#edit-universe)); builders and creators start it, and only creators apply and discard it. Only the live version can be played: Create Character, the lobby and groups always use it (playing the draft to test it is in Later).

Applying the draft is judged like any save that disables things (see [Disabling things players are using](#disabling-things-players-are-using)): Save asks the server what applying would do, comparing the draft with the live version, and the dialog asks its choices. Something the draft disables or deletes counts as disabled:
- a race, class, theme or item the draft deletes while characters use it is kept in the live version, disabled, with the same choices as disabling it; one nothing uses is deleted
- characters in an area the draft deletes or disables move to its parent area (the nearest enabled area of the draft holding it) or their start area, as the dialog chooses, and a deleted area is then deleted
- groups playing at a difficulty level the draft deletes play at its default level, as deleting a level does; groups larger than its group size are handled as lowering the group size

Applying happens in the save's transaction, all or nothing: each draft row is written into the live row it was copied from, under the live row's ID; what the draft added becomes live; what it deleted is deleted (or kept disabled, above); and the draft is gone. Once it commits, the open rooms load the new world (areas, tiles, links and settings), move whoever has to move, and clients fetch the universe text again.

The draft's rows are kept in the same tables as the live version's, marked as the draft's, with IDs of their own: each remembers the live row it was copied from, and applying maps the draft's IDs back to the live ones, inside areas' cells too. A live row deleted while there is a draft leaves its copy as something new in the draft. The ruleset's defaults aren't copied; the draft holds its own copy of the changes the universe made to them.

### Deleting a universe
Any of a universe's creators, and a server admin with the site admin role, can delete it with Delete Universe, a button on its own under the Universe tab's settings, outside their card (red, with no shortcut), whichever version is open. Like the draft's buttons, it is an exception to staging: the universe is deleted as a whole, at once, after asking, and any unsaved changes go with it. While the site's admins disabled the universe and kept its creators from deleting it (see [Universes](#universes)), the first dialog says so to its creators in place of what deleting it deletes, and can't go on; only a server admin may delete it then. Like [deleting an account](#deleting-an-account), it takes two dialogs:
- The first, titled "Delete Kilnhaven", says the universe is deleted for everyone and can't be brought back, and lists what goes with it (`GET /:universeId/deletion`), each on a line of its own: its world and everything else in the editor; its areas and their cells, tilesets and uploads, items, races, classes and translations; its draft, when it has one; its record of saves; how many characters how many players made in it, how many groups disband, and how many other editors lose their role and are emailed, leaving out what it has none of. It says when the editor's unsaved changes are thrown away, and, for a server admin deleting it as an admin, that its editors are told the site's admins deleted it and the admin records keep it. Cancel takes focus, and its Delete Universe sits beside Cancel at the right and opens the second dialog.
- The second asks "Are you absolutely sure you want to delete Kilnhaven? This is permanent (a very long time!) and cannot be undone.", with Delete Universe at the left and I've Made A Terrible Mistake (which closes it) at the right. The player confirms as deleting an account does: with their password, and an authenticator or recovery code when the account has 2FA (a trusted browser still asks), or, without a password, by typing their username and entering a code emailed to the account's address (purpose `deleteUniverse`; Email me a code stands in for Delete Universe until it is sent), so a stolen session alone can't delete it. When what the first dialog said changed in between, such as the admins keeping its creators from deleting it, the first dialog opens again and says why.

Once deleted, the editor goes to Home, which says it was deleted, without the browser asking about unsaved changes. Every row the universe has goes with it, its uploads are deleted from storage, its lobby and groups turn everyone out ("Kilnhaven was deleted, with everything in it."), other editors' windows keep the page but can't save, and each other editor with an address is emailed, in their language, who deleted it, or that the site's admins did. The server checks the role again once the universe is locked, after any save in progress, and refuses a creator while the admins keep its creators from deleting it, or while it requires 2FA the creator doesn't have on (`server/src/http/universeDeletion.ts`). A server admin deleting it with the site admin role, or one its creators are kept from deleting (`deletesUniverseAsAdmin()` in `shared/src/universes.ts`), deletes it through the admin route (`POST /admin/universes/:universeId/deletion`), which records it as an admin event (see [Admin](#admin)); a server admin deleting a universe they create, which nothing keeps from being deleted, deletes it as its creator.

### Exporting a universe
Export Universe (Alt+X), left of Delete Universe under the Universe tab's settings, opens a dialog titled "Export Kilnhaven" saying "Exports everything you can edit in the universe as a zip file, apart from players' characters and audit history.", and while the draft is open, in a notice under it, "You're exporting the draft copy of the universe, not its live version." Its Export Universe (Alt+S, focused as it opens) downloads a zip file of what the player's role can change, in the version open, as it was last saved (unsaved changes aren't in it), says "Exporting..." at the left of the dialog's buttons while the file is made, then closes; a refusal shows in the dialog, and Cancel throws away an export still being made. Every role but beta tester (who can change nothing) has it, whichever version is open, while the universe is disabled or at the `end of time` too. [Importing](#importing-a-universe) reads the same format, so it is kept stable: a change that would make an older import read it wrongly raises `UNIVERSE_EXPORT_FORMAT_VERSION` (`shared/src/universeExport.ts`).
- creators and the site admin role: everything, apart from players' characters (which belong to their players) and the [Audit](#tab-audit) tab's record of saves
- builders: the world: uploaded tilesets, tiles, items, areas with their cells and links, notes for translators and the text marked as needing no translation
- translators: their translations into the languages they were given that the universe is translated into, and the text marked as needing no translation

The file (`MultiverseKiln.kilnhaven.2026-11-08.zip`, with `.draft` before the date for the draft) holds:
- `universe.json`: the format and its version, when it was made and by whom (username and name), the role it was made with, which universe and version it is of (with its ruleset and source language), then a section for each kind of thing the role can change. A section is there exactly when the role can change it, even when empty, so an import can tell "has none" from "wasn't exported": the universe's settings (the Universe, Lobby and Characters tabs' and the languages), the Ruleset tab's settings and difficulty levels, themes and editors (by username, with role and languages) with the settings
- `races.json` and `classes.json`: the races and classes, there exactly when the settings are
- `tilesets.json` and `items.json`, there exactly when the world is: what the [Tilesets](#tab-tilesets) tab shows, the uploaded tilesets (`tileGraphics`, each with its image's path, or null when storage no longer had the image) and the tiles (`tiles`), and the items
- `translations.json`: the universe text's translation work, each section there exactly when the role can change it, and the file there when any section is: the notes for translators (`translatorNotes`) with the world; the text marked as needing no translation (`noTranslation`); and the translations into the languages the role can translate (`translations`), with the languages they cover (`languages`) and each translation's source text hash, so one out of date stays out of date. An import leaves the draft's notes, marks or translations as they are when the file has no section for them
- `areas.json`: the paths of the areas' files, by the areas' names, there exactly when the world is
- `areas/<area ID>.json`: each area (which `areas.json` lists), for editing by hand: its settings, its `bounds`, the links on its cells, then `rows`, every cell of its ground and nothing outside it, one line per row from north to south, each its cells from west to east, so `rows[r][c]` is column `bounds.minColumn + c`, row `bounds.minRow + r`. An import refuses a file whose rows don't cover exactly its bounds, so an area is made larger or smaller by changing both
- `areas/legend.md`: for people reading the files, in the language of the page the export was made from: what an area's file holds, how the rows are laid out, how to find a cell's column and row, and that the rows must match the bounds, a table of what each number in the cells is (each tile's name and color, 0 for the area's default tile, -1 for Unexplored) and a table of which area each file is, with its default tile and its columns and rows (`server/src/http/universeExportLegend.ts`). An import doesn't read it
- `tilesets/<tileset ID>.png`: each uploaded tileset's image
- `signature.json`: the site's signatures, keyed hashes made with `AUTH_HMAC_KEY` that only this site can make (`server/src/http/universeExportSignature.ts`): `origin`, of which universe and version it is of (ID and name), when it was made and by whom (username and name), as `universe.json` says; `files`, the SHA-256 of every other file by its path; and `contents`, of that list. An import reads them to tell an export made here, unchanged, from one changed since or made elsewhere. What the signatures say is shown, not enforced: the player decides whether to import the file. Changing `AUTH_HMAC_KEY` makes every export made before it unconfirmed

Things are named by the IDs the version gives them, as the editor names them, so a draft's export uses the draft's IDs, and lists the live row each of its things was copied from in `liveIds.json`, so an import finds them once the draft is applied and its IDs are gone. The ruleset's default tiles, items, races, classes and themes are all listed, edited or not, each with its key, so an import into another site finds them by key; what the universe added is listed by its own row's ID.

The server reads everything in one read-only snapshot, so the file fits together while others save, and makes the file before sending it, so a slow download doesn't hold the database (`server/src/http/universeExport.ts`, the zip writer in `server/src/archives/zip.ts`). It checks the role again in the snapshot, and makes one export at a time for each player, answering a second while the first is made with a message saying so.

### Importing a universe
A file Export Universe made is imported into the universe's draft, never its live version: players see none of it until the draft is checked and applied with Apply Draft (see [Universe versions](#universe-versions)), as any change to the draft. Import Universe (Alt+I), between Export Universe and Delete Universe, is for every role but beta tester. While the live version is open it first opens a dialog saying files are imported into the draft: with a draft, its Open Draft (Alt+O) opens the draft, after asking about unsaved changes as choosing the draft beside the role does; with none, a creator's or builder's Start Draft (Alt+S, or Save Changes And Start Draft with unsaved changes, which are saved to the live version first) starts one, saying "Starting the draft..." at the left of the buttons, and for other roles the dialog says only the universe's creators and builders can start one. Once the draft is open, the import dialog opens. A draft that can't be started says why on the Universe tab, as Start Draft in the toolbar does. With the draft open, Import Universe opens the import dialog at once. Nothing about importing is shown outside the dialogs.

It opens a dialog titled "Import into the Draft" with a File field (a zip file, at most 80 MB: the export's own, or one made by zipping the folder it was extracted into, whose files the server reads from that folder when `universe.json` isn't at the zip file's root and every file, apart from the `__MACOSX` folder macOS adds, is in it). Choosing a file sends it to the server, which reads it without changing anything (`POST /:universeId/import/preview`) and says what it is, as far as the file's signature confirms it: for a file the site exported, unchanged, "Kilnhaven (live version) originally exported Nov 8, 2026, 3:10 PM by Ada (@ada)."; for one whose signed origin holds but whose files were changed, added or removed since (apart from those operating systems add, such as `.DS_Store` and `__MACOSX`, which an import never reads), the same, with "It has been modified from its original export." in a notice under it; and for one without this site's signature, or whose origin was changed, in a warning, "The file says it is Kilnhaven (live version), exported ... by Ada (@ada), but its authenticity could not be confirmed. Import at your own risk.". Then it says whether it is of this universe (a file of another universe in a warning, "This file is from another universe; everything in your universe will be replaced by the contents of this file, and it will be named Kilnhaven (copy)."), what it replaces in the draft, with how many of each thing, and what it leaves out and why. A file that isn't an export, is damaged, was made by a newer version of the format, or is of a universe with another ruleset is refused under the field. A file uploading tilesets the draft doesn't have shows "I have the rights to use the tilesets' images in this file", which must be checked. Import into Draft (Alt+I) imports it at once, as Apply Draft saves at once once it is confirmed, saying "Importing..." at the left of the buttons (Cancel and Escape wait for it), then closes the dialog, says it was imported in a toast, and opens the draft again. Like Apply Draft it waits until no other change is unsaved, since it replaces the draft they belong to: the dialog says so and the button stays off.

What it imports:
- each part of the file the player's role can change replaces that part of the draft, and the rest is left out: the settings (the Universe, Lobby, Characters, Ruleset and Translations tabs, races, classes, themes and difficulty levels) for creators and the site admin role; the world (tilesets, tiles, items, areas with their cells and links, notes for translators) for builders too; the text needing no translation for every role but beta tester; and translations into the languages the player can translate into that the universe is translated into, once the import's settings are saved
- replacing a part leaves the draft holding what the file holds: the file's things are matched with the draft's and given the file's settings, what the draft has and the file doesn't is deleted, and the rest is made anew. The ruleset's defaults are matched by key, and restored when the file has them unedited. The universe's own things are matched only in a file of the same universe, by the live row each was copied from (or, for a file of the draft still open, by its own ID), so they keep their place once the draft is applied: characters, groups and their positions go on naming the same areas, races, classes, themes and items. Only what differs is changed, so the [Audit](#tab-audit) tab records only that: a matched area is resized only when its bounds differ, only its cells holding another tile are painted, and only the links that go elsewhere, are new or are gone are saved or deleted; the lobby moves only when the file's is another area; and notes, marks and translations the draft already has as they are aren't saved again. A file holding what the draft does records nothing
- left out: its editors, its stage, and whether builders make their changes in a draft and editors need two-factor authentication, which belong to the universe rather than its draft; and a name another universe has: a file of the same universe gives the draft its own name, and another universe's names it after that universe as a copy, "Kilnhaven (copy)" in the player's language, then "Kilnhaven (copy 2)" and so on while those are taken, cut short to fit; when every name it tries is taken, the draft keeps its own; a name that holds text that could be made into a link, which universe names can't, so the draft keeps its own; and, for an import of the world without the settings (a builder's), the draft's lobby and starting areas, and the items in its starting equipment, which the settings still name, with the tiles those areas use

The server reads at most 8 MB of any one JSON file in the archive, and 64 MB of them in all, refusing a larger file before parsing it, since each is parsed in one go and takes many times its size in memory; it gives other requests a turn between areas' files. It runs at most two imports at once, answering others that the server is busy, and each player's import holds its place from before the file is read (so a file still arriving counts) until it is saved (`server/src/http/universeImport.ts`).

The import is one save (`POST /:universeId/import?version=draft`): the server reads the file and plans it (`server/src/http/universeImportFile.ts`, `server/src/http/universeImportPlan.ts`) before the universe is locked, then saves it through the editor's save, so every change is checked as one from the editor would be, all of it or none of it. Settings that name things the same save makes, which a save from the editor can't name, are made as the changes before them are saved (`PendingChange` in `server/src/http/editorChanges.ts`). The [Audit](#tab-audit) tab lists it as a save to the draft, and other editors' windows hear of it as one. Each player imports one file at a time.

### Editing together
Several editors can have a universe's editor open at once. Each window joins the universe's editor room as the editor loads: the room knows who is there and what they have open, carries the editors' [chat](#chat), and tells every editor what the others save. Each editor's changes stay staged until they press Save (see [Unsaved changes](#unsaved-changes)). Nothing is edited together live, keystroke by keystroke, since then no one could tell who was saving what.
- **Chat:** the Chat button in the toolbar (Alt+H) shows and hides the editors' chat, in a panel at the right of the window; Close or Escape hides it. Ctrl+Enter shows it and puts focus in its field. While it shows, the row of tabs ends where it begins, scrolling sideways like any row of tabs too wide for the window, so no tab is hidden under it. While it is hidden, a number in place of the button's icon, and before the page's title ("(3) Edit Kilnhaven", as every page with a chat shows its unread messages), counts the messages others write, including those written since the player last saw the chat (see [Chat](#chat)), and a new one shows in a toast (not green, which is for saving), which screen readers hear. Clicking the toast away marks the messages read and clears the number, as opening the chat does.
- **Who's here:** the list above the editors' chat names each player with the editor open, once however many windows they have, each name linking to their profile. The left of the save bar lists the other editors with where their windows are: the tab, the area when this window has loaded the areas of that version ("Bea: Areas - Forest (draft) and Items"), and which are on the draft; the save bar stays showing while anyone else is here, even on a tab with nothing to save. Screen readers hear when another editor opens or closes the editor. Only players with a role in the universe, and server admins with the site admin role, can join. Losing a role, no longer being a server admin (removed from the admins), the universe being disabled, its stage changing, it starting to require 2FA (for editors without it on) and an editor turning 2FA on or off reach open editors at once, windows still opening the editor included, rather than when their next save is refused: an editor whose role, stage or disabling changed loads the universe again on the tab showing, or, with changes unsaved, says to reload once they are saved or undone. A server admin who is no longer one edits with their own role, or, with none, loses the editor like an editor who loses their role: they go to the universe's page (after the browser asks, when changes are unsaved; one who stays can't save, and is told why). One whose universe is deleted keeps the page but can't save, and is told why.
- **Losing the connection:** a window that can't join the editor room, or loses its connection to it, says so above the tabs (read out by screen readers) as well as in the chat: its tabs no longer follow what other windows save and its chat is off, while saving still works. It stays until the page is reloaded, which connects again. A room never holds a dropped window's place, so a window leaves the room as soon as its connection drops rather than looking connected while it tries to reconnect.
- **Save notices:** when another editor saves to the version you have open, or you save in another window, a toast says who saved what, from the save's [audit](#tab-audit) details, naming up to three things and counting the rest ("Bea saved: Changed race Dwarf, Painted 40 cells in Cave"), and screen readers hear it. The window that saved isn't told. The editor then fetches what changed, and updates whatever you have no unsaved changes to: the lists, an open dialog, the area editor's cells. A save to the other version changes nothing you see, except what the universe holds once (its editors, its stage, and starting, applying or discarding the draft), which is all its toast names. The window decides that from the version it has open (`detailsForVersionOpen()` in `shared/src/editorRoom.ts`), since the room hears which version a window has open only after it opens it, and a save heard of while the universe loads is followed once it has loaded. A window hears only of what its role's tabs show, since only creators and site admins see the Audit tab's record of every save: beta testers of the editors, the settings and the draft, and translators of those and what the Translations tab lists (translations, notes for translators, text marked as needing none, and things added, deleted, restored or renamed); a save that changes nothing they see still tells their window, with nothing to name, and shows no toast (`server/src/logic/saveNotices.ts`).
- **Changes that meet:** when a save changes something you have unsaved changes to, the toast stays until it is dismissed and names the tab, and the thing gets a note inline naming the fields ("Bea changed Name and Speed since you opened this"): under its name in a list, at the top of a settings form (only for the settings that form holds), above the area editor's settings for the area open, and under the title of a dialog open on it. A dialog open on something a save changed, with no unsaved changes to it in the dialog or its tab, shows it afresh where it is, the focus staying put, or closes when the save deleted it; a link dialog with changes not yet applied keeps its area from loading again. Your changes stay as they are, and the note goes once they are saved or thrown away. Changes made while what a save changed is loading count the same way, and changes made while your own save is sent stay unsaved rather than being taken as saved or loaded over. Changes to something the save deleted (one of the universe's races, classes, themes, difficulty levels, items or tiles, or an editor), including those applied afterwards from a dialog still open on it, are kept as adding it again with your settings: the list shows it tagged new, with the note saying who deleted it, so Save adds it back unless you delete it, which discards your changes. The area open in the area editor with unsaved changes is kept the same way, as a new area with the settings it was loaded with and the form's changes: its cells as the window has loaded them, painting and size included, and its links. The parts of the area that hadn't loaded went with the area and come back as the default tile, and links from other areas into it are gone. Deleting something the save deleted already is dropped, an area included, since it is gone; new areas inside a deleted area take its parents, as the saved ones do (see [Regions](#regions)). The Translations tab's table loads again keeping your changes, but marks no row, since a save counts the translations it changed rather than naming them. Starting, applying or discarding the draft changes the whole universe: the editor loads it again, or, with changes unsaved, says to reload once they are saved or undone.
- **Saving only what changed:** each change to settings carries the settings the editor started from beside the ones it sends, and only the fields it changed from those are saved, so changes to different fields of the same thing both save: Bea renaming Dwarf while you change its speed. A field is a setting as the editor shows it, so a starting area's area and square are one. Settings that can only be saved in some combinations are one field too, so a merge never saves one editor's half with another's: a class's own starting area and its starting areas by race, and an editor's role and languages. Only a field changed by two editors to different values conflicts. The server refuses the second save, saving none of it, and the editor shows each such field with both values, as the Audit tab shows them, and who saved the other, to Keep Mine or Take Theirs, then saves again; Cancel keeps the changes unsaved. After a save, the settings forms with no unsaved changes load again, showing the fields the merge kept from others. A list, such as starting equipment or a class's races, is one field. A translation, and a note for translators, is one field too: one another editor saved differently since it was listed on the Translations tab conflicts the same way, shown with where the text comes from and both versions. The live version and the draft are separate, so the same race edited in each never conflicts; applying the draft replaces the live version, as it always does.
- **Painting:** each cell takes the latest save, and the area editor marks the cells other editors painted while you had the area open, so overlapping work can be seen. Their painting shows in your area editor at once, whether or not you have unsaved changes, except on cells you have painted and not saved, which keep yours until you save over theirs; undoing back to the saved cells gives theirs. A marked cell is outlined, and the cell under the pointer or the keyboard's cursor says who painted it. One you had painted too since opening the area, saved or not, is outlined in a warning color (orange) and its text says they painted over yours, and the save's toast says how many, in the warning style, staying until it is closed. Closing a save's toast, by clicking it or with its Got It button (Alt+G), takes that save's marks off the area, and so do newer toasts taking its place (three show at once); the marks otherwise stay until the area closes. Only the parts of the area you have loaded are marked; the rest loads as saved.
- **Area claims:** an area's cells can't be merged by field, so opening an area in the area editor claims it for that window, until the window closes the area or leaves. Another editor opening it sees "Bea is editing this area" above the area's cells. It is a warning, not a lock, so a window left open never keeps anyone out. The [Areas tab](#tab-areas) tags an area being edited with who is editing it. A claim belongs to the version open, since the draft's areas are its own. A window keeps its claim while it shows another tab, since the area stays open in its Areas tab; the player's own other windows don't count, being the same player. Screen readers hear who else is editing the area open when that changes.

### Disabling things players are using
Disabling or limiting something that players are already using warns the editor and asks what should happen:
- a race: "allow them to continue to play, only disable the race for new characters" or "prevent them from playing"
- a class: "allow them to continue to play, only disable the class for new characters" or "prevent them from playing"
- an area with characters in it: "move everyone to the parent area" or "move everyone back to their start area". Disabling a [region](#regions) disables every area below it, and asks the same for each of them with characters in it, as does any change that disables an area through what is above it (a new parent, a move, deleting a region)
- an item characters have: "allow them to continue to use it, prevent new copies of the item from being made" or "remove it from characters, it will be re-added when the item is re-enabled"
- lowering the group size below a group's current size: "allow those groups to continue to play, only limit the size for new groups", "disband larger groups" or "remove X number of group members, starting with those who joined most recently"

Save asks the server first (`POST /:universeId/changes/impact`) what the changes would do, compared with the universe as it is saved. Only a change that disables something saved as enabled, or lowers the group size, warns, and only when characters are using it: characters (not past their last rites) of the race or class, characters carrying the item, characters in the area (playing there, from the rooms, or saved there by their group), groups with more members than the new size. One dialog lists every warning with its choices, and Save in it sends the save with the choices; Cancel aborts. Each choice travels with its change, and the server applies it in the save's transaction, then tells the rooms. A save is judged by how it leaves each thing, not by each change on its way: the editor keeps every edit in order, so one save can disable something, enable it again and disable it once more. Something the save leaves enabled warns about nothing and affects nobody, and something disabled more than once warns once, at its last change, whose choice is the one used (`server/src/http/editorDisablings.ts`). A change sent without a choice (such as one that affected nobody when the editor asked) takes the gentlest: keep playing, keep the item, keep the groups, and back to the start area.

How each choice works:
- races and classes store whether their characters keep playing while disabled (`keepPlaying`), chosen only in Save's dialog; the race and class editors keep the stored value. A character whose race or class bars them is listed with why on the lobby's and the universe page's lists and the invite screen, and can't be chosen in the lobby, be played in a group, make a group or join one. One in a group can leave it from their sheet. Players playing one are switched in the lobby to their most recent character who can play (or become ghosts), and taken out of the group's areas, where they were saved; enabling the race or class, or letting its characters play, lets them back. Enter Universe passes over them
- the parent area is the nearest enabled area holding the disabled one, following its parents up past any [regions](#regions) between them. Characters arrive on the cell of a link there leading back in (to the disabled area or one between them), or at its center when there is none, on the nearest free cell. An area inside no enabled area offers only the start area. The start area is the lobby's area (at its starting square) in the lobby, and the group's starting area (the anchor being's) in a group. The lobby's own area never warns or moves anyone: disabling it takes the lobby's area away instead (see [Tab: Lobby](#tab-lobby)). Group members not playing are moved too, in the database and in an open group room
- a removed item is hidden on each character rather than deleted, keeping how many they had; enabling the item again, or restoring a default item, gives it back. A hidden item still counts as carried, so the item can't be deleted
- disbanding a group or taking members out works as the anchor being or the members leaving: they go back to the lobby, told the group size was lowered. The anchor being is never taken out

Changing the stat rolling method doesn't change existing characters.

### Tab: Editors
Lists the users who can work on the universe, and lets you add them with a role:
- `creator` (admin): can change everything
- `builder`: can make changes to the world: the areas and regions below the [regions they are assigned](#regions) (none until they are assigned one), and, with each permission given:
	- "can edit tiles": tiles and uploaded tilesets
	- "can edit items": items
	- "can edit mobs": mobs, once there are any (stored, but nothing uses it yet)
- `beta tester`: can create characters and play while the universe is in `prologue`
- `translator`: can [translate](#tab-translations) the universe's text into the languages they are assigned, and can't change anything else. The role decides who may change translations however they are made, on the Translations tab or by importing a file

The table lists each editor's username, name, role and, for a translator, their languages; the pointer over a role shows what it lets an editor do. Creators add a player by searching for them (`PlayerSearch`): typing at least 3 characters of a name or username lists up to 10 matching players under the field, each as their name and @username, leaving out the universe's editors, and the player is chosen from the list; their name shows to the right of the field (under it on a narrow screen), with an X that takes the choice back. Only choosing a player counts as a change the dialog asks before closing over, not typing a search. Text starting with @ matches usernames only. Creators then choose a role, each listed with what it lets an editor do (`UNIVERSE_ROLE_DESCRIPTIONS`), and, for a translator, at least one language, or for a builder, the permissions above (checkboxes, all unchecked for a new builder). A builder's row lists their permissions and the regions they are assigned; regions are assigned in the region editor. Creators change an editor's role and remove editors in the same dialog. Anyone can leave the universe: their own username opens the same dialog (with their role read-only unless they are a creator), and its Remove Editor first asks them to confirm and explains what they lose once it is saved: their role and the editor, and the right to play while the universe isn't open to everyone, and that a last creator has to make another editor a creator first. Every change is staged until Save, like the other tabs (see [Unsaved changes](#unsaved-changes)), and saved as `addEditor`, `saveEditor` and `removeEditor` changes. A universe always keeps at least one creator: a save that would leave none, by changing roles, removing editors or its last creator leaving, is refused, but one save can make another editor a creator and then let the old one leave.

Once a save that adds editors commits, each player it added is emailed, in the language they chose (English when they haven't chosen one): who gave them which role in which universe, what the role lets them do, and that they can leave on the Editors tab. A beta tester's email links to the universe's page, where they can enter it, and every other role's to the editor. Changing an editor's role sends nothing, and neither does adding a player the same save removes again or an account without an email address. So adding, saving and removing a player again and again can't flood them, a player is emailed a role in one universe at most once a day, and roles in any universes at most 10 times a day; past that they still get the role, just without the email (`emailAddedEditors()` in `server/src/http/editorEditors.ts`, `server/src/email/universeEmails.ts`).

What each role sees in the editor: creators and builders see every tab (builders read the settings tabs without changing them), while beta testers see only the Editors tab and the Universe tab, read-only, and translators those and the [Translations](#tab-translations) tab. The server holds the other tabs' content back from them too: the routes that load the ruleset, tiles, tilesets, items, races, classes, themes, difficulty levels, areas and their cells, links and characters answer only roles that may change the world (`canEditWorld()`, listed in `shared/src/editor.ts`), so another editor's window on the Areas tab shows them only the tab's name, not the area's. A server admin may open any universe with the site admin role, which acts as a creator (see the admin page's [Universes](#universes)). The server checks every change against the role the player has when the save starts (`mayMakeChange()` in `shared/src/editorChanges.ts`).

A Security section under the list has "Editors need two-factor authentication" (`universes.require_two_factor`), which only creators (and the site admin role) change, staged and saved with the tab's other changes as a `universe` change. Like the stage, the universe has it once, for the live version and the draft, and the [Audit tab](#tab-audit) lists changes to it. A creator without 2FA on can't turn it on: the checkbox is disabled, with a link that opens their profile in a new tab to turn 2FA on, and the server refuses it, so no one keeps themself from saving. While it is on, an editor without 2FA on, whatever their role, can't open the universe in the editor: every editor route refuses them (`EDITOR_TWO_FACTOR_ERROR_ID`, `refuseWithoutRequiredTwoFactor()` in `server/src/http/editorAccess.ts`), as does the editor room, so they see neither the universe's settings nor who is editing or the editors' chat. The only save the server takes from them is one that only leaves the universe. In place of the editor the page says the universe requires 2FA, with Turn on two-factor authentication (Alt+T), Leave Universe (after asking) and Back to Home. Turn on two-factor authentication opens the profile's setup, which goes back to the editor, now opening the universe, once 2FA is on and the recovery codes are closed; the link under the checkbox goes back to the editor the same way (`twoFactorSetupPageUrl()` in `client/src/pages.ts`). They can still play the universe as its stage allows. An editor who isn't a server admin can turn 2FA off, and then can't open the editor until it is back on; turning it off on the profile warns them which universes require it. The universe starting to require 2FA turns away the open editor windows of players without it on, and turning 2FA off while it does turns away the player's windows, both showing the page in place of the editor (`ServerCloseCode.TwoFactorRequired`); turning 2FA on or off otherwise has the player's open editors load the universe again, since whether a creator may require it follows it (see [Editing together](#editing-together)).

Losing a role takes effect at once. The player's next save in an open editor is refused, and a player who may no longer play the universe in its stage is turned out of its lobby and groups, with a message saying why. A save is checked against the role the player had when it began, so one that lowers their own role saves the rest of its changes too. A player who changed their own role sees the editor again as the new role allows, or, with changes made during the save still unsaved, is told to reload once they are saved or undone; one who left goes Home.

A universe can have several creators, any of whom can [delete it](#deleting-a-universe). If you delete your account and your universe has no other creator, you choose what happens to it (see [Deleting an account](#deleting-an-account)): make another of its editors its creator, or delete it.

### Tab: Ruleset
What shows up here depends on what ruleset is chosen.

Below the ruleset's settings, the tab has the universe's coins: a table with a row for each of the ruleset's coins, headed by its name in the rules ("Copper pieces"), with fields for the name and abbreviation the universe gives it (such as "bronze kits" and "bk"), each showing the engine's while it is empty. Saved as `coinNames` and `coinAbbreviations` with the rest of the tab. This is the only engine text a universe can rename
- the abbreviation is what amounts of the coin are written with everywhere in the universe, the character sheet and the editor's money fields included: up to 10 characters without spaces, digits or commas, and no two coins can be shown with the same one, counting the engine's for the coins left empty. The [Characters](#tab-characters) tab's starting money follows the abbreviations as this table shows them, before they are saved
- the name, up to 30 characters, never follows an amount, so it has no singular and plural forms. It is written as it reads mid-sentence ("gold pieces", "bronze kits"), as are the engine's names and the name's translations, so a sentence can use it as it is. A label capitalizes its first letter in the player's language (`capitalized()` in `client/src/localization.ts`): never the reverse, since lowercasing would break a name such as "Crowns of Aldor", and nouns in languages such as German. The character sheet shows it as a label when the pointer rests on the coin's abbreviation (an `abbr`), and later shops and money changers will name coins with it
- both are universe text, translated on the [Translations](#tab-translations) tab. Emptying one gives the coin back the engine's text and deletes that text's translations

Below the coins, the tab lists the universe's [difficulty](#difficulty) levels, easiest first, and saves them with the settings. Each level has:
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
	- `faerie`, with "where is morning?". The [lobby areas](#lobby) can't loop while it is chosen
	- the lobby areas have no passage of time of their own: the area editor says it is set here
- the lobby region: the [region](#regions) whose areas players walk in the lobby (the [lobby areas](#lobby)), chosen in a region select control. Regions with a starting area below them are listed but can't be chosen, saying why: the universe's, a race's or a class's can't be a lobby area, and the server refuses one. So are regions whose areas have links or neighbors leading out of them. No Lobby Region leaves the universe without a lobby to walk in. Saved as `lobbyRegionId`
	- a button after No Lobby Region, "Edit the lobby region", which takes you to the [region editor](#editor-region), while there is one
- the starting square: an area below the lobby region and the square of it players start on, chosen with Choose Area in the [area selection](#selection-area) dialog (which lists only the areas below the lobby region) and shown as e.g. "Square at (3, -2)". Choosing another lobby region clears it unless its area is below the new one too. Without a starting square, or while its area is disabled, the lobby has no area to walk in: its players still chat, see who's here and choose their characters, but have nowhere to walk, even in the other lobby areas; the Lobby tab says so only while that is the case. Changing the starting square's area, or enabling or disabling it, reaches the lobby at once: the area appears with everyone on the starting square, moves everyone to the new area, or disappears. A new starting square in the same area is only for players who join later. Saved as `lobbyAreaId`, `lobbyColumn` and `lobbyRow`
	- a button after No Starting Square, "Edit the lobby's area", which takes you to the [area editor](#editor-area) for the starting square's area, while there is one

### Tab: Characters
- Group size, minimum 1 (single player only) maximum 6 (infrastructure / server max), default server max
- Starting equipment, lets you [select items](#selection-item). A new universe starts with one dagger (PF1E) or survival knife (SF1E) for every character. An item in the starting equipment can't be deleted until it is taken out
- Starting [money](#field-money), in the coins the [Ruleset](#tab-ruleset) tab names
- Starting [area](#selection-area)

Below the settings, the tab lists the [races](#races), the [classes](#classes) and, for a ruleset with them, the [themes](#themes), each in a section of its own, and saves them with the settings. Each list is a table of names, summaries and notes (custom, edited, disabled, and changes not saved yet), sorted by name until the Name or Notes heading is clicked (see [sortable tables](#sortable-tables)); rows that tie are sorted by name. Each race and class can add to the starting money and equipment, and choose a starting area of its own.

A character's starting area is chosen each time a group is made around them, so a change to these settings applies to characters already made. It is chosen in this order, most specific first: the class's entry for their race, the class, the race, then the universe. A class with an area of its own has no entries for races, so the two never compete. Each starting area comes with the square characters start on (chosen with the [area](#selection-area)), which goes with it: a group starts at its anchor being's square, and its members are placed on the free square nearest it. A square the area no longer holds, after it was made smaller, counts as the nearest square in the area.

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
	- disabling a race characters are asks on Save whether they keep playing (see [disabling things players are using](#disabling-things-players-are-using))
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
	- disabling a class characters are asks on Save whether they keep playing, as for races
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

### Tab: Character List
Lists every character players have made in the universe, for creators and builders (the server refuses other roles too): each character's name, their race and class (as the lobby shows them, e.g. "Dwarf Fighter"), their player's name (linking to their profile) and @username, when they were made, and notes saying whether they are in a group or waiting for their [last rites](#deleting-a-character) to end. Characters whose last rites are over aren't listed. A search narrows the list by the character's name or the player's username or name, ignoring capitals; text starting with @ matches usernames only. Filters choose a race, a class (disabled ones included, since characters may still have them) and whether the character is in a group. The server searches, filters and sorts (by name until the Name, Player or Created heading is clicked, see [sortable tables](#sortable-tables)), and the list shows 500 characters a page. Characters belong to their players, so the tab only lists them and has nothing to save.

### Tab: Tilesets
shows you a table of all tiles in the game, populated from the default for your ruleset and any tiles you have created. Default tiles can be edited: the edit applies to your universe only, and can be undone to restore the default. Disabling a default tile is such an edit, so a universe can leave out the ruleset's tiles it doesn't want. A tile you created can be deleted once no area uses it.

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
lists the universe's [regions](#regions) and areas as a tree or a table, chosen with a Tree / Table switch above them. A search above both narrows them by name. The lobby region and every [lobby area](#lobby) below it are tagged "lobby", like the universe's starting area is tagged "starting area". Region names are orange, apart from the lobby region's, which is yellow, along with the line in the tree down to what is inside it.
- the tree: the top-level regions, each with the regions and areas inside it, and each area with the areas inside it. A region or area with several parents is listed under each of them, with everything inside it; each listing after the first starts collapsed. While searching, the tree shows each match with the regions and areas above it
- the table: one row per region and area, with its name, whether it is a region or an area, its parents and its tags, sorted by name (see [sortable tables](#sortable-tables))
- clicking on a region lets you [edit it](#editor-region), and clicking on an area lets you [edit it](#editor-area)
- a region or area another editor has open is tagged with their name (see [Editing together](#editing-together))
- a builder sees every region and area, and can open each, but those outside their assignments open read-only

buttons to Add Region and Add Area (each for creators, and for builders while a region they are assigned can hold it)

### Regions
A region groups areas without cells of its own. It can hold its own settings, which the areas in it inherit, and creators assign builders to it, limiting the areas they edit. A region can also be only one of these: a region for "areas Bea can edit" sets nothing of its own.
- a region's parents are the regions it is inside, in the order they were added: Capitol City can be inside Planet and inside Bea's regions, so a builder assigned to Bea's regions edits everything in Capitol City. A region with no parents is top-level. Nothing can be inside itself, however far down
- an area's parents are one or more regions and areas, in the order they were added, all alike: Cellar's parent is Shop, and Kingdom's parents are Planet and Bea's areas. At most one of them is an area. One region can group the areas a builder works on, while another, like "Planet", sets the rules for every outdoor area
- every area is in at least one region: directly, or through an area it is inside, which puts it in that area's regions. A save that would leave an area in none is refused
- regions and areas nest at most 10 levels deep along their longest path, a top-level region being the first
- deleting an area gives the areas inside it its parents in its place, beside their other parents: deleting Shop makes Cellar's parents Market District and Bea's areas. Cellar's settings can change with it (a conflict between Market District and Bea's areas, or no default tile once Shop's Wood Floor is gone), so deleting an area checks first, as [deleting a region](#deleting-a-region) does, and names the areas that would be left with a conflict or a missing value before it can go on
- a region's name is unique within its version, not counting case
- region names are only seen in the editor: players never see regions, so their names aren't universe text and aren't translated
- one region can be the universe's lobby region, chosen on the [Lobby tab](#tab-lobby): the areas below it are the [lobby's](#lobby), walked in the lobby and never connected to the rest of the world. It can be inside other regions like any region, and the areas below it can be in other regions too; being below the lobby region is what makes an area a lobby area
- a new universe starts with two top-level regions (named in the universe's language): "Lobby", its lobby region, outdoors, lit, without fog of war and with the ruleset's default outdoor tile, holding its Lobby area; and "World", outdoors, lit, flowing normally, with fog of war and with the ruleset's default outdoor tile, holding its Starting Area area

#### Settings
Regions and areas have the same settings: enabled, indoors or outdoors, light level, default tile, passage of time (with "where is morning?" for `faerie`) and fog of war. Each can be `inherit`, the default, shown as "Not set" for a top-level region, which has nothing above it to inherit from.

Passage of time is one of:
- `flows normally` (based on character actions, see [time and distance](#time-and-distance))
- `always dawn`
- `always noon`
- `always dusk`
- `always midnight`
- `faerie`: the time of day depends on where you are in the area. If morning is to the west, the furthest west point is sunrise and the furthest east point is midnight. Selecting `faerie` shows an option for "where is morning?" with a dropdown for:
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
- there is no `real-time` option: it would need time to keep running while nobody is logged on, which is expensive. The lobby can use it because only the time of day changes there, and that is calculated from the Unix epoch (see [Tab: Lobby](#tab-lobby), whose setting the lobby's area uses instead)

Fog of war is `on` or `off`. With it off, nothing near the players in the area is hidden from them: they see everything within the chunks loaded around them, which is all the screen shows and more (never the whole of a large area, which would be slow), and everyone there, at any time of day, whatever the light or the tiles' vision costs, no fog is drawn over it, and a group's room records none of it as explored (see [Vision](#vision)). It suits places like the lobby.

An area's value for each setting is its own, unless it is `inherit`. Then it is found among the area's parents, a level at a time:
1. the area's parents. Those that are `inherit` (a parent area by its own value, before inheriting) are passed over
2. one value, or several that are the same, is the area's value
3. different values are a conflict, whatever order the parents are in
4. none moves up a level: the parents of every parent at this level, and back to step 1. A region or area already looked at is passed over, so each counts once, at the nearest level it is reached. Reaching the top with none is a missing value

A default tile that isn't for the area's kind (indoors or outdoors, as worked out above) is passed over, as if it were `inherit`. Light level counts only for an indoor area: an outdoor area has no conflict or missing value for it, and none is stored for it. `faerie` with two different answers to "where is morning?" is a conflict. The [lobby areas](#lobby) take their passage of time from the [Lobby tab](#tab-lobby), so their own is never a conflict or missing value; a save that leaves an area no longer a lobby area checks it like any other.

Enabled works as a gate instead: an area is enabled only when it and everything above it are, along every path, so it never conflicts. An area in Planet and in Bea's areas is disabled while either of them is. `on` sets nothing, working as `inherit` does: an area or region that is `on` or `inherit` is enabled unless something above it is off. Disabling a region acts on each area below it as disabling that area would, asking about the characters in them (see [Disabling things players are using](#disabling-things-players-are-using)) and taking the lobby's area away when it is one of them. So does any other change that leaves an enabled area disabled by what is above it: adding a disabled parent, moving an area or region under a disabled one, or deleting a region so its areas move to a disabled one. In the draft, none of this asks or moves anyone: players play the live version, so applying the draft asks instead, about each live area it disables or deletes (see [Universe versions](#universe-versions)).

Conflicts and missing values are never saved. Every save that changes areas, regions, an area's parents or which kinds a tile is for works out the settings of every area of the version open in the save's transaction (the same pure function as the editor's, in `/shared`), stores them on each area, and refuses the save when any area has a conflict or a missing value, or would loop with `faerie` time. It names each one, linking to the area: "Market District: passage of time is Always noon in Capitol City but Always dusk in Bea's areas", or "Shop: nothing above it sets a default tile". The rooms, the game and the editor's previews read the stored settings, so nothing works them out during play. The editor runs the same check as changes are made, and the area and region editors show their problems as they appear, naming the other regions. An area can be in a region a builder is assigned to and in one they aren't: when a change to their region conflicts there with the other region, they can still edit the area, and the message tells them whose region the other one is. Applying the draft and importing into it are saves like any other, checked the same way.

#### Assignments
Creators assign builders to regions in the region editor, staged until Save like the rest. An assignment is the universe's rather than its version's, like the editors (see [Universe versions](#universe-versions)). It lets the builder edit everything below the region: the regions inside it at any depth, the areas in any of them, and the areas inside those areas. A region or area in several regions can be edited by a builder assigned to any of them. A builder can rename the regions they are assigned to and change their settings, but not change their parents, delete them, or change their assignments; creators and the site admin role do. Below them, a builder adds, changes, moves and deletes regions and areas. Both ends of a change must be within their assignments: adding or removing a region's or area's parent, and a link between two areas. A translator note on an area's name needs the area within their assignments too. A builder can't delete a link leading to an area outside their assignments, or an area that areas outside them link into, since deleting it deletes those links: a creator does. A builder with no assignments can't edit any area or region. Only builders are assigned: translators work by language rather than by area. Items, tiles and tilesets take the builder's permissions on the [Editors tab](#tab-editors) instead, whatever their assignments. Creators and the site admin role edit everything. The server checks every change against them, as it checks roles.

#### Deleting a region
Delete Region in the region editor asks first, in a dialog listing what is in it:
- the regions and areas whose only parent it is: move them to another region, chosen in a region select control (where the regions can also become top-level), or delete them all, with everything inside them, which asks twice, as [deleting a character](#deleting-a-character) does, and then, in the live version, the warnings for areas with characters in them (see [Disabling things players are using](#disabling-things-players-are-using))
- the regions and areas with other parents too: add another region as a parent, chosen in a region select control, or leave them with their other parents

Each region select offers the deleted region's parents first, when it has any.

Deleting the lobby region says in the dialog that the universe will have no lobby to walk in until another region is chosen on the [Lobby tab](#tab-lobby). Moving a region or area out from below it is checked like any other change of parents: it can't take a lobby area's links or neighbors across the lobby region's edge.

The region is struck through in the tree until the tab is saved, with Undo Delete in its editor. The dialog checks, as the editor does, that what is left still has a value for each setting, and says which areas would be missing one before it can go on.

The [Audit](#tab-audit) tab lists regions like areas ("Added region Planet", "Changed region Planet", "Deleted region Planet"), with their settings, parents and assignments. Exporting and importing include regions with the world, and assignments with the editors.

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

### Tab: Audit
Lists every save made in the universe's editor, newest first, for creators and site admins (the server refuses other roles too): when it was saved, the player who saved (their name, linking to their profile, and @username, or "[deleted user]" once the account is deleted), the role they saved with (site admin included), and what the save changed: each thing it changed on its own line, by name, in the order they were saved, and under a change to settings, a line for each setting it changed with the value it changed it to:
- "Added item Shiv", "Changed item Dagger" (with "Name: Shiv" and "Enabled: no" under it), "Restored item Dagger to its default" (one of the ruleset's defaults given its settings back) and "Deleted item Shiv", and the same for tiles, races, classes, themes and difficulty levels (which are deleted, never restored)
- "Added editor @grace" (with the role given, "Role: builder", and a translator's languages), "Changed editor @grace" (with "Role: translator" and "Languages: Deutsch"), "Removed editor @grace" (with the role and languages they had)
- "Changed settings" for the Universe, Lobby and Characters tabs (with, say, "Group size: 4" and "Starting area: Meadow at 3, 4"), and "Changed the ruleset" (with "Track ammunition: yes")
- "Uploaded tileset Caves" and "Deleted tileset Caves"
- "Added area Cave", "Changed area Cave" (with "Indoors or outdoors: Indoors"), "Resized area Cave" and "Deleted area Cave"
- "Painted 412 cells in Cave", and "Added or changed 3 links in Cave" or "Deleted 1 link in Cave", each counted together for an area

The settings are named as their fields are in the editor, reusing those messages; settings the editor shows as one field are one (a starting area and its cell, a passage of time and its faerie morning, a tile's graphic and uploaded graphic). Values are shown in the player's language: checkboxes as yes or no, choices by their names, money as a money field writes it, and a list (starting equipment, languages, a class's starting areas by race, a race's ability modifiers other than 0) as a list, or none. What a setting names (an area, a tile, an item, a race, an uploaded tileset) is recorded by its name when saved, and the long description only by how many characters it has. Default things are named in the player's language. The tab is as wide as the page, rather than the other tabs' 960px. The server works out the details as it saves (`server/src/http/editorSaveAudit.ts`): just before each change it compares the change with what the universe holds, loading each list a save changes once, so a setting sent with the value it already has isn't named, and a thing deleted is named as it was. Each save that changes something records itself in `universe_edits`, in the same transaction as the save, with its details; a save that is refused, or changes nothing, records nothing. Saves made with the site admin role before saves were recorded show "Not recorded" for their changes. Each record is kept for 90 days, which the tab's hint says: every hour, and as the server starts, the server deletes the older ones, a thousand at a time until none are left so a large backlog never holds the table's locks for long, finding them by an index on when they were saved (`server/src/universeEditSweep.ts`). The records are deleted sooner with the universe; deleting an account empties its column in them rather than deleting them, and leaves its username in the saves that gave it a role, changed it or took it away, which the privacy policy says. Each change to an editor is recorded with the player's ID, an editor added included, so a player's data download finds those saves. The list shows 100 saves a page, and loads again from the newest after each save. When another window saves, to either version, the page showing loads again, so the new save appears without the player losing their place (see [Editing together](#editing-together)). Saves record themselves, so the tab only lists them and has nothing to save.

### Tab: Connect to the Multiverse
Explain that this allows characters to move freely between universes with the same ruleset. If no other universes with this ruleset exist, say that you're alone in the multiverse.

- There's an option for "any universe with this ruleset", which connects only to other universes that have also chosen it.
- There's an option to list a specific universe, which requires you to work with the creators of that universe (they must list you, too).

### Tab: Translations
Lets the universe be played in more than one language. See [Localization](#localization) for how a player's language is chosen.
- source language, the language the universe's editors write in. Defaults to the creator's language: the one on their profile, then the one the pages are shown in, without its region, or English when it isn't one of the languages a profile can name (such as Pirate)
- languages, the languages the universe is translated into ("Translated into", up to 50, never the source language). The choices are every ISO 639-1 language and Pirate (`UNIVERSE_LANGUAGES`); a universe translated into Pirate shows that translation to players who chose Pirate for the site, and fills text it hasn't translated from its English translation, if it has one. [Home](#home) and the universe's page show the source language and these. Taking off a language with translations asks first, since saving deletes its translations. Only creators change them, staged until Save like the rest of the editor, and saved as a `universe` change
- deleting something the universe holds (an area, tile, item, race, class, theme or difficulty level), restoring one of the ruleset's defaults, or giving a coin back the engine's name or abbreviation, deletes its translations and notes in the same save (`server/src/db/universeTextRepo.ts`)
- choosing a language shows a table of every piece of universe text (`GET /:universeId/translations`, paged, searched, filtered and sorted on the server, 100 a page; `server/src/http/editorTranslations.ts`). Ruleset defaults the universe hasn't renamed are engine text and aren't listed, and nor are descriptions it hasn't written or coin names and abbreviations it hasn't given (coins are listed most valuable first):
	- where it comes from (e.g. "Area: Waterdeep, name", or "Coin: copper pieces, abbreviation"). A coin abbreviation's translation follows its rules (no spaces, digits or commas)
	- the source text
	- a note for translators, written by the universe's editors (e.g. "a pun on the town's founder; keep the joke rather than the words"). One note per piece of text, for every language
	- the translation, or "missing", tagged "out of date"; or "needs no translation"
- a piece of text can be marked as needing no translation, such as a proper name, by creators, builders and translators (`saveNoTranslation`, one mark for every language). Players then see it as written in every language, and it is never missing or out of date. Its translations are kept, unused, and come back if the mark is taken off
- filters:
	- search, in where the text comes from, the source text, the note and the translation
	- "is missing" toggle
	- "is out of date" toggle (with both, either)
- sortable by each column, by where the text comes from until a heading is chosen
- each row opens a dialog with the source text, the note and the translation. Apply keeps its changes on the tab until Save, saved as `saveTranslation` and `saveTranslatorNote` changes after every other tab's. A saved translation keeps the hash of the source text the dialog showed. A translation that is [out of date](#out-of-date-translations) can be updated, or confirmed as still correct with Still Correct (Alt+C), which saves it as it is with the current hash. Emptying a translation or a note deletes it
- creators and site admins see and translate every language and write notes; builders see every language and write notes; translators see the tab (with the languages read-only) and only their languages, and translate them
- export and import, for translators working outside the editor (`shared/src/translationFiles.ts`), as Gettext PO, XLIFF 2.0, CSV or JSON, one language a file:
	- Export (Alt+X) saves the language chosen, as the table shows it with the changes not saved yet, in the format chosen, made in the browser from every piece of text (`GET /:universeId/translations/all`). Each entry is named by its key (`area:<id>:name`, by the ID in the live version: the live row a draft row was copied from, or the draft row's own ID for something the draft added, which it keeps when the draft is applied), so a file exported from the draft imports into the draft or, once the draft is applied, into the live version, and one exported from the live version imports into a draft started since. Each comes with where it comes from and its note for translators (PO comments, XLIFF notes, CSV columns, JSON fields), the source text and the translation. Out-of-date translations are fuzzy in PO and in the initial state in XLIFF. Text that needs no translation is left out
	- Import (Alt+I, for those who may translate into the language) reads a file in the format its name says, or the format chosen, and keeps its translations on the tab until Save, like the dialog's. Each keeps the hash of the source text the file holds, so one made from text that has changed since is out of date. A file naming another language is refused. Translations marked fuzzy, too long or holding characters that aren't allowed, or for text the universe doesn't have or that needs no translation, are skipped, and one that comes back as the table shows it is left alone, so an out-of-date translation returned unchanged stays out of date. The tab says how many were imported and skipped. Notes aren't imported
- long descriptions are translated as markdown, with a preview below the field, rendered and sanitized the same way as the source
- the Audit tab counts a save's translations per language ("Added, changed or deleted 3 translations into Deutsch"), its notes ("Wrote or deleted 1 note for translators") and its marks ("Marked 2 pieces of text as needing no translation")

# Gameplay
## Time and distance
In the lobby, actions take no time. The lobby's time of day comes from its [passage of time](#tab-lobby) setting.

Combat is turn-based.
- A square is 5 feet, matching PF1E's movement, reach and spell areas.
- A PF1E combat round is 6 seconds, so the time combat took is added when it ends.

Outside of combat, time is based on your actions - if you are standing still, no time passes. Walking a square takes the walk time of the tile walked into (10 seconds for an indoor tile and 10 minutes for an outdoor one, unless the creator sets another), and a diagonal step counts as one and a half squares. On screen, a player crosses a tile at full speed when it takes no longer than the default for the area (10 seconds indoors, 10 minutes outdoors) and a slower one at a matching fraction of it, so a 20 second tile indoors or a 20 minute tile outdoors is crossed at half speed. Outdoor travel takes longer in game time, but not on screen.

Each group has its own clock, which starts at 8 in the morning and is saved with the group. The whole group shares that one time: when one member walks, time passes for everyone, including members standing still. Members walking at the same time don't pass the time twice: a step is left out when another member's step was counted less than half a second (real time) before it, so two members walking side by side pass the time of one. Only walking in an area whose time `flows normally` passes the group's time: in an `always` area or a `faerie` one the time of day doesn't come from the clock, so the clock stands still there. The group's page shows the day and the time of day in the character's area, the way the universe's "display time" setting says: the clock's time to the second (precise), or a word for the time of day such as afternoon (rough). The time is the clock's, or the area's fixed time in an `always` area. In a `faerie` area it is never more than the word, in place of the clock's time. When the universe displays nothing, the group's page shows no clock, and asking where you are leaves the time out.

The time of day comes from the area's passage of time (see [Regions](#regions)): from the group's clock when time flows normally, fixed for the `always` settings, and from the cell's place in the area for `faerie`. It is light from 7 in the morning to 5 in the evening, dark from 7 in the evening to 5 in the morning, and the light changes over the two hours around dawn (6:00) and dusk (18:00). The area darkens with it, and screen readers are told as dawn breaks or night falls. A character with darkvision and light sensitivity, such as a drow, sees the area darken only a little at night, and outdoors it brightens for them as the light comes up, as far as it darkens for everyone else at night. An indoor area stays as light as its light level instead, and says nothing of dawn or dusk.

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

What a group has explored is kept as the cells it has seen, area by area: a cell is seen once any member has had it in sight (see [Vision](#vision)). The group's room keeps them in memory and saves them every 30 seconds while anyone plays and when the last player leaves. A window in a group's room is only ever sent the tiles of cells the group has seen, and the links on them, so a script in the browser can't uncover the rest: every other cell comes as unseen, and its tile is sent as soon as a member first sees it. The fog follows where players are drawn, a moment behind the server, so those tiles have usually arrived before the fog uncovers them. Cells out of sight that the group has seen are drawn dimmed, and cells it has never seen are drawn as blank map paper, like Unexplored cells. A lobby remembers nothing, so there everything out of sight is only dimmed. An area without fog of war (see [Regions](#regions)) is sent whatever the group has seen, and drawn as in sight within the chunks loaded around the player, and none of it is recorded. Deleting an area deletes what every group has seen of it.

## Neighboring areas
An area can have a neighbor to the north, east, south and west, so a large world is built from areas laid side by side and walked across without links. Neighbors are set in the [area editor](#editor-area).
- only an area at least 32 x 32 cells (a chunk) can have neighbors, so few areas are ever near a player. Edit Size can't make an area with neighbors smaller than that, and a save leaving one smaller is refused
- neighbors are always both ways: when Forest is Town's west neighbor, Town is Forest's east neighbor. Each area stores all four of its sides. A side has at most one neighbor, and an area is never its own neighbor (looping does that)
- neighbors form a grid: going north then west from an area reaches the same area as going west then north, when both reach one, and a save that breaks this is refused. A ring (Town east to Forest, east to Plains, east to Town) is allowed, and so is joining two grids, checked as a whole
- touching sides are the same length, so every area in a row is the same height, and every area in a column the same width. Making an area taller in [Edit Size](#editor-area-cells) makes the areas east and west of it, and theirs, taller on the same side, and making it wider does the same to the areas north and south of it. They are staged together and saved together, and the warning about cut-off cells and links covers them all. A save leaving touching sides of different lengths is refused
- cells meet along the seam row by row (or column by column), counted from the north (or west) edge of each area
- an area with neighbors can still loop. Walking west off the west end of an east-west chain whose west end loops east-west brings a player onto the east edge of the chain's east end, and the same for each direction, so only the loop checkboxes of the areas at a chain's ends matter. A chain loops only when both its ends are checked: with only one, it doesn't loop, and the editors of both ends warn beside the checkbox, naming the other end. A ring has no ends, and loops by itself. Rows (or columns) side by side should loop alike: all of them, with their ends lined up, or none. Otherwise where they meet, going along then across reaches a different area than going across then along, so walking there behaves oddly. It isn't refused, but the editor of each area in such a row warns beside the checkboxes, naming the areas beside it, and the Overall Map marks those areas with a warning sign and explains it under the map. Rows that don't loop may still differ in length, as in an L-shaped grid. An area whose passage of time is `faerie` still can't loop
- walking over a seam moves a player into the neighbor as walking within an area does: there is nothing to press, "requires the whole group" doesn't apply, and the step takes the walk time of the tile walked into
- near a seam, the neighbor's cells are loaded, drawn and seen as if they were part of the area, and the players in it are seen too (see [Vision](#vision)). Each cell is drawn, lit and timed by its own area's settings, so a dark cave beside a sunlit field shows as one. Where no area lies, the unexplored paper darkens with the player's area. A cell's fog follows its own area's fog of war. Cells a group sees over a seam are its exploration of that area. The player's area changes as they cross, and screen readers are told the new area's name
- neighbors never cross the edge of the lobby region (see [Lobby](#lobby)): a lobby area's neighbors are lobby areas too
- a disabled neighbor is an edge: players stop at it, and nothing past it is drawn. At a corner with no area diagonally across it, a diagonal step across the corner is blocked, as at an edge
- in the lobby, players walk the [lobby areas](#lobby), each by its own settings except its passage of time, which is the [Lobby tab](#tab-lobby)'s
- deleting an area leaves its neighbors with an edge on that side, and the dialog deleting it lists them
- a builder sets and removes a neighbor only with both areas within their assignments, as for a link, and can't resize an area when an area the resize carries along is outside them
- drafts copy neighbors with the areas, exports and imports include them, and the [Audit](#tab-audit) tab lists them with the area's other settings

## Vision
Each character has a vision budget, in squares. A character looks along straight lines from their cell, and each step along a line spends its length (a diagonal step counts as one and a half squares, as in movement), more when it leaves a tile with a vision cost: 50% spends twice as much. A 100% tile can be seen but not seen past, so a line of mountains blocks your view. It is also seen when open ground on one of its sides is, so the walls lining a tunnel show along its length, while the inside of a thick wall and its far side stay hidden. Open ground diagonally beside it only counts at an inside corner, where the cells on both sides between them can't be seen past either, so a room's corners show but the tip of a mountain range doesn't light up when the ground around it is out of sight. The character's own cell never gets in the way. Unexplored cells are seen past.
- The budget is 20 squares in full daylight and 4 at night, changing with the light around dawn and dusk. An indoor area is lit (20 squares) or dark (4) at any time of day, by its light level. Darkvision sees at least 12 squares (60 feet), day or night, and superior darkvision at least 24 (120 feet). Light sensitivity (being dazzled, a house rule standing in for PF1E's penalties until there is combat) halves the budget in full daylight or a lit indoor area, and takes less away as the light fades, so a drow sees 24 squares at night and 12 at noon.
- In a group's room, the group sees whatever any of its members in the area sees, so members always see each other. In a lobby each player sees only what they see themselves.
- The server works out what each player can see and only shows them the players in sight. The client runs the same function (`/shared`) to draw fog over the cells out of sight. Screen readers are told how many squares the player can see when they ask where they are.
- In an area whose fog of war is off, there is no vision to work out: everyone in it sees everything within the chunks loaded around them and everyone else there, and no fog is drawn. Screen readers asking where the player is are told nothing near them is hidden, in place of how far they see. Seen over a seam from a [neighboring area](#neighboring-areas) with fog of war, it is seen within the player's vision like anywhere else.
- Vision carries over the seams between [neighboring areas](#neighboring-areas), each cell spending what its own tile costs, and players over a seam are seen like players in the same area.
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

Coins are written with the abbreviations the universe gives them in the Coins table of the [Ruleset](#tab-ruleset) tab, and the engine's in the player's language for the rest. A field reads each coin's abbreviation as shown, and also the engine's in the player's language and in English, unless another coin is shown with it: in a universe that writes gold pieces as "cr", "2gp" still reads as gold, but not once it writes silver pieces as "gp" (`acceptedCoinAbbreviations()` in `shared/src/money.ts`).

Money is kept as individual pieces of each coin, the way a purse holds them, and is never converted automatically: gaining 5sp twice is 10sp, not 1gp, and starting money from the universe, race and class adds up coin by coin. A character can hold 1pp 302gp 4444sp 10cp. A money changer converts coins into the fewest coins of the same worth (that purse becomes 75pp 6gp 5sp). Who offers money changing, and whether it costs a fee, comes with NPCs.

## Selection: Item
modal dialog, lets you type to search, shows you the top results, with name + stats + picture. Each selected item has a quantity (for example, 20 arrows), from 1 to 999. Disabled items can be selected and are marked as disabled; characters are only given enabled items.

## Editor: Item
- name
- type (e.g., "longsword"), one of the ruleset's item types
- a checkbox for "Enabled?", checked by default

## Selection: Area
modal dialog, lets you type to search, shows the top results, shows you a small preview image of the area

Choosing an area's neighbor (see [Editor: Area](#editor-area)) shows only the previews. Every other area chosen here is where characters start: a starting area (the universe's, a race's, a class's, or a class's for one race), or the lobby's starting square. So the preview also chooses the square characters start on: clicking a square, or Space or Enter on the keyboard's cursor, highlights it. A newly chosen area starts on its center (column 0, row 0). The choice shows as e.g. "Town at (3, -2)". A starting area can't be a [lobby area](#lobby), so choosing a starting area leaves out the areas below the lobby region, and choosing the lobby's starting square lists only those areas.

## Editor: Area
Lets you edit details about the area
- name
	- while the area is below the lobby region (a [lobby area](#lobby)), a bright notice under the name says "This area is part of the game's lobby.", and a "Back to Lobby" button (Alt+Y) under "Back to Areas" goes to the [Lobby tab](#tab-lobby)
- parents: the [regions](#regions) and area it is inside, in the order they were added, each with a Remove button, and Add Parent: a search where typing part of a name lists the regions and areas that match, each with what it is inside. It lists only regions while the area has a parent area, and never the area itself, one inside it, or one that would nest it more than 10 levels deep. Every area has at least one parent. The link dialog's "Goes to" field chooses its area the same way, listing only areas, and only those on this area's side of the lobby region's edge (see [Lobby](#lobby)). A parent that would carry the area across that edge while it has links or neighbors on this side is listed but can't be chosen, saying why
- the settings below (see [Regions](#regions)) each start as `inherit` for a new area, and each shows, beside `inherit`, the value it inherits and where from ("Inherit (Always noon, from Capitol City)"), or the conflict or missing value that keeps the area from saving
- enabled?
	- `inherit`, on or off. For a new area, `inherit` while the universe stage is `in the beginning`, and off otherwise.
	- an area is enabled only while everything above it is too: while a region or area above it is disabled, a message says which
	- nobody can go into a disabled area, so players aren't told about links leading to one: the area shows no "Press E to go through" on them. Enabling or disabling an area sends the areas with links into it to their players again
- indoors / outdoors, or `inherit`
	- indoors shows "light level", or `inherit`: `lit` is as light as full daylight at any time of day, and `dark` as dark as night. The area is drawn that light and vision follows it (see [vision](#vision)). Outdoor areas follow the time of day; the setting is kept while an area is outdoors but has no effect
- default tile, or `inherit`. It lists the tiles for the area's kind (see [tile editor](#editor-tile)), plus the area's current default tile, so switching between indoors and outdoors doesn't change it
- passage of time, or `inherit` (see [Regions](#regions) for the options)
- fog of war, or `inherit`, `on` or `off` (see [Regions](#regions))
- checkbox for "loops east-west"
- checkbox for "loops north-south"
	- an area whose passage of time is `faerie` can't loop
	- with [neighbors](#neighboring-areas), only the areas at the ends of a chain loop, so the checkbox is disabled for an area with neighbors on both of its sides, or in a ring, and says why
	- a chain loops only when both its ends are checked: while only one is, a warning beside the checkbox in both ends' editors says the chain doesn't loop, naming the other end
- neighbors (see [Neighboring areas](#neighboring-areas)): a row for each of north, east, south and west, showing the neighbor's name, which opens its editor, with:
	- Choose: the [area selection](#selection-area) dialog, without choosing a square, listing every other area, with those that don't fit greyed out and why: at least 32 x 32, a touching side the same length, a free side facing this area, fitting every area already next to that place in the grid, and, when the area is in a grid of its own, the two grids joining into one without breaking it. Areas on the other side of the lobby region's edge (see [Lobby](#lobby)) don't fit, nor, for a builder, areas outside their assignments. The area chosen becomes the neighbor of every area next to that place, as with Add Neighbor, and the area that was there before stops being this one's
	- Add Neighbor: asks for the new area's name, then adds an area there with the same parents and the same settings of its own, painted only with the default tile. It is as tall as the row it joins and as wide as the column it joins, and takes this area's size where no other area in the grid touches its place. It becomes the neighbor of every area next to its place in the grid, not only this one. The editor stays on this area, whose cells show the new one past the edge. Staged until Save like any new area, and thrown away with the area editor's other changes
	- Remove: the two areas stop being neighbors; their other neighbors stay
	- See Overall Map: a dialog drawing the whole grid zoomed out, each area as its preview at scale with its name, this area highlighted, with this window's unsaved changes. A ring's areas are drawn once each, laid out from this area, with the seam joining back marked. Each end of a chain that loops has a small arrow just outside the edge, pointing off it, with room left around the map for them and a line under it explaining them; screen readers hear on each area which of its edges loop and where each comes back on. Clicking an area, or Enter on it, opens its editor; the arrow keys move between areas, and screen readers hear each area's name and its place in the grid
	- an area smaller than 32 x 32 has no Choose or Add Neighbor, and the section says why
- [the area's cells](#editor-area-cells)

## Editor: Region
Lets you edit a [region](#regions), opened from the [Areas](#tab-areas) tab like an area. Its changes are staged until Save.
- name
	- while the region is the lobby region (see [Lobby](#lobby)), a bright notice under the name says "This region is the game's lobby.", with the "Back to Lobby" button (Alt+Y) under "Back to Areas", as in the [area editor](#editor-area)
- parents: the regions it is inside, in the order they were added, each with a Remove button, and Add Parent: a search like the area editor's, listing only regions (never the region itself, one below it, or one that would nest what is below it more than 10 levels deep). A region with no parents is top-level. A parent that would carry areas across the lobby region's edge while they have links or neighbors on this side is listed but can't be chosen, saying why
- the settings regions and areas share (see [Regions](#regions)): enabled, indoors / outdoors, light level, default tile (the tiles for the region's kind, or every tile while its kind is `inherit`), passage of time and fog of war, each `inherit` by default ("Not set" for a top-level region), showing what it inherits, worked out as for an area, and the problems a change would make in the areas below it. The lobby region and the regions below it show no passage of time, since their areas take the [Lobby tab](#tab-lobby)'s, and say so. Parents giving the region two different values show the conflict as a warning, without keeping the region from saving: only areas are checked, and an area below it may set its own value or find one nearer
- assignments (creators and the site admin role change them; builders see them): the builders responsible for the region, added with a search of the universe's builders and removed with a Remove button on each
- the regions and areas in it, each linking to its editor
- Delete Region (see [Deleting a region](#deleting-a-region))

## Editor: Area Cells
This is a component included in the [area editor](#editor-area). It shows you the same grid as gameplay.
- it has its own card below the area's settings, as wide as the page, and the cells fill the card's width
- the center of the area is x = 0, y = 0
- everything outside the area's edges is drawn as the blank map paper of unexplored cells, as the game draws past an area's edges that don't loop
- Ctrl+wheel zooms the area; the wheel alone scrolls the page, or pans the area while it is Full Page (Shift+wheel pans sideways)
- the coordinates and contents of the cell under the pointer or the keyboard's cursor show over the bottom-left corner of the cells, so they never change the size of the view
- a Full Page button (Alt+P) makes the cells and their tools fill the browser window, with the cells taking all the space the tools leave; the button, or Escape, puts it back
- an area can be at most 512 tiles in each direction, so its file in an [export](#exporting-a-universe) always fits the 8 MB an [import](#importing-a-universe) reads of one file, whatever its tiles' IDs; the size dialog says so and keeps Resize off past it. An area can have at most 1,000 links on its cells, which its file holds too
- a button to edit size
	- a 3x3 grid, 4 input fields (each in north, east, south, west), showing the number of tiles in that direction
		- a field whose value differs from the area's size is shown in a changed color, with what it was under it ("was 10"), which screen readers read with the field
	- a readonly sentence shows the total dimensions (e.g., 1200 tall x 800 wide)
	- an "Extend Size" section: a 3x3 grid with + North, + West, + East and + South buttons around an "Extend by" field (10 by default). Each button adds that many tiles to its direction's field; the area changes when the dialog's Resize button is clicked
	- shrinking the dimensions will show a warning if you delete any tiles that aren't the default tile
	- for an area with [neighbors](#neighboring-areas), the dialog names the areas along its row or column that are resized with it, and its warning covers what they lose too. It keeps Resize off below 32 in either direction, and says why
- tools: [draw](#tool-draw), [fill](#tool-fill) and links
- picking a tile: middle click on a cell, or P on the keyboard's cursor, chooses the cell's tile in the Tile list, whatever the tool, without changing it. A cell holding the area's default tile chooses it, and an Unexplored cell chooses Unexplored. The status line under the cells says which tile was chosen, which screen readers read out. A tile the list doesn't offer (disabled, not for the area's kind, or to be deleted by the Tilesets tab) isn't chosen, and the status line says why. A middle-button drag still pans
- [neighbors](#neighboring-areas): past each edge with a neighbor, the cells show the 16 nearest rows or columns of it, and of the areas at the corners, dimmed and read-only, with this window's unsaved changes to them. Past the end of a chain that loops, they show the chain's other end the same way. The pointer shows as a pointer over them, with no brush outlined, and clicking one opens that area's editor. The keyboard's cursor can move onto them, outlining one cell: P picks a tile there, and Space or Enter opens the area's editor. A button on each such edge, and on each corner with an area diagonally across it, names the area past it (the chain's other end past the end of a chain that loops) and opens its editor, its direction in gray before the area's name. The buttons are reached with Tab after the cells
- undo / redo
	- clicking and dragging counts all changes during that as 1 for the purpose of undo/redo
	- each use of Edit Size is 1 step too. Making the area smaller sets the cells it cuts off to the default tile, so undoing it brings them back, even after it is saved. A resize that carries [neighbors](#neighboring-areas) along is one step in the editor it was made in, and undoing it puts back every area's size
- painting, changes to the area's size and links (and return links placed in other areas) are kept in the editor until the editor's Save button saves them along with the area's settings, and the cells are read-only while they are being saved. Links are saved after the area's new size, so a link can go on cells the area has grown to include
- links on or into cells a smaller area cuts off are deleted when the smaller area is saved, after asking; undo doesn't bring them back
- areas have multiple layers, such as the ground and objects on it
- area links, a layer independent of the artwork. Any cell can link to a cell in another area
	- `automatic`: entering the cell moves you to the target area
	- `manual`: you are offered the option to enter the area
	- "requires the whole group": the link can only be used when every member of the group is present, including the anchor being. For example, the city -> wilderness link requires the whole group, but the city -> shop link doesn't
	- "select destination coordinates": shows a preview of the target area. Clicking a cell marks it as the destination, then lets you place a return link (optional)
	- since links are separate from the artwork, you also need to draw a door (or similar) so players know where to walk

### Tool: Draw
- lets you select a tile, e.g. "Grass" or "Wood Floor": the enabled tiles for the area's kind, indoors or outdoors, and the area's default tile. The list follows the area editor's indoors / outdoors choice before it is saved. Switching an area between them leaves the tiles already painted as they are. Also lets you select "Unexplored": nothing at all, which nobody can enter, drawn in the game and the editor as the blank map paper of a group's unexplored cells
- lets you select a size (1 for a single tile, up to 100 tiles)
- brush shape - circle or square

### Tool: Fill
- Fill (Alt+I), beside Draw and Links, paints with the Tile list's tile, like the [draw tool](#tool-draw)
- clicking a cell, or Space or Enter on the keyboard's cursor, paints it and every cell joined to it to the north, east, south or west that holds the same tile, within the area: it doesn't cross the area's looping edges or go into its [neighbors](#neighboring-areas)
- the area's default tile is the same tile whether a cell holds it as the default or by its own ID
- a fill reaching cells that haven't loaded loads the rest of the area first, so it covers every joined cell
- a fill is one step for undo
- a fill of more than 1,000 cells asks first in a dialog saying how many cells it paints
- screen readers hear how many cells a fill painted, or that the cell already holds the tile

## Editor: Tile
- Delete Tile (a tile the universe added) asks first in a dialog. When areas' cells use the tile, the dialog names them and asks for a tile to paint their cells with instead, which must be chosen. When it is areas' default tile, the dialog says so and asks what they get instead (see [Replacing a default tile](#replacing-a-default-tile)). The tile is struck through until the Tilesets tab is saved; saving paints every cell holding it with the replacement, and gives each region and area that set it as their default tile what the dialog chose, then deletes it. Undo Delete takes it back. A default tile the universe edited has Restore instead, which keeps it in the areas
- name
- enabled: an area's [draw tool](#tool-draw) and default tile only offer enabled tiles. Areas that already use a disabled tile keep it, and an area whose default tile is disabled keeps it until another is chosen. The tiles new areas start with (`DEFAULT_AREA_TILE_KEYS`: Grass outdoors, and Wood Floor or Metal Floor indoors) can't be disabled
- "used in": checkboxes for indoors and outdoors; a tile can be for either, both or neither. An area's [draw tool](#tool-draw) and default tile only offer the tiles for its kind. A tile for neither can't be painted anywhere, but areas that already use it keep it. Unchecking a kind while the tile is the default tile (its own or inherited, see [Regions](#regions)) of an area of that kind says so in a dialog and asks what those areas get instead (see [Replacing a default tile](#replacing-a-default-tile)). Cancel leaves the box checked
- color (used if there are no graphics), accepts hex + has a color picker
- graphic (image). A cell is 32x32 pixels. Graphics only change how the area is drawn; walk time and vision cost still come from the tile
	- each layer has one format, never a mix within a layer, since formats draw on different grids. The format doesn't depend on whether an area is indoors or outdoors, since a tile can be for both
	- the ground layer uses the Dual-Grid System. A Dual-Grid graphic is a 128x128 sheet of 16 frames, each 32x32 (one cell), in a 4x4 grid read left to right, top to bottom. Each frame is drawn on a corner where 4 cells meet, half a cell up and left of the cells, and fills the quarters whose cells hold the tile. The frames are in the game's order (`DUAL_GRID_FRAME_CORNERS` in `/shared`), by rows: empty, bottom-right, bottom-left, top-right; bottom half, top-left and bottom-right, top half, top-right and bottom-left; all but bottom-right, all but bottom-left, all but top-left, all but top-right; right half, left half, top-left, full. The empty frame is never drawn, and the full one, last, is what swatches show. Every sheet the engine ships and stores is in this order. `client/src/assets/tilesets/grass.png` is a sample
	- the tile editor picks a graphic that ships with the engine (`TILE_GRAPHICS` in `/shared`), one of the universe's uploaded tilesets, or none. The hint under the list says how the chosen one is drawn, ending with its tile system: "Blends with neighboring tiles; higher draw order on top. Draw order: 60 (Dual-Grid).", "Drawn over the area's default tile, joining up with its neighbors (47-Tile Blob).", or with none "Drawn in its color."
	- "Upload Tileset Image" (Alt+U) in the tile editor opens a dialog: the layout ("15 tiles, blending with the ground", a Dual-Grid sheet, or "47 tiles, drawn over the ground", a blob sheet; choosing an image of the other layout's sizes switches to it), the image (a PNG of the layout's size, 128x128, or 224x224 or 256x192 for a blob sheet, at most 256 KB), a name, for a Dual-Grid sheet a draw order from 1 to 99 (the engine's own are listed: Grass 30, Forest 40, Mountains 50, Stone Wall 60), and "I have the rights to use this image", which must be checked. The dialog checks the image in the browser and chooses it for the tile, and the graphic list shows it like any uploaded tileset; saving the Tilesets tab uploads it (the server checks it again and stores it re-encoded, without its metadata) before saving the tiles that use it. A universe can have at most 200 uploaded tilesets. Areas draw a tile with an uploaded tileset in its color until the tileset has loaded
	- with an uploaded tileset chosen, "Delete Tileset Image" asks first in a dialog, then takes it off the graphic list and puts the tile back to its color. Tiles drawn with it show their colors on the tab from then on. Saving the Tilesets tab deletes it after saving the tiles, and every tile drawn with it is drawn in its color after; leaving the tab without saving keeps it. One not uploaded yet is simply discarded
	- where different tiles meet, each graphic's draw order decides whose edges overlap whose, since a sheet's edges are drawn for the ground below it; tiles drawn in their colors go below every graphic. Past an edge of an area that doesn't loop, the area ends square
	- players are drawn over the tiles they can walk on. A forest is one sheet, its treetops drawn over its floor; the treetops can rise half a cell above the forest's north edge within ordinary 32x32 frames, since the frames on that edge cover half of the cells north of it, and taller trees need taller frames
	- an impassable tile's graphic, such as mountains whose peaks rise half a cell over the cells north of them, is also drawn over the players standing in the cell just north of it, so they are behind it. No player stands on the tile, and nothing of it is drawn over a player beside or south of it
	- tiles drawn over the ground can use the 47-Tile Blob Set, for things seen from straight above such as hedges, rooftops and rugs. Each quarter of a blob frame depends only on the 4 cells around that corner, as a Dual-Grid frame does, so anything whose look is made of edges and corners can be drawn either way; the blob layout is needed only for art centered on a cell or tied to whole cells. Walls are drawn as their tops, with no front face (which would need more than a cell of height, and reads as a raised floor). A blob graphic is a 224x224 sheet of 47 frames, each 32x32, in 7 columns and 7 rows read left to right, top to bottom; the first 2 places of the last row are empty. Each cell holding the tile gets one frame, picked from which of its 8 neighbors hold the same tile: north 1, north-east 2, east 4, south-east 8, south 16, south-west 32, west 64, north-west 128, with a diagonal counting only when both neighbors beside it hold the tile too. That leaves 47 masks, and the sheet's frames are laid out so its shapes join up across them, like tiles drawn in an area (`BLOB_SHEET_MASKS` in `/shared`): a 3x3 block of a solid area at the top left, then a 1-wide strip down and across, and the frames with inside corners; the second frame of the second row (mask 255) is the tile on every side, which swatches show. The upload dialog also takes a 256x192 sheet of 8 columns and 6 rows with the 47 masks in ascending order and the last place empty, told apart by its size, and rearranges it into the game's order before it is staged. Past an edge of an area that doesn't loop, the cell on the edge carries on, so a wall along it runs off the area. Blob tiles are drawn in a walls layer over the ground, under the players, and the ground under them is drawn as the area's default tile. `client/src/assets/tilesets/hedge.png` and the wood wall (`woodWall.png`) are samples; the stone wall (`stoneWall.png`, rubble with cut stones along its edges) is a Dual-Grid sheet with draw order 60, over every ground graphic. An uploaded tileset is either format, as its uploader chose; a blob sheet has no draw order
	- distinctive buildings and lone trees are placed objects rather than tiles (see [Open questions](#open-questions))
- Vision cost - 0% to 100% (cannot see through). See [vision](#vision)
- Walk time - seconds of game time walking a square takes, 0 to 36000. A new tile gets 600 (10 minutes) when it is for outdoors and 10 when it is only for indoors, following the checkboxes until another walk time is typed. Twice the default takes twice as long (PF1E difficult terrain), 0 is impassable
- Has a preview section for day + night

### Replacing a default tile
Deleting a tile, or unchecking a kind it is for, while it is the default tile of areas (their own or inherited, see [Regions](#regions)) opens a dialog saying so. It lists those areas, each linking to it, under the places that give them the tile: the regions and areas that set it.
- deleting the tile changes every place that sets it
- unchecking a kind changes a place that gives the tile only to areas of that kind. A place that also gives it to areas of the other kind keeps it, since it still suits them, and the areas of the unchecked kind below it are listed as places of their own

Each place has a select of what it gets instead:
- Inherit, offered only when clearing the place's default tile leaves every area it gave the tile to with a default tile worked out from their parent regions and areas, with no conflict, showing what each would get ("Inherit (Grass, from Planet)"). For an area listed below a place that keeps the tile, Inherit leaves it as it is, to take what is above it once the tile no longer suits it. The select starts on Inherit when it is offered, and empty otherwise
- the enabled tiles. Replace All With, above the places, chooses one tile for every place at once

Above the places, a count shows how many have a choice that can go on, out of how many there are ("1 / 20 chosen"), so a builder knows how much work is left; a place starting on Inherit counts as chosen. It updates as choices are made, and is read out to screen readers when it changes.

A tile that isn't for the kind of every area whose default tile it would become shows a warning naming those areas, and the dialog can't go on until another is chosen, nor while a place has nothing chosen. The dialog checks what is left as the editor does, naming any area left with a conflict or a missing value. A builder can only change places within their assignments: the dialog names those outside them, and can't go on while any are listed. Going on applies the changes to the tab with the deletion or the unchecked kind, staged until Save like the rest.

The server refuses a save that leaves an area's default tile not for its kind.

# Localization
Players choose the language they play in, and universes can be translated. There are two kinds of text, and each is looked up in the player's language separately:
- **engine text**, written by the site developers: the pages and editors, messages from the server, emails, and each ruleset's defaults (such as PF1E's races, classes, items and tiles). Its translations ship with the engine
- **universe text**, written by a universe's editors: the universe's name and descriptions, the names of its areas, tiles, races, classes and items (later NPCs and dialog), and the names and abbreviations it gives its coins. Translated in the [Translations](#tab-translations) tab

Text players write is never translated: character names, group names and chat.

Translators get context for every piece of text, because one English word can need several translations (German has several words for "Save", and a button that stores changes needs "Speichern"). Each engine message has a description written next to it in the code, and the same English used for two purposes is two messages. Universe text shows where it comes from, and editors can add a note.

## Choosing a language
- A player's language comes from their [profile](#profile-edit), then the language picker at the bottom of every page (which the browser remembers, so it works without a profile), then the browser's settings, then English. The picker names each language in that language.
- The pages and editors use the player's language if the engine has it. Universe text uses the closest language the universe has, so a French player sees French pages even in a universe written only in English.
- A universe's page also lets the player choose any language the universe is translated into, including ones the engine isn't. The browser then remembers that language with the page's language after it, so universe text is shown in the chosen language and the pages stay in theirs.

## Finding a translation
Universe text uses the first of these that exists:
1. the universe's translation in the player's language (`pt-BR`)
2. the universe's translation in that language without its region (`pt`)
3. the text in the universe's source language

(`findTranslation()` and `universeText()` in `shared/src/universeText.ts`.)

The player's language here is the first of the languages they want that the universe has, as it is or without its region (`chooseUniverseLanguage()`): the language on their profile, then those the pages send in Accept-Language (the one chosen with the picker, then the browser's), whether or not the engine has them. Every page players read universe text on shows it this way; the editor always shows the source text. The rooms send every player the same messages, so they name areas and tiles by ID, and the game looks the names up in the universe's text in the player's language (`GET /universes/:key/text`), which it fetches again, cheaply with its ETag, when a save in the editor changes it. Every window of the universe hears of the change at once, so each waits a random few seconds before fetching, and the server keeps the text it builds for each universe and language until it changes.

A ruleset default the universe hasn't renamed (such as a default tile whose color was edited but not its name) is engine text instead.

Engine text uses the player's language, then that language without its region, then English.

## Out-of-date translations
Each translation remembers the source text it was made from, as its SHA-256 hash (`sourceTextHash()` in `shared/src/universeText.ts`, which Postgres works out the same way). When the source text changes, the translation is still shown, but the [Translations](#tab-translations) tab marks it out of date until a translator updates it or confirms it is still correct.

## Formatting
- Numbers, dates, times ("5 minutes ago") and lists follow the player's language, and names are sorted the way that language sorts them.
- Plurals and other grammar that changes with a number or a person are part of each translated message, never built from pieces.
- [Money](#field-money) denominations ("pp", "gp") are ruleset text, so they are translated. A universe can give a coin a name and abbreviation of its own, which are universe text instead; no other engine text can be renamed by a universe.
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
- A shortcut's letter is in its button's English text, so it can be underlined there. The keys follow one pattern: Alt+S submits the form or dialog showing when its button has an S (Save, Send code, Resize); one without takes a letter of its own word, preferably its first (Alt+C for Create, Choose and Continue, Alt+L for Log in and Create Link, Alt+A for Add). Alt+A applies an editor dialog's changes to its tab (Apply), Alt+N adds something new (on the Characters tab, which adds races, classes and themes, Alt+R adds a race, Alt+L a class and Alt+T a theme), Alt+L leaves (the lobby or group; for the anchor being, whose Disband Group has no L, Alt+B) or picks the Links tool in the area editor, Alt+U enters a universe, Alt+H goes Home from a message filling the page (and shows the editors' chat in the editor), Alt+B goes back, Alt+M moves focus to the area, and Alt+P makes the area editor's cells full page. Ctrl+Enter puts focus in the chat's field wherever there is a chat, showing the editors' chat first when it is hidden.

## Screen readers
- When a screen changes, focus moves to its heading, so the screen is read out.
- The game's area is a focusable application with its keys described. A screen reader is told the area the player enters, players coming into and going out of view, a door or path underfoot that E takes, and when something is in the way. Alt+P reads out the player's area and cell, the tile they stand on, and each player they can see with their distance and compass direction, and shows the same in a toast at the top of the page.
- A toast (`showToast()` in `client/src/ui/toast.ts`) shows a short message at the top of the page for a few seconds (longer while the pointer rests on it), and screen readers read it out through the announcer; the toast's text is hidden from them, so it isn't read twice. A toast that stays until it is closed, such as a save notice warning of changes that meet, has a Got It button (Alt+G, the oldest first when there are several), described by the toast's text, so a keyboard or screen reader can close it.
- The area editor's cells (and the link dialog's preview) can be focused and worked with a cursor: the arrow keys move it, Space or Enter paints or picks its cell, holding Space while moving paints a stroke, + and - zoom and Home returns to the center cell. Each cell the cursor reaches is read out with what it holds.
- Colors are never the only way information is shown: the tile table's swatches carry the color's hex code.

## Sortable tables
A table that can be sorted has a button in each heading that sorts it (`TableSorter` in `client/src/ui/tableSorter.ts`, with `sortRows()` and `SortOrder` in `/shared`). Clicking a heading sorts going up, and clicking it again going down. The heading sorted by has `aria-sort` and an arrow showing which way; the others show an arrow both ways. Screen readers are told how the table is now sorted. A list paged on the server sends the order as the `sort` and `direction` query parameters, and the server sorts before paging; ties are kept in the list's own order.

# Open questions
- **Time:** the overworld map's scale.
- **Offline group members:** whether to use the summoning ring.
- **Lobby:** the player limit (from load testing), how groups manage their lobby listing, and how a lobby with many players shows who is online.
- **Cross-universe play:** art style, and whether items need a "source universe" setting.
- **Accounts:**
	- which email sending service to use in production (email goes out over SMTP, so it's configuration)
	- whether to add a CAPTCHA (such as Cloudflare Turnstile on sending a code). The code limits stop guessing, but someone who knows an address can make 15 wrong guesses and block that address's codes for a day
- **Messages:** blocking, reporting and who can message whom, before messaging is supported.
- **Objects:** how placed objects such as houses and lone trees work. The likely shape: an object is made once and placed in any number of areas, with an image, the cells it covers (each with its own walk time and vision cost, read by the server), the part drawn above players so a player walking behind it is hidden, and door cells for area links into its interior, which is an indoor area
- **Characters:** whether character names must be unique within a universe.
- **Localization:**
	- fonts for text drawn in the game's areas in scripts the default font doesn't cover, such as Chinese and Japanese
	- whether to offer machine translation of chat
- **Licensing:** how to use Pathfinder content within its open license and Paizo's terms for the "Pathfinder" name, alongside the project's AGPL license.
