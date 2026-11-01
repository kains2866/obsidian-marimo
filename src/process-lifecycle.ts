import {spawn} from 'node:child_process';

interface ManagedChild {
  pid?: number;
  exitCode: number|null;
  stdin: {end(): unknown};
  once(event: 'close', callback: () => void): unknown;
  kill(signal: NodeJS.Signals): boolean;
}
interface Options {
  platform?: NodeJS.Platform;
  graceMs?: number;
  killGroup?: (pid: number, signal: NodeJS.Signals) => unknown;
}

/** Only use for children spawned into their own dedicated POSIX process group. */
export function stopOwnedProcess(child: ManagedChild, options: Options = {}): Promise<void> {
  const platform=options.platform??process.platform;
  const groupKill=options.killGroup??((pid,signal)=>process.kill(pid,signal));
  const signal=(kind:NodeJS.Signals) => {
    if(platform!=='win32'&&child.pid)groupKill(-child.pid,kind);
    else if(kind==='SIGKILL'&&child.pid)spawn('taskkill',['/PID',String(child.pid),'/T','/F'],{stdio:'ignore'}).on('error',()=>child.kill(kind));
    else child.kill(kind);
  };
  return new Promise((resolve,reject)=>{
    let settled=false;
    let timer: ReturnType<typeof setTimeout>|undefined;
    const finish=()=>{
      if(settled)return;settled=true;if(timer)clearTimeout(timer);
      // If the adapter crashed, remove any orphan members left in this dedicated group.
      if(platform!=='win32'&&child.pid)try{signal('SIGKILL');}catch(error){if((error as NodeJS.ErrnoException).code!=='ESRCH'){reject(error);return;}}
      resolve();
    };
    child.once('close',finish);
    if(child.exitCode!==null){finish();return;}
    timer=setTimeout(()=>{try{signal('SIGKILL');}catch(error){if((error as NodeJS.ErrnoException).code==='ESRCH')finish();else{clearTimeout(timer);reject(error);}}},options.graceMs??10_000);
    try {child.stdin.end();signal('SIGTERM');}
    catch(error){if((error as NodeJS.ErrnoException).code==='ESRCH')finish();else{if(timer)clearTimeout(timer);reject(error);}}
  });
}
