import {FileSystemAdapter, FuzzySuggestModal, getLanguage, Notice, Plugin, PluginSettingTab, TFile, type SettingDefinitionItem} from 'obsidian';
import {existsSync, realpathSync} from 'node:fs';
import {homedir} from 'node:os';
import {join, resolve, sep} from 'node:path';
import {createHash} from 'node:crypto';
import {RecoveryStore, normalizePython} from './recovery';
import {MarimoView, VIEW_TYPE} from './view';
import type {Cell} from './protocol';
import {WriterLocks,type WriterLease} from './writer-lock';

interface Settings {pythonPath: string;associatePython:boolean}
export default class MarimoPlugin extends Plugin {
  settings: Settings = {pythonPath:'',associatePython:true};
  private associationStatus='';
  recovery!:RecoveryStore;
  private writers = new WriterLocks();
  t(zh: string, en: string): string {return getLanguage().toLowerCase().startsWith('zh') ? zh : en;}
  async onload(): Promise<void> {
    const fallback=join(homedir(),'.local','share','uv','tools','marimo','bin','python');
    const saved=await this.loadData();
    this.settings={pythonPath:normalizePython(saved?.pythonPath,existsSync(fallback)?fallback:'python3'),associatePython:saved?.associatePython!==false};
    this.recovery=new RecoveryStore(join(homedir(),'.local','state','obsidian-marimo','drafts',createHash('sha256').update(this.absoluteRoot()).digest('hex')));
    this.registerView(VIEW_TYPE,leaf=>new MarimoView(leaf,this));
    if(this.settings.associatePython) {
      try{this.registerExtensions(['py'],VIEW_TYPE);this.associationStatus=this.t('点击 Python 文件会在此插件中打开，普通脚本只读显示。','Clicking Python files opens this view; ordinary scripts are shown read-only.');}
      catch{this.associationStatus=this.t('Python 文件已由其他插件接管，保留原关联；可使用右键菜单或命令打开。','Another plugin handles Python files. Its association is preserved; use the context menu or command.');}
    }else this.associationStatus=this.t('未关联 Python 文件；可使用右键菜单或命令打开。','Python file association is disabled; use the context menu or command.');
    const open = (file:TFile) => void this.openFile(file).catch(error=>new Notice(String(error)));
    const pluginForPicker=this;
    this.addCommand({id:'open-native-marimo',name:this.t('以原生 marimo 视图打开','Open in native marimo view'),callback:()=>{
      const file=this.app.workspace.getActiveFile();
      if(file?.extension==='py') {open(file);return;}
      new class extends FuzzySuggestModal<TFile> {
        getItems(): TFile[] {return pluginForPicker.app.vault.getFiles().filter(file=>file.extension==='py');}
        getItemText(file:TFile): string {return file.path;}
        onChooseItem(file:TFile): void {open(file);}
      }(this.app).open();
    }});
    this.registerEvent(this.app.workspace.on('file-menu',(menu,file)=>{
      if(file instanceof TFile && file.extension==='py') menu.addItem(item=>item.setTitle(this.t('以原生 marimo 视图打开','Open in native marimo view')).setIcon('notebook-pen').onClick(()=>open(file)));
    }));
    const plugin=this;
    this.addSettingTab(new class extends PluginSettingTab {
      getSettingDefinitions(): SettingDefinitionItem[] {return [{name:plugin.t('点击 Python 文件打开','Open Python files on click'),desc:plugin.associationStatus+' '+plugin.t('更改后重新加载插件生效。','Changes take effect after reloading the plugin.'),control:{type:'toggle',key:'associatePython',defaultValue:true}},{name:plugin.t('marimo Python 路径','marimo Python path'),desc:plugin.t('须安装 marimo 0.25.2。原型暂不支持其他版本。','Requires marimo 0.25.2. Other versions are not supported by this prototype.'),control:{type:'text',key:'pythonPath',defaultValue:fallback}}];}
    }(this.app,this));
  }
  getPythonPath():string {const fallback=join(homedir(),'.local','share','uv','tools','marimo','bin','python');return normalizePython(this.settings.pythonPath,existsSync(fallback)?fallback:'python3');}
  async onExternalSettingsChange(): Promise<void> {const saved=await this.loadData();this.settings={pythonPath:normalizePython(saved?.pythonPath,this.settings.pythonPath),associatePython:saved?.associatePython!==false};}
  async openFile(file:TFile): Promise<void> {
    const existing=this.app.workspace.getLeavesOfType(VIEW_TYPE).find(leaf=>!leaf.isDeferred&&leaf.view instanceof MarimoView&&!leaf.view.isClosed()&&leaf.view.getState().filename===file.path);
    if(existing){await this.app.workspace.revealLeaf(existing);return;}
    let anotherWriter=false;this.app.workspace.iterateAllLeaves(leaf=>{if((leaf.view as unknown as {file?:TFile}).file?.path===file.path)anotherWriter=true;});
    if(anotherWriter)throw new Error(this.t('请先关闭此文件的其他编辑视图。','Close other editors of this file first.'));
    const leaf=this.app.workspace.getLeaf('tab');
    await leaf.setViewState({type:VIEW_TYPE,state:{file:file.path},active:true});
  }
  private absoluteRoot():string {
    const adapter=this.app.vault.adapter;if(!(adapter instanceof FileSystemAdapter))throw new Error('A desktop filesystem vault is required');return resolve(adapter.getBasePath());
  }
  absolutePath(filename:string): string {
    const adapter=this.app.vault.adapter;
    if(!(adapter instanceof FileSystemAdapter))throw new Error('A desktop filesystem vault is required');
    const root=resolve(adapter.getBasePath()); const target=resolve(root,filename);
    if(!target.startsWith(root+sep))throw new Error('Notebook must be inside this vault');
    return target;
  }
  async claim(filename:string,view:MarimoView):Promise<WriterLease> {
    return this.writers.claim(realpathSync(this.absolutePath(filename)),view);
  }
  release(lease:WriterLease|null):void {this.writers.release(lease);}
  saveRecovery(filename:string,cells:Cell[],baseCodes:string[]):string {return this.recovery.write(filename,cells,baseCodes);}
  onunload(): void {for(const view of this.writers.owners())void view.onClose();}
}
