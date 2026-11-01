import {EditableFileView, MarkdownRenderer, Notice, Scope, sanitizeHTMLToDom, setIcon, type WorkspaceLeaf, type TFile, type ViewStateResult} from 'obsidian';
import {EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter} from '@codemirror/view';
import {Compartment, EditorState} from '@codemirror/state';
import {python} from '@codemirror/lang-python';
import {defaultKeymap, history, historyKeymap} from '@codemirror/commands';
import {autocompletion, type CompletionContext, type CompletionResult} from '@codemirror/autocomplete';
import {syntaxHighlighting} from '@codemirror/language';
import {Backend} from './bridge';
import {insertCell, moveCell, nextCellId, removeCell} from './cells';
import {cellPresentation, mergeCellConfig, readCellConfig, wireConfig, type CellConfig} from './cell-config';
import {nativeHighlight} from './editor-theme';
import {isErrorOutput, isStdinOutput, safeOutput, type BackendMessage, type Cell} from './protocol';
import {isAllowedImageSource, adaptMarimoTex, isBlockedAttribute, isBlockedElement} from './output-policy';
import {parseMarkdownCell} from './markdown-cell';
import {canAdoptClaim, cellActions, connectionState, environmentLabel, normalizeCellStatus, shouldApplyResult, shouldApplyStopResult, showPrototypeInfo, statusView, toolbarAvailability, type CellStatus, type ConnectionState, type RunPhase} from './status';
import {fileFromViewState} from './file-state';
import {inspectSource} from './inspection';
import {mountWidgets} from './widgets';
import {extractUiElements} from './ui-elements';
import inspectorSource from '../python/inspect_notebook.py';
import type MarimoPlugin from './main';
import type {WriterLease} from './writer-lock';

export const VIEW_TYPE = 'marimo-native-notebook';

interface CellEditor {
  view: EditorView;
  editable: Compartment;
}

export class MarimoView extends EditableFileView {
  private filename = '';
  private loadGeneration=0;
  private sourceEditor:EditorView|null=null;
  private inspection:AbortController|null=null;
  private notebookReady=false;
  private connecting=false;
  private lease:WriterLease|null=null;
  private backend: Backend | null = null;
  private editors = new Map<string, CellEditor>();
  private outputs = new Map<string, HTMLElement>();
  private cells: Cell[] = [];
  private status!: HTMLElement;
  private toolbar!: HTMLElement;
  private environment!: HTMLElement;
  private body!: HTMLElement;
  private controls: HTMLButtonElement[] = [];
  private connectButton!: HTMLButtonElement;
  private addButton!: HTMLButtonElement;
  private runButton!: HTMLButtonElement;
  private saveButton!: HTMLButtonElement;
  private stopButton!: HTMLButtonElement;
  private interruptButton!: HTMLButtonElement;
  private formatButton!: HTMLButtonElement;
  private staleButton!: HTMLButtonElement;
  private restoreButton!: HTMLButtonElement;
  private notice!: HTMLElement;
  private previewNote!: HTMLElement;
  private info!: HTMLElement;
  private busy = false;
  private closed = false;
  private closing:Promise<void>|null=null;
  private dirty = false;
  /** Codes of the notebook exactly as read from the file; drafts compare against it. */
  private baseCodes: string[] = [];
  private runPhase: RunPhase = 'none';
  private changedSinceRun = false;
  private stopping = false;
  private hasDraft = false;
  private selectedId: string | null = null;
  private operation = 0;
  /** Latest unsent value per widget, so a fast drag cannot pile up cycles. */
  private widgetPending = new Map<string, unknown>();
  private widgetFlush: Promise<void>|null = null;
  /** Owns Mod-Enter while this view is active; see `onOpen`. */
  private keyScope: Scope|null = null;
  /** The open per-cell popover, if any, and its outside-click handler. */
  private cellMenu: HTMLElement|null = null;
  private menuDismiss: ((event:Event)=>void)|null = null;
  /** Rendered markdown preview per markdown cell; the code stays folded. */
  private markdownPreviews = new Map<string, HTMLElement>();
  /** Markdown cells whose Python source the user explicitly opened. */
  private markdownSourceOpen = new Set<string>();
  private markdownTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Guards `MarkdownRenderer.render` races: only the latest pass may paint. */
  private markdownSeqs = new Map<string, number>();
  constructor(leaf: WorkspaceLeaf, private plugin: MarimoPlugin) {super(leaf);}
  isClosed():boolean {return this.closed;}
  getViewType(): string {return VIEW_TYPE;}
  getDisplayText(): string {return this.file?.basename||this.filename.split('/').pop()||'MarimoNotebook';}
  canAcceptExtension(extension:string):boolean {return extension.toLowerCase()==='py';}
  getIcon(): string {return 'notebook-pen';}
  getState(): Record<string, unknown> {return {...super.getState(),file:this.file?.path||this.filename,filename:this.file?.path||this.filename};}
  async setState(state: unknown, result: ViewStateResult): Promise<void> {
    const filename=fileFromViewState(state);
    await super.setState({...((state&&typeof state==='object')?state:{}),file:filename},result);
  }

  // ---------------------------------------------------------------- state

  private connection(): ConnectionState {
    // A backend object exists before its process reports ready; the toolbar must
    // stay in `connecting` until the session is actually usable.
    return connectionState({hasBackend:this.backend!==null, connecting:this.connecting});
  }
  private updateStatus(): void {
    const view = statusView({connection:this.connection(), run:this.runPhase, dirty:this.dirty, changedSinceRun:this.changedSinceRun, stopping:this.stopping}, this.plugin.t.bind(this.plugin));
    if (this.status.textContent !== view.text) this.status.setText(view.text);
    this.status.dataset.tone = view.tone;
  }
  private updateControls(): void {
    const available = toolbarAvailability({connection:this.connection(), run:this.runPhase, ready:this.notebookReady, hasDraft:this.hasDraft, stopping:this.stopping, busy:this.busy, hasStale:this.hasStaleCells()});
    this.connectButton.hidden = !this.notebookReady || this.connection() !== 'disconnected';
    this.connectButton.disabled = !available.connect;
    this.runButton.disabled = !available.runAll;
    this.saveButton.disabled = !available.save;
    this.stopButton.disabled = !available.stop;
    this.restoreButton.hidden = !available.restore;
    this.interruptButton.hidden = !available.interrupt;
    this.interruptButton.disabled = !available.interrupt;
    this.formatButton.disabled = !available.format;
    this.staleButton.disabled = !available.runStale;
    this.info.hidden = !showPrototypeInfo({ready:this.notebookReady, connection:this.connection()});
    this.body.querySelectorAll<HTMLButtonElement>('button[data-action="run-cell"]').forEach(button => {button.disabled = !available.runAll || button.closest('.marimo-native-cell')?.classList.contains('is-disabled') === true;});
    this.updateCellActions();
    this.updateStatus();
  }

  /** Any row the kernel flagged with stale inputs, or edited since its last run. */
  private hasStaleCells(): boolean {
    if(!this.body) return false;
    return !!this.body.querySelector('.marimo-native-cell[data-stale="true"], .marimo-native-cell[data-cell-status="stale"]');
  }
  private staleCells(): Cell[] {
    const codes=new Map(this.readCells().map(cell=>[cell.id,cell]));
    return Array.from(this.body.querySelectorAll<HTMLElement>('.marimo-native-cell[data-stale="true"], .marimo-native-cell[data-cell-status="stale"]'))
      .map(row=>codes.get(row.dataset.cellId??''))
      .filter((cell): cell is Cell=>cell!==undefined);
  }
  /**
   * The kernel only reports `stale_inputs` in narrow cases; the edit that makes
   * a cell out of date happens in this editor, so it is tracked here. A cell-op
   * that reports execution clears the mark again.
   */
  private markCellStale(cellId:string):void {
    const row=this.rowFor(cellId);
    if(!row||row.dataset.stale==='true')return;
    row.dataset.stale='true';
    this.refreshStaleButton();
  }
  private refreshStaleButton():void {
    if(!this.staleButton)return;
    this.staleButton.disabled=!toolbarAvailability({connection:this.connection(),run:this.runPhase,ready:this.notebookReady,hasDraft:this.hasDraft,stopping:this.stopping,busy:this.busy,hasStale:this.hasStaleCells()}).runStale;
  }

