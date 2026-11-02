/**
 * The AI surface shared by "generate a cell", "refactor a cell" and the chat
 * panel: one OpenAI-compatible chat-completions endpoint the user configures.
 * The plugin ships no key and calls nothing until both an endpoint and a key
 * are set. Streaming is used when the caller wants deltas, so long answers
 * appear while they are still being written.
 */

export interface AIConfig {baseUrl: string;apiKey: string;model: string}

/** What the model sees besides its prompt: notebook code plus live variables. */
export interface AIContext {code: string;variables: {name: string;datatype: string|null;value: string|null}[]}

export interface AIOptions {
  fetchImpl?: typeof fetch;
  /** When given, the request streams and every text chunk lands here. */
  onDelta?: (chunk: string) => void;
}

const VALUE_LIMIT = 200;
const VARIABLE_LIMIT = 40;

const SYSTEM_PROMPT = [
  'You write Python cells for marimo notebooks.',
  'Return ONE executable code cell, and nothing else.',
  'Use `import marimo as mo` when UI elements or markdown are needed.',
  'No prose, no explanation, no surrounding code fences.',
].join(' ');

const REFACTOR_SYSTEM_PROMPT = [
  'You rewrite one existing cell of a marimo notebook according to an instruction.',
  'Return the COMPLETE rewritten cell, and nothing else.',
  'Keep the cell\'s role in the notebook: same name for anything other cells reference.',
  'No prose, no explanation, no surrounding code fences.',
].join(' ');

const CHAT_SYSTEM_PROMPT = [
  'You are the assistant of a marimo notebook editor. You see the notebook\'s',
  'cells and the variables currently in memory. Answer questions, explain the',
  'notebook, and propose code. When you propose code, put it in a fenced block',
  'so it can be inserted as a cell.',
].join(' ');

/** Extract the code from a reply, dropping a single markdown fence. */
export function stripFences(text: string): string {
  const fenced = /```[a-zA-Z0-9]*\s*\n([\s\S]*?)```/.exec(text);
  return (fenced ? fenced[1] : text).trim();
}

/** Flatten a value preview to one line; keep prompts small and readable. */
function preview(value: string): string {
  const oneLine = value.replace(/\s+/g, ' ').trim();
  return oneLine.length > VALUE_LIMIT ? oneLine.slice(0, VALUE_LIMIT) + '…' : oneLine;
}

/**
 * The context message: the notebook source plus a variable table with types
 * and value previews, so the model can code against real data shapes.
 */
export function renderContext(context: AIContext): string {
  const parts = [context.code];
  const variables = context.variables
    .filter(entry => entry.datatype || entry.value)
    .slice(0, VARIABLE_LIMIT);
  if (variables.length) {
    parts.push('Variables in memory:\n' + variables.map(entry => {
      const type = entry.datatype ? ': ' + entry.datatype : '';
      const value = entry.value ? ' = ' + preview(entry.value) : '';
      return `- ${entry.name}${type}${value}`;
    }).join('\n'));
  }
  return parts.join('\n\n');
}

/**
 * Pick the cells a prompt should see: the focus cell whole and first, then
 * the cells that share its variables, then nearest neighbours until the
 * budget is spent. Without a focus the old tail-of-notebook behaviour keeps
 * large notebooks working.
 */
