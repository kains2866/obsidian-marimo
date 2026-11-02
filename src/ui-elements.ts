/**
 * Reading marimo's interactive elements without its frontend.
 *
 * marimo renders `mo.ui.*` as a custom element carrying its whole state in
 * attributes (`marimo 0.25.2`, `_plugins/core/web_component.py`):
 *
 *   <marimo-ui-element object-id='MJUe-0'><marimo-slider data-initial-value='3' ...></marimo-slider></marimo-ui-element>
 *
 * Attribute text is JSON, HTML-escaped, with backslashes and dollar signs
 * written as numeric entities. This module turns that markup into typed
 * descriptors and turns native control state back into the values the kernel's
 * `set_ui_element_value` endpoint expects. Pure functions only: no DOM, no host.
 */

/** A widget marimo knows about, as described by one `marimo-ui-element`. */
export interface UiElement {
  /** Kernel-side identity used when writing a value back. */
  objectId: string;
  /** Stable id for the element instance; not needed for writes. */
  randomId: string;
  /** `marimo-range-slider` -> `range-slider`. */
  kind: string;
  /** Decoded `data-*` attributes, keyed in camelCase. */
  attrs: Record<string, unknown>;
}

/** Kinds with a native control; anything else is reported, never faked. */
const SUPPORTED = new Set([
  'slider', 'range-slider', 'number', 'text', 'text-area', 'checkbox', 'switch',
  'radio', 'dropdown', 'multiselect', 'date', 'datetime', 'button', 'tabs',
  'form', 'table',
  // The converter itself is a React app; this frontend shows a read-only
  // structure preview, which is more useful than an "unsupported" line.
  'dataframe',
]);

export function isSupportedWidget(kind: string): boolean {
  return SUPPORTED.has(kind);
}

const ENTITIES: Record<string, string> = {
  '&#92;': '\\',
  '&#36;': '$',
  '&quot;': '"',
  '&#39;': "'",
  '&#x27;': "'",
  '&nbsp;': ' ',
  '&lt;': '<',
  '&gt;': '>',
  // `&amp;` last: it must not turn `&amp;quot;` into a quote.
  '&amp;': '&',
};