  /** Structural actions depend on the cell's position, so they are set per row. */
  private updateCellActions(): void {
    if(!this.body) return;
    const state = {connection:this.connection(), run:this.runPhase, busy:this.busy};
    if(this.addButton) this.addButton.disabled = !cellActions({...state, count:this.cells.length, index:-1}).add;
    const rows = Array.from(this.body.querySelectorAll<HTMLElement>('.marimo-native-cell'));
    rows.forEach((row, index) => {
      const available = cellActions({...state, count:rows.length, index});
      const button = (action:string) => row.querySelector<HTMLButtonElement>(`button[data-action="${action}"]`);
      const insert = button('cell-insert'); if(insert) insert.disabled = !available.add;
      const up = button('cell-up'); if(up) up.disabled = !available.up;
      const down = button('cell-down'); if(down) down.disabled = !available.down;
      const remove = button('cell-remove'); if(remove) remove.disabled = !available.remove;
    });
  }
  private refreshEnvironment(): void {
    const python = this.plugin.getPythonPath();
    this.environment.setText(environmentLabel(python));
    this.environment.setAttr('title', python);
  }
  private setCellsReadOnly(): void {
    // reconfigure() only builds the effect; it must be dispatched into the view.
    for (const editor of this.editors.values()) editor.view.dispatch({effects: editor.editable.reconfigure([EditorState.readOnly.of(true), EditorView.editable.of(false)])});
  }
  private showNotice(message: string, tone: 'error'|'info'): void {
    this.notice.setText(message);
    this.notice.dataset.tone = tone;
    this.notice.hidden = !message;
  }

  // ---------------------------------------------------------------- file

  async onLoadFile(file:TFile):Promise<void> {
    const generation=++this.loadGeneration;
    this.inspection?.abort();
    const inspection=new AbortController();this.inspection=inspection;
    this.filename=file.path;this.closed=false;this.notebookReady=false;this.connecting=false;this.baseCodes=[];
    this.runPhase='none';this.changedSinceRun=false;this.dirty=false;this.stopping=false;
    this.hasDraft=false;this.selectedId=null;
    this.showNotice('','info');
    this.updateControls();
    try {
      const source=await this.app.vault.read(file);
      if(generation!==this.loadGeneration||this.closed)return;
      this.showSource(source, this.plugin.t('读取中…','Reading…'));
      const preview=await inspectSource(this.plugin.getPythonPath(),source,inspectorSource,{signal:inspection.signal});
      if(generation!==this.loadGeneration||this.closed)return;
      if(preview.error){
        this.showSource(source, this.plugin.t('只读源码','Read-only source'));
        this.showNotice(this.plugin.t('无法预览单元格：','Could not preview cells: ')+preview.error,'error');
        return;
      }
      this.notebookReady=preview.isMarimo;
      if(preview.isMarimo){
        this.cells=preview.cells;this.baseCodes=preview.cells.map(cell=>cell.code);this.renderCells(true);
        // A draft is worth advertising before connecting: the read-only
        // preview already shows the restore offer.
        this.refreshRecovery();
      }
      else this.showSource(source, this.plugin.t('普通 Python 脚本 · 只读','Python script · read-only'));
      this.updateControls();
    }catch(error){
      if(generation===this.loadGeneration&&!this.closed)this.showNotice(this.plugin.t('预览失败，原始源码仍可查看：','Preview failed; original source is still available: ')+String(error),'error');
    }
    finally{if(this.inspection===inspection)this.inspection=null;}
  }
  async onUnloadFile(_file:TFile):Promise<void> {
    this.loadGeneration++;
    await this.releaseFileSession();
    this.filename='';
  }
  async onRename(file:TFile):Promise<void> {
    if(file!==this.file||file.path===this.filename)return;
    await super.onRename(file);
    this.loadGeneration++;this.inspection?.abort();this.connecting=false;this.stopping=false;
    this.disconnect();
    this.filename=file.path;
    this.persistDraft();
    this.showNotice(this.plugin.t('文件已重命名，请重新连接。','File renamed; reconnect to continue.'),'info');
    this.updateControls();
  }

  // ---------------------------------------------------------------- shell

  async onOpen(): Promise<void> {
    this.contentEl.empty();this.contentEl.addClass('marimo-native');
    this.toolbar = this.contentEl.createDiv({cls:'marimo-native-toolbar'});
    this.toolbar.setAttribute('role','toolbar');
    this.toolbar.setAttribute('aria-label',this.plugin.t('Notebook 操作','Notebook actions'));

    this.connectButton = this.createAction('connect', this.plugin.t('连接并运行','Connect and run'), 'plug-zap', true, () => void this.connect());
    this.connectButton.addClass('mod-cta');
    this.addButton = this.createAction('add-cell', this.plugin.t('新增单元格','Add cell'), 'plus', false, () => void this.insertAfter(this.selectedId));
    this.runButton = this.createAction('run-all', this.plugin.t('运行全部','Run all'), 'play', true, () => void this.perform('run', this.readCells()));
    this.staleButton = this.createAction('run-stale', this.plugin.t('运行陈旧','Run stale'), 'refresh-cw', false, () => void this.runStale());
    this.staleButton.setAttr('aria-label', this.plugin.t('运行输入已变化的单元格','Run cells with stale inputs'));
    this.staleButton.setAttr('title', this.plugin.t('运行输入已变化的单元格','Run cells with stale inputs'));
    this.saveButton = this.createAction('save', this.plugin.t('保存','Save'), 'save', false, () => void this.perform('save', this.readCells()));
    this.formatButton = this.createAction('format', this.plugin.t('格式化','Format'), 'sparkles', false, () => void this.formatCells());
    this.formatButton.setAttr('aria-label', this.plugin.t('用 ruff 格式化全部单元格','Format all cells with ruff'));
    this.formatButton.setAttr('title', this.plugin.t('用 ruff 格式化全部单元格','Format all cells with ruff'));
    this.interruptButton = this.createAction('interrupt', this.plugin.t('中断运行','Interrupt run'), 'circle-stop', true, () => void this.interrupt());
    this.interruptButton.hidden = true;
    this.stopButton = this.createAction('stop', this.plugin.t('停止并断开','Stop and disconnect'), 'square', false, () => void this.stop());
    this.restoreButton = this.createAction('restore', this.plugin.t('恢复草稿','Restore draft'), 'history', false, () => this.restoreDraft());
    this.controls = [this.runButton, this.saveButton];

    this.toolbar.createDiv({cls:'marimo-native-spacer'});
    this.environment = this.toolbar.createSpan({cls:'marimo-native-environment'});
    this.status = this.toolbar.createSpan({cls:'marimo-native-status', text:this.plugin.t('未连接','Not connected')});
    this.status.setAttribute('role','status');
    this.status.setAttribute('aria-live','polite');

    this.info = this.contentEl.createDiv({cls:'marimo-native-info',text:this.plugin.t('实验原型 · 连接会启动本地 Python，运行代码拥有当前用户权限。仅打开可信文件。','Experimental prototype · Connecting starts local Python. Code runs with your user permissions. Open trusted files only.')});
    this.notice = this.contentEl.createDiv({cls:'marimo-native-notice'});
    this.notice.setAttribute('role','alert');
    this.notice.hidden = true;
    this.previewNote = this.contentEl.createDiv({cls:'marimo-native-preview-note'});
    this.previewNote.hidden = true;
    this.body = this.contentEl.createDiv({cls:'marimo-native-cells'});

    this.refreshEnvironment();
    // Obsidian's editor keymap claims Mod-Enter before CodeMirror sees it, so the
    // shortcut is registered on a scope of our own. The scope stays pushed while
    // the view exists but only acts when this view is the active one.
    const scope=new Scope(this.app.scope);
    scope.register(['Mod'],'Enter',()=>{
      if(this.closed||this.app.workspace.getActiveViewOfType(MarimoView)!==this)return true;
      const cellId=document.activeElement?.closest<HTMLElement>('.marimo-native-cell')?.dataset.cellId;
      if(!cellId)return true;
      void this.runCell(cellId);
      return false;
    });
    this.app.keymap.pushScope(scope);
    this.keyScope=scope;
    this.updateControls();
  }

