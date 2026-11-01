/**
 * Creating a marimo notebook from inside Obsidian.
 *
 * Two pure pieces so the behaviour is testable without a vault: the template a
 * new file starts from, and the naming rule that keeps an existing notebook
 * from ever being overwritten.
 */

/**
 * The smallest notebook the backend accepts and the static preview can read:
 * module scaffolding only, one cell importing `marimo`, and the `__main__`
 * guard `marimo` itself writes. Every cell body is multi-line — the preview
 * rejects one-line bodies.
 */
export const NOTEBOOK_TEMPLATE = `import marimo

__generated_with = "0.25.2"
app = marimo.App()


@app.cell
def _():
    import marimo as mo

    return (mo,)


if __name__ == "__main__":
    app.run()
`;

/** How many numbered candidates to try before giving up on a name. */
const MAX_ATTEMPTS = 1000;

/**
 * The first free `<folder>/Untitled marimo[ n].py`, never an occupied path.
 * `taken` is injected so callers can use the vault index and tests can use a
 * set; the first number that fits wins, and a folder full of attempts throws
 * rather than overwrite.
 */
export function nextNotebookPath(folder: string, taken: (path: string) => boolean, base = 'Untitled marimo'): string {
  const prefix = folder.replace(/^\/+|\/+$/g, '');
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const name = attempt === 0 ? `${base}.py` : `${base} ${attempt}.py`;
    const path = prefix ? `${prefix}/${name}` : name;
    if (!taken(path)) return path;
  }
  throw new Error(`No free name for ${base} after ${MAX_ATTEMPTS} attempts`);
}
