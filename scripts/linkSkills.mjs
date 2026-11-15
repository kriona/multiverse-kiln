/**
 * Links each agent skill in .agents/skills/ into .claude/skills/, the folder Claude Code loads skills from.
 * On Windows the links are junctions, which hold absolute paths, so .claude/skills/ is git-ignored and every
 * clone and worktree makes its own: npm install runs this through the root package's prepare script
 */
import fs from 'node:fs';
import path from 'node:path';

const repositoryRoot = path.resolve(import.meta.dirname, '..');
const skillsFolder = path.join(repositoryRoot, '.agents', 'skills');
const linksFolder = path.join(repositoryRoot, '.claude', 'skills');

/**
 * Reads a path's own details without following a link
 * @param {string} filePath the path to read
 * @return {?fs.Stats} its details, or null when nothing is there
 */
function statsOf(filePath)
{
	try
	{
		return(fs.lstatSync(filePath));
	}
	catch
	{
		return(null);
	}
}

/**
 * Finds where a path leads, following links
 * @param {string} filePath the path to resolve
 * @return {?string} the real path, or null when it leads nowhere
 */
function realPathOf(filePath)
{
	try
	{
		return(fs.realpathSync(filePath));
	}
	catch
	{
		return(null);
	}
}

/**
 * Lists the skills in .agents/skills/: the folders holding a SKILL.md
 * @return {string[]} the skills' folder names
 */
function listSkills()
{
	const entries = fs.readdirSync(skillsFolder, { withFileTypes: true });
	return(entries
		.filter((entry) => (entry.isDirectory() && fs.existsSync(path.join(skillsFolder, entry.name, 'SKILL.md'))))
		.map((entry) => entry.name));
}

/**
 * Removes links in .claude/skills/ that lead nowhere, such as one to a deleted skill
 */
function removeBrokenLinks()
{
	for (const name of fs.readdirSync(linksFolder))
	{
		const linkPath = path.join(linksFolder, name);
		if (statsOf(linkPath)?.isSymbolicLink() && (realPathOf(linkPath) === null))
		{
			fs.unlinkSync(linkPath);
			console.log(`Removed the broken skill link .claude/skills/${name}`);
		}
	}
}

/**
 * Links one skill into .claude/skills/, replacing a link that leads elsewhere, such as into another checkout.
 * A real folder there is left alone, since it may hold someone's own copy
 * @param {string} name the skill's folder name
 * @return {boolean} whether a link was made
 */
function linkSkill(name)
{
	const target = path.join(skillsFolder, name);
	const linkPath = path.join(linksFolder, name);
	const stats = statsOf(linkPath);
	if (stats !== null)
	{
		if (!stats.isSymbolicLink())
		{
			console.warn(`.claude/skills/${name} is a folder, not a link, so it was left as it is. Delete it to use the skill in .agents/skills/ instead`);
			return(false);
		}
		if (realPathOf(linkPath) === realPathOf(target))
		{
			return(false);
		}
		fs.unlinkSync(linkPath);
	}
	// A relative target suits every system: Node resolves it from the link's folder when making a Windows junction
	fs.symlinkSync(path.relative(linksFolder, target), linkPath, 'junction');
	return(true);
}

/**
 * Links every skill, warning instead of failing so npm install still finishes
 */
function main()
{
	if (!fs.existsSync(skillsFolder))
	{
		return;
	}
	try
	{
		fs.mkdirSync(linksFolder, { recursive: true });
		removeBrokenLinks();
		const linked = listSkills().filter((name) => linkSkill(name)).length;
		if (linked > 0)
		{
			console.log(`Linked ${linked} agent skills into .claude/skills/`);
		}
	}
	catch (error)
	{
		console.warn(`Couldn't link the agent skills into .claude/skills/: ${error.message}`);
	}
}

main();
