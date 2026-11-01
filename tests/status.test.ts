import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cellActions, environmentLabel, normalizeCellStatus, shouldApplyResult, showPrototypeInfo, statusView, toolbarAvailability, type ViewStatus} from '../src/status.ts';

const zh=(zhText:string)=>zhText;
const en=(_zhText:string,enText:string)=>enText;
const base:ViewStatus={connection:'disconnected',run:'none',dirty:false,changedSinceRun:false};

test('disconnected never claims the notebook has run',()=>{
  assert.deepEqual(statusView(base,zh),{text:'未连接',tone:'muted',busy:false});
  assert.equal(statusView({...base,run:'finished',dirty:true},zh).text,'未连接');
});
test('connecting is announced as busy work',()=>{
  assert.deepEqual(statusView({...base,connection:'connecting'},zh),{text:'连接中…',tone:'accent',busy:true});
});
test('stopping is announced before the session is gone',()=>{
  assert.deepEqual(statusView({...base,connection:'connected',stopping:true},zh),{text:'正在断开…',tone:'accent',busy:true});
});
test('running hides modifiers so the label cannot flicker',()=>{
  assert.deepEqual(statusView({...base,connection:'connected',run:'running',dirty:true,changedSinceRun:true},zh),{text:'运行中…',tone:'accent',busy:true});
});
test('finished distinguishes saved, modified and unsaved notebooks',()=>{
  assert.equal(statusView({...base,connection:'connected',run:'finished'},zh).text,'运行结束 · 已保存');
  assert.equal(statusView({...base,connection:'connected',run:'finished',dirty:true,changedSinceRun:true},zh).text,'运行结束 · 代码已修改 · 未保存');
  assert.equal(statusView({...base,connection:'connected',run:'finished',dirty:true},zh).text,'运行结束 · 未保存');
});
test('failed keeps the error tone and the save state',()=>{
  assert.deepEqual(statusView({...base,connection:'connected',run:'failed',dirty:true},zh),{text:'运行失败 · 未保存',tone:'error',busy:false});
  assert.equal(statusView({...base,connection:'connected',run:'failed'},zh).text,'运行失败 · 已保存');
});
test('connected but never run says so explicitly',()=>{
  assert.equal(statusView({...base,connection:'connected'},zh).text,'尚未运行 · 已保存');
  assert.equal(statusView({...base,connection:'connected',dirty:true},zh).text,'尚未运行 · 未保存');
});
test('status text is translated without changing structure',()=>{
  assert.equal(statusView(base,en).text,'Not connected');
  assert.equal(statusView({...base,connection:'connecting'},en).text,'Connecting…');
  assert.equal(statusView({...base,connection:'connected',run:'running'},en).text,'Running…');
  assert.equal(statusView({...base,connection:'connected',run:'failed',dirty:true},en).text,'Run failed · Unsaved');
  assert.equal(statusView({...base,connection:'connected',run:'finished',dirty:true,changedSinceRun:true},en).text,'Run finished · Code modified · Unsaved');
});

test('actions are unavailable before a real session exists',()=>{
  assert.deepEqual(toolbarAvailability({connection:'disconnected',run:'none',ready:true,hasDraft:false}),{connect:true,runAll:false,save:false,stop:false,restore:false,interrupt:false,format:false,runStale:false});
  assert.deepEqual(toolbarAvailability({connection:'connecting',run:'none',ready:true,hasDraft:true}),{connect:false,runAll:false,save:false,stop:true,restore:false,interrupt:false,format:false,runStale:false});
});
test('a connected idle session can run and save, and can stop',()=>{
  assert.deepEqual(toolbarAvailability({connection:'connected',run:'none',ready:true,hasDraft:false}),{connect:false,runAll:true,save:true,stop:true,restore:false,interrupt:false,format:true,runStale:false});
});
test('busy runs block duplicate run and save requests but keep stop available',()=>{
  assert.deepEqual(toolbarAvailability({connection:'connected',run:'running',ready:true,hasDraft:true}),{connect:false,runAll:false,save:false,stop:true,restore:false,interrupt:true,format:false,runStale:false});
});
test('stopping blocks every action including a second stop',()=>{
  assert.deepEqual(toolbarAvailability({connection:'connected',run:'none',ready:true,hasDraft:false,stopping:true}),{connect:false,runAll:false,save:false,stop:false,restore:false,interrupt:false,format:false,runStale:false});
});
test('an ordinary Python script cannot be connected or restored',()=>{
  assert.deepEqual(toolbarAvailability({connection:'disconnected',run:'none',ready:false,hasDraft:true}),{connect:false,runAll:false,save:false,stop:false,restore:false,interrupt:false,format:false,runStale:false});
});
test('the restore offer follows the draft, applying it needs a session',()=>{
  assert.equal(toolbarAvailability({connection:'connected',run:'none',ready:true,hasDraft:true}).restore,true);
  assert.equal(toolbarAvailability({connection:'connected',run:'none',ready:true,hasDraft:false}).restore,false);
  // The offer is visible even before connecting, so a reader reopening the
  // file learns their unsaved edits survived; clicking it asks to connect.
  assert.equal(toolbarAvailability({connection:'disconnected',run:'none',ready:true,hasDraft:true}).restore,true);
  assert.equal(toolbarAvailability({connection:'disconnected',run:'none',ready:true,hasDraft:false}).restore,false);
});

