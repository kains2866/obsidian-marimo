#!/usr/bin/env node
// Local manual-install archive only. GitHub releases use individual dist files.
import {execFileSync} from 'node:child_process';
import {readFileSync, mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {RELEASE_ASSETS} from './release-lib.mjs';

const repo=fileURLToPath(new URL('../',import.meta.url));
execFileSync(process.execPath,['build.mjs'],{cwd:repo,stdio:'inherit'});
execFileSync(process.execPath,['scripts/check-release.mjs','--artifacts'],{cwd:repo,stdio:'inherit'});
const manifest=JSON.parse(readFileSync(join(repo,'manifest.json'),'utf8'));
const outDir=join(repo,'release');
mkdirSync(outDir,{recursive:true});
const output=join(outDir,`${manifest.id}-${manifest.version}.zip`);
const python=process.env.MARIMO_TEST_PYTHON||(process.platform==='win32'?'python':'python3');
execFileSync(python,['-c',`
import json, os, sys, tempfile, zipfile
root, output, plugin_id, names = sys.argv[1:]
fd, temporary = tempfile.mkstemp(prefix='.package-', suffix='.zip', dir=os.path.dirname(output))
os.close(fd)
try:
    with zipfile.ZipFile(temporary, 'w', zipfile.ZIP_DEFLATED) as archive:
        for name in json.loads(names):
            archive.write(os.path.join(root, 'dist', name), plugin_id + '/' + name)
    os.replace(temporary, output)
finally:
    if os.path.exists(temporary):
        os.unlink(temporary)
`,repo,output,manifest.id,JSON.stringify(RELEASE_ASSETS)],{stdio:'inherit'});
console.log(`Local manual-install archive: ${output}`);
