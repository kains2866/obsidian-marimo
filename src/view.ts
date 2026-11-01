import {EditableFileView, Notice, sanitizeHTMLToDom, type WorkspaceLeaf, type TFile, type ViewStateResult} from 'obsidian';
import {EditorView, keymap, lineNumbers} from '@codemirror/view';
import {EditorState} from '@codemirror/state';
import {python} from '@codemirror/lang-python';
import {defaultKeymap, history, historyKeymap} from '@codemirror/commands';
import {syntaxHighlighting} from '@codemirror/language';
import {Backend} from './bridge';
import {nativeHighlight} from './editor-theme';
import {safeOutput, type BackendMessage, type Cell} from './protocol';
import {fileFromViewState} from './file-state';
import {inspectSource} from './inspection';
import inspectorSource from '../python/inspect_notebook.py';
import type MarimoPlugin from './main';
import type {WriterLease} from './writer-lock';

export const VIEW_TYPE = 'marimo-native-notebook';
export class MarimoView extends EditableFileView {
  private filename = '';
  private loadGeneration=0;
  private sourceEditor:EditorView|null=null;
  private inspection:AbortController|null=null;
  private notebookReady=false;
  private connecting=false;
  private lease:WriterLease|null=null;
  private backend: Backend | null = null;
  private editors = new Map<string, EditorView>();
  private outputs = new Map<string, HTMLElement>();
  private cells: Cell[] = [];
  private status!: HTMLElement;
  private body!: HTMLElement;
  private controls: HTMLButtonElement[] = [];
  private connectButton!: HTMLButtonElement;
  private restoreButton!: HTMLButtonElement;
  private busy = false;
  private closed = false;
  private closing:Promise<void>|null=null;
  private dirty = false;
  private runFailed = false;
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
  async onLoadFile(file:TFile):Promise<void> {
    const generation=++this.loadGeneration;
    this.inspection?.abort();
    const inspection=new AbortController();this.inspection=inspection;
    this.filename=file.path;this.closed=false;this.notebookReady=false;
    this.connectButton.disabled=true;this.connectButton.hidden=true;
    this.connectButton.setText(this.plugin.t('连接并允许运行','Connect and allow execution'));
    this.controls.forEach(button=>button.hidden=true);
    this.status.setText(this.plugin.t('读取文件…','Reading file…'));
    try {
      const source=await this.app.vault.read(file);
      if(generation!==this.loadGeneration||this.closed)return;
      this.showSource(source);
      const preview=await inspectSource(this.plugin.getPythonPath(),source,inspectorSource,{signal:inspection.signal});
      if(generation!==this.loadGeneration||this.closed)return;
      if(preview.error){this.status.setText(this.plugin.t('无法预览单元格：','Could not preview cells: ')+preview.error);return;}
      this.notebookReady=preview.isMarimo;
      if(preview.isMarimo){this.cells=preview.cells;this.renderCells(true);}
      this.connectButton.hidden=!preview.isMarimo;this.connectButton.disabled=!preview.isMarimo;
      this.controls.forEach(button=>button.hidden=!preview.isMarimo);
      this.status.setText(preview.isMarimo?this.plugin.t('尚未运行 · 连接后编辑单元格','Not run · Connect to edit cells'):this.plugin.t('普通 Python 脚本 · 只读','Python script · Read-only'));
    }catch(error){if(generation===this.loadGeneration&&!this.closed)this.status.setText(this.plugin.t('预览失败，原始源码仍可查看：','Preview failed; original source is still available: ')+String(error));}
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
    this.loadGeneration++;this.inspection?.abort();this.connecting=false;
    this.disconnect();this.filename=file.path;
    if(this.dirty)this.plugin.saveRecovery(this.filename,this.readCells(),this.cells.map(c=>c.code));
    this.status.setText(this.plugin.t('文件已重命名，请重新连接。','File renamed; reconnect to continue.'));
  }
  private showSource(source:string):void {
    this.sourceEditor?.destroy();this.sourceEditor=null;this.body.empty();
    const host=this.body.createDiv({cls:'marimo-native-editor marimo-native-source'});
    this.sourceEditor=new EditorView({parent:host,state:EditorState.create({doc:source,extensions:[python(),lineNumbers(),syntaxHighlighting(nativeHighlight),EditorState.readOnly.of(true),EditorView.editable.of(false),EditorView.lineWrapping]})});
  }
  async onOpen(): Promise<void> {
    this.contentEl.empty();this.contentEl.addClass('marimo-native');
    const bar = this.contentEl.createDiv({cls:'marimo-native-toolbar'});
    this.connectButton = bar.createEl('button', {text:this.plugin.t('连接并允许运行','Connect and allow execution')});
    this.connectButton.onclick = () => void this.connect();
    const run = bar.createEl('button', {text:this.plugin.t('运行全部','Run all')});
    run.onclick = () => void this.perform('run', this.readCells());
    const save = bar.createEl('button', {text:this.plugin.t('保存','Save')});
    save.onclick = () => void this.perform('save', this.readCells());
    this.restoreButton=bar.createEl('button',{text:this.plugin.t('恢复草稿','Restore draft')});
    this.restoreButton.hidden=true;this.restoreButton.onclick=()=>this.restoreDraft();
    this.controls = [run, save]; this.controls.forEach(button => button.disabled = true);
    this.status = bar.createSpan({cls:'marimo-native-status', text:this.plugin.t('尚未连接','Disconnected')});
    this.contentEl.createDiv({cls:'marimo-native-info',text:this.plugin.t('实验原型 · 连接会启动本地 Python，运行代码拥有当前用户权限。仅打开可信文件。','Experimental prototype · Connecting starts local Python. Code runs with your user permissions. Open trusted files only.')});
    this.body = this.contentEl.createDiv({cls:'marimo-native-cells'});
  }
  private async connect(): Promise<void> {
    if(this.backend || this.closed || this.connecting || !this.notebookReady) return;
    const filename=this.filename;const generation=this.loadGeneration;
    this.connecting=true;this.connectButton.disabled=true;
    try {
      const lease=await this.plugin.claim(filename, this);
      if(this.closed||generation!==this.loadGeneration){this.plugin.release(lease);return;}
      this.lease=lease;
      this.status.setText(this.plugin.t('连接中…','Connecting…'));
      const backend = new Backend(this.plugin.getPythonPath(), this.plugin.absolutePath(this.filename), frame => {if(this.backend===backend)this.receive(frame);});
      this.backend = backend;
      await backend.start();
      if(this.closed||this.backend!==backend) {void backend.close(); return;}
      this.connectButton.setText(this.plugin.t('已连接','Connected'));
      this.controls.forEach(button => button.disabled = false);
      this.refreshRecovery();
      this.status.setText(this.dirty?this.plugin.t('代码已修改','Code modified'):(this.runFailed?this.plugin.t('运行失败','Execution failed'):this.plugin.t('运行结束','Execution finished')));
    } catch(error) {
      if(generation!==this.loadGeneration||this.closed)return;
      this.disconnect();
      this.status.setText(String(error));this.connectButton.disabled=false;
    }finally{if(generation===this.loadGeneration)this.connecting=false;}
  }
  private readCells(): Cell[] {return this.cells.map(cell => ({...cell, code:this.editors.get(cell.id)?.state.doc.toString() ?? cell.code}));}
  private async perform(method: 'run'|'save', cells: Cell[]): Promise<void> {
    if(!this.backend || this.busy || this.closed) return;
    const backend=this.backend;const operation=++this.operation;
    this.busy = true; if(method==='run')this.runFailed=false; this.setBusy(true);
    this.status.setText(method==='run' ? this.plugin.t('运行中…','Running…') : this.plugin.t('保存中…','Saving…'));
    try {
      await backend.request(method, cells);
      if(this.closed||this.backend!==backend) return;
      if(method==='save') {this.dirty = JSON.stringify(this.readCells())!==JSON.stringify(cells);this.cells=cells.map(cell=>({...cell}));if(!this.dirty)this.plugin.recovery.remove(this.filename);this.refreshRecovery();}
      this.status.setText(method==='save' ? (this.dirty?this.plugin.t('代码已修改','Code modified'):this.plugin.t('已保存','Saved')) : (this.runFailed?this.plugin.t('运行失败','Execution failed'):this.plugin.t('运行结束','Execution finished')));
    } catch(error) {if(!this.closed) {this.disconnect();this.status.setText(String(error)); new Notice(String(error));}}
    finally {if(operation===this.operation){this.busy=false; if(!this.closed)this.setBusy(false);}}
  }
  private setBusy(busy: boolean): void {
    this.controls.forEach(button => button.disabled=busy||!this.backend);
    this.body.querySelectorAll<HTMLButtonElement>('button').forEach(button=>button.disabled=busy||!this.backend);
  }
  private receive(frame: BackendMessage): void {
    if(this.closed) return;
    if(frame.type==='ready') {
      const edits=this.dirty?this.readCells():null;
      if(edits && JSON.stringify(this.cells.map(c=>c.code))!==JSON.stringify(frame.cells.map(c=>c.code))) {
        this.disconnect();this.status.setText(this.plugin.t('原文件已变化，编辑草稿已保留。','Original file changed; edited draft retained.'));return;
      }
      this.cells=frame.cells; this.renderCells();
      if(edits)this.applyDraftCodes(edits);
    }
    if(frame.type==='error') {this.disconnect();this.status.setText(frame.error);}
    if(frame.type!=='event') return;
    const data = frame.data;
    if(data.op==='completed-run' && data.outcome==='failed') {this.runFailed=true; this.status.setText(this.plugin.t('运行失败','Execution failed')); return;}
    if(data.op!=='cell-op') return;
    const target = this.outputs.get(String(data.cell_id));
    if(!target) return;
    const display=target.querySelector<HTMLElement>('.marimo-native-display')!;
    const consoleEl=target.querySelector<HTMLElement>('.marimo-native-console')!;
    if(data.output) {if((data.output as Record<string,unknown>).channel==='marimo-error')this.runFailed=true; display.empty(); this.renderOutput(display, data.output);}
    if(Array.isArray(data.console)) {if(data.console.length===0)consoleEl.empty(); else for(const output of data.console)this.renderOutput(consoleEl,output);}
    else if(data.console) this.renderOutput(consoleEl,data.console);
  }
  private renderCells(readOnly=false): void {
    this.sourceEditor?.destroy();this.sourceEditor=null;
    this.editors.forEach(editor=>editor.destroy()); this.editors.clear(); this.outputs.clear(); this.body.empty();
    for(const cell of this.cells) {
      const row=this.body.createDiv({cls:'marimo-native-cell'});
      const gutter=row.createDiv({cls:'marimo-native-gutter'});
      const run=gutter.createEl('button',{text:'▶',attr:{'aria-label':this.plugin.t('运行此块','Run this cell')}});
      run.hidden=readOnly;
      run.onclick=()=>void this.perform('run',this.readCells().filter(item=>item.id===cell.id));
      const content=row.createDiv({cls:'marimo-native-cell-content'});
      const host=content.createDiv({cls:'marimo-native-editor'});
      const editor=new EditorView({parent:host,state:EditorState.create({doc:cell.code,extensions:[EditorState.readOnly.of(readOnly),EditorView.editable.of(!readOnly),python(),lineNumbers(),history(),keymap.of([...defaultKeymap,...historyKeymap]),syntaxHighlighting(nativeHighlight),EditorView.lineWrapping,EditorView.updateListener.of(update=>{if(update.docChanged){this.dirty=true; if(!this.busy)this.status.setText(this.plugin.t('代码已修改','Code modified'));}}),EditorView.theme({'&':{fontFamily:'var(--font-monospace)',fontSize:'var(--code-size)'},'.cm-content':{caretColor:'var(--text-normal)'},'.cm-gutters':{backgroundColor:'var(--background-secondary)',color:'var(--text-faint)',border:'none'},'&.cm-focused':{outline:'none'}})]})});
      this.editors.set(cell.id,editor);
      const output=content.createDiv({cls:'marimo-native-output markdown-rendered'});
      output.createDiv({cls:'marimo-native-display'}); output.createDiv({cls:'marimo-native-console'});
      this.outputs.set(cell.id,output);
    }
  }
  private renderOutput(target: HTMLElement, raw: unknown): void {
    const output=safeOutput(raw);
    if(output.kind==='text') {if(output.text)target.createEl('pre',{text:output.text}); return;}
    if(output.kind==='html') {
      const fragment=sanitizeHTMLToDom(output.text);
      // This prototype is static-only: no remote resources, scriptable media or interactive components.
      fragment.querySelectorAll('script,style,iframe,object,embed,link,img,svg,math,video,audio,source,input,button,form').forEach(node=>node.remove());
      fragment.querySelectorAll('span.paragraph').forEach(node=>{const paragraph=document.createElement('p');paragraph.append(...Array.from(node.childNodes));node.replaceWith(paragraph);});
      fragment.querySelectorAll('*').forEach(node=>{
        for(const attr of Array.from(node.attributes)) if(['style','class','id','name'].includes(attr.name)||attr.name.startsWith('on')||['src','srcset','href','action'].includes(attr.name))node.removeAttribute(attr.name);
      });
      target.appendChild(fragment); return;
    }
    target.createDiv({cls:'marimo-native-unsupported',text:this.plugin.t('此输出类型尚未适配：','Output type not yet supported: ')+output.text});
  }
  private refreshRecovery():void {
    try{this.restoreButton.hidden=!this.plugin.recovery.read(this.filename);this.restoreButton.disabled=!this.backend;}
    catch(error){this.restoreButton.hidden=true;new Notice(String(error));}
  }
  private applyDraftCodes(cells:Cell[]):void {
    this.cells.forEach((cell,i)=>{const editor=this.editors.get(cell.id);if(editor&&cells[i])editor.dispatch({changes:{from:0,to:editor.state.doc.length,insert:cells[i].code}});});
    this.dirty=true;
  }
  private restoreDraft():void {
    try {
      const draft=this.plugin.recovery.read(this.filename);if(!draft||!this.backend)return;
      if(JSON.stringify(draft.baseCodes)!==JSON.stringify(this.cells.map(c=>c.code)))throw new Error(this.plugin.t('原文件与草稿基线不同，草稿保留供手动恢复。','Draft baseline differs from the file; draft retained for manual recovery.'));
      this.applyDraftCodes(draft.cells);this.status.setText(this.plugin.t('草稿已恢复，尚未运行','Draft restored; not executed'));
    }catch(error){new Notice(String(error));}
  }
  private disconnect():void {
    this.operation++;this.busy=false;
    if(this.dirty)try{this.plugin.saveRecovery(this.filename,this.readCells(),this.cells.map(c=>c.code));}catch(error){new Notice(String(error));}
    const backend=this.backend;this.backend=null;void backend?.close().catch(error=>new Notice(String(error)));
    this.releaseLease();
    if(!this.closed){this.connectButton.disabled=false;this.connectButton.setText(this.plugin.t('连接并允许运行','Connect and allow execution'));this.setBusy(false);this.refreshRecovery();}
  }
  private releaseLease():void {const lease=this.lease;this.lease=null;this.plugin.release(lease);}
  private async releaseFileSession():Promise<void> {
    this.operation++;this.busy=false;this.connecting=false;this.notebookReady=false;
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
      this.editors.forEach(editor=>editor.destroy());this.editors.clear();this.outputs.clear();
      this.cells=[];this.dirty=false;this.runFailed=false;
      this.restoreButton.hidden=true;
      this.setBusy(false);
    }
  }
  onClose():Promise<void> {
    if(this.closing)return this.closing;
    this.closed=true;this.loadGeneration++;this.inspection?.abort();
    this.closing=this.releaseFileSession();return this.closing;
  }
}
