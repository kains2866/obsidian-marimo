import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  canAdoptClaim,
  connectionState,
  shouldApplyResult,
  shouldApplyStopResult,
  toolbarAvailability,
} from '../src/status.ts';

/*
 * These tests pin the session guards that the view relies on. Each scenario is a
 * regression that was observed in the host: a late claim after stop, a stop that
 * is still awaiting its process while the file or session changes, and a toolbar
 * that considered `backend !== null` good enough to run code.
 */

test('a claim that resolves after stop must not start a kernel', () => {
  const attempt = {generation: 3};
  // stop() bumps loadGeneration, so the claim that was already in flight is stale.
  assert.equal(canAdoptClaim(attempt, {generation: 4, closed: false, stopping: false}), false);
  // While the process is still closing, stopping alone already rejects the claim.
  assert.equal(canAdoptClaim(attempt, {generation: 3, closed: false, stopping: true}), false);
  // A closed view never adopts a claim either.
  assert.equal(canAdoptClaim(attempt, {generation: 3, closed: true, stopping: false}), false);
  // The untouched attempt is the only one allowed to create a backend.
  assert.equal(canAdoptClaim(attempt, {generation: 3, closed: false, stopping: false}), true);
});

test('a long run stopped mid-flight cannot touch the reconnected session', () => {
  const longRun = {backend: {id: 'A'}, operation: 4};
  // stop() bumps the operation before awaiting the process exit.
  assert.equal(shouldApplyResult(longRun, {backend: null, operation: 5}), false);
  // Reconnecting starts a new session with its own backend and operation.
  const reconnected = {backend: {id: 'B'}, operation: 6};
  assert.equal(shouldApplyResult(longRun, reconnected), false);
  // The new session's own request still publishes its result.
  assert.equal(shouldApplyResult({backend: reconnected.backend, operation: 6}, reconnected), true);
});

test('a stop that is still awaiting close cannot overwrite a new file or session', () => {
  const stopStarted = {generation: 3, operation: 5};
  // Opening another file bumps the generation while the old process is closing.
  assert.equal(shouldApplyStopResult(stopStarted, {generation: 4, operation: 5}), false);
  // A reconnect for the same file bumps the operation.
  assert.equal(shouldApplyStopResult(stopStarted, {generation: 3, operation: 6}), false);
  // Its own completion still resets the session.
  assert.equal(shouldApplyStopResult(stopStarted, {generation: 3, operation: 5}), true);
});

test('a backend object that has not reported ready is still connecting', () => {
  assert.equal(connectionState({hasBackend: false, connecting: false}), 'disconnected');
  assert.equal(connectionState({hasBackend: false, connecting: true}), 'connecting');
  // The backend object is created before `start()` resolves: running must stay closed.
  assert.equal(connectionState({hasBackend: true, connecting: true}), 'connecting');
  assert.equal(connectionState({hasBackend: true, connecting: false}), 'connected');

  const starting = connectionState({hasBackend: true, connecting: true});
  const available = toolbarAvailability({connection: starting, run: 'none', ready: true, hasDraft: false});
  assert.equal(available.runAll, false);
  assert.equal(available.save, false);
  assert.equal(available.stop, true);
});

test('an in-flight save keeps run and save disabled but leaves stop reachable', () => {
  assert.deepEqual(
    toolbarAvailability({connection: 'connected', run: 'finished', ready: true, hasDraft: false, busy: true}),
    {connect: false, runAll: false, save: false, stop: true, restore: false, interrupt: false, format: false, runStale: false},
  );
  // Without the busy flag the same idle session is runnable again.
  assert.deepEqual(
    toolbarAvailability({connection: 'connected', run: 'finished', ready: true, hasDraft: false}),
    {connect: false, runAll: true, save: true, stop: true, restore: false, interrupt: false, format: true, runStale: false},
  );
});
