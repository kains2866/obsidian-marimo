import {Events, ItemView, WorkspaceLeaf} from 'obsidian';
import {VIEW_TYPE, MarimoView} from './view';
import type MarimoPlugin from './main';

/**
 * marimo's outline, docked in Obsidian's own right sidebar.
 *
 * Obsidian's core Outline view only reads heading caches that the metadata
 * indexer builds for markdown files — there is no public way to feed it
 * entries from a custom view. So this view takes the native outline's *place*
 * instead: same dock position, same tree look, synced with whatever marimo
 * notebook is active, mirroring the editor's own heading rail.
 */
export const VIEW_TYPE_OUTLINE = 'marimo-native-outline';

export class MarimoOutlineView extends ItemView {
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
    this.sync();
  }

  async onClose(): Promise<void> {}

  /** The active notebook wins; otherwise the outline reads as empty. */
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
    content.addClass('marimo-outline-pane');
    const notebook=this.activeNotebook();
    if(!notebook) {
      content.createDiv({cls:'marimo-outline-empty',text:this.plugin.t('打开 marimo notebook 后，这里显示它的大纲。','Open a marimo notebook to see its outline here.')});
      return;
    }
    const title=content.createDiv({cls:'marimo-outline-file',text:notebook.file?.name??''});
    title.setAttr('aria-label',notebook.file?.path??'');
    const entries=notebook.currentOutline();
    if(!entries.length) {
      content.createDiv({cls:'marimo-outline-empty',text:this.plugin.t('此 notebook 暂无标题。','This notebook has no headings yet.')});
      return;
    }
    for(const entry of entries) {
      const button=content.createEl('button',{cls:'marimo-outline-item',text:entry.text});
      button.dataset.level=String(entry.level);
      button.onclick=()=>{
        // Bring the notebook forward first, like the core outline does for
        // its markdown editor, then jump to the heading's cell.
        const leaf=this.app.workspace.getLeavesOfType(VIEW_TYPE).find(candidate=>candidate.view===notebook);
        if(leaf)void this.app.workspace.revealLeaf(leaf);
        notebook.revealCell(entry.cellId);
      };
    }
  }
}
