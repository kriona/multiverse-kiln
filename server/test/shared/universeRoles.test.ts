import assert from 'assert';
import { ADMIN_ROLE, canEditUniverseSettings, canEditWorld, canManageEditors, canPlayUniverse, canTranslate, EDITOR_CHANGE_CHECKS, editorAccessOf, mayMakeChange, UNIVERSE_ROLES, type EditorAccess, type EditorChange, type UniverseAccess, type UniverseRole } from '@multiverse-kiln/shared';

/**
 * Someone's access with a role and no languages
 *
 * @param role The role
 * @return The access
 */
function accessOf(role: UniverseRole): UniverseAccess
{
	return({ role, languages: [] });
}

const playerId = '00000000-0000-4000-8000-000000000001';
const otherId = '00000000-0000-4000-8000-000000000002';

const removeOther: EditorChange = { kind: 'removeEditor', playerId: otherId };
const leave: EditorChange = { kind: 'removeEditor', playerId };
const addTranslator: EditorChange = { kind: 'addEditor', username: 'grace', settings: { role: 'translator', languages: ['de'] } };
const rename: EditorChange = { kind: 'universe', update: { name: 'Renamed' } };
const paint: EditorChange = { kind: 'editCells', areaId: '00000000-0000-4000-8000-000000000003', changes: [] };

describe('Universe roles (shared)', () =>
{
	it('lets only creators manage editors and change the settings, and creators and builders change the world', () =>
	{
		const allowed = UNIVERSE_ROLES.map((role) => [role, canManageEditors(role), canEditUniverseSettings(role), canEditWorld(role)]);

		assert.deepStrictEqual(allowed, [
			['creator', true, true, true],
			['builder', false, false, true],
			['beta_tester', false, false, false],
			['translator', false, false, false]
		]);
	});

	it('lets creators translate into any language, and translators into theirs', () =>
	{
		const translator: UniverseAccess = { role: 'translator', languages: ['de', 'pt-BR'] };

		assert.strictEqual(canTranslate(accessOf('creator'), 'ja'), true);
		assert.strictEqual(canTranslate(translator, 'de'), true);
		assert.strictEqual(canTranslate(translator, 'pt-br'), true);
		assert.strictEqual(canTranslate(translator, 'fr'), false);
		assert.strictEqual(canTranslate(accessOf('builder'), 'de'), false);
		assert.strictEqual(canTranslate(accessOf('translator'), 'de'), false);
	});

	it('lets translators play only once the universe is open to everyone', () =>
	{
		assert.deepStrictEqual(['in_the_beginning', 'prologue', 'let_there_be_light'].map((stage) => canPlayUniverse(stage as 'prologue', 'translator')), [false, true, true]);
	});

	it('names a check for every kind of change', () =>
	{
		assert.ok(Object.values(EDITOR_CHANGE_CHECKS).every((check) => ['manageEditors', 'editSettings', 'editWorld'].includes(check)));
	});

	it('checks each change against the role, letting anyone remove themself', () =>
	{
		const allowed = UNIVERSE_ROLES.map((role) => [role, ...[removeOther, leave, addTranslator, rename, paint].map((change) => mayMakeChange(change, accessOf(role), playerId))]);

		assert.deepStrictEqual(allowed, [
			['creator', true, true, true, true, true],
			['builder', false, true, false, false, true],
			['beta_tester', false, true, false, false, false],
			['translator', false, true, false, false, false]
		]);
	});

	it('lets the site admin role do everything a creator can', () =>
	{
		const admin: EditorAccess = { role: ADMIN_ROLE, languages: [] };

		assert.deepStrictEqual([canManageEditors(ADMIN_ROLE), canEditUniverseSettings(ADMIN_ROLE), canEditWorld(ADMIN_ROLE), canTranslate(admin, 'ja')], [true, true, true, true]);
		assert.deepStrictEqual([removeOther, leave, addTranslator, rename, paint].map((change) => mayMakeChange(change, admin, playerId)), [true, true, true, true, true]);
	});

	it('gives server admins the site admin role unless they are a creator, and others their own role', () =>
	{
		const translator: UniverseAccess = { role: 'translator', languages: ['de'] };

		assert.deepStrictEqual(editorAccessOf(undefined, true), { role: ADMIN_ROLE, languages: [] });
		assert.deepStrictEqual(editorAccessOf(translator, true), { role: ADMIN_ROLE, languages: [] });
		assert.deepStrictEqual(UNIVERSE_ROLES.map((role) => editorAccessOf(accessOf(role), true)?.role), ['creator', ADMIN_ROLE, ADMIN_ROLE, ADMIN_ROLE]);
		assert.strictEqual(editorAccessOf(undefined, false), undefined);
		assert.strictEqual(editorAccessOf(translator, false), translator);
	});
});
