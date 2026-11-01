import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectSource} from '../src/inspection.ts';

const python=process.env.MARIMO_TEST_PYTHON??'python3';
test('inspection passes source through stdin without evaluating it',async()=>{
  const result=await inspectSource(python,'raise RuntimeError("must not run")','import sys,json; code=sys.stdin.read(); print(json.dumps({"isMarimo":True,"cells":[{"id":"preview-0","code":code}]}))');
  assert.equal(result.cells[0]?.code,'raise RuntimeError("must not run")');
});
test('rejects malformed inspector responses',async()=>{
  for(const output of ['{"isMarimo":true,"cells":[{"id":3,"code":"x"}]}','noise','{"isMarimo":false,"cells":[{"id":"x","code":"x"}]}']) {
    await assert.rejects(inspectSource(python,'',`print(${JSON.stringify(output)})`),/Invalid notebook inspection/);
  }
});
test('aborted inspections cannot apply stale previews',async()=>{
  const abort=new AbortController();
  const pending=inspectSource(python,'','import time;time.sleep(30)',{signal:abort.signal});
  abort.abort();
  await assert.rejects(pending,/cancelled/);
});
test('hung and excessive inspections fail instead of leaving the page waiting',async()=>{
  await assert.rejects(inspectSource(python,'','import time;time.sleep(30)',{timeout:30}),/timed out/);
  await assert.rejects(inspectSource(python,'','print("x"*5000)',{maxBytes:100}),/too large/);
});
test('missing Python reports a failed inspection',async()=>{
  await assert.rejects(inspectSource('/nonexistent/marimo-python','',''),/ENOENT/);
});
