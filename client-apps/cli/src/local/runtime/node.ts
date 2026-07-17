// Resolution of the Node.js runtime used to launch the runner subprocess.
//
// We reuse the very Node that is running the CLI (process.execPath). The CLI is
// itself an npm package with `engines: node >= 22.13`, so a suitable Node is
// always present by construction — there is deliberately no hermetic Node
// download (DD-002: keep the base install lean; nothing to acquire that the host
// already guarantees). This is exactly what the conformance harness does
// (`spawn(process.execPath, ...)`). An explicit STIGMER_NODE_BIN override is
// honored and capability-checked for advanced/multi-runtime setups.
//
// The gate is a CAPABILITY probe, not a version check. The runner's durable
// local checkpointer imports Node's built-in `node:sqlite`, available unflagged
// from 22.13 in the 22.x line and only from 23.4 in the 23.x line — a gap
// (23.0–23.3) that a previous version-table gate here missed, letting those
// Nodes through to crash at runner boot with a raw ERR_UNKNOWN_BUILTIN_MODULE.
// Probing "can this binary provide node:sqlite?" directly cannot drift; the
// version floors survive only in the error message, where staleness is
// harmless. The runner performs the same probe on its own boot (see
// backend/services/runner/src/preflight.ts) — this one exists to fail at
// resolve time with CLI-appropriate guidance instead of a subprocess crash.

import { execFileSync } from "node:child_process";
import { CliExitError } from "../../errors/cli-exit-error.js";
import { ExitCode } from "../../errors/exit-codes.js";

// Exits 0 when the binary provides `node:sqlite`, 1 otherwise.
//
// Probe notes (each verified against real binaries; do not "simplify"):
// - `process.getBuiltinModule(id)` returns the module when present and
//   `undefined` when absent — no throw. The `?.` guard covers Nodes older than
//   22.3, where `getBuiltinModule` itself does not exist (no `node:sqlite`
//   there either, so exiting 1 is correct).
// - `module.builtinModules` is NOT a valid alternative: it omits experimental
//   builtins, so it reports no `sqlite` even on Nodes where `node:sqlite`
//   loads fine (e.g. 22.13+). Gating on it would reject every supported Node.
// - The probe runs in a SUBPROCESS with stdio suppressed even for the CLI's
//   own runtime: `getBuiltinModule` loads the module, which on 22.x emits an
//   `ExperimentalWarning` on stderr that must not leak into the CLI's output.
const NODE_SQLITE_PROBE =
  "process.exit(process.getBuiltinModule?.('node:sqlite') === undefined ? 1 : 0)";

/**
 * Resolve the Node binary to launch the runner with. Honors STIGMER_NODE_BIN;
 * otherwise returns the current runtime. Either way the binary is probed for
 * the runner's `node:sqlite` requirement; an unsuitable binary throws an
 * actionable CliExitError. The probe cost is one silent subprocess spawn on
 * runner-launch paths only (ensureRunner), never on ordinary CLI commands.
 */
export function resolveNode(): string {
  const override = process.env.STIGMER_NODE_BIN;
  const bin = override !== undefined && override !== "" ? override : process.execPath;
  assertProvidesNodeSqlite(bin);
  return bin;
}

/** Best-effort `--version` for error messages only; null when the spawn fails. */
function probeNodeVersion(bin: string): string | null {
  try {
    const out = execFileSync(bin, ["--version"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out.trim();
  } catch {
    return null;
  }
}

function assertProvidesNodeSqlite(bin: string): void {
  let exitStatus: number | null;
  try {
    execFileSync(bin, ["-e", NODE_SQLITE_PROBE], { stdio: "ignore" });
    return;
  } catch (err) {
    // execFileSync reports a nonzero exit via `status`; a spawn failure
    // (ENOENT, not executable) leaves it null/undefined.
    exitStatus = (err as { status?: number | null }).status ?? null;
  }

  if (exitStatus === null) {
    throw new CliExitError(`could not run ${bin} to verify the runner's Node requirements`, ExitCode.General, [
      `Ensure ${bin} is a working Node >= 22.13 runtime (>= 23.4 in the 23.x line).`,
    ]);
  }

  const version = probeNodeVersion(bin) ?? "unknown version";
  throw new CliExitError(
    `Node at ${bin} (${version}) cannot run the runner: it does not provide the built-in node:sqlite module`,
    ExitCode.General,
    [
      "The runner's durable checkpointer requires node:sqlite, which is available",
      "unflagged from Node 22.13 (22.x line) and 23.4 (23.x and later) — note that",
      "23.0-23.3 lack it.",
      "Upgrade Node, or point STIGMER_NODE_BIN at a suitable runtime.",
    ],
  );
}
