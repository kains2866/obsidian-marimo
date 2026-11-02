import {Events, ItemView, WorkspaceLeaf} from 'obsidian';
import {VIEW_TYPE, MarimoView} from './view';
import type MarimoPlugin from './main';

/**
 * marimo's outline and DEPENDENCIES panel, docked in Obsidian's sidebar.
 *
 * Obsidian's core Outline view only reads heading caches that the metadata
 * indexer builds for markdown files — there is no public way to feed it
 * entries from a custom view. So this view takes the native outline's *place*
 * instead: same dock position, and (like native marimo) a DEPENDENCIES tab
 * with the MINIMAP | GRAPH toggle — the compact cell list and the cell-card
 * tree, styled after marimo's own sidebar.
 */
export const VIEW_TYPE_OUTLINE = 'marimo-native-outline';

type Tab = 'outline'|'deps';
type DepsMode = 'minimap'|'graph';

const DEPS_MODE_KEY = 'marimo-deps-mode';
const GRAPH_ZOOM_KEY = 'marimo-graph-zoom';

export class MarimoOutlineView extends ItemView {
  private tab: Tab = 'outline';
  private depsMode: DepsMode = 'minimap';
  private graphZoom = 1;
  private tabbar!: HTMLElement;
  private toolbar: HTMLElement|null = null;
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
    // Selection changes arrive per keystroke of focus — highlight in place
    // instead of rebuilding the list.
    this.registerEvent(workspace.on('marimo-selection-changed',(cellId: unknown)=>{
      this.highlightSelection(typeof cellId==='string'?cellId:null);
    }));
    // The workspace may restore notebook leaves after this panel opens; a
    // layout change then means "maybe my notebook just appeared".
    let layoutTimer: ReturnType<typeof setTimeout>|null=null;
    this.registerEvent(workspace.on('layout-change',()=>{
      if(layoutTimer)clearTimeout(layoutTimer);
      layoutTimer=setTimeout(()=>{layoutTimer=null;this.sync();},300);
    }));
    const saved=localStorage.getItem(DEPS_MODE_KEY);
    if(saved==='minimap'||saved==='graph')this.depsMode=saved;
    const savedZoom=Number(localStorage.getItem(GRAPH_ZOOM_KEY));
    if(Number.isFinite(savedZoom)&&savedZoom>=0.7&&savedZoom<=1.4)this.graphZoom=savedZoom;
    const content=this.contentEl;
    content.empty();
    content.addClass('marimo-outline-pane');
    this.tabbar=content.createDiv({cls:'marimo-outline-tabs'});
    for(const entry of [
      {tab:'outline' as Tab,zh:'大纲',en:'Outline'},
      {tab:'deps' as Tab,zh:'依赖',en:'Dependencies'},
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
    this.toolbar=null;
    const notebook=this.activeNotebook();
    if(!notebook) {
      body.createDiv({cls:'marimo-outline-empty',text:this.plugin.t('打开 marimo notebook 后，这里显示它的大纲。','Open a marimo notebook to see its outline here.')});
      return;
    }
    if(this.tab==='outline')this.renderOutline(body,notebook);
    else this.renderDeps(body,notebook);
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

  /** First meaningful line of a cell, as the row's label. */
  private cellLabel(notebook:MarimoView,cellId:string):string {
    const code=notebook.cellSource(cellId);
    const line=code.split('\n').map(entry=>entry.trim()).find(entry=>entry.length>0);
    if(!line)return '';
    // A markdown cell's first line is usually a heading: the raw `##` marker
    // reads like a Python comment in the faint monospace label, so strip it.
    return line.replace(/^#{1,6}\s+/, '');
  }

  /** The MINIMAP | GRAPH segmented toggle, styled after marimo's own. */
  private renderDepsToolbar(body:HTMLElement):void {
    const bar=body.createDiv({cls:'marimo-deps-toolbar'});
    bar.createSpan({cls:'marimo-deps-title',text:'DEPENDENCIES'});
    const right=bar.createDiv({cls:'marimo-deps-tools'});
    if(this.depsMode==='graph') {
      // Native marimo's graph has zoom controls; ours scales the tree.
      const zoom=right.createDiv({cls:'marimo-deps-toggle marimo-deps-zoom'});
      for(const entry of [
        {label:'−',title:this.plugin.t('缩小','Zoom out'),step:-0.1},
        {label:'＋',title:this.plugin.t('放大','Zoom in'),step:0.1},
        {label:'1:1',title:this.plugin.t('重置缩放','Reset zoom'),step:null},
      ]) {
        const button=zoom.createEl('button',{cls:'marimo-deps-mode',text:entry.label});
        button.setAttr('title',entry.title);
        button.classList.toggle('is-active',entry.step===null&&this.graphZoom!==1);
        button.onclick=()=>{
          if(entry.step===null)this.setGraphZoom(1);
          else this.setGraphZoom(this.graphZoom+entry.step);
        };
      }
    }
    const toggle=right.createDiv({cls:'marimo-deps-toggle'});
    for(const mode of [
      {mode:'minimap' as DepsMode,label:'MINIMAP'},
      {mode:'graph' as DepsMode,label:'GRAPH'},
    ]) {
      const button=toggle.createEl('button',{cls:'marimo-deps-mode',text:mode.label});
      button.dataset.mode=mode.mode;
      button.classList.toggle('is-active',this.depsMode===mode.mode);
      button.onclick=()=>{
        this.depsMode=mode.mode;
        localStorage.setItem(DEPS_MODE_KEY,mode.mode);
        this.sync();
      };
    }
    this.toolbar=bar;
  }

  private renderDeps(body:HTMLElement,notebook:MarimoView):void {
    this.renderDepsToolbar(body);
    if(!notebook.cells.length) {
      body.createDiv({cls:'marimo-outline-empty',text:this.plugin.t('此 notebook 暂无单元格。','This notebook has no cells yet.')});
      return;
    }
    if(this.depsMode==='minimap')this.renderMinimap(body,notebook);
    else this.renderGraph(body,notebook);
  }

  /**
   * MINIMAP: marimo's compact list — one slim row per cell with its index,
   * a dot, and the first line of code in muted monospace.
   */
  private renderMinimap(body:HTMLElement,notebook:MarimoView):void {
    const list=body.createDiv({cls:'marimo-minimap'});
    list.setAttr('aria-label',notebook.file?.name??'');
    const selection=notebook.getSelectedCellId();
    notebook.cells.forEach((cell,index)=>{
      const label=this.cellLabel(notebook,cell.id);
      const row=list.createEl('button',{cls:'marimo-minimap-row'});
      row.dataset.cellId=cell.id;
      row.createSpan({cls:'marimo-minimap-index',text:String(index)});
      row.createSpan({cls:'marimo-minimap-dot'});
      row.createSpan({cls:'marimo-minimap-code',text:label||this.plugin.t('empty','empty')});
      if(!label)row.addClass('is-empty');
      if(notebook.isMarkdownCell(cell.id))row.addClass('is-markdown');
      if(notebook.hasCellError(cell.id))row.addClass('is-error');
      if(cell.id===selection)row.addClass('is-selected');
      row.setAttr('aria-label',label.slice(0,80)||cell.id);
      row.onclick=()=>this.jumpTo(notebook,cell.id);
    });
  }

  /**
   * GRAPH: marimo's vertical cell tree — one rounded card per cell (a header
   * bar with the cell name, the first line of code beneath it), nested under
   * the cells whose variables they consume. Zoom buttons scale the tree.
   */
  private renderGraph(body:HTMLElement,notebook:MarimoView):void {
    const graph=body.createDiv({cls:'marimo-graph'});
    graph.style.zoom=String(this.graphZoom);
    const selection=notebook.getSelectedCellId();
    const {childrenOf,roots}=this.graphTree(notebook);
    const selected: {el: HTMLElement|null} = {el: null};
    const rendered=new Set<string>();
    const renderCell=(cellId:string,container:HTMLElement):void=>{
      if(rendered.has(cellId))return; // A cycle member renders once, at its first home.
      rendered.add(cellId);
      const label=this.cellLabel(notebook,cellId);
      const card=container.createEl('button',{cls:'marimo-graph-card'});
      card.dataset.cellId=cellId;
      card.createDiv({cls:'marimo-graph-head',text:cellId});
      card.createDiv({cls:'marimo-graph-code',text:label||this.plugin.t('empty','empty')});
      if(!label)card.addClass('is-empty');
      if(notebook.isMarkdownCell(cellId))card.addClass('is-markdown');
      if(notebook.hasCellError(cellId))card.addClass('is-error');
      if(cellId===selection) {
        card.addClass('is-selected');
        selected.el=card;
      }
      card.setAttr('aria-label',(cellId+' · '+label).slice(0,120));
      card.onclick=()=>this.jumpTo(notebook,cellId);
      const kids=childrenOf.get(cellId)??[];
      if(kids.length) {
        const nest=container.createDiv({cls:'marimo-graph-children'});
        for(const kid of kids)renderCell(kid,nest);
      }
    };
    for(const root of roots)renderCell(root,graph);
    // Cells no edge reached (definition cycles, kernel not connected yet)
    // keep their notebook place at the bottom instead of vanishing.
    for(const cell of notebook.cells) {
      if(!rendered.has(cell.id))renderCell(cell.id,graph);
    }
    // Follow the notebook's selection like the native graph highlights the
    // active node: bring the selected card into view after render.
    const picked=selected.el as HTMLElement | null;
    if(picked)requestAnimationFrame(()=>picked.scrollIntoView({block:'nearest'}));
  }

  /**
   * The dependency forest: an edge `parent → child` when the child consumes a
   * variable the parent defines. Children keep notebook order.
   */
  private graphTree(notebook:MarimoView):{childrenOf:Map<string,string[]>;roots:string[]} {
    const deps=notebook.currentCellDeps();
    const definer=new Map<string,string>();
    for(const [cellId,entry] of deps) {
      for(const name of entry.outputs)if(!definer.has(name))definer.set(name,cellId);
    }
    const parents=new Map<string,string[]>();
    const childrenOf=new Map<string,string[]>();
    const ids=notebook.cells.map(cell=>cell.id);
    for(const cellId of ids) {
      const seen=new Set<string>();
      for(const name of deps.get(cellId)?.inputs??[]) {
        const parent=definer.get(name);
        if(parent&&parent!==cellId&&!seen.has(parent))seen.add(parent);
      }
      parents.set(cellId,[...seen]);
    }
    for(const cellId of ids) {
      for(const parent of parents.get(cellId)??[]) {
        const list=childrenOf.get(parent)??[];
        list.push(cellId);
        childrenOf.set(parent,list);
      }
    }
    const roots=ids.filter(cellId=>(parents.get(cellId)??[]).length===0);
    return {childrenOf,roots};
  }

  private setGraphZoom(value:number):void {
    this.graphZoom=Math.min(1.4,Math.max(0.7,Math.round(value*100)/100));
    localStorage.setItem(GRAPH_ZOOM_KEY,String(this.graphZoom));
    this.sync();
  }

  /**
   * Selection changed in the notebook: move the highlight in place. Full
   * re-renders would fight the user's scroll position on every click.
   */
  private highlightSelection(cellId:string|null):void {
    if(this.tab!=='deps'||!this.body)return;
    const items=this.body.querySelectorAll<HTMLElement>('.marimo-minimap-row,.marimo-graph-card');
    const selected: HTMLElement[] = [];
    items.forEach(item=>{
      const active=cellId!==null&&item.dataset.cellId===cellId;
      item.classList.toggle('is-selected',active);
      if(active)selected.push(item);
    });
    selected[0]?.scrollIntoView({block:'nearest'});
  }
}
