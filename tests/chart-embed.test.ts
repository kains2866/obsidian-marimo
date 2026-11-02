import test from 'node:test';
import assert from 'node:assert/strict';
import {renderPlotly, renderVega} from '../src/chart-embed.ts';

class Element {
  className=''; textContent=''; isConnected=true; children:Element[]=[];
  append(child:Element) {this.children.push(child);}
}
async function withDocument(body:(host:HTMLElement,created:string[])=>Promise<void>) {
  const old=Object.getOwnPropertyDescriptor(globalThis,'document');
  const created:string[]=[];
  Object.defineProperty(globalThis,'document',{configurable:true,value:{createElement:(tag:string)=>{created.push(tag);return new Element();}}});
  try {await body(new Element() as unknown as HTMLElement,created);}
  finally {if(old)Object.defineProperty(globalThis,'document',old);else Reflect.deleteProperty(globalThis,'document');}
}
test('Plotly renders through a bundled loader without injecting script tags',async()=>{
  await withDocument(async(host,created)=>{
    const figure={data:[{x:[1],y:[2]}]};let called=false;
    await renderPlotly(host,figure,async()=>({newPlot:async(_target:HTMLElement,data:unknown)=>{called=true;assert.equal(data,figure);}}));
    assert.equal(called,true);assert.equal(created.includes('script'),false);
  });
});
test('Vega renders locally through the same library boundary',async()=>{
  await withDocument(async(host,created)=>{
    const spec={mark:'bar'};let called=false;
    await renderVega(host,spec,async()=>async(_target:HTMLElement,data:unknown)=>{called=true;assert.equal(data,spec);});
    assert.equal(called,true);assert.equal(created.includes('script'),false);
  });
});
test('a renderer failure reports a readable error without claiming a CDN is needed',async()=>{
  await withDocument(async(host)=>{
    await renderVega(host,{},async()=>{throw new Error('renderer failed');});
    const text=(host as unknown as Element).children.map(child=>child.textContent).join('');
    assert.match(text,/render|渲染/);assert.doesNotMatch(text,/network|联网|CDN/i);
  });
});
