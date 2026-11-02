import {Events, ItemView, WorkspaceLeaf} from 'obsidian';
import {VIEW_TYPE, MarimoView} from './view';
import type MarimoPlugin from './main';

/**
 * marimo's variables & datasources inspectors, docked in Obsidian's sidebar.
 *
 * The kernel broadcasts `variables` (dataflow graph), `variable-values`
 * (name/type/preview) and `datasets` after every reactive cycle, so this view
 * is purely passive: it renders whatever the active notebook last reported.
 * Clicking a variable jumps to the cell that declares it.
 */
export const VIEW_TYPE_VARIABLES = 'marimo-native-variables';

export class MarimoVariablesView extends ItemView {
  constructor(leaf: WorkspaceLeaf, private plugin: MarimoPlugin) {
    super(leaf);
    this.navigation = false;
  }

  getViewType(): string {return VIEW_TYPE_VARIABLES;}
  getDisplayText(): string {return this.plugin.t('marimo 变量','marimo variables');}
  getIcon(): string {return 'braces';}

  async onOpen(): Promise<void> {
    const workspace: Events = this.app.workspace;
    this.registerEvent(workspace.on('marimo-variables-changed',()=>this.sync()));
    this.registerEvent(workspace.on('active-leaf-change',()=>this.sync()));
    // The workspace may restore notebook leaves after this panel opens.
    let layoutTimer: ReturnType<typeof setTimeout>|null=null;
    this.registerEvent(workspace.on('layout-change',()=>{
      if(layoutTimer)clearTimeout(layoutTimer);
      layoutTimer=setTimeout(()=>{layoutTimer=null;this.sync();},300);
    }));
    this.sync();
  }

  async onClose(): Promise<void> {}

  private activeNotebook(): MarimoView|null {
    return MarimoView.mostRecent(this.app.workspace);
  }

  private sync(): void {
    const content=this.contentEl;
    content.empty();
    content.addClass('marimo-variables-pane');
    const notebook=this.activeNotebook();
    if(!notebook) {
      content.createDiv({cls:'marimo-outline-empty',text:this.plugin.t('打开 marimo notebook 后，这里显示它的变量与数据源。','Open a marimo notebook to see its variables and data sources here.')});
      return;
    }
    const variables=notebook.currentVariables();
    const heading=content.createDiv({cls:'marimo-variables-heading',text:this.plugin.t('变量','Variables')});
    heading.setAttr('aria-label',notebook.file?.name??'');
    if(!variables.length) {
      content.createDiv({cls:'marimo-outline-empty',text:this.plugin.t('尚无变量（运行后出现）。','No variables yet (they appear after a run).')});
    }
    for(const entry of variables) {
      const row=content.createEl('button',{cls:'marimo-variable'});
      row.dataset.variable=entry.name;
      const line=row.createDiv({cls:'marimo-variable-line'});
      line.createSpan({cls:'marimo-variable-name',text:entry.name});
      if(entry.datatype)line.createSpan({cls:'marimo-variable-type',text:entry.datatype});
      if(entry.value!==null&&entry.value!==undefined) {
        row.createDiv({cls:'marimo-variable-value',text:entry.value});
      }
      row.onclick=()=>{
        const target=entry.declaredBy[0];
        if(!target)return;
        const leaf=this.app.workspace.getLeavesOfType(VIEW_TYPE).find(candidate=>candidate.view===notebook);
        if(leaf)void this.app.workspace.revealLeaf(leaf);
        notebook.revealCell(target);
      };
      const declared=entry.declaredBy.length;
      if(declared)row.setAttr('aria-label',this.plugin.t(`由 ${declared} 个单元格定义 · 点击跳转`,`Defined by ${declared} cell(s) · click to jump`));
    }
    const datasets=notebook.currentDatasets();
    if(datasets.length) {
      content.createDiv({cls:'marimo-variables-heading',text:this.plugin.t('数据源','Data sources')});
      for(const table of datasets) {
        const row=content.createDiv({cls:'marimo-dataset'});
        const head=row.createDiv({cls:'marimo-variable-line'});
        head.createSpan({cls:'marimo-variable-name',text:table.name});
        const meta:string[]=[];
        if(table.numRows!==null)meta.push(this.plugin.t(`${table.numRows} 行`,`${table.numRows} rows`));
        if(table.numColumns!==null)meta.push(this.plugin.t(`${table.numColumns} 列`,`${table.numColumns} cols`));
        if(table.source)meta.push(table.source);
        if(meta.length)head.createSpan({cls:'marimo-variable-type',text:meta.join(' · ')});
        // Columns are the useful part for the data explorer experience;
        // they are revealed on click to keep the pane compact.
        if(table.columns.length) {
          const toggle=row.createEl('button',{cls:'marimo-dataset-toggle'});
          toggle.textContent=this.plugin.t(`列 (${table.columns.length}) ▸`,`columns (${table.columns.length}) ▸`);
          const list=row.createDiv({cls:'marimo-dataset-columns'});
          list.hidden=true;
          toggle.onclick=()=>{
            list.hidden=!list.hidden;
            toggle.textContent=list.hidden
              ?this.plugin.t(`列 (${table.columns.length}) ▸`,`columns (${table.columns.length}) ▸`)
              :this.plugin.t(`列 (${table.columns.length}) ▾`,`columns (${table.columns.length}) ▾`);
          };
          for(const column of table.columns.slice(0,50)) {
            const line=list.createDiv({cls:'marimo-variable-line marimo-dataset-column'});
            line.createSpan({cls:'marimo-variable-name',text:column.name});
            if(column.type)line.createSpan({cls:'marimo-variable-type',text:column.type});
          }
          if(table.columns.length>50)list.createDiv({cls:'marimo-outline-empty',text:this.plugin.t('其余列已省略…','More columns omitted…')});
        }
        // Clicking the table jumps to the cell that declares its variable.
        const declaredBy=table.variableName
          ?notebook.currentVariables().find(entry=>entry.name===table.variableName)?.declaredBy[0]
          :undefined;
        if(declaredBy)row.onclick=()=>{
          const leaf=this.app.workspace.getLeavesOfType(VIEW_TYPE).find(candidate=>candidate.view===notebook);
          if(leaf)void this.app.workspace.revealLeaf(leaf);
          notebook.revealCell(declaredBy);
        };
      }
    }
  }
}
