// Resolution of the Node.js runtime used to launch the runner and TS-server
// subprocesses.
//
// We reuse the very Node that is running the CLI (process.execPath). The CLI is
// itself an npm package with `engines: node >= 22.13`, so a suitable Node is
// always present by construction — there is deliberately no hermetic Node
// download (DD-002: keep the base install lean; nothing to acquire that the host
// already guarantees). This is exactly what the conformance harness does
// (`spawn(process.execPath, ...)`). An explicit STIGMER_NODE_BIN override is
// honored and capability-checked for advanced/multi-runtime setups.
//
// The gates are CAPABILITY probes, not version checks. Two probes, because the
// two children need different sqlite capabilities:
//
// - The RUNNER's durable local checkpointer imports Node's built-in
//   `node:sqlite`, available unflagged from 22.13 in the 22.x line and only
//   from 23.4 in the 23.x line — a gap (23.0–23.3) that a previous
//   version-table gate here missed, letting those Nodes through to crash at
//   runner boot with a raw ERR_UNKNOWN_BUILTIN_MODULE.
// - The SERVER additionally needs `node:sqlite` compiled WITH FTS5 (its
//   search index; migration v3 creates an fts5 virtual table at boot). Node
//   23.4 PROVIDES node:sqlite but its sqlite build LACKS FTS5 — found by
//   D4 #14 and the reason the module-presence probe alone is insufficient
//   for the server. Probing "can this binary create an fts5 table?" directly
//   cannot drift; the version floors survive only in the error messages,
//   where staleness is harmless.
//
// The runner performs the module-presence probe on its own boot (see
// backend/services/runner/src/preflight.ts); the server fails at migration
// time. Both probes here exist to fail at resolve time with CLI-appropriate
// guidance instead of a subprocess crash.

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

// Exits 0 when the binary's `node:sqlite` can create an FTS5 virtual table,
// 1 otherwise. Strictly stronger than NODE_SQLITE_PROBE: it exercises the
// exact operation the server's migration v3 performs, in memory. The
// try/catch covers both failure shapes — module absent (TypeError on the
// undefined module) and FTS5 absent (the exec throws "no such module: fts5").
const NODE_SQLITE_FTS5_PROBE =
  "try{const{DatabaseSync}=process.getBuiltinModule('node:sqlite');" +
  "new DatabaseSync(':memory:').exec('CREATE VIRTUAL TABLE t USING fts5(x)');" +
  "process.exit(0)}catch{process.exit(1)}";

/**
 * Resolve the Node binary to launch the runner with. Honors STIGMER_NODE_BIN;
 * otherwise returns the current runtime. Either way the binary is probed for
 * the runner's `node:sqlite` requirement; an unsuitable binary throws an
 * actionable CliExitError. The probe cost is one silent subprocess spawn on
 * runner-launch paths only (ensureRunner), never on ordinary CLI commands.
 */
export function resolveNode(): string {
  const bin = nodeCandidate();
  assertCapability(bin, NODE_SQLITE_PROBE, {
    subject: "the runner",
    capability: "the built-in node:sqlite module",
    floor: "Node >= 22.13 (>= 23.4 in the 23.x line)",
    detail: [
      "The runner's durable checkpointer requires node:sqlite, which is available",
      "unflagged from Node 22.13 (22.x line) and 23.4 (23.x and later) — note that",
      "23.0-23.3 lack it.",
    ],
  });
  return bin;
}

/**
 * Resolve the Node binary to launch the TS server with. Same
 * STIGMER_NODE_BIN/execPath resolution as {@link resolveNode}, but probes for
 * `node:sqlite` WITH FTS5 — the server's search index needs it and some Node
 * builds (e.g. 23.4) ship node:sqlite without it. Runs on server-launch paths
 * only (ensureServer).
 */
export function resolveServerNode(): string {
  const bin = nodeCandidate();
  assertCapability(bin, NODE_SQLITE_FTS5_PROBE, {
    subject: "the stigmer server",
    capability: "the built-in node:sqlite module with FTS5",
    floor: "Node 22.13+ in the 22.x line (23.x builds lack FTS5)",
    detail: [
      "The server's search index requires node:sqlite compiled with FTS5.",
      "The 22.x line from 22.13 is known-good; 23.x builds ship node:sqlite",
      "WITHOUT FTS5 and cannot run the server. Newer majors work if their",
      "sqlite build includes FTS5 — this probe is the authority.",
    ],
  });
  return bin;
}

function nodeCandidate(): string {
  const override = process.env.STIGMER_NODE_BIN;
  return override !== undefined && override !== ""
    ? override
    : process.execPath;
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

interface CapabilityErrorCopy {
  /** What is being launched, e.g. "the runner". */
  subject: string;
  /** The missing capability, in user terms. */
  capability: string;
  /** The known-good version floor, per probe — the two probes differ (the
   * runner accepts 23.4+; the server does not). Error copy only; the probe
   * is the authority. */
  floor: string;
  /** Guidance lines explaining the requirement. */
  detail: string[];
}

function assertCapability(
  bin: string,
  probe: string,
  copy: CapabilityErrorCopy,
): void {
  let exitStatus: number | null;
  try {
    execFileSync(bin, ["-e", probe], { stdio: "ignore" });
    return;
  } catch (err) {
    // execFileSync reports a nonzero exit via `status`; a spawn failure
    // (ENOENT, not executable) leaves it null/undefined.
    exitStatus = (err as { status?: number | null }).status ?? null;
  }

  if (exitStatus === null) {
    throw new CliExitError(
      `could not run ${bin} to verify ${copy.subject}'s Node requirements`,
      ExitCode.General,
      [`Ensure ${bin} is a working ${copy.floor} runtime.`],
    );
  }

  const version = probeNodeVersion(bin) ?? "unknown version";
  throw new CliExitError(
    `Node at ${bin} (${version}) cannot run ${copy.subject}: it does not provide ${copy.capability}`,
    ExitCode.General,
    [
      ...copy.detail,
      "Upgrade Node, or point STIGMER_NODE_BIN at a suitable runtime.",
    ],
  );
}
