import assert from 'assert';
import { SOURCE_LOCALE, Translator, type ExportedTile } from '@multiverse-kiln/shared';

import { areaCellsLegend, type LegendArea } from '../src/http/universeExportLegend.js';

/**
 * The legend of one area on one tile, with every name given
 *
 * @param name The universe's, the area's and the tile's name
 * @return The legend's lines
 */
function legendLines(name: string): string[]
{
	const tile = {
		id: 7,
		key: null,
		name,
		color: 0x2a7a30
	} as ExportedTile;
	const area = {
		id: 'area-1',
		name,
		defaultTileId: 7,
		bounds: {
			minColumn: 0,
			maxColumn: 1,
			minRow: 0,
			maxRow: 1
		},
		file: 'areas/area-1.json'
	} as LegendArea;

	return(areaCellsLegend(name, 'pf1e', [tile], [area], new Translator(SOURCE_LOCALE)).split('\n'));
}

describe('The export\'s area legend', () =>
{
	it('writes names as text, not as HTML or Markdown', () =>
	{
		const lines = legendLines('<img src=x onerror=alert(1)> &amp; [Fix](https://example.com) ![](https://example.com/p.png) *a* `b` ~c~ $d$ #');
		const escaped = '&lt;img src=x onerror=alert(1)&gt; &amp;amp; \\[Fix\\](https://example.com) !\\[\\](https://example.com/p.png) \\*a\\* \\`b\\` \\~c\\~ \\$d\\$ \\#';

		assert.strictEqual(lines[0], `# ${escaped}: area cells`);
		assert.ok(lines.includes(`| 7 | ${escaped} | #2A7A30 |`), lines.join('\n'));
		assert.ok(lines.includes(`| \`area-1.json\` | ${escaped} | ${escaped} | Columns 0 to 1, rows 0 to 1 |`), lines.join('\n'));
	});

	it('keeps a name\'s backslashes and vertical bars from ending its table cell', () =>
	{
		const lines = legendLines('a\\|b|c\\');

		assert.ok(lines.includes('| 7 | a\\\\\\|b\\|c\\\\ | #2A7A30 |'), lines.join('\n'));
	});
});