export function renderFocusedContext(
  cells: {id: string;code: string}[],
  focusId: string | null,
  relatedIds: Set<string>,
  limit = 6000,
): string {
  if (focusId === null) {
    return cells.map(cell => cell.code).join('\n\n').slice(-limit);
  }
  const focusIndex = cells.findIndex(cell => cell.id === focusId);
  if (focusIndex < 0) return cells.map(cell => cell.code).join('\n\n').slice(-limit);
  const focus = cells[focusIndex]!;
  const related = cells.filter(cell => cell.id !== focusId && relatedIds.has(cell.id));
  const chosen: {id: string;code: string}[] = [focus];
  let budget = limit - focus.code.length;
  // Nearest neighbours first, so the immediate surroundings survive a tight
  // budget even when many cells are related.
  const rest = cells.filter(cell => cell.id !== focusId && !relatedIds.has(cell.id));
  const neighbours: typeof rest = [];
  for (let offset = 1; neighbours.length < rest.length; offset++) {
    const before = cells[focusIndex - offset];
    if (before && !relatedIds.has(before.id) && before.id !== focusId) neighbours.push(before);
    const after = cells[focusIndex + offset];
    if (after && !relatedIds.has(after.id) && after.id !== focusId) neighbours.push(after);
  }
  for (const cell of [...related, ...neighbours]) {
    if (budget - cell.code.length < 0 && chosen.length > 1) break;
    if (chosen.some(picked => picked.id === cell.id)) continue;
    chosen.push(cell);
    budget -= cell.code.length;
  }
  // Notebook order, focus cell first, keeps the text readable for the model.
  const ordered = chosen.filter(cell => cell.id === focusId)
    .concat(chosen.filter(cell => cell.id !== focusId).sort((a, b) =>
      cells.findIndex(cell => cell.id === a.id) - cells.findIndex(cell => cell.id === b.id)));
  const parts: string[] = [];
  let used = 0;
  for (const cell of ordered) {
    if (parts.length && used + cell.code.length > limit) break;
    parts.push(cell.code);
    used += cell.code.length;
  }
  return parts.join('\n\n');
}

/** One SSE line → streamed text, or null when the line carries no content. */
export function extractDelta(line: string): string | null {
  if (!line.startsWith('data:')) return null;
  const payload = line.slice(5).trim();
  if (!payload || payload === '[DONE]') return null;
  try {
    const frame = JSON.parse(payload) as {choices?: {delta?: {content?: string}}[]};
    const content = frame.choices?.[0]?.delta?.content;
    return typeof content === 'string' && content ? content : null;
  } catch {
    return null;
  }
}

function normalizeOptions(options?: AIOptions | typeof fetch): AIOptions {
  return typeof options === 'function' ? {fetchImpl: options} : options ?? {};
}

