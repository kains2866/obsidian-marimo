import {build} from 'esbuild';
import {mkdir,copyFile} from 'node:fs/promises';
await mkdir('dist',{recursive:true});
await build({entryPoints:['src/main.ts'],outfile:'dist/main.js',bundle:true,loader:{'.py':'text'},platform:'node',format:'cjs',target:'es2022',external:['obsidian','electron']});
for(const name of ['manifest.json','styles.css']) await copyFile(name,`dist/${name}`);
