/**
 * Per-cell configuration, as sent by marimo 0.25.2.
 *
 * The kernel speaks snake_case (`hide_code`) in `kernel-ready` and in the save
 * payload; the view works in camelCase. Everything here is pure so the mapping
 * and the defaults can be tested without a host or a kernel.
 */

export interface CellConfig {
  /** Layout column; `null` means the main column. */
  column: number | null;
  /** A disabled cell and its descendants do not execute. */
  disabled: boolean;
  /** The output stays, the editor is not shown. */
  hideCode: boolean;
  /** Show the whole output instead of a clamped preview. */
  expandOutput: boolean;
}

export const DEFAULT_CELL_CONFIG: CellConfig = {
  column: null,
  disabled: false,
  hideCode: false,
  expandOutput: false,
};

function bool(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function column(value: unknown): number | null | undefined {
  if (value === null) return null;
  return typeof value === 'number' && Number.isInteger(value) ? value : undefined;
}

/**
 * Read a config from the wire. Unknown or mistyped fields fall back to the
 * default instead of reaching a request: a boolean sent as a string would make
 * the kernel reject the whole update.
 */
export function readCellConfig(value: unknown): CellConfig {
  if (!value || typeof value !== 'object') return {...DEFAULT_CELL_CONFIG};
  const raw = value as Record<string, unknown>;
  return {
    column: column(raw.column) ?? DEFAULT_CELL_CONFIG.column,
    disabled: bool(raw.disabled) ?? DEFAULT_CELL_CONFIG.disabled,
    hideCode: bool(raw.hideCode ?? raw.hide_code) ?? DEFAULT_CELL_CONFIG.hideCode,
    expandOutput: bool(raw.expandOutput ?? raw.expand_output) ?? DEFAULT_CELL_CONFIG.expandOutput,
  };
}

export function mergeCellConfig(base: CellConfig, patch: Partial<CellConfig>): CellConfig {
  return {...base, ...patch};
}

/** The request body key names for `set_cell_config`. */
export function wireConfig(config: CellConfig): Record<string, unknown> {
  return {
    column: config.column,
    disabled: config.disabled,
    hide_code: config.hideCode,
    expand_output: config.expandOutput,
  };
}

export interface CellPresentation {
  hideCode: boolean;
  disabled: boolean;
  /** The output is taller than the readable window until the reader expands it. */
  clampOutput: boolean;
}

export function cellPresentation(config: CellConfig): CellPresentation {
  return {hideCode: config.hideCode, disabled: config.disabled, clampOutput: !config.expandOutput};
}
