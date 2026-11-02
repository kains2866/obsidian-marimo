/**
 * The marimo interpreter to spawn, per platform.
 *
 * uv's tool layout differs between POSIX (`~/.local/share/uv/tools`) and
 * Windows (`%APPDATA%/uv/tools`, with a `Scripts` directory instead of `bin`).
 * When nothing sensible exists the bare interpreter name is used, matching
 * what `python3` / `python` resolves to on each platform.
 */
import {join} from 'node:path';

export interface PathEnv {
  platform: NodeJS.Platform;
  home: string;
  /** The host passes its own `existsSync`; kept injectable for tests. */
  exists: (path: string) => boolean;
  /** Windows only; defaults to `%APPDATA%`. */
  appData?: string;
}

const POSIX_UV = (home: string): string => join(home, '.local', 'share', 'uv', 'tools', 'marimo', 'bin', 'python');
const WINDOWS_UV = (appData: string): string => join(appData, 'uv', 'tools', 'marimo', 'Scripts', 'python.exe');
const WINDOWS_LOCAL = (home: string): string => join(home, '.local', 'bin', 'marimo', 'Scripts', 'python.exe');

export function defaultPythonPath(env: PathEnv): string {
  if (env.platform === 'win32') {
    const appData = env.appData ?? join(env.home, 'AppData', 'Roaming');
    if (env.exists(WINDOWS_UV(appData))) return WINDOWS_UV(appData);
    if (env.exists(WINDOWS_LOCAL(env.home))) return WINDOWS_LOCAL(env.home);
    return 'python';
  }
  if (env.exists(POSIX_UV(env.home))) return POSIX_UV(env.home);
  return 'python3';
}