async function completion(
  config: AIConfig,
  messages: {role: string;content: string}[],
  options: AIOptions,
  codeReply: boolean,
  maxTokens?: number,
  trimReply = true,
): Promise<string> {
  const base = config.baseUrl.replace(/\/+$/, '');
  if (!base) throw new Error('AI 端点未配置');
  if (!config.apiKey) throw new Error('AI 密钥未配置');
  const fetchImpl = options.fetchImpl ?? fetch.bind(globalThis);
  const stream = typeof options.onDelta === 'function';
  const controller = new AbortController();
  // Streaming answers keep flowing for a while; the cap is only a backstop.
  const timer = setTimeout(() => controller.abort(), stream ? 180_000 : 60_000);
  try {
    const response = await fetchImpl(`${base}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        temperature: 0.2,
        ...(stream ? {stream: true} : {}),
        ...(maxTokens ? {max_tokens: maxTokens} : {}),
      }),
    });
    if (!response.ok) throw new Error(`AI 请求失败：${response.status} ${response.statusText}`);
    let text: string;
    if (stream && response.body) text = await readStream(response, options.onDelta!);
    else {
      const payload = await response.json() as {choices?: {message?: {content?: string}}[]};
      text = payload.choices?.[0]?.message?.content ?? '';
    }
    if (!text.trim()) throw new Error('AI 返回为空');
    return codeReply ? stripFences(text) : (trimReply ? text.trim() : text);
  } finally {
    clearTimeout(timer);
  }
}

/** Consume an SSE body, forwarding deltas and returning the joined text. */
async function readStream(response: Response, onDelta: (chunk: string) => void): Promise<string> {
  const reader = (response.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';
  for (;;) {
    const {done, value} = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, {stream: true});
    let newline: number;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      const delta = extractDelta(line);
      if (delta) {full += delta;onDelta(delta);}
    }
  }
  const rest = buffer.trim();
  const trailing = rest ? extractDelta(rest) : null;
  if (trailing) {full += trailing;onDelta(trailing);}
  return full;
}

/**
 * Ask the configured endpoint for one marimo cell. `context` carries the
 * surrounding cells' source and, when available, the variables in memory.
 */
export async function generateCellCode(
  config: AIConfig,
  prompt: string,
  context: string | AIContext,
  options?: AIOptions | typeof fetch,
): Promise<string> {
  const text = await completion(config, [
    {role: 'system', content: SYSTEM_PROMPT},
    {role: 'user', content: prompt},
    {role: 'user', content: 'Notebook context (other cells and variables):\n' + (typeof context === 'string' ? context : renderContext(context))},
  ], normalizeOptions(options), true);
  if (!text.trim()) throw new Error('AI 返回为空');
  return text;
}

/**
 * Rewrite one existing cell. The reply replaces the cell's code wholesale, so
 * the model must return the complete cell; fences are stripped as usual.
 */
export async function refactorCellCode(
  config: AIConfig,
  instruction: string,
  code: string,
  context: string | AIContext,
  options?: AIOptions | typeof fetch,
): Promise<string> {
  const text = await completion(config, [
    {role: 'system', content: REFACTOR_SYSTEM_PROMPT},
    {role: 'user', content: 'Here is the cell to rewrite:\n\n' + code},
    {role: 'user', content: instruction},
    {role: 'user', content: 'Notebook context (other cells and variables):\n' + (typeof context === 'string' ? context : renderContext(context))},
  ], normalizeOptions(options), true);
  if (!text.trim()) throw new Error('AI 返回为空');
  return text;
}

/** One chat turn; returns the raw reply (fences preserved for rendering). */
export async function chatWithAI(
  config: AIConfig,
  history: {role: 'user'|'assistant';content: string}[],
  message: string,
  context: string | AIContext,
  options?: AIOptions,
): Promise<string> {
  return completion(config, [
    {role: 'system', content: CHAT_SYSTEM_PROMPT},
    {role: 'system', content: 'Notebook context (cells and variables):\n' + (typeof context === 'string' ? context : renderContext(context))},
    ...history,
    {role: 'user', content: message},
  ], normalizeOptions(options), false);
}

// ------------------------------------------------------------- inline completion

const INLINE_SYSTEM_PROMPT = [
  'You are a code completion engine inside a marimo notebook cell.',
  'Insert the text that should appear at the cursor.',
  'Return ONLY the insertion: no prose, no explanation, no surrounding code fences.',
].join(' ');

/** Ghost-text suggestions must stay small: they render inline. */
export const INLINE_MAX_TOKENS = 128;
const INLINE_MAX_CHARS = 400;

/** The messages for one ghost-text completion at the cursor. */
export function inlineCompletionMessages(prefix: string, suffix: string): {role: string;content: string}[] {
  return [
    {role: 'system', content: INLINE_SYSTEM_PROMPT},
    {role: 'user', content: 'Code before the cursor:\n' + prefix},
    {role: 'user', content: 'Code after the cursor:\n' + (suffix || '(end of file)')},
  ];
}

/** Tidy a raw reply into safe ghost text: strip fences, cap the length. */
export function cleanInlineSuggestion(text: string): string {
  let out = text;
  // A model that answers with a fenced block gets the block's body.
  const fenced = /^```[a-zA-Z0-9]*\n([\s\S]*?)```?\s*$/.exec(out);
  if (fenced) out = fenced[1];
  out = out.replace(/\s+$/, '');
  return out.length > INLINE_MAX_CHARS ? out.slice(0, INLINE_MAX_CHARS) : out;
}

/** One ghost-text suggestion; errors and refusals surface to the caller. */
export async function fetchInlineCompletion(
  config: AIConfig,
  prefix: string,
  suffix: string,
  options?: AIOptions | typeof fetch,
): Promise<string> {
  // Leading whitespace is meaningful at a caret ("x = 1" + " * 3"), so the
  // reply keeps its edges and only trailing blanks are dropped.
  const text = await completion(config, inlineCompletionMessages(prefix, suffix), normalizeOptions(options), false, INLINE_MAX_TOKENS, false);
  return cleanInlineSuggestion(text);
}
