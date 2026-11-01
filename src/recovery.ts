import {createHash,randomUUID} from 'node:crypto';
import {mkdirSync,chmodSync,readFileSync,writeFileSync,renameSync,unlinkSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import type {Cell} from './protocol';

export interface Recovery {filename:string; baseCodes:string[]; cells:Cell[]; created:string}
export function normalizePython(value:unknown,fallback:string):string {return typeof value==='string'&&value.trim()?value.trim():fallback;}
export class RecoveryStore {
  private directory:string;
  constructor(directory:string) {this.directory=directory;}
  private path(filename:string):string {return join(this.directory,createHash('sha256').update(filename).digest('hex')+'.json');}
  write(filename:string,cells:Cell[],baseCodes:string[]):string {
    mkdirSync(this.directory,{recursive:true,mode:0o700});chmodSync(this.directory,0o700);
    const file=this.path(filename);const temporary=file+'.'+randomUUID()+'.tmp';
    try {
      writeFileSync(temporary,JSON.stringify({filename,cells,baseCodes,created:new Date().toISOString()}),{mode:0o600,flag:'wx',flush:true});
      renameSync(temporary,file);
    } finally {if(existsSync(temporary))unlinkSync(temporary);}
    return file;
  }
  read(filename:string):Recovery|null {
    const file=this.path(filename);if(!existsSync(file))return null;
    const value=JSON.parse(readFileSync(file,'utf8')) as Recovery;
    // A draft that came from structural edits legitimately holds a different
    // number of cells than the file baseline; only types are validated here.
    if(value.filename!==filename||!Array.isArray(value.cells)||!value.cells.every(c=>c&&typeof c?.id==='string'&&typeof c?.code==='string')||!Array.isArray(value.baseCodes)||!value.baseCodes.every(c=>typeof c==='string'))throw new Error('Recovery draft is invalid; original cache retained');
    return value;
  }
  remove(filename:string):void {const file=this.path(filename);if(existsSync(file))unlinkSync(file);}
}
