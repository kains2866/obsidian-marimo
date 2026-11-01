import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CELL_CONFIG,
  cellPresentation,
  mergeCellConfig,
  readCellConfig,
  wireConfig,
} from '../src/cell-config.ts';

test('a missing or malformed config falls back to marimo defaults', () => {
  assert.deepEqual(readCellConfig(undefined), DEFAULT_CELL_CONFIG);
  assert.deepEqual(readCellConfig(null), DEFAULT_CELL_CONFIG);
  assert.deepEqual(readCellConfig('nope'), DEFAULT_CELL_CONFIG);
  assert.deepEqual(readCellConfig({}), DEFAULT_CELL_CONFIG);
  // Wrong types must not leak into a request payload.
  assert.deepEqual(readCellConfig({disabled: 'yes', hide_code: 1, column: 'x', expand_output: null}), DEFAULT_CELL_CONFIG);
});

test('the kernel sends snake_case configs; camelCase is accepted too', () => {
  const wire = {column: 2, disabled: true, hide_code: true, expand_output: true};
  assert.deepEqual(readCellConfig(wire), {column: 2, disabled: true, hideCode: true, expandOutput: true});
  assert.deepEqual(
    readCellConfig({column: null, disabled: false, hideCode: true, expandOutput: false}),
    {column: null, disabled: false, hideCode: true, expandOutput: false},
  );
});

test('a partial update keeps every other field', () => {
  const base = {column: 1, disabled: true, hideCode: false, expandOutput: true};
  assert.deepEqual(mergeCellConfig(base, {hideCode: true}), {column: 1, disabled: true, hideCode: true, expandOutput: true});
  assert.deepEqual(mergeCellConfig(base, {}), base);
  // Merging must never mutate the stored config.
  assert.deepEqual(base, {column: 1, disabled: true, hideCode: false, expandOutput: true});
});

test('the request payload uses the keys the pinned protocol expects', () => {
  assert.deepEqual(wireConfig({column: null, disabled: false, hideCode: true, expandOutput: false}), {
    column: null,
    disabled: false,
    hide_code: true,
    expand_output: false,
  });
});

test('presentation derives from config, not from the current run phase', () => {
  assert.deepEqual(cellPresentation(DEFAULT_CELL_CONFIG), {hideCode: false, disabled: false, clampOutput: true});
  assert.deepEqual(cellPresentation({column: null, disabled: true, hideCode: true, expandOutput: true}), {
    hideCode: true,
    disabled: true,
    clampOutput: false,
  });
});
