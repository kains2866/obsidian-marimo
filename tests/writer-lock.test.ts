import test from 'node:test';
import assert from 'node:assert/strict';
import {WriterLocks} from '../src/writer-lock.ts';

const owner=()=>({isClosed:()=>false,onClose:async()=>{}});
test('stale file A claim cannot release current file B lock',async()=>{
  let finish!:()=>void;
  const prior={isClosed:()=>true,onClose:()=>new Promise<void>(resolve=>{finish=resolve;})};
  const locks=new WriterLocks();
  const old=await locks.claim('A',prior);
  const current=owner();
  const delayed=locks.claim('A',current);
  const b=await locks.claim('B',current);
  locks.release(old);finish();
  locks.release(await delayed);
  await assert.rejects(locks.claim('B',owner()),/already connected/);
  locks.release(b);
  await locks.claim('B',owner());
});
test('late cleanup of an older lease cannot remove a renewed lease',async()=>{
  const locks=new WriterLocks();const view=owner();
  const first=await locks.claim('renamed-path',view);
  const second=await locks.claim('renamed-path',view);
  locks.release(first);
  await assert.rejects(locks.claim('renamed-path',owner()),/already connected/);
  locks.release(second);await locks.claim('renamed-path',owner());
});
