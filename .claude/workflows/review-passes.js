export const meta = {
	name: 'review-passes',
	description: 'Review the code in up to four passes, then have every finding checked by a verifier that did not make it',
	whenToUse: 'Started by the kiln-review skill (.agents/skills/kiln-review/SKILL.md), which does the setup, passes it as args and writes the findings this returns',
	phases: [
		{ title: 'Review', detail: 'one reviewer per pass and area, combined in diff mode' },
		{ title: 'Verify', detail: 'each verifier tries to disprove its findings, then proves them, in a review slot of its own' }
	]
}

// Which passes review each area: the same table as .agents/skills/kiln-review/references/areas.md
const ALL_PASSES = ['bugs', 'security', 'performance', 'rules']

const AREA_PASSES = {
	rooms: ALL_PASSES,
	http: ALL_PASSES,
	auth: ['bugs', 'security', 'rules'],
	db: ['bugs', 'security', 'performance'],
	uploads: ['bugs', 'security', 'performance'],
	logic: ['bugs', 'performance', 'rules'],
	client: ALL_PASSES,
	other: ['bugs']
}

const PASS_PREFIXES = {
	bugs: 'B',
	security: 'S',
	performance: 'P',
	rules: 'R'
}

const PASS_TITLES = {
	bugs: 'Bugs',
	security: 'Security',
	performance: 'Performance',
	rules: 'Rules'
}

const SEVERITIES = ['critical', 'high', 'medium', 'low']

const VERDICTS = ['reproduced', 'confirmed', 'plausible', 'rejected']

// Diff mode runs at most 10 agents: up to 6 reviewers and up to 4 verifiers
const MAX_DIFF_REVIEWERS = 6

const MAX_DIFF_VERIFIERS = 4

// Verifiers running at once, one per review test database (kiln_review_1_test to kiln_review_4_test)
const REVIEW_SLOTS = 4

// How many findings each verifier takes in full mode
const FULL_BATCH_SIZE = 6

const SKILL_DIR = '.agents/skills/kiln-review'

const FINDINGS_SCHEMA = {
	type: 'object',
	properties: {
		findings: {
			type: 'array',
			items: {
				type: 'object',
				properties: {
					title: { type: 'string', description: 'One line: what is wrong, as a statement' },
					severity: { type: 'string', enum: SEVERITIES },
					file: { type: 'string', description: 'Repository-relative path' },
					line: { type: 'integer', minimum: 1 },
					description: { type: 'string', description: 'What goes wrong and why, in a short paragraph' },
					failsWhen: { type: 'string', description: 'Concrete inputs or state, and the wrong result' },
					fix: { type: 'string', description: 'What would fix it' },
					proof: { type: 'string', description: 'How a verifier could prove it: a repro test, a live check, a benchmark, or reading only' }
				},
				required: ['title', 'severity', 'file', 'line', 'description', 'failsWhen', 'fix', 'proof']
			}
		},
		notes: { type: 'string', description: 'Anything the reviewer could not review, and why' }
	},
	required: ['findings']
}

const VERDICTS_SCHEMA = {
	type: 'object',
	properties: {
		verdicts: {
			type: 'array',
			items: {
				type: 'object',
				properties: {
					id: { type: 'string' },
					verdict: { type: 'string', enum: VERDICTS },
					evidence: { type: 'string', description: 'What proved, confirmed or disproved it, with files and lines; for plausible, what could not be checked' },
					reproFile: { type: 'string', description: 'The repro test, live check or benchmark in the review folder, or empty' },
					severity: { type: 'string', enum: SEVERITIES },
					severityReason: { type: 'string', description: 'Why the severity changed, or empty when it did not' },
					duplicateOf: { type: 'string', description: 'The ID of a finding in this batch with the same cause, or empty' },
					measured: { type: 'string', description: 'Performance only: the numbers measured, or empty when suspected' }
				},
				required: ['id', 'verdict', 'evidence', 'severity']
			}
		}
	},
	required: ['verdicts']
}

if (!args || !Array.isArray(args.areas))
{
	throw new Error('The review workflow needs its args from the kiln-review skill: see .agents/skills/kiln-review/SKILL.md, step 6')
}

const mode = ((args.mode === 'full') ? 'full' : 'diff')
const named = (Array.isArray(args.passes) ? args.passes.filter((pass) => ALL_PASSES.includes(pass)) : [])
const passes = (((mode === 'full') || (named.length === 0)) ? ALL_PASSES : named)
const nextIds = (args.nextIds || {})
const openFindings = (Array.isArray(args.openFindings) ? args.openFindings : [])
const untracked = (Array.isArray(args.untracked) ? args.untracked : [])
let agentCount = 0

