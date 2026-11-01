/**
 * Ordering rules for notebook cells.
 *
 * The array order *is* the file order: marimo's save endpoint writes cells in
 * the order it receives them. These helpers therefore never drop or duplicate a
 * cell, and clamp out-of-range targets instead of failing the interaction.
 */
import type {Cell} from './protocol';

function clamp(index: number, length: number): number {
  if (!Number.isFinite(index)) return 0;
  return Math.min(Math.max(Math.trunc(index), 0), length);
}

/** Move one cell to another slot; a target outside the list is ignored. */
export function moveCell(cells: Cell[], from: number, to: number): Cell[] {
  if (from < 0 || from >= cells.length || to < 0 || to >= cells.length || from === to) return cells.slice();
  const next = cells.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/** Insert a cell at `index`, clamped so the result always contains every cell. */
export function insertCell(cells: Cell[], cell: Cell, index: number): Cell[] {
  const next = cells.slice();
  next.splice(clamp(index, next.length), 0, cell);
  return next;
}

export function removeCell(cells: Cell[], id: string): Cell[] {
  return cells.filter(cell => cell.id !== id);
}

/**
 * The cell a "run and move on" gesture should focus next. The last cell has no
 * successor: the caller keeps the focus where it is instead of jumping away.
 */
export function nextCellId(cells: Cell[], id: string): string | null {
  const index = cells.findIndex(cell => cell.id === id);
  if (index < 0 || index >= cells.length - 1) return null;
  return cells[index + 1].id;
}
