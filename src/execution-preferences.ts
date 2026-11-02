/** Opening a file only authorizes execution when this preference is explicitly enabled. */
export function autoConnectEnabled(saved:unknown):boolean {
  return saved === true;
}
