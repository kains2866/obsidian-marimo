import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {RecoveryStore, normalizePython} from '../src/recovery.ts';

test('durable recovery roundtrips edited code with its original baseline',()=>{
 const dir=mkdtempSync(join(tmpdir(),'native-recovery-test-'));
 try {const store=new RecoveryStore(dir);const file=store.write('a.py',[{id:'a',code:'x=4'}],['x=2']);assert.ok(readFileSync(file,'utf8').includes('x=4'));assert.equal(store.read('a.py')?.cells[0].code,'x=4');assert.deepEqual(store.read('a.py')?.baseCodes,['x=2']);assert.equal(store.read('b.py'),null);store.remove('a.py');assert.equal(store.read('a.py'),null);}finally{rmSync(dir,{recursive:true,force:true});}
});

test('a draft may hold a different number of cells than its baseline',()=>{
 // Structural edits (insert/delete) legitimately change the cell count while
 // the file baseline stays as read; the reader must not reject that.
 const dir=mkdtempSync(join(tmpdir(),'native-recovery-test-'));
 try {const store=new RecoveryStore(dir);
   store.write('b.py',[{id:'a',code:'x=2'},{id:'b',code:'x+1'}],['x=2']);
   const draft=store.read('b.py');
   assert.ok(draft);
   assert.equal(draft.cells.length,2);
   assert.equal(draft.baseCodes.length,1);
 } finally {rmSync(dir,{recursive:true,force:true});}
});

test('corrupt drafts still fail loudly instead of restoring garbage',()=>{
 const dir=mkdtempSync(join(tmpdir(),'native-recovery-test-'));
 try {const store=new RecoveryStore(dir);
   const file=store.write('c.py',[{id:'a',code:'x=1'}],['x=1']);
   writeFileSync(file,JSON.stringify({filename:'c.py',cells:[{id:3,code:'x=1'}],baseCodes:['x=1']}));
   assert.throws(()=>store.read('c.py'),/Recovery draft is invalid/);
 } finally {rmSync(dir,{recursive:true,force:true});}
});
test('blank Python configuration uses an available default',()=>{
 assert.equal(normalizePython('  ','/python'),'/python');assert.equal(normalizePython(undefined,'/python'),'/python');assert.equal(normalizePython(' /custom ','/python'),'/custom');
});