/**
 * The files (diff mode) or paths (full mode) an area covers
 *
 * @param area An area from args.areas
 * @return The paths
 */
function areaPaths(area)
{
	return((area.files || area.paths || []))
}

/**
 * How many paths a reviewer's areas cover, to combine the smallest first
 *
 * @param task A reviewer's pass and areas
 * @return The number of paths
 */
function taskSize(task)
{
	return(task.areas.reduce((total, area) => (total + areaPaths(area).length), 0))
}

const tasks = []

for (const area of args.areas)
{
	if (!AREA_PASSES[area.name])
	{
		log(`Area "${area.name}" isn't in the areas table, so only the bugs pass reviews it`)
	}

	const areaPasses = (AREA_PASSES[area.name] || AREA_PASSES.other)

	for (const pass of passes)
	{
		if (areaPasses.includes(pass) && (areaPaths(area).length > 0))
		{
			tasks.push({
				pass,
				areas: [area]
			})
		}
	}
}

// Diff mode combines the two smallest reviews of one pass until there are few enough. Each pass keeps
// at least one reviewer, so four passes always fit
while ((mode === 'diff') && (tasks.length > MAX_DIFF_REVIEWERS))
{
	let best

	for (const pass of passes)
	{
		const own = tasks
			.filter((task) => (task.pass === pass))
			.sort((first, second) => (taskSize(first) - taskSize(second)))

		if ((own.length >= 2) && (!best || ((taskSize(own[0]) + taskSize(own[1])) < best.size)))
		{
			best = {
				first: own[0],
				second: own[1],
				size: (taskSize(own[0]) + taskSize(own[1]))
			}
		}
	}

	if (!best)
	{
		break
	}

	tasks.splice(tasks.indexOf(best.first), 1)
	tasks.splice(tasks.indexOf(best.second), 1)
	tasks.push({
		pass: best.first.pass,
		areas: [...best.first.areas, ...best.second.areas]
	})
}

if (tasks.length === 0)
{
	log('No pass reviews any of the areas given, so there is nothing to review')
	return({
		mode,
		passes,
		findings: [],
		notReviewed: [],
		agents: 0
	})
}

/**
 * The prompt for one reviewer
 *
 * @param task Its pass and areas
 * @return The prompt
 */
function reviewerPrompt(task)
{
	const areaNames = task.areas.map((area) => area.name).join(', ')
	const known = openFindings.filter((finding) => (finding.pass === task.pass))
	const readFirst = [
		`- ${SKILL_DIR}/references/checklists.md: its opening paragraphs and the ${PASS_TITLES[task.pass]} section`,
		`- The Severity section of ${SKILL_DIR}/SKILL.md, which every reviewer grades with`
	]

	if ((task.pass === 'bugs') && task.areas.some((area) => (area.name === 'rooms')))
	{
		readFirst.push('- The colyseus skill (.agents/skills/colyseus/SKILL.md) and the files in its references/ for what the rooms use')
	}

	if ((task.pass === 'bugs') && task.areas.some((area) => (area.name === 'client')))
	{
		readFirst.push('- The Phaser skills (.agents/skills/<area>/SKILL.md) for the Phaser APIs the client code uses, and v3-to-v4-migration when unsure an API still exists')
	}

	const scope = ((mode === 'diff')
		? [
			`The branch ${args.branch}'s changes: from the merge-base ${args.mergeBase} to the working tree, uncommitted changes included. \`git diff ${args.mergeBase} -- <file>\` shows a file's changes; untracked files are new, so read them whole.`,
			'Review the changes and the code they reach: callers, what they call, both the client and server sides of a message or route. A problem in code the branch didn\'t change counts only when the change introduces it, exposes it or depends on it.',
			'',
			'Files:',
			...task.areas.flatMap((area) => areaPaths(area).map((path) => `- ${path} (${area.name}${(untracked.includes(path) ? ', untracked' : '')})`))
		]
		: [
			'The whole of these paths, in the repository as it is now:',
			...task.areas.flatMap((area) => areaPaths(area).map((path) => `- ${path} (${area.name})`))
		])

	return([
		`You are the ${task.pass} reviewer for the ${areaNames} area${((task.areas.length > 1) ? 's' : '')} of a code review of this repository (${(mode === 'diff') ? 'diff mode' : 'the full repository'}).`,
		'',
		'Read first:',
		...readFirst,
		'',
		'What to review:',
		...scope,
		'',
		...((known.length > 0)
			? [
				'Already reported and still open, so don\'t report them again:',
				...known.map((finding) => `- ${finding.id}: ${finding.title} (${finding.where})`),
				''
			]
			: []),
		'Rules:',
		'- Never edit, create or delete a file. Read code, and run only read-only commands (git diff, git log, git show, grep).',
		'- Don\'t run the server, tests or live checks: verifiers prove the findings after you.',
		`- Report only ${task.pass} problems; another reviewer covers each other pass.`,
		'- One problem per finding, at the exact file and line where it is. Say concretely when it fails (the inputs or state, and the wrong result) and what would fix it.',
		'- Report everything you believe is a real problem, low ones included, and nothing you don\'t: verifiers try to disprove each one.',
		...((task.pass === 'performance') ? ['- Your findings are suspected, not measured: say in proof what a benchmark would measure to show it.'] : []),
		'',
		'Return the findings through the structured output. An empty list is a fine answer when you find nothing.'
	].join('\n'))
}

