import {test} from 'node:test';
import assert from 'node:assert/strict';
import {decodeMessage, isErrorOutput, isStdinOutput, safeOutput} from '../src/protocol.ts';

test('accepts ready cells without treating code as markup',()=>{
  const result=decodeMessage('{"type":"ready","cells":[{"id":"abc","code":"x = 2"}]}');
  assert.equal(result.type,'ready');
  if(result.type==='ready')assert.equal(result.cells[0].code,'x = 2');
});
test('rejects malformed backend frames',()=>{
  assert.throws(()=>decodeMessage('{"type":"ready","cells":[{}]}'));
  assert.throws(()=>decodeMessage('{"type":"unknown"}'));
});
test('a result frame may carry the id of a cell the adapter just created',()=>{
  const created=decodeMessage('{"type":"result","id":"7","cellId":"native-abc"}');
  assert.equal(created.type,'result');
  if(created.type==='result')assert.equal(created.cellId,'native-abc');
  // A malformed id must fail loudly instead of becoming an empty cell id.
  assert.throws(()=>decodeMessage('{"type":"result","id":"7","cellId":42}'));
  assert.throws(()=>decodeMessage('{"type":"result","id":"7","cellId":""}'));
  const plain=decodeMessage('{"type":"result","id":"8"}');
  if(plain.type==='result')assert.equal(plain.cellId,undefined);
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

test('error channel and error mime types are recognized for error styling',()=>{
  assert.equal(isErrorOutput({channel:'marimo-error',mimetype:'text/plain',data:'boom'}),true);
  assert.equal(isErrorOutput({mimetype:'application/vnd.marimo+traceback',data:'<pre>Traceback</pre>'}),true);
  assert.equal(isErrorOutput({mimetype:'application/vnd.marimo+error',data:[{msg:'x'}]}),true);
});
test('ordinary outputs are not mistaken for errors',()=>{
  assert.equal(isErrorOutput({channel:'output',mimetype:'text/plain',data:'12'}),false);
  assert.equal(isErrorOutput({mimetype:'text/html',data:'<b>12</b>'}),false);
  assert.equal(isErrorOutput({mimetype:'text/markdown',data:'<p>hi</p>'}),false);
  assert.equal(isErrorOutput(null),false);
  assert.equal(isErrorOutput('text'),false);
});

test('raster images become image outputs with an explicit mime',()=>{
  const png=safeOutput({channel:'output',mimetype:'image/png',data:'iVBORw0KGgo='});
  assert.equal(png.kind,'image');
  assert.equal(png.mime,'image/png');
  assert.equal(png.text,'iVBORw0KGgo=');
  assert.equal(safeOutput({mimetype:'image/jpeg',data:'/9j/4AAQ'}).kind,'image');
});
test('vector and malformed image payloads are still refused',()=>{
  assert.equal(safeOutput({mimetype:'image/svg+xml',data:'<svg/>'}).kind,'unsupported');
  assert.equal(safeOutput({mimetype:'image/png',data:'<svg onload="x"/>'}).kind,'unsupported');
  assert.equal(safeOutput({mimetype:'image/png',data:'javascript:alert(1)'}).kind,'unsupported');
  assert.equal(safeOutput({mimetype:'image/png',data:['not','a','string']}).kind,'unsupported');
});

test('the stdin channel is recognized so the view can prompt',()=>{
  assert.equal(isStdinOutput({channel:'stdin',mimetype:'text/plain',data:'Your name: '}),true);
  assert.equal(isStdinOutput({channel:'stdout',mimetype:'text/plain',data:'x'}),false);
  assert.equal(isStdinOutput(null),false);
});

test('formatter and completion results are validated before use',()=>{
  const formatted=decodeMessage('{"type":"result","id":"9","codes":{"abc":"x = 1"}}');
  assert.equal(formatted.type,'result');
  if(formatted.type==='result')assert.deepEqual(formatted.codes,{abc:'x = 1'});
  // Non-string code would replace a cell with "undefined".
  assert.throws(()=>decodeMessage('{"type":"result","id":"9","codes":{"abc":42}}'));
  assert.throws(()=>decodeMessage('{"type":"result","id":"9","codes":[]}'));

  const completed=decodeMessage('{"type":"result","id":"10","prefixLength":2,"options":[{"name":"marimo","type":"module","info":"module marimo"}]}');
  assert.equal(completed.type,'result');
  if(completed.type==='result')assert.equal(completed.options?.[0].name,'marimo');
  assert.throws(()=>decodeMessage('{"type":"result","id":"10","options":[{"type":1}]}'));
  assert.throws(()=>decodeMessage('{"type":"result","id":"10","prefixLength":-1}'));
});

test('an open result only reports whether a browser was launched',()=>{
  const opened=decodeMessage('{"type":"result","id":"11","opened":true}');
  assert.equal(opened.type,'result');
  if(opened.type==='result')assert.equal(opened.opened,true);
  const refused=decodeMessage('{"type":"result","id":"11","opened":false}');
  if(refused.type==='result')assert.equal(refused.opened,false);
  // A truthy string would make "did it open?" unanswerable.
  assert.throws(()=>decodeMessage('{"type":"result","id":"11","opened":"yes"}'));
});

test('plotly and vega chart outputs are recognized for CDN rendering',()=>{
  const spec={data:{values:[{a:1}]}};
  const plotly=safeOutput({mimetype:'application/vnd.plotly.v1+json',data:JSON.stringify(spec)});
  assert.equal(plotly.kind,'plotly');
  assert.deepEqual(JSON.parse(plotly.text),spec);
  const vega=safeOutput({mimetype:'application/vnd.vegalite.v6+json',data:JSON.stringify(spec)});
  assert.equal(vega.kind,'vega');
  assert.deepEqual(JSON.parse(vega.text),spec);
  const vega5=safeOutput({mimetype:'application/vnd.vega.v5+json',data:'{}'});
  assert.equal(vega5.kind,'vega');
  // Broken JSON must not reach the renderer.
  assert.equal(safeOutput({mimetype:'application/vnd.plotly.v1+json',data:'not json'}).kind,'unsupported');
  assert.equal(safeOutput({mimetype:'application/vnd.plotly.v1+json',data:'{"layout":{}}'.slice(0,5)}).kind,'unsupported');
});
