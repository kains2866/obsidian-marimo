import {spawn, type ChildProcessWithoutNullStreams} from 'node:child_process';
import {createInterface} from 'node:readline';
import {stopOwnedProcess} from './process-lifecycle';
import {decodeMessage, type BackendMessage, type Cell} from './protocol';
import backendSource from '../python/backend.py';

export type RequestMethod = 'run' | 'save' | 'interrupt' | 'stdin';

export interface RequestPayload {
  cells?: Cell[];
  /** Answer for a pending `input()`. */
  value?: string;
}

export class Backend {
  private process: ChildProcessWithoutNullStreams | null = null;
  private pending = new Map<string, {resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout>}>();
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
        try {
          const frame = decodeMessage(line);
          if (frame.type === 'ready') {clearTimeout(timer); resolve();}
          if (frame.type === 'error') fail(new Error(frame.error));
          if (frame.type === 'result') {
            const pending = this.pending.get(frame.id);
            if (pending) {clearTimeout(pending.timer); this.pending.delete(frame.id); frame.error ? pending.reject(new Error(frame.error)) : pending.resolve();}
          }
          this.onMessage(frame);
        } catch (error) {fail(new Error('Invalid marimo adapter response'));this.onMessage({type:'error',error:'Invalid marimo adapter response; reconnect'});void this.close();}
      });
    });
  }

  request(method: RequestMethod, payload: RequestPayload = {}): Promise<void> {
    if (this.closed || !this.process || this.process.exitCode !== null) return Promise.reject(new Error('Session is not connected'));
    const id = String(++this.serial);
    // Run/save wait for a whole reactive cycle; interrupt and stdin must answer fast.
    const long = method === 'run' || method === 'save';
    const frame: Record<string, unknown> = {id, method};
    if (long) frame.cells = payload.cells ?? [];
    else if (method === 'stdin') frame.value = payload.value ?? '';
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {this.pending.delete(id); reject(new Error(`${method} timed out; session stopped`)); this.close();}, long ? 120_000 : 15_000);
      this.pending.set(id, {resolve, reject, timer});
      this.process!.stdin.write(JSON.stringify(frame)+'\n', error => {if(error) {clearTimeout(timer); this.pending.delete(id); reject(error);}});
    });
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
