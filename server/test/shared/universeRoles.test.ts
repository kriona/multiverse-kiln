import assert from 'assert';
import { ADMIN_ROLE, canEditUniverseSettings, canEditWorld, canManageEditors, canPlayUniverse, canTranslate, canViewUniverse, EDITOR_CHANGE_CHECKS, editorAccessOf, mayMakeChange, maySaveInStage, UNIVERSE_ROLES, UNIVERSE_STAGES, type EditorAccess, type EditorChange, type UniverseAccess, type UniverseRole } from '@multiverse-kiln/shared';

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

	it('lets each role play and look at a universe by its stage, and everyone look at one at the end of time without playing it', () =>
	{
		const roles = [undefined, ...UNIVERSE_ROLES];
		const playing = UNIVERSE_STAGES.map((stage) => [stage, ...roles.map((role) => canPlayUniverse(stage, role))]);
		const viewing = UNIVERSE_STAGES.map((stage) => [stage, ...roles.map((role) => canViewUniverse(stage, role))]);

		// No role, creator, builder, beta tester, translator
		assert.deepStrictEqual(playing, [
			['in_the_beginning', false, true, true, false, false],
			['prologue', false, true, true, true, true],
			['let_there_be_light', true, true, true, true, true],
			['end_of_time', false, false, false, false, false]
		]);
		assert.deepStrictEqual(viewing, [
			['in_the_beginning', false, true, true, false, false],
			['prologue', false, true, true, true, true],
			['let_there_be_light', true, true, true, true, true],
			['end_of_time', true, true, true, true, true]
		]);
	});

	it('lets only creators and the site admin role save at the end of time, and anyone leave', () =>
	{
		const savers = [...UNIVERSE_ROLES, ADMIN_ROLE].map((role) => [role, maySaveInStage([paint], 'end_of_time', { role, languages: [] }, playerId)]);

		assert.deepStrictEqual(savers, [
			['creator', true],
			['builder', false],
			['beta_tester', false],
			['translator', false],
			[ADMIN_ROLE, true]
		]);
		assert.strictEqual(maySaveInStage([leave], 'end_of_time', accessOf('beta_tester'), playerId), true);
		assert.strictEqual(maySaveInStage([leave, paint], 'end_of_time', accessOf('builder'), playerId), false);
		assert.strictEqual(maySaveInStage([removeOther], 'end_of_time', accessOf('builder'), playerId), false);
		assert.strictEqual(maySaveInStage([paint], 'let_there_be_light', accessOf('builder'), playerId), true);
	});

	it('names a check for every kind of change', () =>
	{
		assert.ok(Object.values(EDITOR_CHANGE_CHECKS).every((check) => ['manageEditors', 'editSettings', 'editWorld', 'translate', 'markNoTranslation'].includes(check)));
	});

	it('lets creators and translators of the language translate, and creators and builders write notes', () =>
	{
		const text = { kind: 'area', thingId: '00000000-0000-4000-8000-000000000003', field: 'name' } as const;
		const translateInto = (language: string): EditorChange => ({ kind: 'saveTranslation', text, language, translation: 'Wiese', sourceHash: '0'.repeat(64) });
		const note: EditorChange = { kind: 'saveTranslatorNote', text, note: 'Flowers' };
		const germanTranslator: EditorAccess = { role: 'translator', languages: ['de'] };
		const allowed = UNIVERSE_ROLES.map((role) => [role, ...[translateInto('de'), note].map((change) => mayMakeChange(change, accessOf(role), playerId))]);

		assert.deepStrictEqual(allowed, [
			['creator', true, true],
			['builder', false, true],
			['beta_tester', false, false],
			['translator', false, false]
		]);
		assert.deepStrictEqual([translateInto('de'), translateInto('fr'), note].map((change) => mayMakeChange(change, germanTranslator, playerId)), [true, false, false]);
	});

	it('lets creators, builders and translators mark text as needing no translation', () =>
	{
		const mark: EditorChange = { kind: 'saveNoTranslation', text: { kind: 'universe', thingId: playerId, field: 'name' }, noTranslation: true };

		assert.deepStrictEqual(UNIVERSE_ROLES.map((role) => [role, mayMakeChange(mark, accessOf(role), playerId)]), [
			['creator', true],
			['builder', true],
			['beta_tester', false],
			['translator', true]
		]);
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
