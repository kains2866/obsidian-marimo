import {Events, ItemView, MarkdownRenderer, Notice, setIcon, WorkspaceLeaf} from 'obsidian';
import {chatWithAI} from './ai';
import {MarimoView, VIEW_TYPE} from './view';
import type MarimoPlugin from './main';

/**
 * marimo's chat panel, docked in Obsidian's sidebar.
 *
 * One conversation per open view, wired to the same OpenAI-compatible endpoint
 * as cell generation. Every turn carries the active notebook's cells and the
 * variables in memory, so the assistant can answer against real data shapes.
 * Code blocks in a reply can be inserted into the notebook as runnable cells.
 */
export const VIEW_TYPE_CHAT = 'marimo-native-chat';

interface ChatMessage {role: 'user'|'assistant';content: string}

export class MarimoChatView extends ItemView {
  private history: ChatMessage[] = [];
  private log!: HTMLElement;
  private input!: HTMLTextAreaElement;
  private sendButton!: HTMLButtonElement;
  private generating = false;

  constructor(leaf: WorkspaceLeaf, private plugin: MarimoPlugin) {
    super(leaf);
    this.navigation = false;
  }

  getViewType(): string {return VIEW_TYPE_CHAT;}
  getDisplayText(): string {return this.plugin.t('marimo AI 对话','marimo AI chat');}
  getIcon(): string {return 'bot-message-square';}

  async onOpen(): Promise<void> {
    const workspace: Events = this.app.workspace;
    this.registerEvent(workspace.on('active-leaf-change',()=>this.refreshHeader()));
    this.contentEl.empty();
    this.contentEl.addClass('marimo-chat');
    const header=this.contentEl.createDiv({cls:'marimo-chat-header'});
    this.headerNote=header.createSpan({cls:'marimo-chat-context'});
    const clear=header.createEl('button',{cls:'marimo-chat-clear is-icon-only'});
    setIcon(clear,'eraser');
    clear.setAttr('aria-label',this.plugin.t('清空对话','Clear conversation'));
    clear.onclick=()=>{if(!this.generating){this.history=[];this.renderLog();}};

    this.log=this.contentEl.createDiv({cls:'marimo-chat-log'});
    const composer=this.contentEl.createDiv({cls:'marimo-chat-composer'});
    this.input=composer.createEl('textarea');
    this.input.placeholder=this.plugin.t('询问这个 notebook…（Ctrl/Cmd+Enter 发送）','Ask about this notebook… (Ctrl/Cmd+Enter to send)');
    this.input.rows=3;
    this.input.addEventListener('keydown',event=>{
      if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)){event.preventDefault();void this.send();}
    });
    this.sendButton=composer.createEl('button',{text:this.plugin.t('发送','Send'),cls:'mod-cta'});
    this.sendButton.onclick=()=>void this.send();

    if(!this.plugin.settings.aiBaseUrl||!this.plugin.settings.aiApiKey) {
      this.log.createDiv({cls:'marimo-outline-empty',text:this.plugin.t('先在设置中配置 AI 端点与密钥，再开始对话。','Configure an AI endpoint and key in the settings first.')});
    }
    this.refreshHeader();
    this.renderLog();
  }

  private headerNote!: HTMLElement;

  async onClose(): Promise<void> {}

  private activeNotebook(): MarimoView|null {
    return MarimoView.mostRecent(this.app.workspace);
  }

  private refreshHeader(): void {
    const notebook=this.activeNotebook();
    const name=notebook?.file?.name??this.plugin.t('未打开 notebook','No notebook open');
    this.headerNote.textContent=name;
    this.headerNote.setAttr('aria-label',name);
  }

  private renderLog(): void {
    this.log.empty();
    if(!this.history.length) {
      this.log.createDiv({cls:'marimo-outline-empty',text:this.plugin.t('还没有对话。','No messages yet.')});
      return;
    }
    for(const message of this.history) this.appendBubble(message.role,message.content);
    this.log.scrollTop=this.log.scrollHeight;
  }

  /** One message bubble; assistant markdown renders with code blocks intact. */
  private appendBubble(role:'user'|'assistant', content:string, live=false): HTMLElement {
    const bubble=this.log.createDiv({cls:`marimo-chat-bubble marimo-chat-${role}`+(live?' is-live':'')});
    if(role==='user') {
      bubble.createSpan({text:content});
    } else {
      const body=bubble.createDiv({cls:'marimo-chat-body'});
      void MarkdownRenderer.render(this.app,content,body,'',this);
      const fenced=/```[a-zA-Z0-9]*\s*\n([\s\S]*?)```/g.exec(content);
      if(fenced) {
        const insert=bubble.createEl('button',{cls:'marimo-chat-insert'});
        setIcon(insert,'plus');
        insert.createSpan({text:this.plugin.t('插入为单元格并运行','Insert as cell and run')});
        insert.onclick=()=>{
          const notebook=this.activeNotebook();
          if(!notebook)return;
          void notebook.insertGeneratedCell(fenced[1].trim());
        };
      }
    }
    return bubble;
  }

  private async send(): Promise<void> {
    const message=this.input.value.trim();
    if(!message||this.generating)return;
    const settings=this.plugin.settings;
    if(!settings.aiBaseUrl||!settings.aiApiKey) {
      new Notice(this.plugin.t('请先在设置中配置 AI 端点与密钥。','Configure an AI endpoint and key in the settings first.'));
      return;
    }
    const notebook=this.activeNotebook();
    const context=notebook?notebook.aiContext():{code:'(empty notebook)',variables:[]};
    this.generating=true;
    this.sendButton.disabled=true;
    this.input.value='';
    // The user bubble and a live assistant bubble that grows with the stream.
    this.log.querySelector('.marimo-outline-empty')?.remove();
    this.appendBubble('user',message);
    const live=this.appendBubble('assistant','',true);
    const body=live.querySelector<HTMLElement>('.marimo-chat-body')!;
    this.history.push({role:'user',content:message});
    try {
      let streamed='';
      const reply=await chatWithAI(
        {baseUrl:settings.aiBaseUrl,apiKey:settings.aiApiKey,model:settings.aiModel||'gpt-4o-mini'},
        this.history.slice(0,-1),message,context,{
          onDelta:chunk=>{
            streamed+=chunk;
            body.empty();
            void MarkdownRenderer.render(this.app,streamed,body,'',this);
            this.log.scrollTop=this.log.scrollHeight;
          },
        });
      this.history.push({role:'assistant',content:reply});
    } catch(error) {
      const text=String(error);
      this.history.push({role:'assistant',content:text});
      new Notice(text);
    } finally {
      this.generating=false;
      this.sendButton.disabled=false;
      this.renderLog();
    }
  }
}