phase('Review')

const reviews = await parallel(tasks.map((task) => () =>
{
	agentCount++

	return(agent(reviewerPrompt(task), {
		label: `review:${task.pass}:${task.areas.map((area) => area.name).join('+')}`,
		phase: 'Review',
		schema: FINDINGS_SCHEMA
	}))
}))

const notReviewed = []
const byPass = {}

reviews.forEach((review, index) =>
{
	const task = tasks[index]

	if (!review)
	{
		notReviewed.push({
			pass: task.pass,
			areas: task.areas.map((area) => area.name)
		})
		log(`The ${task.pass} reviewer for ${task.areas.map((area) => area.name).join(', ')} didn't finish, so that part isn't reviewed`)
		return
	}

	if (review.notes)
	{
		log(`${task.pass} (${task.areas.map((area) => area.name).join(', ')}): ${review.notes}`)
	}

	byPass[task.pass] = (byPass[task.pass] || []).concat(review.findings.map((finding) => ({
		...finding,
		pass: task.pass,
		areas: task.areas.map((area) => area.name)
	})))
})

// Number each pass's findings, most severe first, carrying on from the branch's earlier runs
const findings = []

for (const pass of passes)
{
	const own = (byPass[pass] || [])
		.sort((first, second) => ((SEVERITIES.indexOf(first.severity) - SEVERITIES.indexOf(second.severity)) || first.file.localeCompare(second.file) || (first.line - second.line)))
	let next = (Number.isInteger(nextIds[pass]) ? nextIds[pass] : 1)

	for (const finding of own)
	{
		findings.push({
			id: `${PASS_PREFIXES[pass]}-${String(next).padStart(3, '0')}`,
			...finding
		})
		next++
	}
}

log(`${findings.length} findings from ${tasks.length} reviewers`)

if (findings.length === 0)
{
	return({
		mode,
		passes,
		findings: [],
		notReviewed,
		agents: agentCount
	})
}

// Findings sorted by place, so two passes' findings about the same lines land in one batch, where the
// verifier can mark one a duplicate of the other
const byPlace = [...findings]
	.sort((first, second) => (first.file.localeCompare(second.file) || (first.line - second.line)))
const batches = []

if (mode === 'diff')
{
	const count = Math.min(MAX_DIFF_VERIFIERS, byPlace.length)

	for (let index = 0; index < count; index++)
	{
		batches.push(byPlace.slice(Math.floor((index * byPlace.length) / count), Math.floor(((index + 1) * byPlace.length) / count)))
	}
}
else
{
	for (let start = 0; start < byPlace.length; start += FULL_BATCH_SIZE)
	{
		batches.push(byPlace.slice(start, (start + FULL_BATCH_SIZE)))
	}
}

/**
 * The prompt for one verifier
 *
 * @param batch The findings it checks
 * @param slot Its review slot, from 1 to REVIEW_SLOTS
 * @return The prompt
 */
