import {readFileSync,readdirSync} from 'node:fs';
import {join,dirname} from 'node:path';

const VENDORED_NOTICES={
  'vega-embed':{version:'7.3.0',files:['vega-embed-7.3.0-fast-deep-equal.txt','vega-embed-7.3.0-fast-json-patch.txt']},
  'plotly.js-dist-min':{version:'2.32.0',files:['plotly-2.32.0-NOTICES.txt','plotly-2.32.0-vendored-LICENSES.txt']},
};

/** Derive attribution from modules actually emitted by esbuild, including transitives. */
export function collectThirdPartyNotices(root,metafile) {
  const directories=new Set();
  for(const output of Object.values(metafile.outputs))for(const [input,data]of Object.entries(output.inputs??{})) {
    if(data.bytesInOutput<=0||!input.includes('node_modules/'))continue;
    let dir=dirname(input);
    while(dir!=='.'&&dir!==dirname(dir)) {
      try{readFileSync(join(root,dir,'package.json'));directories.add(dir);break;}catch{dir=dirname(dir);}
    }
  }
  const sections=[`# Third-party notices\n\nGenerated from bundled runtime modules. These licenses apply to the named dependencies, not to the entire plugin. The separately installed marimo runtime is Apache-2.0 licensed and is not bundled here. Upstream dist files may contain additional embedded notices, which the build preserves.\n`];
  for(const directory of [...directories].sort()) {
    const pkg=JSON.parse(readFileSync(join(root,directory,'package.json'),'utf8'));
    const files=readdirSync(join(root,directory)).filter(name=>/^(licen[cs]e|copying|notice)(\.|$)/i.test(name)).sort();
    if(!files.length)throw new Error(`Missing license file for ${pkg.name}`);
    sections.push(`## ${pkg.name} ${pkg.version}\n\nLicense: ${pkg.license??'See text below'}.\n`);
    const vendored=VENDORED_NOTICES[pkg.name];
    if(vendored) {
      if(vendored.version!==pkg.version)throw new Error(`Recheck vendored notices before upgrading ${pkg.name}`);
      for(const file of vendored.files) {
        let text;try{text=readFileSync(join(root,'docs/licenses',file),'utf8');}
        catch{throw new Error(`Missing vendored notices for ${pkg.name}: ${file}`);}
        sections.push(`### Vendored: ${file}\n\n\`\`\`text\n${text.trimEnd()}\n\`\`\`\n`);
      }
    }
    for(const file of files)sections.push(`### ${file}\n\n\`\`\`text\n${readFileSync(join(root,directory,file),'utf8').trimEnd()}\n\`\`\`\n`);
  }
  return sections.join('\n');
}
