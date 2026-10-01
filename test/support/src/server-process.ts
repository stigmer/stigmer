// Boots a stigmer-server child process against throwaway state and waits for
// it to report the ports it bound.
// Domain: test support (stack spawns).
//
// Each instance owns a temp dir (SQLite DB + storage) and its own ports, so
// suite files can boot servers concurrently without colliding. The child is
// handed port 0 for both listeners and asked for its ready line
// (STIGMER_READY_LINE=stdout, the server's boot/ready-line.ts): the ports its
// listeners actually bound, printed once both are listening. That removes the
// window a probed-then-released port leaves for another listener to take
// (ports.ts, stigmer#1469), and because the line comes from this child, the
// harness can never mistake another process on the port for its server. The
// ready line only proves the listeners are up; the gRPC-level readiness gate
// lives in the target.
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stopChild, teeChildOutput } from "./child-process.ts";
import { UNREACHABLE_HOST_PORT } from "./ports.ts";

const READY_TIMEOUT_MS = 20_000;
const LOG_TAIL_BYTES = 8_000;

// The ready line's one top-level key. The server's boot/ready-line.ts
// (READY_LINE_KEY) spells it too: this package imports only `node:*` and its
// own files, so the two copies are pinned together end to end instead, by
// every boot through this function.
const READY_LINE_KEY = "stigmerServerReady";

// The Temporal address of a server spawned with no engine behind it. It must
// stay dead for the whole run, for the reason ports.ts gives (stigmer#1221).
const ENGINELESS_TEMPORAL_HOST_PORT = UNREACHABLE_HOST_PORT;

// The OAuth callback URL every hermetic server boots with (see the env block
// below): a fixed dummy the server only forwards as the redirect_uri, never
// fetches. Exported so a suite can assert the redirect_uri the server presents
// to an authorization server against the value the server was given — one
// source of truth, no copy drift.
export const HERMETIC_OAUTH_REDIRECT_URI = "http://127.0.0.1:8234/auth/oauth/callback";

// The storage ONE spawned server writes to, as the env that selects it plus
// the obligation to release it — the managed targets' storage-driver seam
// (`provisionStorage()`), so the primary server and a sibling spawned beside
// it each get their own store by the same call. The sqlite shape is the
// spawn's own temp `DB_PATH` (below), so its env is empty and its release a
// no-op; the Postgres shape provisions a throwaway database and drops it
// (the conformance harness's `provisionPostgresStorage`). The driver is
// wire-invisible, so nothing but this env may differ between the two.
export interface ProvisionedStorage {
  // Layered over the spawn's base env; `DATABASE_URL` here wins over the
  // base `DB_PATH` (the server's documented config precedence).
  readonly serverEnv: Record<string, string>;
  // Called after the server that used it has stopped.
  release(): Promise<void>;
}

// The sqlite storage every spawn already has: `spawnServer` allocates the
// temp `DB_PATH` and `stop()` removes it, so there is nothing to add or to
// release. Exists so a target's `provisionStorage()` has the same shape on
// every driver.
export function ephemeralSqliteStorage(): ProvisionedStorage {
  return { serverEnv: {}, release: async () => {} };
}

export interface RunningServer {
  readonly baseUrl: string;
  readonly port: number;
  // The local artifact store root (the server's ARTIFACT_LOCAL_BASE_PATH). The
  // runner must be pointed at this exact directory so a storage-key artifact the
  // server writes resolves when the runner reads it back (#285).
  readonly artifactBaseDir: string;
  // Base URL of the server's artifact HTTP file server, for the runner's
  // LOCAL_ARTIFACT_SERVE_URL (the runner's own reads go straight to disk, but
  // the blob download path resolves through this).
  readonly artifactServeUrl: string;
  // Last ~8KB of combined stdout/stderr, surfaced in failures for diagnosis.
  logTail(): string;
  stop(): Promise<void>;
}

