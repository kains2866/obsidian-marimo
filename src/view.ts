import {EditableFileView, Notice, sanitizeHTMLToDom, setIcon, type WorkspaceLeaf, type TFile, type ViewStateResult} from 'obsidian';
import {EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter} from '@codemirror/view';
import {Compartment, EditorState} from '@codemirror/state';
import {python} from '@codemirror/lang-python';
import {defaultKeymap, history, historyKeymap} from '@codemirror/commands';
import {syntaxHighlighting} from '@codemirror/language';
import {Backend} from './bridge';
import {nativeHighlight} from './editor-theme';
import {isErrorOutput, safeOutput, type BackendMessage, type Cell} from './protocol';
import {isBlockedAttribute, isBlockedElement} from './output-policy';
import {canAdoptClaim, connectionState, environmentLabel, normalizeCellStatus, shouldApplyResult, shouldApplyStopResult, showPrototypeInfo, statusView, toolbarAvailability, type CellStatus, type ConnectionState, type RunPhase} from './status';
import {fileFromViewState} from './file-state';
import {inspectSource} from './inspection';
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
  private runButton!: HTMLButtonElement;
  private saveButton!: HTMLButtonElement;
  private stopButton!: HTMLButtonElement;
  private restoreButton!: HTMLButtonElement;
  private notice!: HTMLElement;
  private previewNote!: HTMLElement;
  private info!: HTMLElement;
  private busy = false;
  private closed = false;
  private closing:Promise<void>|null=null;
  private dirty = false;
  private runPhase: RunPhase = 'none';
  private changedSinceRun = false;
  private stopping = false;
  private hasDraft = false;
  private selectedId: string | null = null;
  private operation = 0;
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
    const available = toolbarAvailability({connection:this.connection(), run:this.runPhase, ready:this.notebookReady, hasDraft:this.hasDraft, stopping:this.stopping, busy:this.busy});
    this.connectButton.hidden = !this.notebookReady || this.connection() !== 'disconnected';
    this.connectButton.disabled = !available.connect;
    this.runButton.disabled = !available.runAll;
    this.saveButton.disabled = !available.save;
    this.stopButton.disabled = !available.stop;
    this.restoreButton.hidden = !available.restore;
    this.info.hidden = !showPrototypeInfo({ready:this.notebookReady, connection:this.connection()});
    this.body.querySelectorAll<HTMLButtonElement>('button[data-action="run-cell"]').forEach(button => {button.disabled = !available.runAll;});
    this.updateStatus();
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
    this.filename=file.path;this.closed=false;this.notebookReady=false;this.connecting=false;
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
      if(preview.isMarimo){this.cells=preview.cells;this.renderCells(true);}
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
    if(this.dirty)this.plugin.saveRecovery(this.filename,this.readCells(),this.cells.map(c=>c.code));
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
    this.runButton = this.createAction('run-all', this.plugin.t('运行全部','Run all'), 'play', true, () => void this.perform('run', this.readCells()));
    this.saveButton = this.createAction('save', this.plugin.t('保存','Save'), 'save', false, () => void this.perform('save', this.readCells()));
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
    if(this.dirty)try{this.plugin.saveRecovery(this.filename,this.readCells(),this.cells.map(c=>c.code));}catch(error){new Notice(String(error));}
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
      await backend.request(method, cells);
      if(!shouldApplyResult({backend,operation},{backend:this.backend,operation:this.operation})) return;
      if(method==='save') {
        this.dirty = JSON.stringify(this.readCells())!==JSON.stringify(cells);
        this.cells=cells.map(cell=>({...cell}));
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

  private receive(frame: BackendMessage): void {
    if(this.closed) return;
    if(frame.type==='ready') {
      const edits=this.dirty?this.readCells():null;
      if(edits && JSON.stringify(this.cells.map(c=>c.code))!==JSON.stringify(frame.cells.map(c=>c.code))) {
        this.disconnect();
        this.showNotice(this.plugin.t('原文件已变化，编辑草稿已保留。','Original file changed; edited draft retained.'),'error');
        return;
      }
      this.cells=frame.cells; this.renderCells(false);
      if(edits)this.applyDraftCodes(edits);
      // `ready` follows the backend's initial instantiate+run: cells already executed.
      this.runPhase='finished';
      this.changedSinceRun=false;
      this.updateControls();
    }
    if(frame.type==='error') {this.disconnect();this.showNotice(frame.error,'error');this.updateControls();}
    if(frame.type!=='event') return;
    const data = frame.data;
    if(data.op==='completed-run' && data.outcome==='failed') {this.runPhase='failed'; this.updateStatus(); return;}
    if(data.op!=='cell-op') return;
    const target = this.outputs.get(String(data.cell_id));
    if(!target) return;
    const display=target.querySelector<HTMLElement>('.marimo-native-display')!;
    const consoleEl=target.querySelector<HTMLElement>('.marimo-native-console')!;
    if(data.output) {
      if((data.output as Record<string,unknown>).channel==='marimo-error')this.runPhase='failed';
      display.empty(); this.renderOutput(display, data.output);
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
    this.editors.clear(); this.outputs.clear(); this.body.empty();
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

  private renderCell(cell:Cell, readOnly:boolean): void {
    const row=this.body.createDiv({cls:'marimo-native-cell'});
    row.dataset.cellId = cell.id;
    row.addEventListener('pointerdown',()=>this.selectCell(cell.id));
    row.addEventListener('focusin',()=>this.selectCell(cell.id));

    const gutter=row.createDiv({cls:'marimo-native-gutter'});
    const run=gutter.createEl('button',{cls:'marimo-native-run'});
    run.dataset.action='run-cell';
    run.hidden=readOnly;
    run.setAttr('aria-label',this.plugin.t('运行此块','Run this cell'));
    run.setAttr('title',this.plugin.t('运行此块','Run this cell'));
    setIcon(run,'play');
    run.onclick=()=>void this.perform('run',this.readCells().filter(item=>item.id===cell.id));

    const content=row.createDiv({cls:'marimo-native-cell-content'});
    const host=content.createDiv({cls:'marimo-native-editor'});
    const editable=new Compartment();
    const editor=new EditorView({parent:host,state:EditorState.create({doc:cell.code,extensions:[editable.of([EditorState.readOnly.of(readOnly),EditorView.editable.of(!readOnly)]),python(),lineNumbers(),highlightActiveLine(),highlightActiveLineGutter(),history(),keymap.of([...defaultKeymap,...historyKeymap]),syntaxHighlighting(nativeHighlight),EditorView.lineWrapping,EditorView.updateListener.of(update=>{
      if(update.focusChanged&&update.view.hasFocus)this.selectCell(cell.id);
      if(update.docChanged){
        this.dirty=true;
        if(this.runPhase!=='none')this.changedSinceRun=true;
        this.updateStatus();
      }
    }),EditorView.theme({'&':{fontFamily:'var(--font-monospace)',fontSize:'var(--code-size)'},'.cm-content':{caretColor:'var(--text-normal)'},'.cm-gutters':{backgroundColor:'transparent',color:'var(--text-faint)',border:'none'},'&.cm-focused':{outline:'none'}})]})});
    this.editors.set(cell.id,{view:editor,editable});
    const output=content.createDiv({cls:'marimo-native-output markdown-rendered'});
    output.createDiv({cls:'marimo-native-display'});
    output.createDiv({cls:'marimo-native-console'});
    this.outputs.set(cell.id,output);
  }

  private selectCell(id:string, force=false): void {
    if(this.selectedId===id && !force) return;
    this.selectedId=id;
    this.body.querySelectorAll<HTMLElement>('.marimo-native-cell').forEach(row=>{row.toggleClass('is-selected',row.dataset.cellId===id);});
  }

  private syncOutputState(target:HTMLElement): void {
    const display=target.querySelector<HTMLElement>('.marimo-native-display');
    const consoleEl=target.querySelector<HTMLElement>('.marimo-native-console');
    const hasContent=!!(display?.childElementCount||consoleEl?.childElementCount);
    target.toggleClass('has-output',hasContent);
  }

  private renderOutput(target: HTMLElement, raw: unknown): void {
    const output=safeOutput(raw);
    // Failures keep their channel/mime so the view can apply the error tone.
    const errorClass=isErrorOutput(raw)?' is-error':'';
    if(output.kind==='text') {if(output.text)target.createEl('pre',{cls:'marimo-native-text'+errorClass,text:output.text}); return;}
    if(output.kind==='html') {
      const fragment=sanitizeHTMLToDom(output.text);
      // marimo emits placeholder markup such as `<div></div>`; an output block with
      // no text and no visible structure must not reserve space or draw a divider.
      const visibleText=!!fragment.textContent?.trim();
      const visibleStructure=!!fragment.querySelector('pre,table,ul,ol,blockquote,hr,figure,code,h1,h2,h3,h4,h5,h6');
      if(!visibleText && !visibleStructure) return;
      // Static-only: no scripts, remote resources or interactive components.
      fragment.querySelectorAll('*').forEach(node=>{if(isBlockedElement(node.tagName))node.remove();});
      fragment.querySelectorAll('span.paragraph').forEach(node=>{const paragraph=document.createElement('p');paragraph.append(...Array.from(node.childNodes));node.replaceWith(paragraph);});
      fragment.querySelectorAll('*').forEach(node=>{
        for(const attr of Array.from(node.attributes)) if(isBlockedAttribute(attr.name))node.removeAttribute(attr.name);
      });
      const wrapper=target.createDiv({cls:'marimo-native-html'+errorClass});
      wrapper.appendChild(fragment);
      return;
    }
    target.createDiv({cls:'marimo-native-unsupported',text:this.plugin.t('此输出类型尚未适配：','Output type not yet supported: ')+output.text});
  }

  // ------------------------------------------------------------ cell status

  /** Reflect a cell-op status onto the gutter button and the row. */
  private applyCellStatus(cellId:string, status:CellStatus): void {
    const row=this.body.querySelector<HTMLElement>(`.marimo-native-cell[data-cell-id="${CSS.escape(cellId)}"]`);
    if(!row)return;
    row.dataset.cellStatus=status;
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

  private refreshRecovery():void {
    try{
      this.hasDraft = !!this.plugin.recovery.read(this.filename);
    }catch(error){this.hasDraft=false;new Notice(String(error));}
    this.updateControls();
  }
  private applyDraftCodes(cells:Cell[]):void {
    this.cells.forEach((cell,i)=>{const editor=this.editors.get(cell.id)?.view;if(editor&&cells[i])editor.dispatch({changes:{from:0,to:editor.state.doc.length,insert:cells[i].code}});});
    this.dirty=true;this.updateStatus();
  }
  private restoreDraft():void {
    try {
      const draft=this.plugin.recovery.read(this.filename);if(!draft||!this.backend)return;
      if(JSON.stringify(draft.baseCodes)!==JSON.stringify(this.cells.map(c=>c.code)))throw new Error(this.plugin.t('原文件与草稿基线不同，草稿保留供手动恢复。','Draft baseline differs from the file; draft retained for manual recovery.'));
      this.applyDraftCodes(draft.cells);
      this.showNotice(this.plugin.t('草稿已恢复，尚未运行。','Draft restored; not executed.'),'info');
    }catch(error){new Notice(String(error));}
  }

  // ---------------------------------------------------------------- teardown

  private disconnect():void {
    this.operation++;this.busy=false;
    if(this.dirty)try{this.plugin.saveRecovery(this.filename,this.readCells(),this.cells.map(c=>c.code));}catch(error){new Notice(String(error));}
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
    this.inspection?.abort();this.inspection=null;
    if(this.dirty) {
      try{this.plugin.saveRecovery(this.filename,this.readCells(),this.cells.map(c=>c.code));}
      catch{new Notice(this.plugin.t('无法保存编辑草稿，请检查本机目录权限。','Could not save recovery draft. Check local directory permissions.'));}
    }
    const backend=this.backend;this.backend=null;
    const lease=this.lease;this.lease=null;
    try{await backend?.close();}catch(error){new Notice(String(error));}
    finally {
      this.plugin.release(lease);
      this.sourceEditor?.destroy();this.sourceEditor=null;
      for(const editor of this.editors.values()) editor.view.destroy();
      this.editors.clear();this.outputs.clear();
      this.cells=[];this.dirty=false;this.runPhase='none';this.changedSinceRun=false;
      this.selectedId=null;this.hasDraft=false;
      if(this.restoreButton)this.restoreButton.hidden=true;
      if(this.body)this.body.empty();
      if(this.previewNote)this.previewNote.hidden=true;
    }
  }
  onClose():Promise<void> {
    if(this.closing)return this.closing;
    this.closed=true;this.loadGeneration++;this.inspection?.abort();
    this.closing=this.releaseFileSession();return this.closing;
  }
}
