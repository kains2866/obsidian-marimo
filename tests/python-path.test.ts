import {test} from 'node:test';
import assert from 'node:assert/strict';
import {defaultPythonPath} from '../src/python-path.ts';

test('windows prefers the uv tool env then a venv, and never python3', () => {
  const found = defaultPythonPath({
    platform: 'win32',
    home: 'C:/Users/u',
    exists: path => path === 'C:/Users/u/AppData/Roaming/uv/tools/marimo/Scripts/python.exe',
  });
  assert.equal(found, 'C:/Users/u/AppData/Roaming/uv/tools/marimo/Scripts/python.exe');
  const fallback = defaultPythonPath({platform: 'win32', home: 'C:/Users/u', exists: () => false});
  assert.equal(fallback, 'python');
});

test('posix keeps the uv tools layout and falls back to python3', () => {
  const found = defaultPythonPath({
    platform: 'darwin',
    home: '/Users/u',
    exists: path => path === '/Users/u/.local/share/uv/tools/marimo/bin/python',
  });
  assert.equal(found, '/Users/u/.local/share/uv/tools/marimo/bin/python');
  const fallback = defaultPythonPath({platform: 'linux', home: '/home/u', exists: () => false});
  assert.equal(fallback, 'python3');
});