function unescapeEntities(text: string): string {
  return text.replace(/&(?:#92|#36|quot|#39|#x27|nbsp|lt|gt|amp);/g, entity => ENTITIES[entity] ?? entity);
}

/** Decode one attribute: JSON when it parses, its text otherwise. */
export function decodeAttribute(raw: string | null | undefined): unknown {
  if (raw === null || raw === undefined) return undefined;
  const text = unescapeEntities(String(raw)).trim();
  if (!text) return '';
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function camelCase(name: string): string {
  return name.replace(/-([a-z0-9])/g, (_match, letter: string) => letter.toUpperCase());
}

function decodeAttributes(attributes: Record<string, string>): Record<string, unknown> {
  const decoded: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(attributes)) {
    if (!name.toLowerCase().startsWith('data-')) continue;
    decoded[camelCase(name.slice(5).toLowerCase())] = decodeAttribute(value);
  }
  return decoded;
}

/**
 * Read one element. Returns `null` for the wrapper itself, for anything that is
 * not a marimo custom element, and for widgets without an object id — those
 * cannot be written back and must not pretend to be interactive.
 */
export function readUiElement(tagName: string, attributes: Record<string, string>): UiElement | null {
  const tag = tagName.trim().toLowerCase();
  if (!tag.startsWith('marimo-') || tag === 'marimo-ui-element' || tag === 'marimo-') return null;
  const objectId = (attributes['object-id'] ?? '').trim();
  if (!objectId) return null;
  return {objectId, randomId: (attributes['random-id'] ?? '').trim(), kind: tag.slice('marimo-'.length), attrs: decodeAttributes(attributes)};
}

/** One widget taken out of an output, with the markup it wrapped. */
export interface WidgetMarkup {
  element: UiElement;
  /** Raw inner markup: tab panes, or the element a form submits. */
  innerHtml: string;
}

const OPEN_TAG = '<marimo-ui-element';
const CLOSE_TAG = '</marimo-ui-element>';

/** Index of the `>` closing a start tag, respecting quoted attribute values. */
function tagEnd(html: string, from: number): number {
  let quote: string | null = null;
  for (let index = from; index < html.length; index += 1) {
    const char = html[index];
    if (quote) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {quote = char; continue;}
    if (char === '>') return index;
  }
  return -1;
}

function parseAttributes(text: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const pattern = /([^\s=<>/]+)\s*=\s*(?:'([^']*)'|"([^"]*)")/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) attributes[match[1]] = match[2] ?? match[3] ?? '';
  return attributes;
}

/** Index of the `</marimo-ui-element>` matching the wrapper that opened before `from`. */
function wrapperEnd(html: string, from: number): number {
  let depth = 1;
  let index = from;
  while (index < html.length) {
    const open = html.indexOf(OPEN_TAG, index);
    const close = html.indexOf(CLOSE_TAG, index);
    if (close < 0) return -1;
    if (open >= 0 && open < close) {depth += 1; index = open + OPEN_TAG.length; continue;}
    depth -= 1;
    if (depth === 0) return close;
    index = close + CLOSE_TAG.length;
  }
  return -1;
}

/**
 * The widget a wrapper holds: `<marimo-ui-element><marimo-slider ...></marimo-slider></marimo-ui-element>`.
 * The object id lives on the wrapper, the component and its state on the child.
 */
function readWrapper(wrapper: Record<string, string>, inner: string): WidgetMarkup | null {
  const objectId = (wrapper['object-id'] ?? '').trim();
  if (!objectId) return null;
  const opening = /^\s*<([a-zA-Z][\w-]*)/.exec(inner);
  if (!opening) return null;
  const tag = opening[1].toLowerCase();
  if (!tag.startsWith('marimo-') || tag === 'marimo-ui-element') return null;
  const end = tagEnd(inner, opening[0].length);
  if (end < 0) return null;
  const attributes = parseAttributes(inner.slice(opening[0].length, end));
  const closeAt = inner.lastIndexOf(`</${tag}>`);
  return {
    element: {objectId, randomId: (wrapper['random-id'] ?? '').trim(), kind: tag.slice('marimo-'.length), attrs: decodeAttributes(attributes)},
    innerHtml: closeAt > end ? inner.slice(end + 1, closeAt) : '',
  };
}

/**
 * Lift every widget out of an output string, leaving a slot element the host's
 * sanitizer keeps. Custom elements cannot survive `sanitizeHTMLToDom`, so the
 * markup has to be read here — before the fragment is ever sanitized.
 */
export function extractUiElements(html: string): {html: string; widgets: WidgetMarkup[]} {
  const widgets: WidgetMarkup[] = [];
  let output = '';
  let cursor = 0;
  while (true) {
    const start = html.indexOf(OPEN_TAG, cursor);
    if (start < 0) {output += html.slice(cursor); break;}
    const end = tagEnd(html, start + OPEN_TAG.length);
    const close = end < 0 ? -1 : wrapperEnd(html, end + 1);
    if (end < 0 || close < 0) {
      // Unbalanced markup is not a widget; leave it for the sanitizer to strip.
      output += html.slice(cursor);
      break;
    }
    const wrapper = parseAttributes(html.slice(start + OPEN_TAG.length, end));
    const markup = readWrapper(wrapper, html.slice(end + 1, close));
    output += html.slice(cursor, start);
    if (markup) {
      output += `<span data-widget-slot="${widgets.length}"></span>`;
      widgets.push(markup);
    }
    cursor = close + CLOSE_TAG.length;
  }
  return {html: output, widgets};
}

/** Labels arrive as rendered markdown; native controls need their text. */
export function labelText(raw: unknown): string {
  if (typeof raw !== 'string' || !raw) return '';
  const text = unescapeEntities(raw.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
  return text;
}

export interface WidgetOption {
  label: string;
  /** Value sent to the kernel: marimo selects by option *name*. */
  value: string;
}

/** Dropdown/radio options; mapped values still select by their name. */
export function optionLabels(raw: unknown): WidgetOption[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(item => {
    if (item && typeof item === 'object') {
      const record = item as Record<string, unknown>;
      const label = typeof record.label === 'string' ? record.label : String(record.value ?? '');
      return {label, value: label};
    }
    return {label: String(item), value: String(item)};
  }).filter(option => option.label !== '');
}

/** `data-data` holds a JSON string that itself holds the rows. */
export function tableRows(raw: unknown): Record<string, unknown>[] {
  let value = typeof raw === 'string' ? decodeAttribute(raw) : raw;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) return [];
  return value.filter((row): row is Record<string, unknown> => !!row && typeof row === 'object' && !Array.isArray(row));
}

/** Client-side ordering for a `mo.ui.table`; null keeps the data order. */
export interface TableSort {column: string;direction: 'asc'|'desc'}

export interface TableViewModelRow {index: number;cells: Record<string, unknown>}

/**
 * Search + sort over the rows *without losing the original row numbers*:
 * selection writes back indices into the full data, so a visible row must
 * carry the index it had before filtering. Numbers compare numerically,
 * everything else case-insensitively by text; unknown columns and empty
 * queries degrade to the identity order.
 */
export function tableViewModel(
  rows: Record<string, unknown>[],
  query: string,
  sort: TableSort|null,
  limit: number,
): {columns: string[];rows: TableViewModelRow[]} {
  const columns = rows.length ? Object.keys(rows[0]) : [];
  const needle = query.trim().toLowerCase();
  let visible = rows.map((cells, index) => ({index, cells}));
  if (needle) {
    visible = visible.filter(entry => columns.some(column => {
      const value = entry.cells[column];
      return value !== null && value !== undefined && String(value).toLowerCase().includes(needle);
    }));
  }
  if (sort && columns.includes(sort.column)) {
    const column = sort.column;
    const factor = sort.direction === 'desc' ? -1 : 1;
    visible = visible.slice().sort((a, b) => {
      const left = a.cells[column];
      const right = b.cells[column];
      const leftNumber = typeof left === 'number' || (typeof left === 'string' && left.trim() !== '' && Number.isFinite(Number(left))) ? Number(left) : null;
      const rightNumber = typeof right === 'number' || (typeof right === 'string' && right.trim() !== '' && Number.isFinite(Number(right))) ? Number(right) : null;
      if (leftNumber !== null && rightNumber !== null) return factor * (leftNumber - rightNumber);
      if (leftNumber !== null) return -factor;
      if (rightNumber !== null) return factor;
      return factor * String(left ?? '').localeCompare(String(right ?? ''), undefined, {sensitivity: 'base'});
    });
  }
  return {columns, rows: visible.slice(0, limit)};
}

/** Tab titles arrive as rendered markdown, one per tab. */
export function tabsLabels(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(labelText);
}

/**
 * Native control state -> the value `/api/kernel/set_ui_element_value` expects.
 * Each shape mirrors the component's own `_convert_value` in the pinned version.
 */
export function valueForWidget(kind: string, input: unknown): unknown {
  switch (kind) {
    case 'slider':
    case 'number': {
      const numeric = typeof input === 'number' ? input : Number(input);
      return Number.isFinite(numeric) ? numeric : 0;
    }
    case 'button': {
      const clicks = Number(input);
      return Number.isFinite(clicks) ? clicks : 0;
    }
    case 'range-slider':
      return Array.isArray(input) ? input.slice(0, 2).map(value => {
        const numeric = Number(value);
        return Number.isFinite(numeric) ? numeric : 0;
      }) : [];
    case 'checkbox':
    case 'switch':
      return Boolean(input);
    case 'text':
    case 'text-area':
    case 'radio':
    case 'date':
    case 'datetime':
    case 'tabs':
      return String(input ?? '');
    case 'dropdown':
      // A dropdown reports the set of selected option names, not the name itself.
      return input === null || input === undefined || input === '' ? [] : [String(input)];
    case 'multiselect':
      return Array.isArray(input) ? input.map(String) : [];
    case 'table':
      // Row selection writes back the selected row indices (list[int]), the
      // exact shape `table._convert_value` consumes in the pinned version.
      return Array.isArray(input) ? input.map(Number).filter(Number.isInteger) : [];
    default:
      return input;
  }
}