  private createAction(action:string, label:string, icon:string, withText:boolean, onClick:()=>void):HTMLButtonElement {
    const button = this.toolbar.createEl('button',{cls:'marimo-native-action'});
    button.dataset.action = action;
    button.setAttr('aria-label', label);
    button.setAttr('title', label);
    setIcon(button, icon);
    if (withText) button.createSpan({text:label});
    else button.addClass('is-icon-only');
    button.onclick = onClick;
    return button;
  }

  private showSource(source:string, caption:string):void {
    this.sourceEditor?.destroy();this.sourceEditor=null;this.body.empty();
    this.previewNote.hidden = true;
    const panel = this.body.createDiv({cls:'marimo-native-source-panel'});
    panel.createDiv({cls:'marimo-native-source-caption',text:caption});
    const host=panel.createDiv({cls:'marimo-native-editor marimo-native-source'});
    this.sourceEditor=new EditorView({parent:host,state:EditorState.create({doc:source,extensions:[python(),lineNumbers(),highlightActiveLine(),highlightActiveLineGutter(),syntaxHighlighting(nativeHighlight),EditorState.readOnly.of(true),EditorView.editable.of(false),EditorView.lineWrapping]})});
  }

  // ---------------------------------------------------------------- session

  private async connect(): Promise<void> {
    if(this.backend || this.closed || this.connecting || this.stopping || !this.notebookReady) return;
    const filename=this.filename;const generation=this.loadGeneration;
    // Claiming a session invalidates any older stop/request that still awaits work.
    this.connecting=true;this.operation++;this.runPhase='none';this.changedSinceRun=false;
    this.updateControls();
    try {
      const lease=await this.plugin.claim(filename, this);
      // stop() or a file switch during the claim: release instead of starting a kernel.
      if(!canAdoptClaim({generation},{generation:this.loadGeneration,closed:this.closed,stopping:this.stopping})) {this.plugin.release(lease);return;}
      this.lease=lease;
      const backend = new Backend(this.plugin.getPythonPath(), this.plugin.absolutePath(this.filename), frame => {if(this.backend===backend)this.receive(frame);});
      this.backend = backend;
      await backend.start();
      if(this.closed||this.backend!==backend) {if(this.lease===lease)this.lease=null;this.plugin.release(lease);void backend.close(); return;}
      this.showNotice('','info');
      this.refreshEnvironment();
      this.refreshRecovery();
    } catch(error) {
      if(generation!==this.loadGeneration||this.closed)return;
      this.disconnect();
      this.showNotice(String(error),'error');
      new Notice(String(error));
    }finally{
      if(generation===this.loadGeneration)this.connecting=false;
      this.updateControls();
    }
  }

  /** Real disconnect: wait for our own adapter/process group to exit. */
  private async stop(): Promise<void> {
    if(this.stopping||this.closed) return;
    if(!this.backend && !this.connecting) return;
    // Invalidate a claim/start that is still awaited: it must not spawn a kernel
    // after the user has already asked to stop.
    const generation=++this.loadGeneration;
    const operation=++this.operation;
    this.stopping=true;
    this.updateControls();
    const backend=this.backend;
    this.backend=null;
    this.connecting=false;
    this.busy=false;
    this.widgetPending.clear();
    this.persistDraft();
    this.setCellsReadOnly();
    this.clearCellStatuses();
    const lease=this.lease;this.lease=null;
    try{await backend?.close();}
    catch(error){if(this.loadGeneration===generation)this.showNotice(String(error),'error');}
    finally{
      this.plugin.release(lease);
      // The session may have been replaced while the process was closing; only the
      // stop that still owns this file session may reset its state.
      if(shouldApplyStopResult({generation,operation},{generation:this.loadGeneration,operation:this.operation})){
        this.runPhase='none';this.changedSinceRun=false;
        this.stopping=false;
        this.refreshRecovery();
      }
    }
  }

  private readCells(): Cell[] {return this.cells.map(cell => ({...cell, code:this.editors.get(cell.id)?.view.state.doc.toString() ?? cell.code}));}
  private async perform(method: 'run'|'save', cells: Cell[]): Promise<void> {
    if(!this.backend || this.busy || this.closed || this.connecting) return;
    const backend=this.backend;const operation=++this.operation;
    this.busy = true;
    if(method==='run'){this.runPhase='running';this.changedSinceRun=false;}
    this.updateControls();
    try {
      await backend.request(method, {cells});
      if(!shouldApplyResult({backend,operation},{backend:this.backend,operation:this.operation})) return;
      if(method==='save') {
        this.dirty = JSON.stringify(this.readCells())!==JSON.stringify(cells);
        this.cells=cells.map(cell=>({...cell}));
        this.baseCodes=cells.map(cell=>cell.code);
        if(!this.dirty)this.plugin.recovery.remove(this.filename);
        this.refreshRecovery();
      } else if(this.runPhase==='running') this.runPhase='finished';
    } catch(error) {
      // A stop()/disconnect() during the request already reported the session end;
      // its error must not surface as a run failure of the ended session.
      if(!shouldApplyResult({backend,operation},{backend:this.backend,operation:this.operation})) return;
      if(!this.closed) {this.disconnect();this.showNotice(String(error),'error'); new Notice(String(error));}
    }
    finally {
      if(operation===this.operation){this.busy=false; if(!this.closed)this.updateControls();}
    }
  }

  /** Cancel the in-flight run but keep the kernel and the edits. */
  private async interrupt(): Promise<void> {
    if(!this.backend || this.closed || this.connecting || this.stopping || this.runPhase!=='running') return;
    const backend=this.backend;
    try { await backend.request('interrupt'); }
    catch(error) { if(this.backend===backend && !this.closed) this.showNotice(String(error),'error'); }
    // The run request is still in flight; it publishes `interrupted` itself.
    if(!this.closed) this.updateControls();
  }

  /** Answer a pending `input()`; the prompt row is replaced by the answer. */
  private async answerStdin(value:string, row:HTMLElement): Promise<void> {
    const backend=this.backend;
    if(!backend||row.classList.contains('is-sending')) return;
    row.classList.add('is-sending');
    try {
      await backend.request('stdin', {value});
      row.removeClass('is-sending');
      row.empty();
      row.addClass('is-answered');
      row.createSpan({cls:'marimo-native-stdin-prompt',text:'>'});
      row.createSpan({cls:'marimo-native-stdin-answer',text:value});
    } catch(error) {
      row.removeClass('is-sending');
      this.showNotice(String(error),'error');
    }
  }

  /**
   * A widget change is a reactive cycle of its own. Values are coalesced per
   * element and sent one at a time: two cycles must never share the socket.
   */
  private queueWidgetValue(objectId: string, value: unknown): void {
    if(this.closed||!this.backend) return;
    this.widgetPending.set(objectId,value);
    if(!this.widgetFlush) this.widgetFlush=this.flushWidgetQueue().finally(()=>{this.widgetFlush=null;});
  }

