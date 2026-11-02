import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {collectThirdPartyNotices} from '../scripts/third-party-notices.mjs';

test('bundled dependency notices preserve license text and exclude unused inputs',()=>{
  const root=mkdtempSync(join(tmpdir(),'marimo-notices-'));
  try {
    const dir=join(root,'node_modules','example');mkdirSync(dir,{recursive:true});
    writeFileSync(join(dir,'package.json'),JSON.stringify({name:'example',version:'1.2.3',license:'MIT'}));
    writeFileSync(join(dir,'LICENSE'),'Copyright Example\nFull license terms.\n');
    const notices=collectThirdPartyNotices(root,{outputs:{'dist/main.js':{inputs:{'node_modules/example/index.js':{bytesInOutput:20},'node_modules/unused/index.js':{bytesInOutput:0}}}}});
    assert.match(notices,/example 1\.2\.3/);assert.match(notices,/Copyright Example\nFull license terms\./);assert.doesNotMatch(notices,/unused/);
  } finally {rmSync(root,{recursive:true,force:true});}
});
test('a bundled dependency with no license file blocks notice generation',()=>{
  const root=mkdtempSync(join(tmpdir(),'marimo-notices-'));
  try {
    const dir=join(root,'node_modules','example');mkdirSync(dir,{recursive:true});
    writeFileSync(join(dir,'package.json'),JSON.stringify({name:'example',version:'1.0.0',license:'MIT'}));
    assert.throws(()=>collectThirdPartyNotices(root,{outputs:{out:{inputs:{'node_modules/example/index.js':{bytesInOutput:1}}}}}),/license/i);
  } finally {rmSync(root,{recursive:true,force:true});}
});
test('prebundled engines require explicit vendored notices',()=>{
  const root=mkdtempSync(join(tmpdir(),'marimo-notices-'));
  try {
    const dir=join(root,'node_modules','vega-embed');mkdirSync(dir,{recursive:true});
    writeFileSync(join(dir,'package.json'),JSON.stringify({name:'vega-embed',version:'7.3.0',license:'BSD-3-Clause'}));
    writeFileSync(join(dir,'LICENSE'),'Outer package license.');
    assert.throws(()=>collectThirdPartyNotices(root,{outputs:{out:{inputs:{'node_modules/vega-embed/build/embed.js':{bytesInOutput:1}}}}}),/vendored/i);
  } finally {rmSync(root,{recursive:true,force:true});}
});
