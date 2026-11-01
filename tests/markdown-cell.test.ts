import {test} from 'node:test';
import assert from 'node:assert/strict';
import {encodeMarkdownCell, parseMarkdownCell} from '../src/markdown-cell.ts';

test('a plain mo.md call with a double-quoted literal is markdown', () => {
  assert.deepEqual(parseMarkdownCell('mo.md("# Hi")'), {markdown: '# Hi'});
});

test('single quotes and surrounding whitespace are accepted', () => {
  assert.deepEqual(parseMarkdownCell("  mo.md( '## list' )  \n"), {markdown: '## list'});
});

test('a triple-quoted body keeps its newlines and is dedented', () => {
  const code = 'mo.md(\n    """\n    ## Rich body\n\n    - one\n    - two\n    """\n)';
  assert.deepEqual(parseMarkdownCell(code), {markdown: '## Rich body\n\n- one\n- two'});
});

test('escape sequences are decoded like Python would', () => {
  assert.deepEqual(parseMarkdownCell('mo.md("a\\nb\\tc\\\\d\\"e")'), {markdown: 'a\nb\tc\\d"e'});
  // A line continuation folds into one line.
  assert.deepEqual(parseMarkdownCell('mo.md("one\\\ntwo")'), {markdown: 'onetwo'});
});

test('an unknown escape is kept verbatim', () => {
  assert.deepEqual(parseMarkdownCell('mo.md("\\q")'), {markdown: '\\q'});
});

test('a raw string keeps backslashes and rejects a trailing one', () => {
  assert.deepEqual(parseMarkdownCell('mo.md(r"C:\\path\\section")'), {markdown: 'C:\\path\\section'});
  assert.equal(parseMarkdownCell('mo.md(r"ends\\")'), null);
});

test('an f-string without interpolation is markdown; with interpolation it is not', () => {
  assert.deepEqual(parseMarkdownCell('mo.md(f"plain")'), {markdown: 'plain'});
  // A doubled brace is a literal brace, not an interpolation slot.
  assert.deepEqual(parseMarkdownCell('mo.md(f"brace{{literal}}")'), {markdown: 'brace{literal}'});
  assert.equal(parseMarkdownCell('mo.md(f"doubled={x}")'), null);
});

test('a leading comment line is allowed', () => {
  assert.deepEqual(parseMarkdownCell('# the intro\nmo.md("# Hi")'), {markdown: '# Hi'});
});

test('anything that is not a single markdown literal is rejected', () => {
  assert.equal(parseMarkdownCell('mo.md(x)'), null);
  assert.equal(parseMarkdownCell('mo.md()'), null);
  assert.equal(parseMarkdownCell('mo.md("a", "b")'), null);
  assert.equal(parseMarkdownCell('mo.md("a")\nprint(1)'), null);
  assert.equal(parseMarkdownCell('x = mo.md("a")'), null);
  assert.equal(parseMarkdownCell('mo.md("unclosed)'), null);
  assert.equal(parseMarkdownCell('print("# hi")'), null);
  assert.equal(parseMarkdownCell(''), null);
  // An implicit top-level string is not treated as markdown: the kernel
  // renders it as a repr, so the view must not diverge.
  assert.equal(parseMarkdownCell('"Implicit top-level string"'), null);
  assert.equal(parseMarkdownCell('mo.vstack([x])'), null);
});

test('a multi-parameter call inside the parens is rejected', () => {
  assert.equal(parseMarkdownCell('mo.md("a", justify="left")'), null);
});

test('an inline literal is taken verbatim, without dedenting', () => {
  // The encoder writes inline literals; their text must round-trip exactly,
  // including any indentation a reader might mistake for a block string.
  assert.deepEqual(parseMarkdownCell('mo.md("""    indented code""")'), {markdown: '    indented code'});
});

// ---------------------------------------------------------------- encoder

const cases: string[] = [
  '# Hi',
  'line one\n\nline two',
  'ends with a "quote"',
  'a \\ b',
  'trailing backslash \\',
  'triple """ quotes',
  'both """ and \'\'\' marks',
  'trailing ""',
  'trailing "',
  'starts with\na newline',
  '\nleading blank line',
  'text\n',
  'trailing spaces   ',
  '    all lines indented\n    like a code block',
  'unicode: 标题 «guillemets» — dash',
  'mixed\r\ncrlf',
];

test('encodeMarkdownCell round-trips through parseMarkdownCell exactly', () => {
  for (const markdown of cases) {
    const parsed = parseMarkdownCell(encodeMarkdownCell(markdown));
    assert.notEqual(parsed, null, `round trip failed for ${JSON.stringify(markdown)}`);
    assert.equal(parsed!.markdown, markdown, `round trip changed ${JSON.stringify(markdown)}`);
  }
});

test('encodeMarkdownCell output is valid single-call python', () => {
  const code = encodeMarkdownCell('# Hi\n\nbody');
  assert.match(code, /^mo\.md\(/);
  assert.match(code, /\)$/);
  // The kernel-visible wrapper stays one expression on the stored cell.
  assert.deepEqual(parseMarkdownCell(code), {markdown: '# Hi\n\nbody'});
});

test('empty markdown encodes to a plain empty literal', () => {
  assert.equal(encodeMarkdownCell(''), 'mo.md("")');
  assert.deepEqual(parseMarkdownCell('mo.md("")'), {markdown: ''});
});
