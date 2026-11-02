/** Chart engines are pinned npm dependencies bundled into main.js, never CDN scripts. */
export interface PlotlyRenderer {
  newPlot(target:HTMLElement,figure:unknown,config?:unknown):Promise<unknown>;
}
export type VegaRenderer=(target:HTMLElement,spec:unknown,options?:unknown)=>Promise<unknown>;

async function loadPlotly():Promise<PlotlyRenderer> {
  const module=await import('plotly.js-dist-min');
  return module.default;
}
async function loadVega():Promise<VegaRenderer> {
  const module=await import('vega-embed');
  return module.default as unknown as VegaRenderer;
}
function renderFailure(host:HTMLElement,kind:string):void {
  const note=document.createElement('div');
  note.className='marimo-native-widget-note';
  note.textContent=`${kind} 图表渲染失败。/${kind} chart could not be rendered.`;
  host.append(note);
}
export async function renderPlotly(host:HTMLElement,spec:unknown,load:()=>Promise<PlotlyRenderer>=loadPlotly):Promise<void> {
  const target=document.createElement('div');
  target.className='marimo-native-chart';host.append(target);
  try {
    const plotly=await load();
    if(!target.isConnected)return;
    await plotly.newPlot(target,spec,{responsive:true});
  }catch{if(target.isConnected)renderFailure(host,'Plotly');}
}
export async function renderVega(host:HTMLElement,spec:unknown,load:()=>Promise<VegaRenderer>=loadVega):Promise<void> {
  const target=document.createElement('div');
  target.className='marimo-native-chart';host.append(target);
  try {
    const embed=await load();
    if(!target.isConnected)return;
    await embed(target,spec,{actions:false});
  }catch{if(target.isConnected)renderFailure(host,'Vega');}
}
