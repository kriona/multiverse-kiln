import assert from 'assert';
import { isReservedName } from '@multiverse-kiln/shared';

describe('isReservedName (shared)', () =>
{
	it('keeps back names that pass as staff, in any capitals', () =>
	{
		for (const name of ['Admin', 'ADMIN', 'Moderator', 'Mod', 'Staff', 'System', 'Official', 'Support', 'Sysop'])
		{
			assert.strictEqual(isReservedName(name), true, name);
		}
	});

	it('sees through leetspeak, separators, repeats and decorations', () =>
	{
		for (const name of ['Adm1n', '4dm!n', 'a.d.m.i.n', 'A d m i n', 'Aaadmiiin', 'admin_', 'Admin123', '__Admin__', 'xX_Admin_Xx', 'm0d3rat0r'])
		{
			assert.strictEqual(isReservedName(name), true, name);
		}
	});

	it('sees through accents, look-alike letters, full-width letters and invisible characters', () =>
	{
		// Cyrillic а, Greek ο, full-width letters, a zero-width space
		for (const name of ['Ádmín', 'аdmin', 'Mοderator', 'Ａｄｍｉｎ', 'ad​min'])
		{
			assert.strictEqual(isReservedName(name), true, name);
		}
	});

	it('finds the words in a longer name, split by spaces, punctuation or capitals', () =>
	{
		for (const name of ['The Admin', 'TheAdmin', 'Server-Admin', 'Brokk the Moderator', 'Real.Staff'])
		{
			assert.strictEqual(isReservedName(name), true, name);
		}
	});

	it('keeps back the game\'s name and game master anywhere', () =>
	{
		for (const name of ['Multiverse Kiln', 'MultiverseKilnFan', 'Game Master Bob', 'thegamemaster'])
		{
			assert.strictEqual(isReservedName(name), true, name);
		}
	});

	it('allows names that only contain the letters of a reserved word', () =>
	{
		for (const name of ['Quarterstaff', 'Observer', 'Modesty', 'Desmond', 'Adam', 'Administrata', 'Systole', 'Kiln', 'Brokk', 'Mira Stafford'])
		{
			assert.strictEqual(isReservedName(name), false, name);
		}
	});
});
