import test from 'node:test';
import assert from 'node:assert/strict';
import {autoConnectEnabled} from '../src/execution-preferences.ts';

test('new or malformed settings never authorize execution on open', () => {
  for (const value of [undefined, null, false, 'true', 1, {}]) assert.equal(autoConnectEnabled(value), false);
});
test('a previously explicit auto-connect choice remains enabled', () => {
  assert.equal(autoConnectEnabled(true), true);
});
