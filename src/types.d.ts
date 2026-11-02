declare module '*.py' {const source: string; export default source;}

declare module 'plotly.js-dist-min' {
  const plotly:import('./chart-embed').PlotlyRenderer;
  export default plotly;
}
