import {readFile,readdir,lstat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {isBuiltin} from 'node:module';
import {RELEASE_ASSETS,validateAssetNames,validateReleaseMetadata} from './release-lib.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const read=path=>readFile(join(root,path),'utf8');
const json=async path=>JSON.parse(await read(path));
const args=process.argv.slice(2);
try {
  const tagIndex=args.indexOf('--tag');
  if(tagIndex>=0&&!args[tagIndex+1])throw new Error('--tag needs an exact version.');
  const manifest=await json('manifest.json');
  const pkg=await json('package.json');
  const errors=validateReleaseMetadata({manifest,pkg,versions:await json('versions.json'),readme:await read('README.md'),readmeZh:await read('README.zh-CN.md'),...(tagIndex>=0?{tag:args[tagIndex+1]}:{})});
  const lock=await json('package-lock.json');
  if(lock.packages?.['']?.version!==manifest.version)errors.push('package-lock root version differs from manifest.');
  if(!(await read('LICENSE')).startsWith('MIT License'))errors.push('MIT LICENSE is missing.');
  await read(`docs/releases/${manifest.version}.md`);
  if(args.includes('--artifacts')) {
    const names=await readdir(join(root,'dist'));
    errors.push(...validateAssetNames(names));
    for(const name of RELEASE_ASSETS) {
      const stat=await lstat(join(root,'dist',name));
      if(!stat.isFile()||!stat.size)errors.push(`Invalid distributable: ${name}`);
    }
    if(await read('manifest.json')!==await read('dist/manifest.json'))errors.push('Built manifest differs from root manifest.');
    if(await read('THIRD_PARTY_NOTICES.md')!==await read('build/third-party-notices.md'))errors.push('Third-party notices are stale; rebuild and copy build/third-party-notices.md to THIRD_PARTY_NOTICES.md.');
    if(await read('styles.css')!==await read('dist/styles.css'))errors.push('Built styles are stale.');
    const noticeComment='/* Third-party license texts\n'+(await read('THIRD_PARTY_NOTICES.md')).replaceAll('*/','* /')+'\n*/';
    if(!(await read('dist/main.js')).includes(noticeComment))errors.push('Built JavaScript is missing full third-party license texts.');
    const meta=await json('build/metafile.json');
    for(const output of Object.values(meta.outputs))for(const item of output.imports??[]) {
      if(item.external&&!['obsidian','electron'].includes(item.path)&&!isBuiltin(item.path))errors.push(`Unbundled runtime dependency: ${item.path}`);
    }
  }
  if(errors.length)throw new Error(errors.join('\n'));
  console.log(`Release preflight passed: ${manifest.name} ${manifest.version}${args.includes('--artifacts')?' (three store assets)':''}`);
}catch(error){console.error(error.message);process.exitCode=1;}
