import {Decoration, EditorView, ViewPlugin, WidgetType, keymap, type DecorationSet, type ViewUpdate} from '@codemirror/view';
import {Facet, Prec, StateEffect, StateField, type Extension} from '@codemirror/state';

/**
 * Copilot-style ghost text: after a short typing pause the fetcher is asked
 * for a suggestion at the cursor; it renders as translucent text after the
 * caret. Tab accepts, any cursor move or edit dismisses. Errors are swallowed
 * — a failed completion must never disturb typing.
 */

export interface InlineRequest {prefix: string;suffix: string;signal: AbortSignal}
export type InlineFetcher = (request: InlineRequest) => Promise<string | null>;

interface Suggestion {pos: number;text: string}

const setSuggestion = StateEffect.define<Suggestion | null>();

class GhostWidget extends WidgetType {
  constructor(readonly text: string) {super();}
  override eq(other: GhostWidget): boolean {return other.text === this.text;}
  toDOM(): HTMLElement {
    const span=document.createElement('span');
    span.className='cm-inline-suggestion';
    span.textContent=this.text;
    return span;
  }
  override ignoreEvent(): boolean {return false;}
}

const suggestionField = StateField.define<Suggestion | null>({
  create: () => null,
  update(value, tr) {
    let next = value;
    for (const effect of tr.effects) {
      if (effect.is(setSuggestion)) next = effect.value;
    }
    // Any edit invalidates the suggestion: it was written against the old doc.
    if (tr.docChanged) next = null;
    return next;
  },
  provide: field => EditorView.decorations.compute([field], state => {
    const suggestion = state.field(field);
    if (!suggestion) return Decoration.none as DecorationSet;
    return Decoration.set([
      Decoration.widget({widget: new GhostWidget(suggestion.text), side: 1}).range(suggestion.pos),
    ]);
  }),
});

const clearAll = (view: EditorView): void => {
  if (view.state.field(suggestionField, false)) view.dispatch({effects: setSuggestion.of(null)});
};

/** The minimum typed text before a completion is worth a round-trip. */
const MIN_PREFIX = 4;
const PREFIX_WINDOW = 4000;
const SUFFIX_WINDOW = 1000;
const DEBOUNCE_MS = 600;

/** The configured fetcher, so the plugin class needs no extra constructor argument. */
const fetcherFacet = Facet.define<InlineFetcher, InlineFetcher>({combine: fetchers => fetchers[fetchers.length - 1]!});

const triggerPlugin = ViewPlugin.fromClass(class {
  private timer: ReturnType<typeof setTimeout>|null = null;
  private seq = 0;
  private controller: AbortController | null = null;
  private destroyed = false;

  constructor(readonly view: EditorView) {}

  update(update: ViewUpdate): void {
    if (!update.docChanged && !update.selectionSet) return;
    clearAll(this.view);
    if (this.timer) clearTimeout(this.timer);
    if (update.transactions.some(tr => tr.isUserEvent('input.type'))) this.schedule();
  }

  private schedule(): void {
    this.timer = setTimeout(() => {this.timer = null;void this.request();}, DEBOUNCE_MS);
  }

  private async request(): Promise<void> {
    const view = this.view;
    const state = view.state;
    if (state.readOnly) return;
    const fetcher = state.facet(fetcherFacet);
    if (!fetcher) return;
    const pos = state.selection.main.head;
    const prefix = state.doc.sliceString(Math.max(0, pos - PREFIX_WINDOW), pos);
    if (prefix.trim().length < MIN_PREFIX) return;
    const suffix = state.doc.sliceString(pos, Math.min(state.doc.length, pos + SUFFIX_WINDOW));
    const seq = ++this.seq;
    this.controller?.abort();
    this.controller = new AbortController();
    let text: string | null = null;
    try {
      text = await fetcher({prefix, suffix, signal: this.controller.signal});
    } catch {
      return; // A failed suggestion is silent; typing continues uninterrupted.
    }
    if (!text || seq !== this.seq || this.destroyed) return;
    // The caret may have moved on while the request was in flight.
    if (view.state.selection.main.head !== pos) return;
    try {
      view.dispatch({effects: setSuggestion.of({pos, text})});
    } catch {
      // The editor can go away between the check and the dispatch.
    }
  }

  destroy(): void {
    this.destroyed = true;
    if (this.timer) clearTimeout(this.timer);
    this.controller?.abort();
  }
});

const acceptKeymap = Prec.highest(keymap.of([
  {
    key: 'Tab',
    run: view => {
      const suggestion = view.state.field(suggestionField, false);
      if (!suggestion) return false;
      view.dispatch({
        changes: {from: suggestion.pos, insert: suggestion.text},
        selection: {anchor: suggestion.pos + suggestion.text.length},
        effects: setSuggestion.of(null),
      });
      return true;
    },
  },
]));

/** Escape dismisses before Obsidian's other Escape handlers see it. */
const escapeKeymap = Prec.highest(keymap.of([
  {
    key: 'Escape',
    run: view => {
      if (!view.state.field(suggestionField, false)) return false;
      clearAll(view);
      return true;
    },
  },
]));

/** Build the ghost-text extension around the given fetcher. */
export function inlineSuggestion(fetcher: InlineFetcher): Extension {
  return [suggestionField, fetcherFacet.of(fetcher), triggerPlugin, acceptKeymap, escapeKeymap];
}
