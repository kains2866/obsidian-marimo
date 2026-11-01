/**
 * Starter code for new cells, mirroring the native editor's creation bar
 * (PYTHON / MARKDOWN / SQL). A created cell starts as an empty code cell and
 * receives its template through the editor, so the normal edit pipeline —
 * auto markdown detection, staleness marking, kernel sync — handles it.
 */

export type CellKind = 'python' | 'markdown' | 'sql';

export const MARKDOWN_CELL_TEMPLATE = '## New section\n\nWrite **markdown** here.';

export const SQL_CELL_TEMPLATE = 'df = mo.sql(\n    f"""\n    SELECT 1 AS one\n    """\n)';

export function cellTemplate(kind: CellKind): string {
  if (kind === 'markdown') return MARKDOWN_CELL_TEMPLATE;
  if (kind === 'sql') return SQL_CELL_TEMPLATE;
  return '';
}
