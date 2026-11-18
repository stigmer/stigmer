// Resolution of the Node.js runtime used to launch the runner and TS-server
// subprocesses.
//
// We reuse the very Node that is running the CLI (process.execPath). The CLI is
// itself an npm package whose `engines` is the server's range (Node 22 from
// 22.19, or 24 and later), so npm warns at install on a Node that cannot run
// the server — there is deliberately no hermetic Node download (keep the base
// install lean: nothing to acquire that the host already provides). This is
// exactly what the conformance harness does (`spawn(process.execPath, ...)`).
// An explicit STIGMER_NODE_BIN override is honored and checked the same way
// for advanced/multi-runtime setups.
//
// The runner's gate is a CAPABILITY probe; the server's is its declared
// version range, then a capability probe:
//
// - The RUNNER's durable local checkpointer imports Node's built-in
//   `node:sqlite`, available unflagged from 22.13 in the 22.x line and only
//   from 23.4 in the 23.x line — a gap (23.0–23.3) that a previous
//   version-table gate here missed, letting those Nodes through to crash at
//   runner boot with a raw ERR_UNKNOWN_BUILTIN_MODULE. Probing the module
//   cannot drift; the runner's floors survive only in its error copy.
// - The SERVER declares the Nodes it runs on in its own `engines`
//   (`backend/services/stigmer-server/package.json`), above the runner's:
//   its outbound dialer loads undici, whose floor is 22.19, and the server
//   supports 22.x and 24+. undici's need has no capability this resolver
//   could probe without loading undici, so here the gate IS a version check,
//   against `SERVER_NODE_LINES`, which a test holds equal to the server's
//   declared range and to this package's own `engines`, so the two cannot
//   drift apart. The server ALSO needs `node:sqlite` compiled WITH FTS5 (its
//   search index; migration v3 creates an fts5 virtual table at boot), and
//   that stays a capability probe: a Node in range whose sqlite build lacks
//   FTS5 is refused by what it cannot do.
//
// The runner performs the module-presence probe on its own boot (see
// backend/services/runner/src/preflight.ts); the server fails at migration
// time. These gates exist to fail at resolve time with CLI-appropriate
// guidance instead of a subprocess crash.

import { execFileSync } from "node:child_process";
import { CliExitError } from "../../errors/cli-exit-error.js";
import { ExitCode } from "@stigmer/client/exit-codes";

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
 * The Node lines the server runs on, lowest accepted version first: each
 * entry accepts its major from `minor`, and the last accepts every later
 * major too. The one source for the server's floor in the CLI: the range
 * string, the sentence and the check all derive from it, and a test holds
 * the range equal to the server's `engines.node` and this package's own.
 */
const SERVER_NODE_LINES = [
  { major: 22, minor: 19 },
  { major: 24, minor: 0 },
] as const;

/** Whether the line at `index` is the last, which accepts every later major too. */
const isLastLine = (index: number): boolean => index === SERVER_NODE_LINES.length - 1;

/** The server's supported Node range as npm's `engines` writes it: `>=22.19.0 <23 || >=24`. */
export const SERVER_NODE_RANGE = SERVER_NODE_LINES.map(({ major, minor }, i) =>
  isLastLine(i)
    ? minor === 0
      ? `>=${major}`
      : `>=${major}.${minor}.0`
    : `>=${major}.${minor}.0 <${major + 1}`,
).join(" || ");

/** The same range in words: "Node.js 22 (22.19 or newer) or Node.js 24 or newer". */
export const SERVER_NODE_FLOOR = SERVER_NODE_LINES.map(({ major, minor }, i) =>
  isLastLine(i)
    ? minor === 0
      ? `Node.js ${major} or newer`
      : `Node.js ${major}.${minor} or newer`
    : `Node.js ${major} (${major}.${minor} or newer)`,
).join(" or ");

/** Whether `version` (`v22.19.0` or `22.19.0`) is on a line the server runs on. */
export function serverRunsOn(version: string): boolean {
  const [major = Number.NaN, minor = Number.NaN] = version.replace(/^v/, "").split(".").map(Number);
  return SERVER_NODE_LINES.some(
    (line, i) => (major === line.major && minor >= line.minor) || (isLastLine(i) && major > line.major),
  );
}

/**
 * Resolve the Node binary to launch the TS server with. Same
 * STIGMER_NODE_BIN/execPath resolution as {@link resolveNode}, but checks
 * the binary's version against the server's supported lines first (a Node
 * outside them is refused naming the version to install), then probes for
 * `node:sqlite` WITH FTS5 — the server's search index needs it, and a Node
 * build can ship node:sqlite without it. Runs on server-launch paths only
 * (ensureServer).
 */
export function resolveServerNode(): string {
  const bin = nodeCandidate();
  const version = probeNodeVersion(bin);
  if (version === null) {
    throw new CliExitError(
      `could not run ${bin} to verify the stigmer server's Node requirements`,
      ExitCode.General,
      [`Ensure ${bin} is a working ${SERVER_NODE_FLOOR} runtime.`],
    );
  }
  if (!serverRunsOn(version)) {
    throw new CliExitError(
      `Node at ${bin} (${version}) cannot run the stigmer server: it needs ${SERVER_NODE_FLOOR}`,
      ExitCode.General,
      [
        "These are the Node lines the server is built and tested for; on 22.x its network client needs 22.19 or newer.",
        `Install ${SERVER_NODE_FLOOR}, or point STIGMER_NODE_BIN at one.`,
      ],
    );
  }
  assertCapability(bin, NODE_SQLITE_FTS5_PROBE, {
    subject: "the stigmer server",
    capability: "the built-in node:sqlite module with FTS5",
    floor: SERVER_NODE_FLOOR,
    detail: [
      "The server's search index requires node:sqlite compiled with FTS5,",
      "and this Node's sqlite build lacks it.",
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

/** The binary's `--version` (`v22.19.0`); null when the spawn fails. */
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
  /** The known-good version floor, per probe — the two differ (the runner
   * accepts 23.4+; the server does not). Error copy only; the probe is the
   * authority for the capability. */
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
