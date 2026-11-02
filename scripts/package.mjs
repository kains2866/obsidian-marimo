#!/usr/bin/env node
/**
 * Build the plugin and zip the three release files into
 * `release/marimo-notebook-<version>.zip`, the layout Obsidian's manual
 * install expects (manifest.json at the archive root).
 */
import {execFileSync} from 'node:child_process';
import {mkdirSync, readFileSync, rmSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const repo = join(root, '..');

const manifest = JSON.parse(readFileSync(join(repo, 'manifest.json'), 'utf8'));
const outDir = join(repo, 'release');
const zipName = `marimo-notebook-${manifest.version}.zip`;

execFileSync('node', ['build.mjs'], {cwd: repo, stdio: 'inherit'});
rmSync(outDir, {recursive: true, force: true});
mkdirSync(outDir, {recursive: true});
execFileSync('zip', ['-j', join(outDir, zipName), 'dist/main.js', 'dist/manifest.json', 'dist/styles.css'], {cwd: repo, stdio: 'inherit'});
console.log(`Packaged ${outDir}/${zipName}`);
