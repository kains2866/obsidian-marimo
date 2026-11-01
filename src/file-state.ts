export function fileFromViewState(value:unknown):string {
  if(!value||typeof value!=='object')return '';
  const state=value as Record<string,unknown>;
  if(typeof state.file==='string'&&state.file)return state.file;
  return typeof state.filename==='string'?state.filename:'';
}