export interface SpawnServerOptions {
  // A live Temporal frontend host:port the server should connect to. Omit it
  // for the CRUD slice (Class A): the server is then pointed at
  // ENGINELESS_TEMPORAL_HOST_PORT, an address no process in the run can take,
  // so its non-fatal connection attempt fails fast instead of retrying the
  // live default at localhost:7233 or finding a sibling server. The execution
  // target (Class B) passes its dev-server address so workflowCreator is
  // injected and executions can actually run.
  temporalHostPort?: string;
  // Extra environment for the server process, layered over the fixed base
  // (the target's config seam — e.g. the execution target pins the schedule
  // auto-pause threshold so the firing suite proves the pause in two fires).
  // Keys here win over the base on collision.
  env?: Record<string, string>;
  // Arguments for the spawned executable: the server is a node entry, so
  // callers pass node as binaryPath and the entry module here. (The shape
  // survives from the retired Go binary, which spawned bare — the identical
  // env contract is what let the two servers share this harness.)
  args?: string[];
  // A fixed gRPC port instead of an ephemeral one, for a suite whose clients
  // are configured before the stack boots (the e2e console points at 7234).
  // Omit it everywhere else: an ephemeral port is what lets servers boot side
  // by side. The artifact lane stays ephemeral either way.
  port?: number;
  // When set, the server's combined stdout/stderr is also streamed to this
  // file, which survives teardown (the e2e diagnostics). It takes precedence
  // over STIGMER_CONFORMANCE_LOG_DIR.
  logFile?: string;
  // How long the child may take to print its ready line (default 20 s). The
  // harness's own tests shorten it to prove the silent case.
  readyTimeoutMs?: number;
}

// The ports a server's ready line reports.
interface ReadyPorts {
  readonly grpcPort: number;
  readonly artifactHttpPort: number;
}

// Names a server's diagnostic log file before its port is known.
let spawnCount = 0;

export async function spawnServer(
  binaryPath: string,
  opts: SpawnServerOptions = {},
): Promise<RunningServer> {
  const temporalHostPort = opts.temporalHostPort ?? ENGINELESS_TEMPORAL_HOST_PORT;
  const stateDir = await mkdtemp(join(tmpdir(), "stigmer-conformance-"));
  // The base path IS the artifact root (#285); mirror the production
  // ~/.stigmer/data/artifacts shape. The runner is pointed at this same dir.
  const artifactBaseDir = join(stateDir, "data", "artifacts");
  spawnCount += 1;

  const child = spawn(binaryPath, opts.args ?? [], {
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      // 0 asks the listener for an ephemeral port; the ready line says which.
      GRPC_PORT: String(opts.port ?? 0),
      DB_PATH: join(stateDir, "stigmer.db"),
      STORAGE_PATH: join(stateDir, "storage"),
      ARTIFACT_STORAGE_TYPE: "local",
      ARTIFACT_LOCAL_BASE_PATH: artifactBaseDir,
      // An explicit 0 keeps the artifact lane ephemeral even beside a fixed
      // gRPC port, where the server's default would be GRPC_PORT+1; the ready
      // line reports it, and the runner's serve URL is built from that.
      ARTIFACT_HTTP_PORT: "0",
      STIGMER_READY_LINE: "stdout",
      TEMPORAL_HOST_PORT: temporalHostPort,
      ENV: "local",
      LOG_LEVEL: "warn",
      // Hermeticity: the server's background model-registry refresh dials the
      // public cloud endpoint on boot and would swap the served document
      // mid-run when the network happens to be up — making any assertion on
      // the registry lane pass offline and flake online. Conformance servers
      // always serve the bundled snapshot.
      STIGMER_MODEL_REGISTRY_REFRESH: "off",
      // Enable the MCP OAuth Connect lanes (unset means initiateOAuthConnect
      // refuses with FailedPrecondition). The value is a fixed dummy: the
      // server never fetches this URL — it only forwards it to the
      // authorization server as the redirect_uri parameter, and the OAuth
      // conformance suite's mock authorization server never redirects.
      STIGMER_OAUTH_REDIRECT_URI: HERMETIC_OAUTH_REDIRECT_URI,
      ...(opts.env ?? {}),
    },
  });

  // Debug lever: STIGMER_CONFORMANCE_LOG_DIR tees the child's full output
  // to a per-process file that SURVIVES teardown — the in-memory tail
  // only surfaces on spawn failure, which makes intermittent mid-suite
  // races (writer-ordering flakes) undiagnosable without it.
  const output = teeChildOutput(child, {
    tailBytes: LOG_TAIL_BYTES,
    file:
      opts.logFile ??
      (process.env.STIGMER_CONFORMANCE_LOG_DIR
        ? join(
            process.env.STIGMER_CONFORMANCE_LOG_DIR,
            `server-${process.pid}-${spawnCount}-${Date.now()}.log`,
          )
        : undefined),
  });

  const stop = async (): Promise<void> => {
    // SIGKILL, not SIGTERM: the server holds only throwaway state and has
    // nothing worth draining. The order is the discipline child-process.ts
    // documents — exit, then the tee, then the state dir the process was
    // still using.
    await stopChild(child, { signal: "SIGKILL", graceMs: 0 });
    await output.close();
    await rm(stateDir, { recursive: true, force: true });
  };

  let ready: ReadyPorts;
  try {
    ready = await waitForReadyLine(child, opts.readyTimeoutMs ?? READY_TIMEOUT_MS, () => output.tail());
    if (opts.port !== undefined && ready.grpcPort !== opts.port) {
      throw new Error(
        `stigmer-server was asked for gRPC port ${opts.port} but reported ${ready.grpcPort} on its ready line\n` +
          `--- server log tail ---\n${output.tail()}`,
      );
    }
  } catch (err) {
    await stop();
    throw err;
  }

  return {
    baseUrl: `http://127.0.0.1:${ready.grpcPort}`,
    port: ready.grpcPort,
    artifactBaseDir,
    artifactServeUrl: `http://127.0.0.1:${ready.artifactHttpPort}`,
    logTail: () => output.tail(),
    stop,
  };
}