  private async flushWidgetQueue(): Promise<void> {
    while(this.widgetPending.size) {
      const backend=this.backend;
      if(!backend||this.closed||this.connecting||this.stopping) {this.widgetPending.clear();return;}
      const [objectId,value]=this.widgetPending.entries().next().value as [string,unknown];
      this.widgetPending.delete(objectId);
      const operation=++this.operation;
      this.busy=true;this.runPhase='running';this.updateControls();
      try {
        await backend.request('ui',{objectId,widgetValue:value});
        if(!shouldApplyResult({backend,operation},{backend:this.backend,operation:this.operation})) return;
        if(this.runPhase==='running')this.runPhase='finished';
      } catch(error) {
        if(!shouldApplyResult({backend,operation},{backend:this.backend,operation:this.operation})) return;
        this.widgetPending.clear();
        if(!this.closed){this.disconnect();this.showNotice(String(error),'error');new Notice(String(error));}
        return;
      } finally {
        if(operation===this.operation){this.busy=false;if(!this.closed)this.updateControls();}
      }
    }
  }

  private receive(frame: BackendMessage): void {
    if(this.closed) return;
    if(frame.type==='ready') {
      // The draft is compared against the file it was taken from, never against
      // the edited model, which may now hold added or removed cells.
      const edits=this.dirty?this.readCells():null;
      const fileCodes=frame.cells.map(cell=>cell.code);
      if(edits && JSON.stringify(this.baseCodes)!==JSON.stringify(fileCodes)) {
        this.disconnect();
        this.showNotice(this.plugin.t('原文件已变化，编辑草稿已保留。','Original file changed; edited draft retained.'),'error');
        return;
      }
      this.cells=frame.cells; this.baseCodes=fileCodes; this.renderCells(false);
      // The adapter streams the first cycle after `ready`, so the notebook is
      // executing at this point; `completed-run` publishes the final phase.
      this.runPhase='running';
      this.changedSinceRun=false;
      this.updateControls();
      if(edits) void this.reapplyLocal(edits);
    }
    if(frame.type==='error') {this.disconnect();this.showNotice(frame.error,'error');this.updateControls();}
    if(frame.type!=='event') return;
    const data = frame.data;
    // marimo announces an interrupt with its own event; the following
    // `completed-run` still reports `succeeded`, so order matters here.
    if(data.op==='interrupted') {this.runPhase='interrupted'; this.updateControls(); return;}
    if(data.op==='completed-run') {
      // `interrupted` must not read as a failure or as a successful run.
      if(data.outcome==='failed') this.runPhase='failed';
      else if(data.outcome==='interrupted') this.runPhase='interrupted';
      else if(this.runPhase!=='interrupted') this.runPhase='finished';
      // Availability changes with the phase: run replaces interrupt.
      this.updateControls();
      return;
    }
    if(data.op!=='cell-op') return;
    const target = this.outputs.get(String(data.cell_id));
    if(!target) return;
    const display=target.querySelector<HTMLElement>('.marimo-native-display')!;
    const consoleEl=target.querySelector<HTMLElement>('.marimo-native-console')!;
    if(data.output) {
      if((data.output as Record<string,unknown>).channel==='marimo-error')this.runPhase='failed';
      // A markdown cell paints itself locally with Obsidian's renderer; the
      // kernel's pre-rendered copy would only duplicate it. Console output and
      // errors always pass through.
      const row=target.closest('.marimo-native-cell');
      const suppress=!!row?.classList.contains('is-markdown') && (data.output as Record<string,unknown>).mimetype==='text/markdown';
      display.empty();
      if(!suppress)this.renderOutput(display, data.output);
    }
    if(Array.isArray(data.console)) {if(data.console.length===0)consoleEl.empty(); else for(const output of data.console)this.renderOutput(consoleEl,output);}
    else if(data.console) this.renderOutput(consoleEl,data.console);
    this.syncOutputState(target);
    const cellStatus=normalizeCellStatus(data.status, data.stale_inputs);
    if(cellStatus!=='unknown')this.applyCellStatus(String(data.cell_id),cellStatus);
    this.updateStatus();
  }

  // ---------------------------------------------------------------- cells

  private renderCells(readOnly=false): void {
    this.sourceEditor?.destroy();this.sourceEditor=null;
    for(const editor of this.editors.values()) editor.view.destroy();
    this.editors.clear(); this.outputs.clear();
    this.markdownPreviews.clear(); this.markdownSourceOpen.clear(); this.markdownSeqs.clear();
    for(const timer of this.markdownTimers.values()) clearTimeout(timer);
    this.markdownTimers.clear();
    this.body.empty();
    this.previewNote.hidden = !readOnly;
    if(readOnly) this.previewNote.setText(this.plugin.t('只读预览 · 连接后可编辑并运行单元格','Read-only preview · Connect to edit and run cells'));
    if(!this.cells.length) {
      this.body.createDiv({cls:'marimo-native-empty',text:this.plugin.t('此 Notebook 没有单元格。','This notebook has no cells.')});
      return;
    }
    for(const cell of this.cells) this.renderCell(cell, readOnly);
    // Re-rendering replaces every row, so the previous selection must be restored
    // or the accent rail would silently vanish after connecting.
    if(this.selectedId && this.cells.some(cell=>cell.id===this.selectedId)) this.selectCell(this.selectedId, true);
    this.updateControls();
  }

  private renderCell(cell:Cell, readOnly:boolean): HTMLElement {
    const config=readCellConfig(cell.config);
    cell.config=config;
    const presentation=cellPresentation(config);
    const row=this.body.createDiv({cls:'marimo-native-cell'});
    row.dataset.cellId = cell.id;
    row.addEventListener('pointerdown',()=>this.selectCell(cell.id));
    row.addEventListener('focusin',()=>this.selectCell(cell.id));

    const gutter=row.createDiv({cls:'marimo-native-gutter'});
    const run=gutter.createEl('button',{cls:'marimo-native-run'});
    run.dataset.action='run-cell';
    run.hidden=readOnly;
    // A disabled cell can be edited but never executed; the kernel would skip it.
    run.disabled=presentation.disabled;
    run.setAttr('aria-label',this.plugin.t('运行此块','Run this cell'));
    run.setAttr('title',this.plugin.t('运行此块','Run this cell'));
    setIcon(run,'play');
    run.onclick=()=>void this.runCell(cell.id);

    const content=row.createDiv({cls:'marimo-native-cell-content'});
    // A cell that is just `mo.md(<literal>)` is prose: Obsidian renders its
    // markdown natively and the Python wrapper stays folded until asked for.
    const markdown=this.plugin.settings.renderMarkdown?parseMarkdownCell(cell.code):null;
    if(markdown) {
      row.addClass('is-markdown');
      if(this.markdownSourceOpen.has(cell.id)) row.addClass('is-source-open');
    }
    const preview=content.createDiv({cls:'marimo-native-markdown'});
    preview.setAttr('aria-label',this.plugin.t('Markdown 单元格 · 点击编辑源码','Markdown cell · click to edit source'));
    if(markdown) {
      this.markdownPreviews.set(cell.id,preview);
      preview.addEventListener('click',()=>{this.openMarkdownSource(cell.id);});
      void this.renderMarkdownPreview(cell.id,markdown.markdown);
    }
    const host=content.createDiv({cls:'marimo-native-editor'});
    const editable=new Compartment();
    const editor=new EditorView({parent:host,state:EditorState.create({doc:cell.code,extensions:[editable.of([EditorState.readOnly.of(readOnly),EditorView.editable.of(!readOnly)]),python(),lineNumbers(),highlightActiveLine(),highlightActiveLineGutter(),history(),
      // Notebook gestures come before the default keymap so Shift-Enter runs
      // instead of inserting a newline.
      keymap.of([
        {key:'Mod-Enter', run:()=>{void this.runCell(cell.id);return true;}},
        {key:'Shift-Enter', run:()=>{void this.runCellAndAdvance(cell.id);return true;}},
      ]),
      autocompletion({override:[context=>this.completeAt(cell.id,context)],activateOnTyping:true}),
      keymap.of([...defaultKeymap,...historyKeymap]),syntaxHighlighting(nativeHighlight),EditorView.lineWrapping,EditorView.updateListener.of(update=>{
      if(update.focusChanged&&update.view.hasFocus)this.selectCell(cell.id);
      if(update.docChanged){
        this.dirty=true;
        if(this.runPhase!=='none')this.changedSinceRun=true;
        this.updateStatus();
        // The code no longer matches what the kernel executed.
        this.markCellStale(cell.id);
        this.scheduleMarkdownRefresh(cell.id);
      }
    }),EditorView.theme({'&':{fontFamily:'var(--font-monospace)',fontSize:'var(--code-size)'},'.cm-content':{caretColor:'var(--text-normal)'},'.cm-gutters':{backgroundColor:'transparent',color:'var(--text-faint)',border:'none'},'&.cm-focused':{outline:'none'}})]})});
    this.editors.set(cell.id,{view:editor,editable});
    if(!readOnly) {
      // Hover-revealed so the notebook reads as prose, not as a control panel.
      const actions=content.createDiv({cls:'marimo-native-cell-actions'});
      // Only meaningful on markdown rows; CSS hides it everywhere else so the
      // button can appear the moment an edit turns a cell into prose.
      this.cellAction(actions,'cell-source','code',this.plugin.t('查看/折叠源码','Toggle source'),() => this.toggleMarkdownSource(cell.id));
      this.cellAction(actions,'cell-insert','plus',this.plugin.t('在下方插入单元格','Insert cell below'),() => void this.insertAfter(cell.id));
      this.cellAction(actions,'cell-up','arrow-up',this.plugin.t('上移','Move up'),() => this.shiftCell(cell.id,-1));
      this.cellAction(actions,'cell-down','arrow-down',this.plugin.t('下移','Move down'),() => this.shiftCell(cell.id,1));
      this.cellAction(actions,'cell-config','more-horizontal',this.plugin.t('单元格设置','Cell settings'),(event) => this.toggleCellMenu(event.currentTarget as HTMLElement,cell.id));
      this.cellAction(actions,'cell-remove','trash-2',this.plugin.t('删除此单元格','Delete this cell'),() => void this.deleteCell(cell.id));
    }
    const output=content.createDiv({cls:'marimo-native-output markdown-rendered'});
    output.createDiv({cls:'marimo-native-display'});
    output.createDiv({cls:'marimo-native-console'});
    this.outputs.set(cell.id,output);
    this.applyCellConfig(row,cell.id);
    return row;
  }