function verifierPrompt(batch, slot)
{
	const shown = batch.map((finding) => ({
		id: finding.id,
		pass: finding.pass,
		severity: finding.severity,
		title: finding.title,
		where: `${finding.file}:${finding.line}`,
		description: finding.description,
		failsWhen: finding.failsWhen,
		fix: finding.fix,
		proof: finding.proof
	}))

	return([
		`You are a verifier in a code review of this repository (${(mode === 'diff') ? `the branch ${args.branch}'s changes from ${args.mergeBase}` : 'the full repository'}). Other agents made the findings below; your job is to try to disprove each one, then prove what survives.`,
		'',
		'Read first:',
		`- ${SKILL_DIR}/references/verification.md: evidence levels, repro tests, live checks`,
		`- ${SKILL_DIR}/references/benchmarks.md, for performance findings`,
		`- The Severity section of ${SKILL_DIR}/SKILL.md`,
		'',
		'Your setup:',
		`- Review slot: ${slot}. Run every repro test and mocha benchmark from server/ with TEST_REVIEW_SLOT=${slot}, never without it and never with --parallel.`,
		`- Review folder: ${args.reviewDir}. Write repro tests, live checks and benchmarks only there, named <ID>-<name>.<ext>.`,
		`- Dev server: ${args.serverUrl}. Review universe: ${args.universe ? `${args.universe.name} (${args.universe.id})` : 'none given'}.`,
		`- Accounts: ${Object.entries(args.accounts || {}).map(([role, username]) => `${role} ${username}`).join(', ')}. Their session tokens are in ${args.sessionsFile}; use them through ${SKILL_DIR}/scripts/request.mjs or by reading the file in a script. Never print or copy a token.`,
		'',
		'For each finding:',
		'1. Read the code paths: the line named, its callers, the checks and transactions around it, what the client sends and what the server accepts. If something prevents the problem, it is rejected: say what, with its file and line.',
		'2. If it survives, prove it where you can: a repro test that fails while the problem is there, a live check against the dev server, or a benchmark. Run a repro twice. Otherwise it is confirmed by reading, or plausible when something couldn\'t be checked.',
		'3. Grade it with the review\'s severities. Change the severity if the finding\'s is wrong, and say why.',
		'4. If two findings here have the same cause, give the less fitting one duplicateOf the other\'s ID.',
		'',
		'Rules:',
		`- Never edit the repository's code or any file outside ${args.reviewDir}.`,
		'- Live checks go only through the server\'s HTTP routes and rooms, never SQL, only in the review universe and with the review accounts. Name what you add review-<ID>. No load beyond what one repro needs. Never open a browser for a review account.',
		'- Test rate limits and timeouts with a clock passed in, never by waiting or by sending requests until one is refused.',
		'',
		'Findings:',
		JSON.stringify(shown, null, '\t'),
		'',
		'Return one verdict per finding, by ID, through the structured output.'
	].join('\n'))
}

phase('Verify')

// Each slot's verifiers run one after another, so no two share a review test database
const lanes = Array.from({ length: Math.min(REVIEW_SLOTS, batches.length) }, () => [])

batches.forEach((batch, index) =>
{
	lanes[index % lanes.length].push(batch)
})

const laneResults = await parallel(lanes.map((lane, laneIndex) => async () =>
{
	const verdicts = []

	for (const batch of lane)
	{
		agentCount++

		const result = await agent(verifierPrompt(batch, (laneIndex + 1)), {
			label: `verify:slot${laneIndex + 1}:${batch[0].id}${((batch.length > 1) ? `+${batch.length - 1}` : '')}`,
			phase: 'Verify',
			schema: VERDICTS_SCHEMA
		})

		if (!result)
		{
			log(`The verifier for ${batch.map((finding) => finding.id).join(', ')} didn't finish, so they are left unverified`)
			continue
		}

		const ids = new Set(batch.map((finding) => finding.id))

		verdicts.push(...result.verdicts.filter((verdict) => ids.has(verdict.id)))
	}

	return(verdicts)
}))

const verdictsById = new Map()

for (const verdict of laneResults.filter(Boolean).flat())
{
	verdictsById.set(verdict.id, verdict)
}

const checked = findings.map((finding) =>
{
	const verdict = verdictsById.get(finding.id)

	if (!verdict)
	{
		return({
			...finding,
			verdict: 'plausible',
			evidence: 'Not verified: its verifier didn\'t finish or returned no verdict for it',
			reproFile: '',
			originalSeverity: finding.severity,
			severityReason: '',
			duplicateOf: '',
			measured: ''
		})
	}

	return({
		...finding,
		verdict: verdict.verdict,
		evidence: verdict.evidence,
		reproFile: (verdict.reproFile || ''),
		originalSeverity: finding.severity,
		severity: verdict.severity,
		severityReason: (verdict.severityReason || ''),
		duplicateOf: (verdict.duplicateOf || ''),
		measured: (verdict.measured || '')
	})
})

const counts = VERDICTS.map((verdict) => `${checked.filter((finding) => (finding.verdict === verdict)).length} ${verdict}`)

log(`Verified ${checked.length} findings with ${batches.length} verifiers: ${counts.join(', ')}`)

return({
	mode,
	passes,
	findings: checked,
	notReviewed,
	agents: agentCount
})
