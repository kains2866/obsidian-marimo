import {test} from 'node:test';
import assert from 'node:assert/strict';
import {NOTEBOOK_TEMPLATE, nextNotebookPath} from '../src/notebook-file.ts';

const nothing = () => false;
const only = (...paths: string[]) => (path: string) => paths.includes(path);

test('a new notebook lands in the requested folder with a free name', () => {
  assert.equal(nextNotebookPath('', nothing), 'Untitled marimo.py');
  assert.equal(nextNotebookPath('/', nothing), 'Untitled marimo.py');
  assert.equal(nextNotebookPath('notes', nothing), 'notes/Untitled marimo.py');
  assert.equal(nextNotebookPath('notes/', nothing), 'notes/Untitled marimo.py');
  assert.equal(nextNotebookPath('a/b/c', nothing), 'a/b/c/Untitled marimo.py');
});

test('a taken name is never overwritten', () => {
  assert.equal(nextNotebookPath('', only('Untitled marimo.py')), 'Untitled marimo 1.py');
  assert.equal(
    nextNotebookPath('notes', only('notes/Untitled marimo.py', 'notes/Untitled marimo 1.py')),
    'notes/Untitled marimo 2.py',
  );
  // A file that only exists in another folder does not block this one.
  assert.equal(nextNotebookPath('notes', only('Untitled marimo.py')), 'notes/Untitled marimo.py');
});

test('numbering skips over gaps instead of packing into the first hole', () => {
  assert.equal(
    nextNotebookPath('', only('Untitled marimo.py', 'Untitled marimo 2.py')),
    'Untitled marimo 1.py',
  );
});

test('an endless collision reports failure instead of looping forever', () => {
  assert.throws(() => nextNotebookPath('', () => true), /Untitled marimo/);
});

test('the template is a minimal marimo notebook the preview can parse', () => {
  assert.match(NOTEBOOK_TEMPLATE, /^import marimo\n/);
  assert.match(NOTEBOOK_TEMPLATE, /__generated_with = "0\.25\.2"/);
  assert.match(NOTEBOOK_TEMPLATE, /app = marimo\.App\(\)/);
  assert.match(NOTEBOOK_TEMPLATE, /@app\.cell\ndef _\(\):\n {4}import marimo as mo\n\n {4}return \(mo,\)/);
  assert.match(NOTEBOOK_TEMPLATE, /if __name__ == "__main__":\n {4}app\.run\(\)/);
  // A one-line body would be rejected by the static preview.
  assert.doesNotMatch(NOTEBOOK_TEMPLATE, /def _\([^)]*\): ./);
  assert.ok(NOTEBOOK_TEMPLATE.endsWith('\n'));
});
