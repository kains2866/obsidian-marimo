export interface Cell {id: string; code: string}
export type BackendMessage =
  | {type: 'ready'; cells: Cell[]}
  | {type: 'event'; data: Record<string, unknown>}
  | {type: 'result'; id: string; error?: string}
  | {type: 'error'; error: string};

export function decodeMessage(line: string): BackendMessage {
  const value: unknown = JSON.parse(line);
  if (!value || typeof value !== 'object') throw new Error('Invalid backend message');
  const frame = value as Record<string, unknown>;
  if (frame.type === 'ready' && Array.isArray(frame.cells) && frame.cells.every(cell =>
    cell && typeof cell.id === 'string' && typeof cell.code === 'string')) return frame as unknown as BackendMessage;
  if (frame.type === 'event' && frame.data && typeof frame.data === 'object') return frame as unknown as BackendMessage;
  if (frame.type === 'result' && typeof frame.id === 'string' && (frame.error === undefined || typeof frame.error === 'string')) return frame as unknown as BackendMessage;
  if (frame.type === 'error' && typeof frame.error === 'string') return frame as unknown as BackendMessage;
  throw new Error('Invalid backend message');
}

export function safeOutput(value: unknown): {kind: 'text' | 'html' | 'unsupported'; text: string} {
  if (!value || typeof value !== 'object') return {kind: 'unsupported', text: ''};
  const output = value as Record<string, unknown>;
  if (output.mimetype === 'application/vnd.marimo+error' && Array.isArray(output.data)) return {kind:'text',text:output.data.map(error=>typeof error?.msg==='string'?error.msg:JSON.stringify(error)).join('\n')};
  if (typeof output.data !== 'string') return {kind: 'unsupported', text: ''};
  if (output.mimetype === 'application/vnd.marimo+traceback') return {kind:'html',text:output.data};
  if (output.mimetype === 'text/plain') return {kind: 'text', text: output.data};
  // marimo 0.25.2 live mo.md() emits pre-rendered HTML under text/markdown.
  if (output.mimetype === 'text/html' || output.mimetype === 'text/markdown') return {kind: 'html', text: output.data};
  return {kind: 'unsupported', text: String(output.mimetype ?? '')};
}