  /** Reflect one cell's config onto its row without rebuilding the editor. */
  private applyCellConfig(row:HTMLElement, cellId:string): void {
    const cell=this.cells.find(item=>item.id===cellId);
    const presentation=cellPresentation(readCellConfig(cell?.config));
    row.toggleClass('is-disabled',presentation.disabled);
    row.toggleClass('is-code-hidden',presentation.hideCode);
    row.toggleClass('is-output-clamped',presentation.clampOutput);
    const run=row.querySelector<HTMLButtonElement>('button[data-action="run-cell"]');
    // `updateControls` owns the rest of the availability rules.
    if(run)run.disabled=presentation.disabled;
    // CodeMirror measures on its own, but a hidden host has a zero size.
    if(!presentation.hideCode)this.editors.get(cellId)?.view.requestMeasure();
  }

  // ------------------------------------------------------------ markdown cells

  /** Folded source is one click away; folding again repaints the preview. */
  private toggleMarkdownSource(cellId:string): void {
    const row=this.rowFor(cellId);
    if(!row)return;
    if(row.hasClass('is-source-open'))this.closeMarkdownSource(cellId);
    else this.openMarkdownSource(cellId);
  }
  private openMarkdownSource(cellId:string): void {
    const row=this.rowFor(cellId);
    if(!row||!row.hasClass('is-markdown'))return;
    row.addClass('is-source-open');
    this.markdownSourceOpen.add(cellId);
    this.editors.get(cellId)?.view.focus();
  }
  private closeMarkdownSource(cellId:string): void {
    this.rowFor(cellId)?.removeClass('is-source-open');
    this.markdownSourceOpen.delete(cellId);
    this.refreshMarkdownNow(cellId);
  }

  private scheduleMarkdownRefresh(cellId:string): void {
    const timer=this.markdownTimers.get(cellId);
    if(timer)clearTimeout(timer);
    this.markdownTimers.set(cellId,setTimeout(()=>{
      this.markdownTimers.delete(cellId);
      this.refreshMarkdownNow(cellId);
    },250));
  }

  /**
   * Re-parse the edited code: repaint the preview while it stays static
   * markdown, or fall back to a plain kernel-driven cell when it does not.
   */
  private refreshMarkdownNow(cellId:string): void {
    const row=this.rowFor(cellId);
    const editor=this.editors.get(cellId);
    if(!row||!editor)return;
    const parsed=parseMarkdownCell(editor.view.state.doc.toString());
    if(!parsed) {
      row.removeClass('is-markdown','is-source-open');
      this.markdownSourceOpen.delete(cellId);
      // The stale preview must not linger next to the real kernel output.
      this.markdownPreviews.get(cellId)?.empty();
      this.markdownPreviews.delete(cellId);
      editor.view.requestMeasure();
      return;
    }
    row.addClass('is-markdown');
    // A previous non-markdown edit dropped the container registration; the
    // preview element itself is still in the row, so re-attach it.
    const preview=row.querySelector<HTMLElement>('.marimo-native-markdown');
    if(preview)this.markdownPreviews.set(cellId,preview);
    if(!row.hasClass('is-source-open'))void this.renderMarkdownPreview(cellId,parsed.markdown);
  }

  /** Paint the cell's markdown with Obsidian's own renderer. */
  private async renderMarkdownPreview(cellId:string, text:string): Promise<void> {
    const target=this.markdownPreviews.get(cellId);
    if(!target)return;
    const seq=(this.markdownSeqs.get(cellId)??0)+1;
    this.markdownSeqs.set(cellId,seq);
    const sink=document.createElement('div');
    try{
      await MarkdownRenderer.render(this.app,text,sink,this.filename,this);
    }catch(error){
      // A failed render must not leave a blank cell; plain text stays readable.
      console.error('marimo markdown render failed',error);
      sink.createDiv({cls:'marimo-native-text',text});
    }
    // A newer edit or a rebuilt row owns the container now.
    if(seq!==this.markdownSeqs.get(cellId)||this.markdownPreviews.get(cellId)!==target)return;
    target.empty();
    while(sink.firstChild)target.appendChild(sink.firstChild);
  }

  /**
   * The cell menu is a small popover of our own rather than `Menu`: the host
   * menu is drawn by a native layer, which makes it impossible to verify and
   * leaves the notebook with two visual languages.
   */
  private toggleCellMenu(button:HTMLElement, cellId:string): void {
    if(this.cellMenu?.dataset.cellId===cellId){this.closeCellMenu();return;}
    this.closeCellMenu();
    const row=this.rowFor(cellId);
    const cell=this.cells.find(item=>item.id===cellId);
    if(!row||!cell)return;
    const config=readCellConfig(cell.config);
    const menu=row.createDiv({cls:'marimo-native-cell-menu'});
    menu.dataset.cellId=cellId;
    menu.setAttribute('role','menu');
    menu.setAttribute('aria-label',this.plugin.t('单元格设置','Cell settings'));
    const item=(action:string, icon:string, label:string, onClick:()=>void) => {
      const entry=menu.createEl('button',{cls:'marimo-native-cell-menu-item'});
      entry.dataset.menuAction=action;
      entry.setAttribute('role','menuitem');
      setIcon(entry,icon);
      entry.createSpan({text:label});
      entry.onclick=event=>{event.stopPropagation();this.closeCellMenu();onClick();};
      return entry;
    };
    item('hide-code',config.hideCode?'eye':'eye-off',config.hideCode?this.plugin.t('显示代码','Show code'):this.plugin.t('隐藏代码','Hide code'),()=>void this.setCellConfig(cellId,{hideCode:!config.hideCode}));
    item('toggle-disabled','power',config.disabled?this.plugin.t('启用此单元格','Enable this cell'):this.plugin.t('禁用此单元格','Disable this cell'),()=>void this.setCellConfig(cellId,{disabled:!config.disabled}));
    item('toggle-expand',config.expandOutput?'minimize-2':'maximize-2',config.expandOutput?this.plugin.t('折叠输出','Collapse output'):this.plugin.t('展开输出','Expand output'),()=>void this.setCellConfig(cellId,{expandOutput:!config.expandOutput}));
    this.cellMenu=menu;
    // A later interaction elsewhere closes it; this click is already finished.
    this.menuDismiss=(event:Event)=>{if(!menu.contains(event.target as Node))this.closeCellMenu();};
    document.addEventListener('pointerdown',this.menuDismiss,{capture:true});
    document.addEventListener('keydown',this.menuKey,{capture:true});
    // The button stays the visual anchor even when the row is scrolled.
    button.setAttribute('aria-expanded','true');
  }

