---
name: kiln-grill-me
description: "Questions the user about a design until nothing in it is unclear, then lists the assumptions implementing it would make, and carries it out once the user agrees. Takes the design as text or a path to a file, or asks for it"
argument-hint: "[design text | path to a design file]"
disable-model-invocation: true
---
# Kiln grill me

Questions the user about a design, such as a new phase, a feature or a change to a rule, until nothing in it is unclear. Then it lists the assumptions implementing the design would make. Once the user agrees, it carries out what the design asked.

## Getting the design

- A path to a file, such as `/kiln-grill-me scratchpad/avatars.md`: read the file.
- Other text: that text is the design. It can be many lines long.
- Nothing: ask the user to paste the design, and wait for it.

## Steps

1. Read what the design touches before asking anything:
	- The sections of `STRUCTURE-OVERVIEW.md` it changes or relies on.
	- `PLAN.md`: the phases it relates to, and the Later, Open decisions and TODO sections, which may already cover it.
	- The code it would change, enough to know what is there now.
2. List what is unclear. Look for:
	- Parts that conflict with each other, with `STRUCTURE-OVERVIEW.md`, with `PLAN.md` or with the code. For example, a new phase given a number another phase already has.
	- Parts that break the rules in `CLAUDE.md`, such as the server deciding every outcome, or the universe editor staging every change.
	- Gaps. Who can do it: players, creators or server admins? Where does it appear? What is stored, and where? What happens to existing data, exports and imports? What does each ruleset do? How does it work with only a keyboard and with a screen reader? What happens at the edges: limits, empty states, errors and deleting?
	- Words that could mean more than one thing.

	Don't ask what the docs or the code already answer. Don't ask what the project's conventions give an obvious default for. Those become assumptions in step 4.
3. Ask the user, interactively:
	- Ask one question at a time, or a few closely related ones together. Start with the questions whose answers change the most, since they may settle others.
	- When a question has a few clear answers, use the AskUserQuestion tool. Put the answer you recommend first, marked "(Recommended)", and say what each answer means for the design.
	- Ask an open question in plain text and wait for the reply. An open question is one like what something is called, or what a screen shows.
	- Make each question stand on its own. Say briefly what in the design or the code raised it.
	- After each answer, update the list. An answer can raise new questions or settle others.
	- Keep going until nothing is unclear. Don't stop early because there are many questions. Don't ask what the user has already answered.
4. Once every question is answered, tell the user the assumptions you would make if implementing the design. These are the choices nobody stated, but the work can't avoid making. For example:
	- Defaults taken from the project's conventions or from a similar feature. Name the feature.
	- Where things go: tables, routes, rooms, pages and modules.
	- What is left out of this work for later.
	- How existing data, exports and imports are handled.

	Start with a short summary of what the answers decided. Then list the assumptions grouped by topic, one per line. Make each one specific enough to disagree with: "Avatars are a column on `characters`", not "Store avatars sensibly". Ask the user to confirm the assumptions, or correct any that are wrong. When they correct some, show only what changed, and ask them to confirm again.
5. Once the user confirms the assumptions, carry out what the design asked. Don't start before they confirm:
	- A new phase or a design change: write it into `PLAN.md` the way the phases there are written, with a "Decided:" list of the answers and assumptions, steps with checkboxes, and a "Done when" check. Update `STRUCTURE-OVERVIEW.md` to match.
	- A request to build something: build it, following `CLAUDE.md`.
	- When it's unclear whether the user wants it planned or built, ask.
