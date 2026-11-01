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
