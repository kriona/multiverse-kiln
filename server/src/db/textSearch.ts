/**
 * SQL for searching text columns, shared by the repositories
 */
import { or, sql, type AnyColumn, type SQL } from 'drizzle-orm';

/**
 * A condition that any of some columns holds a piece of text, ignoring capitals
 *
 * @param columns The columns
 * @param text The text; %, _ and backslash match themselves, not as LIKE's wildcards and escape
 * @return The condition
 */
export function anyColumnContains(columns: readonly AnyColumn[], text: string): SQL | undefined
{
	const pattern = `%${text.toLowerCase().replace(/[\\%_]/g, (character) => `\\${character}`)}%`;

	return(or(...columns.map((column) => sql`lower(${column}) LIKE ${pattern}`)));
}
