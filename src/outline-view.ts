import {Events, ItemView, WorkspaceLeaf} from 'obsidian';
import {VIEW_TYPE, MarimoView} from './view';
import type MarimoPlugin from './main';

/**
 * marimo's outline, dependencies and minimap, docked in Obsidian's sidebar.
 *
 * Obsidian's core Outline view only reads heading caches that the metadata
 * indexer builds for markdown files — there is no public way to feed it
 * entries from a custom view. So this view takes the native outline's *place*
 * instead: same dock position, and (like the native marimo sidebar) tabs for
 * the outline tree, the per-cell dataflow (DEPENDENCIES) and a compact
 * notebook map (MINIMAP).
 */
export const VIEW_TYPE_OUTLINE = 'marimo-native-outline';

type Tab = 'outline'|'deps'|'map';

export class MarimoOutlineView extends ItemView {
  private tab: Tab = 'outline';
  private tabbar!: HTMLElement;
  private body!: HTMLElement;

  constructor(leaf: WorkspaceLeaf, private plugin: MarimoPlugin) {
    super(leaf);
    this.navigation = false;
  }

  getViewType(): string {return VIEW_TYPE_OUTLINE;}
  getDisplayText(): string {return this.plugin.t('marimo 大纲','marimo outline');}
  getIcon(): string {return 'list-tree';}

  async onOpen(): Promise<void> {
    // Workspace.on's typed overloads don't cover plugin events; the generic
    // Events interface does, and `trigger` on the workspace is untyped already.
    const workspace: Events = this.app.workspace;
    this.registerEvent(workspace.on('marimo-outline-changed',()=>this.sync()));
    this.registerEvent(workspace.on('active-leaf-change',()=>this.sync()));
    // The workspace may restore notebook leaves after this panel opens; a
    // layout change then means "maybe my notebook just appeared".
    let layoutTimer: ReturnType<typeof setTimeout>|null=null;
    this.registerEvent(workspace.on('layout-change',()=>{
      if(layoutTimer)clearTimeout(layoutTimer);
      layoutTimer=setTimeout(()=>{layoutTimer=null;this.sync();},300);
    }));
    const content=this.contentEl;
    content.empty();
    content.addClass('marimo-outline-pane');
    this.tabbar=content.createDiv({cls:'marimo-outline-tabs'});
    for(const entry of [
      {tab:'outline' as Tab,zh:'大纲',en:'Outline'},
      {tab:'deps' as Tab,zh:'依赖',en:'Deps'},
      {tab:'map' as Tab,zh:'地图',en:'Map'},
    ]) {
      const button=this.tabbar.createEl('button',{cls:'marimo-outline-tab',text:this.plugin.t(entry.zh,entry.en)});
      button.dataset.tab=entry.tab;
      button.onclick=()=>{this.tab=entry.tab;this.sync();};
    }
    this.body=content.createDiv({cls:'marimo-outline-body'});
    this.sync();
  }

  async onClose(): Promise<void> {}

  /** The most recently active notebook; panels never steal focus. */
  private activeNotebook(): MarimoView|null {
    return MarimoView.mostRecent(this.app.workspace);
  }

  private sync(): void {
    for(const button of this.tabbar.querySelectorAll('.marimo-outline-tab')) {
      (button as HTMLElement).classList.toggle('is-active',(button as HTMLElement).dataset.tab===this.tab);
    }
    const body=this.body;
    body.empty();
    const notebook=this.activeNotebook();
    if(!notebook) {
      body.createDiv({cls:'marimo-outline-empty',text:this.plugin.t('打开 marimo notebook 后，这里显示它的大纲。','Open a marimo notebook to see its outline here.')});
      return;
    }
    if(this.tab==='outline')this.renderOutline(body,notebook);
    else if(this.tab==='deps')this.renderDeps(body,notebook);
    else this.renderMap(body,notebook);
  }

  private jumpTo(notebook:MarimoView,cellId:string):void {
    const leaf=this.app.workspace.getLeavesOfType(VIEW_TYPE).find(candidate=>candidate.view===notebook);
    if(leaf)void this.app.workspace.revealLeaf(leaf);
    notebook.revealCell(cellId);
  }

