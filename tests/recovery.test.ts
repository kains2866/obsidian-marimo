import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {RecoveryStore, normalizePython} from '../src/recovery.ts';

test('durable recovery roundtrips edited code with its original baseline',()=>{
 const dir=mkdtempSync(join(tmpdir(),'native-recovery-test-'));
 try {const store=new RecoveryStore(dir);const file=store.write('a.py',[{id:'a',code:'x=4'}],['x=2']);assert.ok(readFileSync(file,'utf8').includes('x=4'));assert.equal(store.read('a.py')?.cells[0].code,'x=4');assert.deepEqual(store.read('a.py')?.baseCodes,['x=2']);assert.equal(store.read('b.py'),null);store.remove('a.py');assert.equal(store.read('a.py'),null);}finally{rmSync(dir,{recursive:true,force:true});}
});
test('blank Python configuration uses an available default',()=>{
 assert.equal(normalizePython('  ','/python'),'/python');assert.equal(normalizePython(undefined,'/python'),'/python');assert.equal(normalizePython(' /custom ','/python'),'/custom');
});
