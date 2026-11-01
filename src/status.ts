/**
 * Pure view-state model for the native notebook toolbar.
 *
 * Kept free of DOM and Obsidian imports so the copy, ordering and availability
 * rules can be tested without a host.
 */

export type ConnectionState = 'disconnected' | 'connecting' | 'connected';
export type RunPhase = 'none' | 'running' | 'finished' | 'failed' | 'interrupted';
export type StatusTone = 'muted' | 'accent' | 'error';

/**
 * `connecting` wins over the existence of a backend object: the view creates the
 * adapter before `start()` resolves, and code must not run until the session has
 * reported ready.
 */
export function connectionState(input: {hasBackend: boolean; connecting: boolean}): ConnectionState {
  if (input.connecting) return 'connecting';
  return input.hasBackend ? 'connected' : 'disconnected';
}

export interface ViewStatus {
  connection: ConnectionState;
  run: RunPhase;
  /** Content differs from the file on disk. */
  dirty: boolean;
  /** Content changed after the last completed run. */
  changedSinceRun: boolean;
  stopping?: boolean;
}

export interface StatusView {
  text: string;
  tone: StatusTone;
  /** True while an operation owns the session; callers must not start another. */
  busy: boolean;
}

export type Translate = (zh: string, en: string) => string;

const PHASE: Record<RunPhase, [string, string]> = {
  none: ['尚未运行', 'Not run yet'],
  running: ['运行中…', 'Running…'],
  finished: ['运行结束', 'Run finished'],
  failed: ['运行失败', 'Run failed'],
  interrupted: ['已中断', 'Interrupted'],
};

export function statusView(status: ViewStatus, t: Translate): StatusView {
  if (status.stopping) return {text: t('正在断开…', 'Disconnecting…'), tone: 'accent', busy: true};
  if (status.connection === 'disconnected') return {text: t('未连接', 'Not connected'), tone: 'muted', busy: false};
  if (status.connection === 'connecting') return {text: t('连接中…', 'Connecting…'), tone: 'accent', busy: true};
  // A running cell updates outputs constantly; extra modifiers would make the label jump.
  if (status.run === 'running') return {text: t('运行中…', 'Running…'), tone: 'accent', busy: true};

  const phase = PHASE[status.run];
  const parts = [t(phase[0], phase[1])];
  if (status.changedSinceRun) parts.push(t('代码已修改', 'Code modified'));
  parts.push(status.dirty ? t('未保存', 'Unsaved') : t('已保存', 'Saved'));
  return {text: parts.join(' · '), tone: status.run === 'failed' ? 'error' : 'muted', busy: false};
}

export interface ToolbarInput {
  connection: ConnectionState;
  run: RunPhase;
  /** The file was recognised as a marimo notebook. */
  ready: boolean;
  hasDraft: boolean;
  stopping?: boolean;
  /** An explicit run/save request is in flight, independent of the run phase. */
  busy?: boolean;
  /** At least one cell has inputs that changed since its last run. */
  hasStale?: boolean;
}

export interface ToolbarAvailability {
  connect: boolean;
  runAll: boolean;
  save: boolean;
  stop: boolean;
  restore: boolean;
  /** Cancels the current run without dropping the session. */
  interrupt: boolean;
  /** Rewrites every cell with the server's formatter. */
  format: boolean;
  /** Runs only the cells whose inputs changed. */
  runStale: boolean;
}

export function toolbarAvailability(input: ToolbarInput): ToolbarAvailability {
  const stopping = input.stopping === true;
  // `busy` covers saves and runs that have not changed the run phase yet; without
  // it a second click could queue another request while one is still in flight.
  const busy = stopping || input.busy === true || input.run === 'running' || input.connection === 'connecting';
  const live = input.connection === 'connected';
  return {
    connect: input.ready && input.connection === 'disconnected' && !stopping,
    runAll: live && !busy,
    save: live && !busy,
    // Stop stays reachable while connecting so a hung start can be abandoned.
    stop: !stopping && (live || input.connection === 'connecting'),
    // The restore offer is visible as soon as a draft exists (the read-only
    // preview tells the reader their edits survived); applying it still needs
    // a session, and clicking without one asks the user to connect.
    restore: input.ready && input.hasDraft && !busy,
    // Interrupt is the only action that must stay live during `running`.
    interrupt: live && !stopping && input.run === 'running',
    format: live && !busy,
    // Nothing stale means nothing to do: the button stays visible but inert.
    runStale: live && !busy && input.hasStale === true,
  };
}

