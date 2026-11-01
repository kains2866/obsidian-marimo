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
}

/** Parse one Python string literal starting at `start`; `end` points past it. */
function readLiteral(code: string, start: number): Literal | null {
  let index = start;
  let raw = false;
  let interpolated = false;
  // String prefix: combinations of r/f in either order or case.
  while (index < code.length) {
    const char = code[index]!.toLowerCase();
    if (char === 'r' && !raw) {raw = true; index += 1; continue;}
    if (char === 'f' && !interpolated) {interpolated = true; index += 1; continue;}
    break;
  }
  const quote = code[index];
  if (quote !== '"' && quote !== "'") return null;
  const triple = code.slice(index, index + 3) === quote.repeat(3);
  const terminator = triple ? quote.repeat(3) : quote;
  let from = triple ? index + 3 : index + 1;
  let text = '';
  while (from < code.length) {
    if (code.startsWith(terminator, from)) {
      // A single-quoted literal cannot span lines (source newlines were
      // rejected below); a decoded `\n` escape is perfectly legal.
      return {text, end: from + terminator.length, interpolated};
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
  return {markdown: dedent(literal.text)};
}