  private renderOutline(body:HTMLElement,notebook:MarimoView):void {
    const title=body.createDiv({cls:'marimo-outline-file',text:notebook.file?.name??''});
    title.setAttr('aria-label',notebook.file?.path??'');
    const entries=notebook.currentOutline();
    if(!entries.length) {
      body.createDiv({cls:'marimo-outline-empty',text:this.plugin.t('此 notebook 暂无标题。','This notebook has no headings yet.')});
      return;
    }
    for(const entry of entries) {
      const button=body.createEl('button',{cls:'marimo-outline-item',text:entry.text});
      button.dataset.level=String(entry.level);
      button.onclick=()=>{
        // Bring the notebook forward first, like the core outline does for
        // its markdown editor, then jump to the heading's cell.
        this.jumpTo(notebook,entry.cellId);
      };
    }
  }

  /** First meaningful line of a cell, as the dependency row's label. */
  private cellLabel(notebook:MarimoView,cellId:string):string {
    const code=notebook.cellSource(cellId);
    const line=code.split('\n').map(entry=>entry.trim()).find(entry=>entry.length>0);
    return line??this.plugin.t('（空）','(empty)');
  }

  private renderDeps(body:HTMLElement,notebook:MarimoView):void {
    const deps=notebook.currentCellDeps();
    let edges=0;
    for(const entry of deps.values())edges+=entry.inputs.length+entry.outputs.length;
    if(!deps.size||!edges) {
      body.createDiv({cls:'marimo-outline-empty',text:this.plugin.t('连接并运行后，这里显示每个单元格定义和读取的变量。','Connect and run to see what each cell defines and reads.')});
      return;
    }
    for(const cell of notebook.cells) {
      const entry=deps.get(cell.id);
      if(!entry)continue;
      const row=body.createEl('button',{cls:'marimo-dep-cell'});
      row.createDiv({cls:'marimo-dep-label',text:this.cellLabel(notebook,cell.id)});
      row.onclick=()=>this.jumpTo(notebook,cell.id);
      if(entry.outputs.length) {
        const line=row.createDiv({cls:'marimo-dep-line'});
        line.createSpan({cls:'marimo-dep-kind',text:this.plugin.t('输出','out')});
        for(const name of entry.outputs)line.createSpan({cls:'marimo-dep-chip is-output',text:name});
      }
      if(entry.inputs.length) {
        const line=row.createDiv({cls:'marimo-dep-line'});
        line.createSpan({cls:'marimo-dep-kind',text:this.plugin.t('输入','in')});
        for(const name of entry.inputs)line.createSpan({cls:'marimo-dep-chip is-input',text:name});
      }
      if(!entry.outputs.length&&!entry.inputs.length) {
        row.createDiv({cls:'marimo-dep-line marimo-dep-none',text:this.plugin.t('无依赖','no variables')});
      }
    }
  }

  /**
   * The minimap: one slim block per cell, its height following the code
   * length, colored by kind (markdown / error), the selected cell outlined.
   */
  private renderMap(body:HTMLElement,notebook:MarimoView):void {
    const strip=body.createDiv({cls:'marimo-minimap'});
    strip.setAttr('aria-label',notebook.file?.name??'');
    const selection=notebook.getSelectedCellId();
    for(const cell of notebook.cells) {
      const code=notebook.cellSource(cell.id);
      const lines=Math.max(1,code.split('\n').length);
      const block=strip.createDiv({cls:'marimo-minimap-block'});
      block.style.flexGrow=String(Math.min(lines,12));
      const isMarkdown=notebook.isMarkdownCell(cell.id);
      if(isMarkdown)block.addClass('is-markdown');
      if(notebook.hasCellError(cell.id))block.addClass('is-error');
      if(cell.id===selection)block.addClass('is-selected');
      const label=this.cellLabel(notebook,cell.id).slice(0,60);
      block.setAttr('aria-label',label);
      block.onclick=()=>this.jumpTo(notebook,cell.id);
    }
  }
}