/**
 * Structural actions on one cell. They change the shape of the notebook, so
 * they need the same quiet, live session as a run: a preview, a connecting
 * kernel or a running cycle must never add or drop cells behind the user.
 */
export interface CellActionInput {
  connection: ConnectionState;
  run: RunPhase;
  /** The cell's position in the notebook; `-1` when the notebook is empty. */
  index: number;
  count: number;
  busy?: boolean;
}

export interface CellActionAvailability {
  /** Insert a cell (toolbar and per-cell "insert below" share this). */
  add: boolean;
  remove: boolean;
  up: boolean;
  down: boolean;
}

export function cellActions(input: CellActionInput): CellActionAvailability {
  const live = input.connection === 'connected' && input.run !== 'running' && input.busy !== true;
  if (!live) return {add: false, remove: false, up: false, down: false};
  return {
    add: true,
    // A notebook always keeps at least one cell: an empty app cannot be saved.
    remove: input.count > 1,
    up: input.index > 0,
    down: input.index >= 0 && input.index < input.count - 1,
  };
}

/**
 * A request may only publish its result while it still owns the session.
 * Disconnecting, stopping or reconnecting bumps the operation counter, so a
 * late `finally` from the old request cannot overwrite the newer state.
 */
export function shouldApplyResult(
  request: {backend: unknown; operation: number},
  current: {backend: unknown; operation: number},
): boolean {
  return request.backend === current.backend && request.operation === current.operation;
}

/**
 * A claim belongs to the file session that requested it. Stopping bumps the
 * generation before the process is closed, so a claim that resolves late must be
 * released instead of spawning a kernel the user already asked to stop.
 */
export function canAdoptClaim(
  attempt: {generation: number},
  current: {generation: number; closed: boolean; stopping: boolean},
): boolean {
  return !current.closed && !current.stopping && attempt.generation === current.generation;
}

/**
 * The reset performed after `stop()` awaits the process exit belongs to that
 * stop only. Opening another file (new generation) or reconnecting (newer
 * operation) must not be rolled back to "not run".
 */
export function shouldApplyStopResult(
  stop: {generation: number; operation: number},
  current: {generation: number; operation: number},
): boolean {
  return stop.generation === current.generation && stop.operation === current.operation;
}

/** Human readable environment name; never a full path and never a secret. */
export function environmentLabel(pythonPath: string): string {
  const trimmed = pythonPath.trim();
  if (!trimmed) return 'Python';
  const segments = trimmed.split(/[\\/]+/).filter(Boolean);
  const tools = segments.indexOf('tools');
  if (segments.includes('uv') && tools >= 0 && segments[tools + 1] && segments[tools + 2] === 'bin') {
    return `${segments[tools + 1]} (uv)`;
  }
  if (segments.some(segment => /(^|\.)venv$/i.test(segment))) return 'venv';
  return segments[segments.length - 1] ?? 'Python';
}

/**
 * View-level kinds for the pinned protocol's per-cell status
 * (marimo 0.25.2 `RuntimeStateType`) plus the `stale_inputs` flag.
 * Staleness only marks idle cells: a running cell is about to refresh anyway.
 */
export type CellStatus = 'idle' | 'queued' | 'running' | 'disabled' | 'stale' | 'unknown';

export function normalizeCellStatus(status: unknown, staleInputs?: unknown): CellStatus {
  if (status === 'running') return 'running';
  if (status === 'queued') return 'queued';
  if (status === 'disabled-transitively') return 'disabled';
  if (status === 'idle') return staleInputs === true ? 'stale' : 'idle';
  return 'unknown';
}

/**
 * The safety notice about local execution matters before a session exists;
 * once connected it is noise, and a plain script can never connect at all.
 */
export function showPrototypeInfo(input: {ready: boolean; connection: ConnectionState}): boolean {
  return input.ready && input.connection !== 'connected';
}
