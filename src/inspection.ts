import {spawn} from 'node:child_process';
import type {Cell} from './protocol.ts';

export interface Inspection {isMarimo:boolean;cells:Cell[];error?:string}

function decodeInspection(text:string):Inspection {
  let value:unknown;
  try{value=JSON.parse(text);}catch{throw new Error('Invalid notebook inspection response');}
  if(!value||typeof value!=='object')throw new Error('Invalid notebook inspection response');
  const record=value as Record<string,unknown>;
  if(typeof record.isMarimo!=='boolean'||!Array.isArray(record.cells)||(record.error!==undefined&&typeof record.error!=='string'))throw new Error('Invalid notebook inspection response');
  const ids=new Set<string>();
  const cells=record.cells.map((item:unknown)=>{
    const cell=item as Partial<Cell>|null;
    if(!cell||typeof cell.id!=='string'||typeof cell.code!=='string'||ids.has(cell.id))throw new Error('Invalid notebook inspection response');
    ids.add(cell.id);return {id:cell.id,code:cell.code};
  });
  if((!record.isMarimo||record.error)&&cells.length)throw new Error('Invalid notebook inspection response');
  return {isMarimo:record.isMarimo,cells,...(typeof record.error==='string'?{error:record.error}:{})};
}

// Only the bundled standard-library inspector runs; notebook source is stdin data.
export function inspectSource(python:string,source:string,script:string,options:{signal?:AbortSignal;timeout?:number;maxBytes?:number}={}):Promise<Inspection> {
  return new Promise((resolve,reject)=>{
    if(options.signal?.aborted){reject(new Error('Notebook inspection cancelled'));return;}
    const child=spawn(python,['-I','-S','-c',script],{stdio:'pipe',windowsHide:true});
    const chunks:Buffer[]=[];let size=0;let settled=false;
    const finish=(error?:Error,value?:Inspection)=>{
      if(settled)return;settled=true;
      clearTimeout(timer);options.signal?.removeEventListener('abort',cancel);
      if(error){child.kill('SIGKILL');reject(error);}else resolve(value!);
    };
    const cancel=()=>finish(new Error('Notebook inspection cancelled'));
    const timer=setTimeout(()=>finish(new Error('Notebook inspection timed out')),options.timeout??15_000);
    options.signal?.addEventListener('abort',cancel,{once:true});
    child.once('error',error=>finish(error));
    child.stdin.on('error',error=>finish(error));
    child.stderr.resume();
    child.stdout.on('data',(chunk:Buffer)=>{
      size+=chunk.length;
      if(size>(options.maxBytes??8*1024*1024)){finish(new Error('Notebook inspection response too large'));return;}
      if(!settled)chunks.push(chunk);
    });
    child.once('close',code=>{
      if(settled)return;
      if(code!==0){finish(new Error(`Notebook inspection stopped (${code??'signal'})`));return;}
      try{finish(undefined,decodeInspection(Buffer.concat(chunks).toString('utf8')));}catch(error){finish(error as Error);}
    });
    child.stdin.end(source);
  });
}