  private closeCellMenu(): void {
    if(this.menuDismiss){document.removeEventListener('pointerdown',this.menuDismiss,{capture:true});this.menuDismiss=null;}
    document.removeEventListener('keydown',this.menuKey,{capture:true});
    this.cellMenu?.parentElement?.querySelectorAll<HTMLElement>('[data-action="cell-config"]').forEach(button=>button.setAttribute('aria-expanded','false'));
    this.cellMenu?.remove();
    this.cellMenu=null;
  }

  private menuKey=(event:KeyboardEvent):void => {
    if(event.key==='Escape'){event.stopPropagation();this.closeCellMenu();}
  };

  private cellAction(parent:HTMLElement, action:string, icon:string, label:string, onClick:(event:MouseEvent)=>void):HTMLButtonElement {
    const button=parent.createEl('button',{cls:'marimo-native-cell-action'});
    button.dataset.action=action;
    button.setAttr('aria-label',label);
    button.setAttr('title',label);
    setIcon(button,icon);
    button.onclick=event=>{event.stopPropagation();onClick(event);};
    return button;
  }

  private selectCell(id:string, force=false): void {
    if(this.selectedId===id && !force) return;
    this.selectedId=id;
    this.body.querySelectorAll<HTMLElement>('.marimo-native-cell').forEach(row=>{row.toggleClass('is-selected',row.dataset.cellId===id);});
  }

  // ------------------------------------------------------- cell structure

  /** Structural edits own the session like a run does: one operation at a time. */
  private canEditStructure():boolean {
    return !!this.backend && !this.busy && !this.closed && !this.connecting && !this.stopping;
  }
  private markStructuralChange():void {
    this.dirty=true;
    if(this.runPhase!=='none')this.changedSinceRun=true;
  }
  private structureFailed(backend:Backend, operation:number, error:unknown):void {
    if(!shouldApplyResult({backend,operation},{backend:this.backend,operation:this.operation}))return;
    if(!this.closed){this.disconnect();this.showNotice(String(error),'error');new Notice(String(error));}
  }

  /** Insert an empty cell after `afterId`; with no selection it goes last. */
  private async insertAfter(afterId:string|null):Promise<void> {
    const backend=this.backend;
    if(!backend||!this.canEditStructure())return;
    const operation=++this.operation;
    this.busy=true;this.updateControls();
    try {
      const created=await backend.request('create');
      if(!shouldApplyResult({backend,operation},{backend:this.backend,operation:this.operation}))return;
      const id=created.cellId;
      if(!id)throw new Error(this.plugin.t('适配层未返回单元格标识','The adapter did not return a cell id'));
      const cells=this.readCells();
      const at=afterId===null?-1:cells.findIndex(cell=>cell.id===afterId);
      const index=at<0?cells.length:at+1;
      this.markStructuralChange();
      this.cells=insertCell(cells,{id,code:''},index);
      // Only the new row is built: re-rendering every cell would throw away the
      // outputs the kernel already produced for the others.
      const row=this.renderCell(this.cells[index],false);
      const anchor=afterId===null?null:this.body.querySelector<HTMLElement>(`.marimo-native-cell[data-cell-id="${CSS.escape(afterId)}"]`);
      if(anchor)anchor.after(row);
      this.selectedId=id;
      this.selectCell(id,true);
      this.updateControls();
      this.editors.get(id)?.view.focus();
    } catch(error) {
      this.structureFailed(backend,operation,error);
    } finally {
      if(operation===this.operation){this.busy=false;if(!this.closed)this.updateControls();}
    }
  }

  private async deleteCell(cellId:string):Promise<void> {
    const backend=this.backend;
    // A notebook keeps at least one cell: an empty app cannot be saved.
    if(!backend||!this.canEditStructure()||this.cells.length<=1)return;
    const operation=++this.operation;
    this.busy=true;this.updateControls();
    try {
      await backend.request('delete',{cellId});
      if(!shouldApplyResult({backend,operation},{backend:this.backend,operation:this.operation}))return;
      const cells=this.readCells();
      const index=cells.findIndex(cell=>cell.id===cellId);
      if(index<0)return;
      this.markStructuralChange();
      this.cells=removeCell(cells,cellId);
      this.dropRow(cellId);
      const neighbour=this.cells[Math.min(index,this.cells.length-1)];
      this.selectedId=neighbour?.id??null;
      if(this.selectedId)this.selectCell(this.selectedId,true);
      this.updateControls();
    } catch(error) {
      this.structureFailed(backend,operation,error);
    } finally {
      if(operation===this.operation){this.busy=false;if(!this.closed)this.updateControls();}
    }
  }

  private dropRow(cellId:string):void {
    this.editors.get(cellId)?.view.destroy();
    this.editors.delete(cellId);
    this.outputs.delete(cellId);
    this.body.querySelector<HTMLElement>(`.marimo-native-cell[data-cell-id="${CSS.escape(cellId)}"]`)?.remove();
  }

  private rowFor(cellId:string):HTMLElement|null {
    return this.body.querySelector<HTMLElement>(`.marimo-native-cell[data-cell-id="${CSS.escape(cellId)}"]`);
  }

  /** The model order always follows the rows, so the two cannot drift apart. */
  private orderFromDom(cells:Cell[]):Cell[] {
    const byId=new Map(cells.map(cell=>[cell.id,cell]));
    return Array.from(this.body.querySelectorAll<HTMLElement>('.marimo-native-cell'))
      .map(row=>byId.get(row.dataset.cellId??''))
      .filter((cell):cell is Cell=>cell!==undefined);
  }

  /** Reordering is local: only the save request decides the file order. */
  private shiftCell(cellId:string, delta:number):void {
    if(!this.canEditStructure())return;
    const cells=this.readCells();
    const from=cells.findIndex(cell=>cell.id===cellId);
    const next=moveCell(cells,from,from+delta);
    if(next.every((cell,index)=>cell.id===cells[index].id))return;
    const row=this.rowFor(cellId);
    const sibling=delta<0?row?.previousElementSibling:row?.nextElementSibling;
    if(!row||!(sibling instanceof HTMLElement)||!sibling.classList.contains('marimo-native-cell'))return;
    // Moving the row instead of rebuilding it keeps editors, outputs and scroll.
    if(delta<0)sibling.before(row); else sibling.after(row);
    this.cells=this.orderFromDom(next);
    this.markStructuralChange();
    this.selectedId=cellId;
    this.selectCell(cellId,true);
    this.updateControls();
    this.editors.get(cellId)?.view.focus();
  }

  // ------------------------------------------------- running & cell config