test('the environment label names the marimo tool, not a raw path',()=>{
  assert.equal(environmentLabel('/Users/me/.local/share/uv/tools/marimo/bin/python'),'marimo (uv)');
  assert.equal(environmentLabel('/srv/project/.venv/bin/python'),'venv');
  assert.equal(environmentLabel('/usr/local/bin/python3.12'),'python3.12');
  assert.equal(environmentLabel(''),'Python');
  assert.equal(environmentLabel('   '),'Python');
});

test('cell statuses map the pinned protocol values onto view kinds',()=>{
  assert.equal(normalizeCellStatus('running'),'running');
  assert.equal(normalizeCellStatus('queued'),'queued');
  assert.equal(normalizeCellStatus('idle'),'idle');
  assert.equal(normalizeCellStatus('disabled-transitively'),'disabled');
});
test('stale inputs only mark idle cells as stale',()=>{
  assert.equal(normalizeCellStatus('idle',true),'stale');
  assert.equal(normalizeCellStatus('running',true),'running');
  assert.equal(normalizeCellStatus('queued',false),'queued');
});
test('unknown or missing cell statuses never fabricate a state',()=>{
  assert.equal(normalizeCellStatus(undefined),'unknown');
  assert.equal(normalizeCellStatus(null),'unknown');
  assert.equal(normalizeCellStatus('exploded'),'unknown');
  assert.equal(normalizeCellStatus(42),'unknown');
});

test('the prototype notice shows before a session and hides once connected',()=>{
  assert.equal(showPrototypeInfo({ready:true,connection:'disconnected'}),true);
  assert.equal(showPrototypeInfo({ready:true,connection:'connecting'}),true);
  assert.equal(showPrototypeInfo({ready:true,connection:'connected'}),false);
  assert.equal(showPrototypeInfo({ready:false,connection:'disconnected'}),false);
});

test('an interrupted run is stated plainly instead of looking successful',()=>{
  assert.deepEqual(statusView({...base,connection:'connected',run:'interrupted'},zh),{text:'已中断 · 已保存',tone:'muted',busy:false});
  assert.equal(statusView({...base,connection:'connected',run:'interrupted',dirty:true,changedSinceRun:true},zh).text,'已中断 · 代码已修改 · 未保存');
  assert.equal(statusView({...base,connection:'connected',run:'interrupted'},en).text,'Interrupted · Saved');
});

test('structural cell actions need a live idle session',()=>{
  const idle={connection:'connected' as const,run:'none' as const,count:3,index:1};
  assert.deepEqual(cellActions(idle),{add:true,remove:true,up:true,down:true});
  // Before connecting the notebook is a read-only preview: no structural edits.
  assert.deepEqual(cellActions({...idle,connection:'disconnected'}),{add:false,remove:false,up:false,down:false});
  assert.deepEqual(cellActions({...idle,connection:'connecting'}),{add:false,remove:false,up:false,down:false});
  // A run owns the session; the file must not change shape mid-cycle.
  assert.deepEqual(cellActions({...idle,run:'running'}),{add:false,remove:false,up:false,down:false});
  assert.deepEqual(cellActions({...idle,busy:true}),{add:false,remove:false,up:false,down:false});
});
test('the first and last cells cannot move past the notebook edges',()=>{
  assert.deepEqual(cellActions({connection:'connected',run:'finished',count:3,index:0}),{add:true,remove:true,up:false,down:true});
  assert.deepEqual(cellActions({connection:'connected',run:'finished',count:3,index:2}),{add:true,remove:true,up:true,down:false});
});
test('the last remaining cell cannot be deleted',()=>{
  assert.deepEqual(cellActions({connection:'connected',run:'none',count:1,index:0}),{add:true,remove:false,up:false,down:false});
  // An empty notebook may still receive a cell.
  assert.deepEqual(cellActions({connection:'connected',run:'none',count:0,index:-1}),{add:true,remove:false,up:false,down:false});
});

test('a superseded request must not overwrite the state of a newer session',()=>{
  const stopped={backend:null,operation:5};
  assert.equal(shouldApplyResult({backend:{id:1},operation:4},stopped),false);
  const restarted={backend:{id:2},operation:6};
  assert.equal(shouldApplyResult({backend:{id:1},operation:4},restarted),false);
  const same={backend:stopped.backend,operation:5};
  assert.equal(shouldApplyResult({backend:null,operation:5},same),true);
});

test('a stale notebook offers a targeted run, and formatting stays available',()=>{
  const live = toolbarAvailability({connection:'connected',run:'finished',ready:true,hasDraft:false,hasStale:true});
  assert.equal(live.runStale,true);
  assert.equal(live.format,true);
  assert.equal(live.runAll,true);
  // Nothing stale: the button must be visible but inert.
  assert.equal(toolbarAvailability({connection:'connected',run:'finished',ready:true,hasDraft:false,hasStale:false}).runStale,false);
  // A running cycle owns the session; formatting must wait.
  assert.equal(toolbarAvailability({connection:'connected',run:'running',ready:true,hasDraft:false,hasStale:true}).format,false);
});
