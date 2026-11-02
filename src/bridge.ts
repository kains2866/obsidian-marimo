import {spawn, type ChildProcessWithoutNullStreams} from 'node:child_process';
import {createInterface} from 'node:readline';
import {stopOwnedProcess} from './process-lifecycle';
import {decodeMessage, type BackendMessage, type Cell, type RequestResult} from './protocol';
import backendSource from '../python/backend.py';

export type RequestMethod = 'run' | 'save' | 'create' | 'delete' | 'interrupt' | 'stdin' | 'ui' | 'config' | 'format' | 'complete' | 'open' | 'function';

export interface RequestPayload {
  cells?: Cell[];
  /** Cell to remove, configure or complete inside. */
  cellId?: string;
  /** Initial code for a new cell. */
  code?: string;
  /** Answer for a pending `input()`. */
  value?: string;
  /** Widget whose value is being written back. */
  objectId?: string;
  /** New widget value, already normalised to the shape its element expects. */
  widgetValue?: unknown;
  /** Partial cell config in wire form (snake_case flags). */
  config?: Record<string, unknown>;
  /** Code per cell for the formatter. */
  codes?: Record<string, string>;
  /** Source up to the cursor for completion. */
  document?: string;
  /** Widget function RPC: namespace (element id) and function name. */
  namespace?: string;
  functionName?: string;
  /** Arguments for a function RPC. */
  args?: Record<string, unknown>;
}

export class Backend {
  private process: ChildProcessWithoutNullStreams | null = null;
  private pending = new Map<string, {resolve: (result: RequestResult) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout>}>();
  private serial = 0;
  private closed = false;
  private closing: Promise<void>|null = null;
  constructor(private python: string, private filename: string, private onMessage: (frame: BackendMessage) => void) {}

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.process || this.closed) return reject(new Error('Session already started or closed'));
      const child = spawn(this.python, ['-u', '-c', backendSource, '--notebook', this.filename], {stdio: 'pipe', detached:process.platform!=='win32',env:{...process.env,MARIMO_NATIVE_PARENT_GROUP:'1'}});
      this.process = child;
      const timer = setTimeout(() => {reject(new Error('marimo startup timed out')); this.close();}, 45_000);
      const fail = (error: Error) => {clearTimeout(timer); reject(error); this.failPending(error);};
      child.once('error', fail);
      child.stdin.on('error',error=>{fail(error);void this.close();});
      child.once('exit', (code) => {fail(new Error(`marimo session stopped (${code ?? 'signal'})`)); if (!this.closed) this.onMessage({type:'error', error:'marimo session stopped'});});
      // stderr is deliberately not displayed: upstream diagnostics can contain tokens.
      child.stderr.resume();
      createInterface({input: child.stdout}).on('line', line => {
        if (this.closed) return;
        let frame: BackendMessage;
        try {
          frame = decodeMessage(line);
        } catch (error) {
          // A frame this plugin cannot read means the two sides no longer agree
          // on the protocol; carrying on would corrupt the notebook silently.
          fail(new Error('Invalid marimo adapter response'));
          this.onMessage({type:'error',error:'Invalid marimo adapter response; reconnect'});
          void this.close();
          return;
        }
        // Dispatch is kept apart from decoding: a rendering bug in the view is a
        // bug in the view, not a broken adapter, and must not end the session.
        try {
          if (frame.type === 'ready') {clearTimeout(timer); resolve();}
          if (frame.type === 'error') fail(new Error(frame.error));
          if (frame.type === 'result') {
            const pending = this.pending.get(frame.id);
            if (pending) {clearTimeout(pending.timer); this.pending.delete(frame.id); frame.error ? pending.reject(new Error(frame.error)) : pending.resolve({cellId: frame.cellId, codes: frame.codes, options: frame.options, prefixLength: frame.prefixLength, opened: frame.opened});}
          }
          this.onMessage(frame);
        } catch (error) {
          console.error('marimo notebook: frame handling failed', error);
        }
      });
    });
  }

  request(method: RequestMethod, payload: RequestPayload = {}): Promise<RequestResult> {
    if (this.closed || !this.process || this.process.exitCode !== null) return Promise.reject(new Error('Session is not connected'));
    const id = String(++this.serial);
    // Runs, saves, deletes, widget and config writes wait for a whole reactive
    // cycle; the rest must answer fast.
    const long = method === 'run' || method === 'save' || method === 'delete' || method === 'ui' || method === 'config' || method === 'function';
    const frame: Record<string, unknown> = {id, method};
    if (method === 'run' || method === 'save') frame.cells = payload.cells ?? [];
    else if (method === 'create') frame.code = payload.code ?? '';
    else if (method === 'delete') frame.cellId = payload.cellId ?? '';
    else if (method === 'stdin') frame.value = payload.value ?? '';
    else if (method === 'ui') {frame.objectId = payload.objectId ?? ''; frame.value = payload.widgetValue ?? null;}
    else if (method === 'config') {frame.cellId = payload.cellId ?? ''; frame.config = payload.config ?? {};}
    else if (method === 'format') frame.codes = payload.codes ?? {};
    else if (method === 'complete') {frame.cellId = payload.cellId ?? ''; frame.document = payload.document ?? '';}
    else if (method === 'function') {frame.namespace = payload.namespace ?? ''; frame.functionName = payload.functionName ?? ''; frame.args = payload.args ?? {};}
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {this.pending.delete(id); reject(new Error(`${method} timed out; session stopped`)); this.close();}, long ? 120_000 : 20_000);
      this.pending.set(id, {resolve, reject, timer});
      this.process!.stdin.write(JSON.stringify(frame)+'\n', error => {if(error) {clearTimeout(timer); this.pending.delete(id); reject(error);}});
    });
  }
  /**
   * Open this notebook in the native marimo editor, in the user's browser.
   * The adapter holds the access token; only success/failure comes back.
   */
  async openInBrowser(): Promise<boolean> {
    const result = await this.request('open');
    return result.opened === true;
  }
  close(): Promise<void> {
    if(this.closing)return this.closing;
    this.closed = true;
    this.failPending(new Error('Session closed'));
    const child=this.process;this.process=null;
    this.closing=child?stopOwnedProcess(child):Promise.resolve();
    this.closing.catch(error=>this.onMessage({type:'error',error:'Could not stop marimo: '+String(error)}));
    return this.closing;
  }
  private failPending(error: Error): void {
    for (const pending of this.pending.values()) {clearTimeout(pending.timer); pending.reject(error);}
    this.pending.clear();
  }
}
