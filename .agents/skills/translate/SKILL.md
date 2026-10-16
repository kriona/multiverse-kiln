---
name: translate
description: "Fills in the messages a translation of the engine text (shared/locales/<locale>.json) is missing or has out of date. Use when the user runs /translate <locale>, asks to update a translation such as Pirate (en-x-pirate), or when npm run messages, npm run lint or the pre-commit hook warns that a translation is missing messages or out of date."
---
# Translate

Updates one translation of the engine text, such as Pirate (`en-x-pirate`). See Localization in `STRUCTURE-OVERVIEW.md` for how messages and translations work.

The argument is the translation's language tag, e.g. `/translate en-x-pirate`. Without one, update every translation the warning names.

## Steps

1. Make sure `shared/locales/en.json` is current: run `npm run messages`. If it reports problems with the messages, fix those first.
2. List what the translation needs:

	```bash
	npm run --silent messages -w shared -- --missing <locale>
	```

	This prints JSON by message ID. Each entry has the English `message` and the `description` written for translators. An entry that is out of date also has its current `translation` and the English it was `translatedFrom`, so the update can follow what changed in the English rather than starting over.
3. Translate each message and write it to `shared/locales/<locale>.json` with the Edit tool, as:

	```json
	"<id>": {
		"message": "<the translation>",
		"source": "<the English message, exactly as --missing printed it>"
	},
	```

	`source` must match the English exactly; it is how the tools tell whether a translation is out of date. Keep the file's entries sorted by ID, indented with tabs, with CRLF line endings.
4. Run `npm run messages` again. The translation should report every message translated and current. Then run `npm run lint`.
5. Tell the user which messages were added or updated, and quote any where the translation was a judgment call.

## Translating

- Read each message's description. It says what the text is and where it appears, and that decides the word: a button that stores changes needs a different word from one that rescues someone.
- Keep ICU syntax intact. Arguments such as `{name}` stay as they are and may move within the sentence. In `{count, plural, one {...} other {...}}` and `{mode, select, ...}`, the keywords and argument names stay in English and only the text inside each branch is translated; the target language may need other plural categories (`few`, `many`).
- Arguments a description says are links or names stay untranslated, as do names of products, licenses and people.
- Keep punctuation and length close to the English, so the text fits where it's shown.
- Legal text, such as the license notices on the license page, keeps its meaning exactly. For Pirate, give it the voice but not different terms.

## Pirate (en-x-pirate)

Pirate is a joke translation that ships with the engine, for testing how languages load and switch. Write it in a playful pirate voice that stays understandable ("Belay that" for Cancel, "chart" for map, "passage" for link), and use the words its existing entries already use for the same things.

## Real languages

Don't machine-translate a real language unless the user asks for it. List what it needs, from step 2, so a translator can work on it, and stop there.
