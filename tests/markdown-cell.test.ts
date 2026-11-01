import {test} from 'node:test';
import assert from 'node:assert/strict';
import {encodeMarkdownCell, outlineEntries, parseMarkdownCell} from '../src/markdown-cell.ts';

test('a plain mo.md call with a double-quoted literal is markdown', () => {
  assert.deepEqual(parseMarkdownCell('mo.md("# Hi")'), {markdown: '# Hi', prefix: ''});
});

test('single quotes and surrounding whitespace are accepted', () => {
  assert.deepEqual(parseMarkdownCell("  mo.md( '## list' )  \n"), {markdown: '## list', prefix: ''});
});

test('a triple-quoted body keeps its newlines and is dedented', () => {
  const code = 'mo.md(\n    """\n    ## Rich body\n\n    - one\n    - two\n    """\n)';
  assert.deepEqual(parseMarkdownCell(code), {markdown: '## Rich body\n\n- one\n- two', prefix: ''});
});

test('escape sequences are decoded like Python would', () => {
  assert.deepEqual(parseMarkdownCell('mo.md("a\\nb\\tc\\\\d\\"e")'), {markdown: 'a\nb\tc\\d"e', prefix: ''});
  // A line continuation folds into one line.
  assert.deepEqual(parseMarkdownCell('mo.md("one\\\ntwo")'), {markdown: 'onetwo', prefix: ''});
});

test('an unknown escape is kept verbatim', () => {
  assert.deepEqual(parseMarkdownCell('mo.md("\\q")'), {markdown: '\\q', prefix: ''});
});

test('a raw string keeps backslashes and rejects a trailing one', () => {
  assert.deepEqual(parseMarkdownCell('mo.md(r"C:\\path\\section")'), {markdown: 'C:\\path\\section', prefix: ''});
  assert.equal(parseMarkdownCell('mo.md(r"ends\\")'), null);
});

test('a slot-free f-string normalizes to a plain string', () => {
  // Without interpolation slots an f-string renders exactly like a plain
  // string, so the view encodes it as one and keeps literal braces literal.
  assert.deepEqual(parseMarkdownCell('mo.md(f"plain")'), {markdown: 'plain', prefix: ''});
  // A doubled brace is a literal brace, not an interpolation slot.
  assert.deepEqual(parseMarkdownCell('mo.md(f"brace{{literal}}")'), {markdown: 'brace{literal}', prefix: ''});
  assert.deepEqual(parseMarkdownCell('mo.md(f"""# Hi""")'), {markdown: '# Hi', prefix: ''});
  assert.deepEqual(parseMarkdownCell('mo.md(F"plain")'), {markdown: 'plain', prefix: ''});
});

test('an interpolated f-string is dynamic markdown with the f prefix', () => {
  // The slot survives decoding verbatim: the editor shows `{result}` and the
  // kernel evaluates it.
  assert.deepEqual(parseMarkdownCell('mo.md(f"doubled={x}")'), {markdown: 'doubled={x}', prefix: 'f'});
  assert.deepEqual(parseMarkdownCell('mo.md(f"## {a} and {obj.attr}")'), {markdown: '## {a} and {obj.attr}', prefix: 'f'});
  // An unterminated slot is not representable.
  assert.equal(parseMarkdownCell('mo.md(f"broken {x")'), null);
  // A single `}` cannot occur in a Python f-string.
  assert.equal(parseMarkdownCell('mo.md(f"stray } brace")'), null);
});

test('a leading comment line is allowed', () => {
  assert.deepEqual(parseMarkdownCell('# the intro\nmo.md("# Hi")'), {markdown: '# Hi', prefix: ''});
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
  assert.deepEqual(parseMarkdownCell('mo.md("""    indented code""")'), {markdown: '    indented code', prefix: ''});
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
  assert.deepEqual(parseMarkdownCell(code), {markdown: '# Hi\n\nbody', prefix: ''});
});

test('empty markdown encodes to a plain empty literal', () => {
  assert.equal(encodeMarkdownCell(''), 'mo.md("")');
  assert.deepEqual(parseMarkdownCell('mo.md("")'), {markdown: '', prefix: ''});
});

// ----------------------------------------------------------------- f-string

test('f-string encoding keeps slots single and doubles literal braces', () => {
  const code = encodeMarkdownCell('value {x} stays', 'f');
  assert.match(code, /^mo\.md\(f"""/);
  // The interpolation slot must survive: the kernel keeps evaluating it.
  assert.match(code, /value \{x\} stays/);
  const parsed = parseMarkdownCell(code);
  assert.deepEqual(parsed, {markdown: 'value {x} stays', prefix: 'f'});
});

test('f-string round trip holds for mixed slot and literal braces', () => {
  // Text always round-trips exactly; the reported prefix reflects whether
  // the decoded text still carries an interpolation slot.
  const dynamic: Array<[string, string]> = [
    ['{result} and { literal', 'f'],
    ['{{a}}', 'f'],
    ['{a} }{b}', 'f'],
    ['{a}{', 'f'],
    ['{a}}', 'f'],
    ['}{a}{', 'f'],
    ['{a{b}', 'f'],
    ['{x:{w}}', 'f'],
    ['{}', ''],
    ['{0}', ''],
    ['no braces', ''],
  ];
  for (const [text, prefix] of dynamic) {
    const parsed = parseMarkdownCell(encodeMarkdownCell(text, 'f'));
    assert.deepEqual(parsed, {markdown: text, prefix}, text);
  }
});

test('plain encoding keeps braces literal and reports no prefix', () => {
  const parsed = parseMarkdownCell(encodeMarkdownCell('a {b} c'));
  assert.deepEqual(parsed, {markdown: 'a {b} c', prefix: ''});
});

test('a stored f-string without slots reports no prefix', () => {
  assert.deepEqual(parseMarkdownCell('mo.md(f"""# Hi""")'), {markdown: '# Hi', prefix: ''});
});

// ------------------------------------------------------------------ outline

test('outlineEntries lists headings with depth and clean labels', () => {
  const entries = outlineEntries('# One\n\ntext\n## Two *emphasised*\n### [Link](https://x) head\n#### Four `code`');
  assert.deepEqual(entries, [
    {level: 1, text: 'One'},
    {level: 2, text: 'Two emphasised'},
    {level: 3, text: 'Link head'},
    {level: 4, text: 'Four code'},
  ]);
});

test('outlineEntries skips headings inside fenced code', () => {
  const entries = outlineEntries('# Real\n\n```python\n# not a heading\n```\n\n~~~\n# also not\n~~~\n\n## After');
  assert.deepEqual(entries, [{level: 1, text: 'Real'}, {level: 2, text: 'After'}]);
});

test('outlineEntries ignores close fences of the wrong marker', () => {
  const entries = outlineEntries('# A\n\n```\nstill code ~~~\n```\n\n## B');
  assert.deepEqual(entries, [{level: 1, text: 'A'}, {level: 2, text: 'B'}]);
});
