import {test} from 'node:test';
import assert from 'node:assert/strict';
import {decodeMessage, safeOutput} from '../src/protocol.ts';

test('accepts ready cells without treating code as markup',()=>{
  const result=decodeMessage('{"type":"ready","cells":[{"id":"abc","code":"x = 2"}]}');
  assert.equal(result.type,'ready');
  if(result.type==='ready')assert.equal(result.cells[0].code,'x = 2');
});
test('rejects malformed backend frames',()=>{
  assert.throws(()=>decodeMessage('{"type":"ready","cells":[{}]}'));
  assert.throws(()=>decodeMessage('{"type":"unknown"}'));
});
test('only text and explicitly sanitized HTML may be displayed',()=>{
  assert.equal(safeOutput({mimetype:'application/javascript',data:'alert(1)'}).kind,'unsupported');
  assert.equal(safeOutput({mimetype:'text/plain',data:'<script>bad</script>'}).kind,'text');
  assert.equal(safeOutput({mimetype:'text/html',data:'<b>12</b>'}).kind,'html');
  assert.equal(safeOutput({mimetype:'image/svg+xml',data:'<svg onload="alert(1)"/>'}).kind,'unsupported');
});

test('marimo runtime errors become readable plain text',()=>{
  const output=safeOutput({mimetype:'application/vnd.marimo+error',data:[{type:'exception',msg:'native-probe-error'}]});
  assert.equal(output.kind,'text');
  assert.match(output.text,/native-probe-error/);
});

test('recognizes pre-rendered live marimo markdown output',()=>{
  assert.equal(safeOutput({mimetype:'text/markdown',data:'<h2>Result</h2><p><strong>6</strong></p>'}).kind,'html');
});

test('traceback markup uses the same sanitization path as static HTML',()=>{
  assert.equal(safeOutput({mimetype:'application/vnd.marimo+traceback',data:'<pre>ValueError</pre>'}).kind,'html');
});