// Resolves with the ports from the child's ready line: the first whole stdout
// line that carries READY_LINE_KEY. stdout is read here, apart from the tee's
// merged stream, so a stderr chunk can never land in the middle of the line;
// any other stdout line is not the report and is skipped (it still reaches
// the tee). Rejects when the child closes first, prints a report naming no
// bound port, or stays silent past the deadline.
function waitForReadyLine(child: ChildProcess, timeoutMs: number, getLog: () => string): Promise<ReadyPorts> {
  return new Promise((resolveReady, rejectReady) => {
    let buffered = "";

    const settle = (outcome: () => void): void => {
      clearTimeout(deadline);
      child.stdout?.off("data", onData);
      child.off("close", onClose);
      outcome();
    };

    const onData = (chunk: Buffer): void => {
      buffered += chunk.toString("utf8");
      let newline = buffered.indexOf("\n");
      while (newline !== -1) {
        const line = buffered.slice(0, newline);
        buffered = buffered.slice(newline + 1);
        const parsed = parseReadyLine(line);
        if (parsed !== undefined) {
          settle(() =>
            "problem" in parsed
              ? rejectReady(
                  new Error(
                    `stigmer-server printed a ready line naming no bound port (${parsed.problem}): ${line}\n` +
                      `--- server log tail ---\n${getLog()}`,
                  ),
                )
              : resolveReady(parsed.ports),
          );
          return;
        }
        newline = buffered.indexOf("\n");
      }
    };

    // `close`, not `exit`: it fires once the child's pipes have drained, so
    // the tail quoted below holds the child's last words.
    const onClose = (code: number | null, signal: NodeJS.Signals | null): void => {
      settle(() =>
        rejectReady(
          new Error(
            `stigmer-server exited before becoming ready (code=${code}, signal=${signal})\n` +
              `--- server log tail ---\n${getLog()}`,
          ),
        ),
      );
    };

    // Silence has two causes, and the error names both: a server still booting
    // on a saturated machine, and a build from before the ready line existed,
    // which both entry helpers reuse (ts-build.ts, the e2e server manager) and
    // which prints none.
    const deadline = setTimeout(() => {
      settle(() =>
        rejectReady(
          new Error(
            `stigmer-server did not print its ready line within ${timeoutMs}ms. ` +
              "Either it is still booting on a heavily loaded machine, or it is a build from before " +
              "the ready line existed, which prints none: rebuild it (make build-server).\n" +
              `--- server log tail ---\n${getLog()}`,
          ),
        ),
      );
    }, timeoutMs);

    child.stdout?.on("data", onData);
    child.once("close", onClose);
  });
}

// The report a stdout line carries, a sentence saying what is wrong with a
// report, or undefined for a line that is not the ready line at all.
function parseReadyLine(line: string): { ports: ReadyPorts } | { problem: string } | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null || !(READY_LINE_KEY in parsed)) return undefined;
  const report: unknown = (parsed as Record<string, unknown>)[READY_LINE_KEY];
  if (typeof report !== "object" || report === null) return { problem: "the report is not an object" };
  const { grpcPort, artifactHttpPort } = report as Record<string, unknown>;
  if (!isBoundPort(grpcPort)) return { problem: "grpcPort" };
  // The harness always runs local artifact storage, so the lane always binds.
  if (!isBoundPort(artifactHttpPort)) return { problem: "artifactHttpPort" };
  return { ports: { grpcPort, artifactHttpPort } };
}

function isBoundPort(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value < 65_536;
}
