import test from 'node:test';
import assert from 'node:assert/strict';
import {validateReleaseMetadata,validateAssetNames} from '../scripts/release-lib.mjs';

const valid=()=>({manifest:{id:'marimo-notebook',name:'MarimoNotebook',version:'0.0.1',minAppVersion:'1.13.0',description:'Edit and run marimo notebooks with a native interface and a local Python runtime.',author:'Kains',isDesktopOnly:true},pkg:{version:'0.0.1'},versions:{'0.0.1':'1.13.0'},readme:'# MarimoNotebook\n\n## Installation\nEdit notebooks.',readmeZh:'# MarimoNotebook\n\n安装说明。'});
test('matching store metadata and individual assets are accepted',()=>{
  assert.deepEqual(validateReleaseMetadata(valid()),[]);
  assert.deepEqual(validateAssetNames(['main.js','styles.css','manifest.json']),[]);
});
test('mismatching versions, a v-prefixed tag, and a wrong README title fail preflight',()=>{
  const data=valid();data.pkg.version='0.1.0';data.readme='# Another plugin\n\n## Installation';
  const errors=validateReleaseMetadata({...data,tag:'v0.0.1'}).join('\n');
  assert.match(errors,/package/);assert.match(errors,/README/);assert.match(errors,/tag/);
});
test('invalid IDs and mobile declarations cannot silently pass',()=>{
  const data=valid();data.manifest.id='obsidian-example-plugin';data.manifest.isDesktopOnly=false;
  const errors=validateReleaseMetadata(data).join('\n');
  assert.match(errors,/id/);assert.match(errors,/desktop/i);
});
test('compatibility mapping and plain English description remain required',()=>{
  const data=valid();data.versions['0.0.1']='1.12.0';data.manifest.description='Experiment — demo';
  const errors=validateReleaseMetadata(data).join('\n');
  assert.match(errors,/versions.json/);assert.match(errors,/description/);
});
test('ZIPs, checksums, missing files, and additional assets are rejected as store assets',()=>{
  assert.notDeepEqual(validateAssetNames(['main.js','manifest.json','styles.css','plugin.zip']),[]);
  assert.notDeepEqual(validateAssetNames(['main.js','manifest.json']),[]);
  assert.notDeepEqual(validateAssetNames(['main.js','manifest.json','styles.css','SHA256SUMS']),[]);
});
