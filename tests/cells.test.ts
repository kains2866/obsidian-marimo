import {test} from 'node:test';
import assert from 'node:assert/strict';
import {insertCell, moveCell, nextCellId, removeCell, splitCellCode} from '../src/cells.ts';
import type {Cell} from '../src/protocol.ts';

const cells: Cell[] = [
  {id: 'a', code: 'a = 1'},
  {id: 'b', code: 'b = 2'},
  {id: 'c', code: 'c = 3'},
];

test('moving a cell swaps it into the requested slot without losing any cell', () => {
  assert.deepEqual(moveCell(cells, 0, 2).map(cell => cell.id), ['b', 'c', 'a']);
  assert.deepEqual(moveCell(cells, 2, 0).map(cell => cell.id), ['c', 'a', 'b']);
  assert.deepEqual(moveCell(cells, 0, 1).map(cell => cell.id), ['b', 'a', 'c']);
});
test('a move that leaves the list is ignored instead of dropping a cell', () => {
  assert.deepEqual(moveCell(cells, 0, 3).map(cell => cell.id), ['a', 'b', 'c']);
  assert.deepEqual(moveCell(cells, 2, -1).map(cell => cell.id), ['a', 'b', 'c']);
  assert.deepEqual(moveCell(cells, -1, 0).map(cell => cell.id), ['a', 'b', 'c']);
  assert.deepEqual(moveCell(cells, 1, 1).map(cell => cell.id), ['a', 'b', 'c']);
});
test('moving must not mutate the previous order, which the view still renders', () => {
  const before = cells.map(cell => cell.id);
  moveCell(cells, 0, 2);
  assert.deepEqual(cells.map(cell => cell.id), before);
});
test('inserting clamps to the notebook bounds', () => {
  const fresh: Cell = {id: 'new', code: ''};
  assert.deepEqual(insertCell(cells, fresh, 1).map(cell => cell.id), ['a', 'new', 'b', 'c']);
  assert.deepEqual(insertCell(cells, fresh, 0).map(cell => cell.id), ['new', 'a', 'b', 'c']);
  assert.deepEqual(insertCell(cells, fresh, 99).map(cell => cell.id), ['a', 'b', 'c', 'new']);
  assert.deepEqual(insertCell(cells, fresh, -5).map(cell => cell.id), ['new', 'a', 'b', 'c']);
  assert.deepEqual(insertCell([], fresh, 3).map(cell => cell.id), ['new']);
});
test('removing drops exactly the requested cell and keeps the rest in order', () => {
  assert.deepEqual(removeCell(cells, 'b').map(cell => cell.id), ['a', 'c']);
  assert.deepEqual(removeCell(cells, 'missing').map(cell => cell.id), ['a', 'b', 'c']);
  assert.deepEqual(removeCell(cells, 'c').map(cell => cell.id), ['a', 'b']);
});

test('focusing the next cell stops at the end instead of wrapping', () => {
  assert.equal(nextCellId(cells, 'a'), 'b');
  assert.equal(nextCellId(cells, 'b'), 'c');
  assert.equal(nextCellId(cells, 'c'), null);
  assert.equal(nextCellId(cells, 'missing'), null);
});

test('splitting at the caret divides the code into two runnable halves', () => {
  assert.deepEqual(splitCellCode('a = 1\nb = 2', 5), {before: 'a = 1', after: 'b = 2'});
  // A caret at line start sends the whole line to the lower half.
  assert.deepEqual(splitCellCode('a = 1\nb = 2', 6), {before: 'a = 1', after: 'b = 2'});
  // Trailing/leading blank lines around the split collapse away.
  assert.deepEqual(splitCellCode('a = 1\n\n\nb = 2', 7), {before: 'a = 1', after: 'b = 2'});
});

test('splitting at the edges keeps one side empty instead of losing code', () => {
  assert.deepEqual(splitCellCode('a = 1', 0), {before: '', after: 'a = 1'});
  assert.deepEqual(splitCellCode('a = 1', 5), {before: 'a = 1', after: ''});
  assert.deepEqual(splitCellCode('a = 1', 99), {before: 'a = 1', after: ''});
  assert.deepEqual(splitCellCode('a = 1', -3), {before: '', after: 'a = 1'});
});
