/**
 * CDN-backed renderers for plotly and vega/vega-lite chart outputs.
 *
 * The chart JSON never touches innerHTML: it goes to the library APIs
 * (`Plotly.newPlot` / `vegaEmbed`) after the script tags are loaded. When the
 * network is unavailable the placeholder note says so instead of failing the
 * whole output.
 */

const PLOTLY_CDN = 'https://cdn.plot.ly/plotly-2.32.0.min.js';
const VEGA_CDNS = [
  'https://cdn.jsdelivr.net/npm/vega@5.30.0/build/vega.min.js',
  'https://cdn.jsdelivr.net/npm/vega-lite@5.21.0/build/vega-lite.min.js',
  'https://cdn.jsdelivr.net/npm/vega-embed@6.26.0/build/vega-embed.min.js',
];

declare global {
  interface Window {
    Plotly?: {newPlot: (el: HTMLElement, spec: unknown, config?: unknown) => Promise<unknown>};
    vegaEmbed?: (el: HTMLElement, spec: unknown, options?: unknown) => Promise<unknown>;
  }
}

const loaded = new Map<string, Promise<void>>();

function loadScript(src: string): Promise<void> {
  const existing = loaded.get(src);
  if (existing) return existing;
  const promise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      loaded.delete(src);
      script.remove();
      reject(new Error('chart library failed to load: ' + src));
    };
    document.head.append(script);
  });
  loaded.set(src, promise);
  return promise;
}

function offlineNote(host: HTMLElement, kind: string): void {
  const note = document.createElement('div');
  note.className = 'marimo-native-widget-note';
  note.textContent = `${kind} 图表库需要联网加载。/${kind} charts load their library from the network.`;
  host.append(note);
}

/** Render a plotly figure spec; safe to call many times on one host. */
export async function renderPlotly(host: HTMLElement, spec: unknown): Promise<void> {
  const target = document.createElement('div');
  target.className = 'marimo-native-chart';
  host.append(target);
  try {
    await loadScript(PLOTLY_CDN);
    if (!window.Plotly) throw new Error('plotly missing after load');
    await window.Plotly.newPlot(target, spec, {responsive: true});
  } catch {
    offlineNote(host, 'Plotly');
  }
}

/** Render a vega-lite (or vega) spec through vega-embed. */
export async function renderVega(host: HTMLElement, spec: unknown): Promise<void> {
  const target = document.createElement('div');
  target.className = 'marimo-native-chart';
  host.append(target);
  try {
    for (const src of VEGA_CDNS) await loadScript(src);
    if (!window.vegaEmbed) throw new Error('vega-embed missing after load');
    await window.vegaEmbed(target, spec, {actions: false});
  } catch {
    offlineNote(host, 'Vega');
  }
}
