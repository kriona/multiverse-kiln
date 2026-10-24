/**
 * Sorting a table by one of its columns: the order a list query asks for, and sorting rows by it. The
 * directions are the values of the aria-sort attribute, so a table's heading can use them as they are
 */

/**
 * The ways a column can be sorted
 */
export const SORT_DIRECTIONS = ['ascending', 'descending'] as const;

/**
 * A way a column can be sorted
 */
export type SortDirection = typeof SORT_DIRECTIONS[number];

/**
 * The column a table is sorted by, and which way
 */
export interface SortOrder<Column extends string>
{
	column: Column;
	direction: SortDirection;
}

/**
 * How to compare two rows by each column a table can be sorted by: negative when the first comes first
 * going up, positive when it comes second, and 0 when they tie
 */
export type RowComparers<Row, Column extends string> = Record<Column, (first: Row, second: Row) => number>;

/**
 * Rows sorted by a column. Rows that tie on it keep their order going either way
 *
 * @param rows The rows, in the order used to break ties
 * @param comparers How to compare rows by each column
 * @param order The column to sort by, and which way
 * @return A sorted copy of the rows
 */
export function sortRows<Row, Column extends string>(rows: readonly Row[], comparers: RowComparers<Row, Column>, order: SortOrder<Column>): Row[]
{
	const compare = comparers[order.column];
	const sign = ((order.direction === 'ascending') ? 1 : -1);

	return([...rows].sort((first, second) => (sign * compare(first, second))));
}

/**
 * Compares two numbers going up
 *
 * @param first The first number
 * @param second The second number
 * @return Negative, 0 or positive, for sort()
 */
export function compareNumbers(first: number, second: number): number
{
	return(first - second);
}
