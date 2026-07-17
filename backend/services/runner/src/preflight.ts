/**
 * Boot preflight: verify the Node runtime can run this runner BEFORE the deep
 * import chains load.
 *
 * Why this exists: the durable local checkpointer (shared/checkpointer/
 * sqlite-saver.ts) imports Node's built-in `node:sqlite` at module load time,
 * and both the manager and the static runner eagerly import that chain during
 * initialization. On a Node without unflagged `node:sqlite` — anything below
 * 22.13, and 23.0–23.3 (the 23.x line only gained it in 23.4) — that import
 * throws a raw `ERR_UNKNOWN_BUILTIN_MODULE` deep inside init, which surfaces
 * to hosts (e.g. the desktop Run dialog) as an inscrutable internal error.
 * This gate turns it into an actionable "your Node cannot run the runner"
 * message on the very first line of output.
 *
 * Why a capability probe and not a version check: version gating is exactly
 * what let this failure ship — the CLI's node resolver encoded a 22.13 floor
 * but its table missed the 23.0–23.3 gap. Probing the capability itself
 * ("can this binary provide node:sqlite?") cannot drift. The version floors
 * appear only in the human-facing message, where staleness is harmless.
 *
 * The gate is unconditional (not checkpointer-type-dependent): the eager
 * import chain needs `node:sqlite` to LOAD regardless of configuration, so
 * the gate mirrors the actual load-time requirement.
 */

/**
 * True when this Node binary provides the built-in `node:sqlite`.
 *
 * Probe notes (each verified against real binaries; do not "simplify"):
 * - `process.getBuiltinModule(id)` returns the module when present and
 *   `undefined` when absent — no throw. The `?.` guard covers Nodes older
 *   than 22.3, where `getBuiltinModule` itself does not exist (there
 *   `node:sqlite` is absent too, so reporting "unsupported" is correct).
 * - `module.builtinModules` is NOT a valid alternative: it omits experimental
 *   builtins, so it reports no `sqlite` even on Nodes where `node:sqlite`
 *   loads fine (e.g. 22.13+). Gating on it would reject every supported Node.
 * - The probe loads the module, which on 22.x emits a one-time
 *   `ExperimentalWarning` on stderr. The runner loads `node:sqlite` eagerly
 *   moments later anyway, so this only moves that warning to boot.
 */
export function isNodeSqliteAvailable(): boolean {
  return process.getBuiltinModule?.("node:sqlite") !== undefined;
}

/**
 * Check the current runtime, returning `null` when it can run the runner or
 * an actionable operator-facing message when it cannot. The probe is
 * injectable so tests can exercise the failure path on a supported Node.
 */
export function preflightNodeRuntime(
  isSqliteAvailable: () => boolean = isNodeSqliteAvailable,
): string | null {
  if (isSqliteAvailable()) return null;
  return (
    `Node v${process.versions.node} does not provide the built-in node:sqlite ` +
    `module required by the runner's durable checkpointer. ` +
    `Use Node >= 22.13 (22.x line) or >= 23.4 (23.x and later).`
  );
}
