export const RELEASE_ASSETS=['main.js','manifest.json','styles.css'];

export function validateAssetNames(names) {
  return names.length===RELEASE_ASSETS.length&&RELEASE_ASSETS.every(name=>names.includes(name))
    ? [] : ['Store assets must be exactly main.js, manifest.json and styles.css (no ZIP/checksum files).'];
}

export function validateReleaseMetadata({manifest,pkg,versions,readme,readmeZh,tag}) {
  const errors=[];
  const semver=/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
  if(!semver.test(manifest.version??''))errors.push('manifest version must be x.y.z.');
  if(!semver.test(manifest.minAppVersion??''))errors.push('minAppVersion must be x.y.z.');
  if(!/^[a-z]+(?:-[a-z]+)*$/.test(manifest.id??'')||manifest.id?.includes('obsidian')||manifest.id?.endsWith('plugin'))errors.push('manifest id violates directory naming rules.');
  if(typeof manifest.name!=='string'||!manifest.name.trim())errors.push('manifest name is required.');
  if(typeof manifest.author!=='string'||!manifest.author.trim())errors.push('manifest author is required.');
  if(typeof manifest.description!=='string'||!manifest.description.endsWith('.')||manifest.description.length>250||!/^[\x20-\x7E]+$/.test(manifest.description))errors.push('description must be a short plain English sentence ending with a period.');
  if(manifest.isDesktopOnly!==true)errors.push('Desktop-only declaration is required by this plugin.');
  if(pkg.version!==manifest.version)errors.push('package version differs from manifest version.');
  if(versions[manifest.version]!==manifest.minAppVersion)errors.push('versions.json must map the current version to minAppVersion.');
  for(const [label,body] of [['README.md',readme],['README.zh-CN.md',readmeZh]]) {
    if(body.match(/^#\s+(.+)$/m)?.[1]?.trim()!==manifest.name)errors.push(`${label} title must match manifest name.`);
  }
  if(!/^## Installation\b/m.test(readme))errors.push('README.md must contain English installation instructions.');
  if(tag!==undefined&&tag!==manifest.version)errors.push('Release tag must exactly match manifest version, without a v prefix.');
  return errors;
}
