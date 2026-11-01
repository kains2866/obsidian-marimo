import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fileFromViewState} from '../src/file-state.ts';

test('native Obsidian file state wins over legacy filename',()=>{
 assert.equal(fileFromViewState({file:'new.py',filename:'old.py'}),'new.py');
});
test('previously saved prototype tabs can restore their filename',()=>{
 assert.equal(fileFromViewState({filename:'demo.py'}),'demo.py');
});
test('bad or empty workspace state is ignored',()=>{
 assert.equal(fileFromViewState(null),'');assert.equal(fileFromViewState({file:2}),'');assert.equal(fileFromViewState({file:''}),'');
});
