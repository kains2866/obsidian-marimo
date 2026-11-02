/**
 * Static output sanitization policy.
 *
 * marimo returns pre-rendered HTML for live `mo.md()` output, so the view must
 * strip anything scriptable or remotely loading itself. Keeping the lists here
 * makes the policy testable without a DOM.
 */

/** Elements removed before the fragment is inserted into the document. */
export const BLOCKED_ELEMENTS: readonly string[] = [
  'script', 'style', 'iframe', 'object', 'embed', 'link', 'img', 'svg', 'math',
  'video', 'audio', 'source', 'track', 'picture', 'canvas', 'input', 'button',
  'form', 'textarea', 'select', 'option', 'template', 'meta', 'base',
];

/** Attributes removed from every remaining node. */
export const BLOCKED_ATTRIBUTES: readonly string[] = [
  'style', 'class', 'id', 'name', 'src', 'srcset', 'href', 'action', 'formaction', 'poster',
];

const ELEMENTS = new Set(BLOCKED_ELEMENTS);
const ATTRIBUTES = new Set(BLOCKED_ATTRIBUTES);

export function isBlockedElement(tagName: string): boolean {
  return ELEMENTS.has(tagName.trim().toLowerCase());
}

export function isBlockedAttribute(name: string): boolean {
  const lower = name.trim().toLowerCase();
  return ATTRIBUTES.has(lower) || lower.startsWith('on');
}

/**
 * Inline raster data URLs are the one image source allowed through: they cannot
 * reach the network and cannot carry script. Vector formats stay blocked.
 */
const IMAGE_DATA_URL = /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/i;

export function isAllowedImageSource(src: string | null | undefined): boolean {
  return typeof src === 'string' && IMAGE_DATA_URL.test(src.trim());
}

/**
 * Kernel HTML cannot know vault paths, but an `<img src>` that names a vault
 * file should still load. Turn a raw src into a vault linkpath: percent
 * decoding, `./` stripping, anchor and query removal. Data URLs pass through
 * untouched (they never reach this function in the policy, but stay safe).
 */
export function normalizeLinkpath(src: string | null | undefined): string {
  if (!src) return '';
  const trimmed = src.trim();
  if (trimmed.startsWith('data:')) return trimmed;
  let linkpath = trimmed;
  try {
    linkpath = decodeURIComponent(trimmed);
  } catch {
    // A malformed escape keeps the raw text; getFirstLinkpathDest just fails.
  }
  linkpath = linkpath.replace(/^\.?\//, '');
  const hash = linkpath.indexOf('#');
  if (hash >= 0) linkpath = linkpath.slice(0, hash);
  const query = linkpath.indexOf('?');
  if (query >= 0) linkpath = linkpath.slice(0, query);
  return linkpath;
}

/**
 * marimo renders LaTeX as `<marimo-tex>||(...||)</marimo-tex>`; the custom tag
 * cannot survive sanitization, so the delimiter form is unwrapped to plain
 * `$...$` / `$$...$$` text the reader can still parse.
 */
export function adaptMarimoTex(html: string): string {
  // The wrapper opens with `||(` or `||[` and closes with `||)` or `||]`.
  return html
    .replace(/<marimo-tex[^>]*>\|\|\[([\s\S]*?)\|\|\]<\/marimo-tex>/g, '$$$$$1$$$$')
    .replace(/<marimo-tex[^>]*>\|\|\(([\s\S]*?)\|\|\)<\/marimo-tex>/g, '$$$1$$');
}
