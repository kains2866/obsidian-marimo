import {test} from 'node:test';
import assert from 'node:assert/strict';
import {extractDelta, generateCellCode, renderContext, stripFences} from '../src/ai.ts';

const CONFIG = {baseUrl: 'https://api.example.com/v1/', apiKey: 'sk-test', model: 'gpt-test'};

function stubFetch(response: unknown) {
  const calls: {url: string; init: RequestInit}[] = [];
  const impl = (async (url: string|URL|Request, init?: RequestInit) => {
    calls.push({url: String(url), init: init ?? {}});
    return {
      ok: true, status: 200,
      json: async () => response,
    } as unknown as Response;
  }) as typeof fetch;
  return {impl, calls};
}

test('missing key or endpoint refuses to call out', async () => {
  await assert.rejects(() => generateCellCode({...CONFIG, apiKey: ''}, 'p', 'c', fetch));
  await assert.rejects(() => generateCellCode({...CONFIG, baseUrl: ''}, 'p', 'c', fetch));
});

test('the completion request targets the configured endpoint with the model', async () => {
  const {impl, calls} = stubFetch({choices: [{message: {content: 'x = 1'}}]});
  const code = await generateCellCode(CONFIG, 'make a counter', 'import marimo as mo', impl);
  assert.equal(code, 'x = 1');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.example.com/v1/chat/completions');
  const body = JSON.parse(String(calls[0].init.body));
  assert.equal(body.model, 'gpt-test');
  assert.equal(body.messages[0].role, 'system');
  assert.match(body.messages[0].content, /marimo/i);
  assert.equal(body.messages[1].content, 'make a counter');
  assert.match(body.messages[2].content, /import marimo as mo/);
  assert.equal((calls[0].init.headers as Record<string, string>)['Authorization'], 'Bearer sk-test');
});

test('a fenced reply is unwrapped and language tags dropped', () => {
  assert.equal(stripFences('```python\nx = 1\nx\n```'), 'x = 1\nx');
  assert.equal(stripFences('```\ny = 2\n```'), 'y = 2');
  assert.equal(stripFences('z = 3'), 'z = 3');
  assert.equal(stripFences('prose\n```python\nw = 4\n```\ntrailer'), 'w = 4');
});

test('a fenced reply from the endpoint is unwrapped too', async () => {
  const {impl} = stubFetch({choices: [{message: {content: '```python\nx = 42\nx\n```'}}]});
  const code = await generateCellCode(CONFIG, 'p', 'c', impl);
  assert.equal(code, 'x = 42\nx');
});

test('an http error surfaces with status text', async () => {
  const impl = (async () => ({ok: false, status: 401, statusText: 'Unauthorized',
    json: async () => ({})}) as unknown as Response) as typeof fetch;
  await assert.rejects(() => generateCellCode(CONFIG, 'p', 'c', impl), /401/);
});

test('variables ride along with the notebook context', async () => {
  const {impl, calls} = stubFetch({choices: [{message: {content: 'x = 1'}}]});
  const context = renderContext({
    code: 'import marimo as mo',
    variables: [
      {name: 'df', datatype: 'DataFrame', value: 'shape: (100, 4)'},
      {name: 'n', datatype: 'int', value: '42'},
      {name: 'empty', datatype: null, value: null},
    ],
  });
  await generateCellCode(CONFIG, 'filter df', context, {fetchImpl: impl});
  const body = JSON.parse(String(calls[0].init.body));
  const contextMessage = body.messages[2].content as string;
  assert.match(contextMessage, /import marimo as mo/);
  assert.match(contextMessage, /df.*DataFrame/s);
  assert.match(contextMessage, /shape: \(100, 4\)/);
  assert.match(contextMessage, /n.*int.*42/s);
  assert.doesNotMatch(contextMessage, /empty/);
});

test('long values are flattened and truncated so the prompt stays small', () => {
  const text = renderContext({
    code: 'y = 1',
    variables: [{name: 'big', datatype: 'str', value: 'a'.repeat(500)}],
  });
  assert.ok(text.length < 600);
  assert.match(text, /a+\u2026/);
  assert.doesNotMatch(text, /\n {3,}/);
});