  private runCell(cellId:string):Promise<void> {
    const row=this.rowFor(cellId);
    // A disabled cell is skipped by the kernel anyway; do not pretend to run it.
    if(!row||row.classList.contains('is-disabled'))return Promise.resolve();
    const cell=this.readCells().find(item=>item.id===cellId);
    return cell?this.perform('run',[cell]):Promise.resolve();
  }

  /** Shift-Enter: run this cell and keep writing in the next one. */
  private runCellAndAdvance(cellId:string):void {
    const next=nextCellId(this.cells,cellId);
    void this.runCell(cellId);
    if(next&&!this.closed)this.editors.get(next)?.view.focus();
  }

  private async runStale():Promise<void> {
    const cells=this.staleCells();
    if(!cells.length)return;
    await this.perform('run',cells);
  }

  /**
   * A config write is a reactive cycle, so it owns the session like a run does.
   * The config is stored locally only after the kernel accepts it; `save()` reads
   * it from there, which is how `hide_code` and friends reach the file.
   */
  private async setCellConfig(cellId:string, patch:Partial<CellConfig>):Promise<void> {
    const backend=this.backend;
    if(!backend||!this.canEditStructure())return;
    const cell=this.cells.find(item=>item.id===cellId);
    if(!cell)return;
    const config=mergeCellConfig(readCellConfig(cell.config),patch);
    const operation=++this.operation;
    this.busy=true;this.updateControls();
    try {
      await backend.request('config',{cellId,config:wireConfig(config)});
      if(!shouldApplyResult({backend,operation},{backend:this.backend,operation:this.operation}))return;
      cell.config=config;
      // The setting is written into the file on save.
      this.dirty=true;
      const row=this.rowFor(cellId);
      if(row)this.applyCellConfig(row,cellId);
      this.updateStatus();
    } catch(error) {
      this.structureFailed(backend,operation,error);
    } finally {
      if(operation===this.operation){this.busy=false;if(!this.closed)this.updateControls();}
    }
  }

  /** Rewrite every cell with the server's formatter; the kernel is untouched. */
  private async formatCells():Promise<void> {
    const backend=this.backend;
    if(!backend||!this.canEditStructure()||!this.cells.length)return;
    const codes:Record<string,string>={};
    for(const cell of this.cells)codes[cell.id]=this.editors.get(cell.id)?.view.state.doc.toString()??cell.code;
    const operation=++this.operation;
    this.busy=true;this.updateControls();
    try {
      const result=await backend.request('format',{codes});
      if(!shouldApplyResult({backend,operation},{backend:this.backend,operation:this.operation}))return;
      let changed=false;
      for(const [id,code] of Object.entries(result.codes??{})) {
        const editor=this.editors.get(id);
        if(!editor)continue;
        const current=editor.view.state.doc.toString();
        if(current===code)continue;
        // Replacing the document keeps the undo history instead of rebuilding it.
        editor.view.dispatch({changes:{from:0,to:current.length,insert:code}});
        changed=true;
      }
      if(changed){this.dirty=true;if(this.runPhase!=='none')this.changedSinceRun=true;this.updateStatus();}
    } catch(error) {
      this.structureFailed(backend,operation,error);
    } finally {
      if(operation===this.operation){this.busy=false;if(!this.closed)this.updateControls();}
    }
  }

  /**
   * Language-server completions. The kernel answers on the socket, so this is
   * async; a slow or empty answer must never break typing.
   */
  private async completeAt(cellId:string, context:CompletionContext):Promise<CompletionResult|null> {
    const backend=this.backend;
    if(!backend||this.closed||this.busy||this.connecting)return null;
    const word=context.matchBefore(/[\w.]*/);
    if(!word||(word.from===word.to&&!context.explicit))return null;
    try {
      const result=await backend.request('complete',{cellId,document:context.state.sliceDoc(0,context.pos)});
      const options=(result.options??[]).map(option=>({label:option.name,type:option.type||undefined,detail:option.info||undefined}));
      if(!options.length||this.closed)return null;
      return {from:Math.max(0,context.pos-(result.prefixLength??0)),options};
    } catch { return null; }
  }

  /**
   * Make the live notebook match `target`: drop what the target lacks, recreate
   * cells whose ids died with an earlier kernel, and keep the target's order.
   */
  private async adoptCells(backend:Backend, target:Cell[]):Promise<Cell[]> {
    const current=this.readCells();
    const currentIds=new Set(current.map(cell=>cell.id));
    const targetIds=new Set(target.map(cell=>cell.id));
    for(const cell of current) if(!targetIds.has(cell.id)) await backend.request('delete',{cellId:cell.id});
    const resolved:Cell[]=[];
    for(const cell of target) {
      // A surviving cell keeps its config; a recreated kernel cell starts from
      // marimo's defaults, which is what the kernel actually knows.
      if(currentIds.has(cell.id)) {resolved.push({id:cell.id,code:cell.code,config:cell.config}); continue;}
      const created=await backend.request('create');
      if(!created.cellId)throw new Error(this.plugin.t('适配层未返回单元格标识','The adapter did not return a cell id'));
      resolved.push({id:created.cellId,code:cell.code});
    }
    return resolved;
  }

  private syncOutputState(target:HTMLElement): void {
    const display=target.querySelector<HTMLElement>('.marimo-native-display');
    const consoleEl=target.querySelector<HTMLElement>('.marimo-native-console');
    const hasContent=!!(display?.childElementCount||consoleEl?.childElementCount);
    target.toggleClass('has-output',hasContent);
  }

  private renderOutput(target: HTMLElement, raw: unknown): void {
    if(isStdinOutput(raw)) {this.renderStdinPrompt(target, raw); return;}
    const output=safeOutput(raw);
    // Failures keep their channel/mime so the view can apply the error tone.
    const errorClass=isErrorOutput(raw)?' is-error':'';
    if(output.kind==='image' && output.mime) {
      // `safeOutput` already restricted this to base64 raster data.
      const image=target.createEl('img',{cls:'marimo-native-image'});
      image.src=`data:${output.mime};base64,${output.text}`;
      image.alt=this.plugin.t('图像输出','Image output');
      return;
    }
    if(output.kind==='text') {if(output.text)target.createEl('pre',{cls:'marimo-native-text'+errorClass,text:output.text}); return;}
    if(output.kind==='html') {
      // Custom elements never survive the host sanitizer, so widgets are lifted
      // out of the raw string and the rest is sanitized as usual. marimo's
      // LaTeX wrapper cannot survive either, so it is unwrapped first.
      const extracted=extractUiElements(adaptMarimoTex(output.text));
      const fragment=sanitizeHTMLToDom(extracted.html);
      // marimo emits placeholder markup such as `<div></div>`; an output block with
      // no text and no visible structure must not reserve space or draw a divider.
      const visibleText=!!fragment.textContent?.trim();
      const visibleStructure=extracted.widgets.length>0||!!fragment.querySelector('pre,table,ul,ol,blockquote,hr,figure,code,h1,h2,h3,h4,h5,h6,img,[data-widget-slot]');
      if(!visibleText && !visibleStructure) return;
      // Inline raster data URLs survive; every other image source is dropped.
      fragment.querySelectorAll('img').forEach(image=>{
        const src=image.getAttribute('src');
        if(!isAllowedImageSource(src)) {image.remove(); return;}
        for(const attr of Array.from(image.attributes)) if(attr.name!=='src'&&attr.name!=='alt') image.removeAttribute(attr.name);
        image.setAttribute('src',(src??'').trim());
      });
      // Static-only: no scripts, remote resources or interactive components.
      fragment.querySelectorAll('*').forEach(node=>{if(node.tagName==='IMG')return;if(isBlockedElement(node.tagName))node.remove();});
      fragment.querySelectorAll('span.paragraph').forEach(node=>{const paragraph=document.createElement('p');paragraph.append(...Array.from(node.childNodes));node.replaceWith(paragraph);});
      fragment.querySelectorAll('*').forEach(node=>{
        if(node.tagName==='IMG')return;
        for(const attr of Array.from(node.attributes)) if(isBlockedAttribute(attr.name))node.removeAttribute(attr.name);
      });
      const wrapper=target.createDiv({cls:'marimo-native-html'+errorClass});
      wrapper.appendChild(fragment);
      mountWidgets(wrapper, extracted.widgets, {
        send:(objectId,value)=>this.queueWidgetValue(objectId,value),
        translate:(zh,en)=>this.plugin.t(zh,en),
        sanitize:html=>sanitizeHTMLToDom(html),
      });
      return;
    }
    target.createDiv({cls:'marimo-native-unsupported',text:this.plugin.t('此输出类型尚未适配：','Output type not yet supported: ')+output.text});
  }

