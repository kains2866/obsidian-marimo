import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateCellCode, stripFences} from '../src/ai.ts';

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
