/**
 * Static detection of markdown cells.
 *
 * A cell whose code is a single `mo.md(<string literal>)` expression is prose,
 * not code: the view renders its text with Obsidian's own markdown engine and
 * keeps the Python wrapper out of sight. The parser is deliberately narrow —
 * anything it does not fully understand (interpolation, multiple statements,
 * unknown escapes it cannot decode) returns `null` and the cell stays a normal
 * editable cell driven by the kernel output.
 */

export interface MarkdownCellSource {
  /** The decoded markdown text, dedented for rendering. */
  markdown: string;
  /** String prefix on the literal: `''` for a plain string, `'f'` for f-strings. */
  prefix: '' | 'f';
}

/**
 * Serialize markdown text back into the `mo.md(...)` call the .py file stores.
 *
 * The view edits markdown cells as bare markdown (the way the marimo editor
 * does); this is the write-back half of that round trip. The literal is laid
 * out inline — the text starts right after the opening quotes — so parsing it
 * again takes the verbatim branch and returns exactly the input text. An
 * f-string prefix round-trips too: braces are doubled so Python interpolates
 * what the kernel expects and keeps literal braces literal.
 */
export function encodeMarkdownCell(markdown: string, prefix: '' | 'f' = ''): string {
  if (markdown === '') return prefix ? `mo.md(${prefix}"")` : 'mo.md("")';
  let body = markdown
    // Doubled backslashes decode to single ones; this also keeps a trailing
    // backslash from swallowing the closing quote. (Must run first: every
    // escape inserted below would otherwise be doubled too.)
    .replace(/\\/g, '\\\\')
    // A leading newline would mark the literal as block-style and trigger
    // dedenting; escaping it keeps the literal inline and the text verbatim.
    .replace(/^\n/, '\\n')
    // A quote run of three or more would end the literal early.
    .replace(/"{3,}/g, run => '\\"'.repeat(run.length))
    // Any quote directly before the closing terminator shifts its position.
    .replace(/"+$/, run => '\\"'.repeat(run.length));
  if (prefix === 'f') {
    // Python f-strings decode `{{` to `{`; doubling keeps the decoded text
    // identical whether the kernel interpolates the braces or not.
    body = body.replace(/\{/g, '{{').replace(/\}/g, '}}');
  }
  return `mo.md(${prefix}"""${body}""")`;
}

const ESCAPES: Record<string, string> = {
  n: '\n',
  t: '\t',
  r: '\r',
  '\\': '\\',
  "'": "'",
  '"': '"',
  a: '\x07',
  b: '\b',
  f: '\f',
  v: '\v',
  0: '\0',
};

interface Literal {
  text: string;
  end: number;
  /** True for `f` strings, whose braces may interpolate. */
  interpolated: boolean;
  /** Normalized prefix characters in source order (`'f'`, `'r'`, `'rf'`, …). */
  prefix: string;
  /** True when the source text starts with a newline: the block-string style. */
  block: boolean;
}

/** Parse one Python string literal starting at `start`; `end` points past it. */
function readLiteral(code: string, start: number): Literal | null {
  let index = start;
  let raw = false;
  let interpolated = false;
  let prefix = '';
  // String prefix: combinations of r/f in either order or case.
  while (index < code.length) {
    const char = code[index]!.toLowerCase();
    if (char === 'r' && !raw) {raw = true; prefix += 'r'; index += 1; continue;}
    if (char === 'f' && !interpolated) {interpolated = true; prefix += 'f'; index += 1; continue;}
    break;
  }
  const quote = code[index];
  if (quote !== '"' && quote !== "'") return null;
  const triple = code.slice(index, index + 3) === quote.repeat(3);
  const terminator = triple ? quote.repeat(3) : quote;
  let from = triple ? index + 3 : index + 1;
  // The block-string style `"""\n…\n"""` is the one humans indent; an inline
  // literal (`"""# Title…`) is taken verbatim, which is what our own encoder
  // writes and what keeps its round trip exact.
  const block = code[from] === '\n';
  let text = '';
  while (from < code.length) {
    if (code.startsWith(terminator, from)) {
      // A single-quoted literal cannot span lines (source newlines were
      // rejected below); a decoded `\n` escape is perfectly legal.
      return {text, end: from + terminator.length, interpolated, prefix, block};
    }
    const char = code[from]!;
    if (char === '\n' && !triple) return null;
    if (interpolated) {
      // Doubled braces are literal braces; a single one starts an
      // interpolation expression this static reader must not evaluate.
      if (char === '{') {
        if (code[from + 1] === '{') {text += '{'; from += 2; continue;}
        return null;
      }
      if (char === '}') {
        if (code[from + 1] === '}') {text += '}'; from += 2; continue;}
        return null;
      }
    }
    if (char === '\\' && !raw) {
      const next = code[from + 1];
      if (next === undefined) return null;
      // A backslash before a real newline continues the line.
      if (next === '\n') {from += 2; continue;}
      const decoded = ESCAPES[next];
      if (decoded === undefined) {
        // Unknown escapes stay verbatim, matching Python's own behaviour.
        text += `\\${next}`;
      } else text += decoded;
      from += 2;
      continue;
    }
    if (raw && char === '\\' && code[from + 1] === quote) {
      // In a raw string a backslash still escapes the quote for tokenization.
      text += `\\${quote}`;
      from += 2;
      continue;
    }
    text += char;
    from += 1;
  }
  return null;
}

/** Remove the common leading indentation and blank edges, for rendering. */
function dedent(text: string): string {
  const stripped = text.replace(/^\n+/, '').replace(/\s+$/, '');
  const lines = stripped.split('\n');
  let margin: string | null = null;
  for (const line of lines) {
    if (!line.trim()) continue;
    const indent = line.match(/^[ \t]*/)?.[0] ?? '';
    if (margin === null || indent.length < margin.length) margin = indent;
  }
  if (!margin) return stripped;
  return lines.map(line => line.startsWith(margin!) ? line.slice(margin!.length) : line).join('\n');
}

export function parseMarkdownCell(code: string): MarkdownCellSource | null {
  const lines = code.split('\n');
  let start = 0;
  let end = lines.length;
  // Leading and trailing whole-line comments do not make the cell dynamic.
  while (start < end && lines[start]!.trim().startsWith('#')) start += 1;
  while (end > start && (lines[end - 1]!.trim() === '' || lines[end - 1]!.trim().startsWith('#'))) end -= 1;
  const body = lines.slice(start, end).join('\n').trim();
  if (!body.startsWith('mo.md')) return null;
  const call = body.slice('mo.md'.length);
  let index = 0;
  while (index < call.length && /\s/.test(call[index]!)) index += 1;
  if (call[index] !== '(') return null;
  index += 1;
  while (index < call.length && /\s/.test(call[index]!)) index += 1;
  const literal = readLiteral(call, index);
  if (!literal) return null;
  index = literal.end;
  while (index < call.length && /\s/.test(call[index]!)) index += 1;
  if (call[index] !== ')') return null;
  index += 1;
  // Only whitespace or a trailing comment may follow.
  const rest = call.slice(index).trim();
  if (rest && !rest.startsWith('#')) return null;
  // A literal laid out inline keeps every character, including any indent —
  // that is the exactness contract with `encodeMarkdownCell`. Only the f
  // prefix participates in the round trip; the encoder never writes raw
  // strings, so r-prefixed literals keep their pre-existing lossy edit path.
  return {
    markdown: literal.block ? dedent(literal.text) : literal.text,
    prefix: literal.interpolated ? 'f' : '',
  };
}

export interface OutlineEntry {
  /** Heading depth, 1 for `#` through 6 for `######`. */
  level: number;
  /** Heading text with inline markers stripped, ready for a nav label. */
  text: string;
}

/**
 * Headings of a markdown document, for the outline rail. Fenced code blocks
 * are skipped so `#` comments inside them never become navigation entries.
 */
export function outlineEntries(markdown: string): OutlineEntry[] {
  const entries: OutlineEntry[] = [];
  let fence: string | null = null;
  for (const line of markdown.split('\n')) {
    const opening = line.match(/^\s*(`{3,}|~{3,})/);
    if (opening) {
      const marker = opening[1]![0]!;
      fence = fence === null ? marker : fence === marker ? null : fence;
      continue;
    }
    if (fence) continue;
    const heading = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (!heading) continue;
    const text = heading[2]!
      // Links keep their label; emphasis markers disappear.
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/[*_`~]/g, '')
      .trim();
    if (text) entries.push({level: heading[1]!.length, text});
  }
  return entries;
}
