import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {stopOwnedProcess} from '../src/process-lifecycle.ts';

class FakeChild extends EventEmitter {
  pid=12345; exitCode: number|null=null;
  stdin={end:()=>undefined};
  kill(_signal:NodeJS.Signals): boolean {return true;}
}
test('a stuck dedicated process group is force stopped', async()=>{
  const child=new FakeChild();const signals:string[]=[];
  const result=stopOwnedProcess(child,{platform:'darwin',graceMs:5,killGroup:(_pid,signal)=>{signals.push(signal);if(signal==='SIGKILL'){child.exitCode=1;child.emit('close');}}});
  await result;
  assert.equal(signals[0],'SIGTERM');assert.ok(signals.includes('SIGKILL'));
});
test('normal close cancels the escalation timer', async()=>{
  const child=new FakeChild();const signals:string[]=[];
  const result=stopOwnedProcess(child,{platform:'darwin',graceMs:100,killGroup:(_pid,signal)=>signals.push(signal)});
  child.exitCode=0;child.emit('close');await result;
  assert.equal(signals[0],'SIGTERM');
});

test('real POSIX child that ignores TERM is killed after the grace period',{skip:process.platform==='win32'},async()=>{
 const {spawn}=await import('node:child_process');
 const child=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});console.log('ready');setInterval(()=>{},1000)"],{detached:true,stdio:'pipe'});
 await new Promise<void>((resolve,reject)=>{child.stdout.once('data',()=>resolve());child.once('error',reject);});
 await stopOwnedProcess(child,{graceMs:20});
 assert.equal(child.signalCode,'SIGKILL');
});