  /** `input()` prompt with a local answer box; the answer goes to the kernel. */
  private renderStdinPrompt(target: HTMLElement, raw: unknown): void {
    const prompt = typeof (raw as Record<string,unknown>)?.data === 'string' ? String((raw as Record<string,unknown>).data) : '';
    const row=target.createDiv({cls:'marimo-native-stdin'});
    row.createSpan({cls:'marimo-native-stdin-prompt',text:prompt||this.plugin.t('输入：','Input: ')});
    const input=row.createEl('input',{cls:'marimo-native-stdin-input',type:'text'});
    input.setAttr('aria-label',this.plugin.t('输入内容','Input value'));
    const send=row.createEl('button',{cls:'marimo-native-stdin-send',text:this.plugin.t('发送','Send')});
    send.setAttr('aria-label',this.plugin.t('发送输入','Send input'));
    const submit=()=>void this.answerStdin(input.value,row);
    input.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();submit();}});
    send.onclick=submit;
    // The run is blocked until this is answered, so bring it into view.
    row.scrollIntoView({block:'nearest'});
    input.focus();
  }

  // ------------------------------------------------------------ cell status

  /** Reflect a cell-op status onto the gutter button and the row. */
  private applyCellStatus(cellId:string, status:CellStatus): void {
    const row=this.body.querySelector<HTMLElement>(`.marimo-native-cell[data-cell-id="${CSS.escape(cellId)}"]`);
    if(!row)return;
    row.dataset.cellStatus=status;
    // Any cycle that reaches the cell executed (or restored) it, so the local
    // "edited since run" mark no longer applies.
    if(status==='running'||status==='queued'||status==='idle') delete row.dataset.stale;
    const run=row.querySelector<HTMLElement>('button[data-action="run-cell"]');
    if(run && !run.hidden) setIcon(run, status==='running'?'loader-2':'play');
  }
  /** A ended session must not leave spinners or stale marks behind. */
  private clearCellStatuses(): void {
    this.body.querySelectorAll<HTMLElement>('.marimo-native-cell[data-cell-status]').forEach(row=>{
      delete row.dataset.cellStatus;
      const run=row.querySelector<HTMLElement>('button[data-action="run-cell"]');
      if(run && !run.hidden) setIcon(run,'play');
    });
  }

  // ---------------------------------------------------------------- drafts

  /**
   * Persist unsaved edits as a recovery draft — but only while the notebook
   * still exists in the vault. Closing a leaf after the file was trashed must
   * not resurrect a draft the caller just removed.
   */
  private persistDraft():void {
    if(!this.dirty)return;
    if(!this.filename||!this.app.vault.getAbstractFileByPath(this.filename))return;
    try{this.plugin.saveRecovery(this.filename,this.readCells(),[...this.baseCodes]);}
    catch{new Notice(this.plugin.t('无法保存编辑草稿，请检查本机目录权限。','Could not save recovery draft. Check local directory permissions.'));}
  }

  private refreshRecovery():void {
    try{
      this.hasDraft = !!this.plugin.recovery.read(this.filename);
    }catch(error){this.hasDraft=false;new Notice(String(error));}
    this.updateControls();
  }
  /** Put pending local edits back onto a freshly connected session. */
  private async reapplyLocal(edits:Cell[]):Promise<void> {
    const backend=this.backend;
    if(!backend)return;
    const operation=this.operation;
    this.busy=true;this.updateControls();
    try {
      this.cells=await this.adoptCells(backend,edits);
      if(!shouldApplyResult({backend,operation},{backend:this.backend,operation:this.operation}))return;
      if(this.selectedId && !this.cells.some(cell=>cell.id===this.selectedId)) this.selectedId=this.cells[0]?.id??null;
      this.markStructuralChange();
      this.renderCells(false);
    } catch(error) {
      this.structureFailed(backend,operation,error);
    } finally {
      if(operation===this.operation){this.busy=false;if(!this.closed)this.updateControls();}
    }
  }
  private async restoreDraft():Promise<void> {
    try {
      const draft=this.plugin.recovery.read(this.filename);const backend=this.backend;
      if(!draft)return;
      // The offer is visible without a session; applying it needs one.
      if(!backend||!this.canEditStructure()){
        this.showNotice(this.plugin.t('连接后可恢复草稿。','Connect to restore the draft.'),'info');
        return;
      }
      if(JSON.stringify(draft.baseCodes)!==JSON.stringify(this.baseCodes))throw new Error(this.plugin.t('原文件与草稿基线不同，草稿保留供手动恢复。','Draft baseline differs from the file; draft retained for manual recovery.'));
      const operation=++this.operation;
      this.busy=true;this.updateControls();
      try {
        // A restored draft may add or remove cells, so it is adopted wholesale
        // instead of being written into an assumed one-to-one cell list.
        this.cells=await this.adoptCells(backend,draft.cells);
        if(!shouldApplyResult({backend,operation},{backend:this.backend,operation:this.operation}))return;
        this.selectedId=this.cells[0]?.id??null;
        this.markStructuralChange();
        this.renderCells(false);
        this.showNotice(this.plugin.t('草稿已恢复，尚未运行。','Draft restored; not executed.'),'info');
      } finally {
        if(operation===this.operation){this.busy=false;if(!this.closed)this.updateControls();}
      }
    } catch(error){new Notice(String(error));}
  }

  // ---------------------------------------------------------------- teardown

  private disconnect():void {
    this.operation++;this.busy=false;
    // A queued widget value has no session to reach any more.
    this.widgetPending.clear();
    this.persistDraft();
    const backend=this.backend;this.backend=null;
    void backend?.close().catch(error=>new Notice(String(error)));
    this.releaseLease();
    this.setCellsReadOnly();
    this.clearCellStatuses();
    this.runPhase='none';this.changedSinceRun=false;
    if(!this.closed){this.refreshRecovery();this.updateControls();}
  }
  private releaseLease():void {const lease=this.lease;this.lease=null;this.plugin.release(lease);}
  private async releaseFileSession():Promise<void> {
    this.operation++;this.busy=false;this.connecting=false;this.stopping=false;this.notebookReady=false;
    this.widgetPending.clear();
    this.inspection?.abort();this.inspection=null;
    this.persistDraft();
    const backend=this.backend;this.backend=null;
    const lease=this.lease;this.lease=null;
    try{await backend?.close();}catch(error){new Notice(String(error));}
    finally {
      this.plugin.release(lease);
      this.sourceEditor?.destroy();this.sourceEditor=null;
      for(const editor of this.editors.values()) editor.view.destroy();
      this.editors.clear();this.outputs.clear();
      this.cells=[];this.baseCodes=[];this.dirty=false;this.runPhase='none';this.changedSinceRun=false;
      this.selectedId=null;this.hasDraft=false;
      if(this.restoreButton)this.restoreButton.hidden=true;
      if(this.body)this.body.empty();
      if(this.previewNote)this.previewNote.hidden=true;
    }
  }
  onClose():Promise<void> {
    if(this.closing)return this.closing;
    if(this.keyScope){this.app.keymap.popScope(this.keyScope);this.keyScope=null;}
    this.closed=true;this.loadGeneration++;this.inspection?.abort();
    this.closing=this.releaseFileSession();return this.closing;
  }
}
