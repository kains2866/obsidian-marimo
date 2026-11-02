export const RELEASE_ASSETS:string[];
export function validateAssetNames(names:string[]):string[];
export function validateReleaseMetadata(data:{manifest:Record<string,unknown>;pkg:Record<string,unknown>;versions:Record<string,unknown>;readme:string;readmeZh:string;tag?:string}):string[];
