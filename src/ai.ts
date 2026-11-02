/**
 * "GENERATE WITH AI": the creation bar's fourth option, wired to an
 * OpenAI-compatible chat-completions endpoint the user configures. The plugin
 * ships no key and calls nothing until both an endpoint and a key are set.
 */

export interface AIConfig {baseUrl: string;apiKey: string;model: string}

const SYSTEM_PROMPT = [
  'You write Python cells for marimo notebooks.',
  'Return ONE executable code cell, and nothing else.',
  'Use `import marimo as mo` when UI elements or markdown are needed.',
  'No prose, no explanation, no surrounding code fences.',
].join(' ');

/** Extract the code from a reply, dropping a single markdown fence. */
export function stripFences(text: string): string {
  const fenced = /```[a-zA-Z0-9]*\s*\n([\s\S]*?)```/.exec(text);
  return (fenced ? fenced[1] : text).trim();
}

/**
 * Ask the configured endpoint for one marimo cell. `context` carries the
 * surrounding cells' source so the model can reuse existing variables.
 * `fetchImpl` is injectable for tests.
 */
export async function generateCellCode(
  config: AIConfig,
  prompt: string,
  context: string,
  fetchImpl: typeof fetch = fetch.bind(globalThis),
): Promise<string> {
  const base = config.baseUrl.replace(/\/+$/, '');
  if (!base) throw new Error('AI 端点未配置');
  if (!config.apiKey) throw new Error('AI 密钥未配置');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
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
        messages: [
          {role: 'system', content: SYSTEM_PROMPT},
          {role: 'user', content: prompt},
          {role: 'user', content: 'Notebook context (other cells):\n' + context},
        ],
        temperature: 0.2,
      }),
    });
    if (!response.ok) throw new Error(`AI 请求失败：${response.status} ${response.statusText}`);
    const payload = await response.json() as {choices?: {message?: {content?: string}}[]};
    const text = payload.choices?.[0]?.message?.content ?? '';
    if (!text.trim()) throw new Error('AI 返回为空');
    return stripFences(text);
  } finally {
    clearTimeout(timer);
  }
}
