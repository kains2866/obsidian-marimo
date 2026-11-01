export interface Cell {id: string; code: string}
export type BackendMessage =
  | {type: 'ready'; cells: Cell[]}
  | {type: 'event'; data: Record<string, unknown>}
  | {type: 'result'; id: string; error?: string; cellId?: string}
  | {type: 'error'; error: string};

/** Data a successful request may return; `create` answers with the new id. */
export interface RequestResult {cellId?: string}

export function decodeMessage(line: string): BackendMessage {
  const value: unknown = JSON.parse(line);
  if (!value || typeof value !== 'object') throw new Error('Invalid backend message');
  const frame = value as Record<string, unknown>;
  if (frame.type === 'ready' && Array.isArray(frame.cells) && frame.cells.every(cell =>
    cell && typeof cell.id === 'string' && typeof cell.code === 'string')) return frame as unknown as BackendMessage;
  if (frame.type === 'event' && frame.data && typeof frame.data === 'object') return frame as unknown as BackendMessage;
  if (frame.type === 'result' && typeof frame.id === 'string' && (frame.error === undefined || typeof frame.error === 'string')) {
    // An empty id would silently address the wrong cell; reject it here.
    if (frame.cellId !== undefined && (typeof frame.cellId !== 'string' || !frame.cellId)) throw new Error('Invalid backend message');
    return frame as unknown as BackendMessage;
  }
  if (frame.type === 'error' && typeof frame.error === 'string') return frame as unknown as BackendMessage;
  throw new Error('Invalid backend message');
}

export interface RenderedOutput {
  kind: 'text' | 'html' | 'image' | 'unsupported';
  text: string;
  /** Set for `image` outputs so the view can build a data URL. */
  mime?: string;
}

/** Raster formats a data URL can safely carry; SVG stays out (it can script). */
const IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

export function safeOutput(value: unknown): RenderedOutput {
  if (!value || typeof value !== 'object') return {kind: 'unsupported', text: ''};
  const output = value as Record<string, unknown>;
  if (output.mimetype === 'application/vnd.marimo+error' && Array.isArray(output.data)) return {kind:'text',text:output.data.map(error=>typeof error?.msg==='string'?error.msg:JSON.stringify(error)).join('\n')};
  if (typeof output.mimetype === 'string' && IMAGE_MIMES.has(output.mimetype)) {
    if (typeof output.data !== 'string') return {kind: 'unsupported', text: output.mimetype};
    const data = output.data.trim();
    // Anything that is not plain base64 could smuggle markup into a data URL.
    if (!BASE64.test(data)) return {kind: 'unsupported', text: output.mimetype};
    return {kind: 'image', text: data, mime: output.mimetype};
  }
  if (typeof output.data !== 'string') return {kind: 'unsupported', text: ''};
  if (output.mimetype === 'application/vnd.marimo+traceback') return {kind:'html',text:output.data};
  if (output.mimetype === 'text/plain') return {kind: 'text', text: output.data};
  // marimo 0.25.2 live mo.md() emits pre-rendered HTML under text/markdown.
  if (output.mimetype === 'text/html' || output.mimetype === 'text/markdown') return {kind: 'html', text: output.data};
  return {kind: 'unsupported', text: String(output.mimetype ?? '')};
}

/** `input()` arrives as a console output on the stdin channel. */
export function isStdinOutput(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  return (value as Record<string, unknown>).channel === 'stdin';
}

/**
 * True when an output (main or console) came from a failure, so the view can
 * color it with the theme error tone. Covers the console error channel and the
 * two error MIME types the pinned version emits.
 */
export function isErrorOutput(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const output = value as Record<string, unknown>;
  if (output.channel === 'marimo-error') return true;
  return output.mimetype === 'application/vnd.marimo+traceback' || output.mimetype === 'application/vnd.marimo+error';
}