test('streaming deltas surface as they arrive', async () => {
  const chunks = [
    'data: {"choices":[{"delta":{"content":"```python\\n"}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"x = 1\\n"}}]}\n',
    'data: {"choices":[{"delta":{"content":"x\\n```"}}]}\n\n',
    'data: [DONE]\n\n',
  ];
  const impl = (async () => ({
    ok: true, status: 200,
    body: {getReader: () => {
      let i = 0;
      return {read: async () => i < chunks.length ? {done: false, value: new TextEncoder().encode(chunks[i++])} : {done: true, value: undefined}};
    }},
  }) as unknown as Response) as typeof fetch;
  const seen: string[] = [];
  const code = await generateCellCode(CONFIG, 'p', 'c', {fetchImpl: impl, onDelta: d => seen.push(d)});
  assert.equal(code, 'x = 1\nx');
  assert.deepEqual(seen.join(''), '```python\nx = 1\nx\n```');
});

test('non-data and malformed SSE lines are skipped, not fatal', () => {
  assert.equal(extractDelta('data: [DONE]'), null);
  assert.equal(extractDelta(': keep-alive'), null);
  assert.equal(extractDelta('data: not json'), null);
  assert.equal(extractDelta('data: {"choices":[]}'), null);
  assert.equal(extractDelta('data: {"choices":[{"delta":{}}]}'), null);
  assert.equal(extractDelta('data: {"choices":[{"delta":{"content":"hi"}}]}'), 'hi');
});

// ---------------- inline completion ----------------

import {cleanInlineSuggestion, fetchInlineCompletion, inlineCompletionMessages} from '../src/ai.ts';

test('inline completion messages carry prefix, suffix and a compact system prompt', () => {
  const messages = inlineCompletionMessages('x = 1\ny = ', '+ 1');
  assert.equal(messages[0].role, 'system');
  assert.match(messages[0].content, /insert/i);
  assert.match(messages.find(m => m.content.includes('x = 1\ny = '))!.content, /before/i);
  assert.match(messages.find(m => m.content.includes('+ 1'))!.content, /after/i);
});

test('fetchInlineCompletion asks the endpoint with a small token cap and cleans the reply', async () => {
  const {impl, calls} = stubFetch({choices: [{message: {content: '```python\nx + 1\n```'}}]});
  const text = await fetchInlineCompletion(CONFIG, 'x = 1\ny = ', '', impl);
  assert.equal(text, 'x + 1');
  const body = JSON.parse(String(calls[0].init.body));
  assert.equal(body.model, 'gpt-test');
  assert.equal(body.max_tokens, 128);
  assert.equal(body.stream, undefined);
  assert.match(body.messages.at(-1)!.content, /end of file/i);
});

test('inline completion refuses without credentials and caps runaway replies', async () => {
  await assert.rejects(() => fetchInlineCompletion({...CONFIG, apiKey: ''}, 'a', '', fetch));
  assert.equal(cleanInlineSuggestion('y'.repeat(500)).length, 400);
  assert.equal(cleanInlineSuggestion('x + 1\n\n'), 'x + 1');
});

test('inline completion keeps a meaningful leading space', async () => {
  const {impl} = stubFetch({choices: [{message: {content: ' * 3'}}]});
  assert.equal(await fetchInlineCompletion(CONFIG, 'y = x', '', impl), ' * 3');
});

// ---------------- focused context ----------------

import {renderFocusedContext} from '../src/ai.ts';

const CELLS = [
  {id: 'a', code: 'import marimo as mo'},
  {id: 'b', code: 'x = 4'},
  {id: 'c', code: 'result = x * 3'},
  {id: 'd', code: 'plot(result)'},
  {id: 'e', code: 'unrelated = 1'},
];

test('focused context puts the focus cell first, then related cells in order', () => {
  const text = renderFocusedContext(CELLS, 'c', new Set(['b', 'd']), 33);
  const order = [text.indexOf('result = x * 3'), text.indexOf('x = 4'), text.indexOf('plot(result)')];
  assert.ok(order[0] >= 0 && order[0] < order[1] && order[1] < order[2], text);
  assert.ok(!text.includes('unrelated'), text);
});

test('focused context fills leftover budget with nearest neighbours', () => {
  const text = renderFocusedContext(CELLS, 'c', new Set(), 10_000);
  assert.ok(text.includes('import marimo as mo'), text);
  assert.ok(text.includes('x = 4'), text);
});

test('focused context respects the character budget, focus cell always whole', () => {
  const big = CELLS.map(cell => ({...cell, code: cell.id.repeat(200)}));
  const text = renderFocusedContext(big, 'c', new Set(['b']), 450);
  assert.ok(text.length <= 450 + 20, String(text.length));
  assert.ok(text.startsWith('c'.repeat(200)), text.slice(0, 10));
});

test('focused context without a focus keeps the tail of the notebook', () => {
  const text = renderFocusedContext(CELLS, null, new Set(), 40);
  assert.ok(text.endsWith('unrelated = 1'.slice(0, 40).trim()) || text.includes('unrelated'), text);
});
