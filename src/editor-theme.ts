import {HighlightStyle} from '@codemirror/language';
import {tags} from '@lezer/highlight';

// Obsidian owns the palette; no fixed light/dark editor theme is installed.
export const nativeHighlight = HighlightStyle.define([
  {tag:tags.keyword,color:'var(--code-keyword, var(--text-normal))'},
  {tag:[tags.string,tags.special(tags.string)],color:'var(--code-string, var(--text-normal))'},
  {tag:tags.comment,color:'var(--code-comment, var(--text-muted))'},
  {tag:[tags.number,tags.bool,tags.null],color:'var(--code-value, var(--text-normal))'},
  {tag:tags.operator,color:'var(--code-operator, var(--text-normal))'},
  {tag:tags.function(tags.variableName),color:'var(--code-function, var(--text-normal))'},
  {tag:tags.className,color:'var(--code-type, var(--text-normal))'},
  {tag:tags.variableName,color:'var(--code-normal, var(--text-normal))'},
]);
