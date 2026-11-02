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
    this.sync();
  }

  async onClose(): Promise<void> {}

  private activeNotebook(): MarimoView|null {
    const active=this.app.workspace.getActiveViewOfType(MarimoView);
    if(active&&!active.isClosed())return active;
    for(const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      const view=leaf.view;
      if(view instanceof MarimoView&&!view.isClosed())return view;
    }
    return null;
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
        row.createSpan({cls:'marimo-variable-name',text:table.name});
        if(table.source)row.createSpan({cls:'marimo-variable-type',text:table.source});
      }
    }
  }
}
