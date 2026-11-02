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
    return codeReply ? stripFences(text) : text.trim();
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
