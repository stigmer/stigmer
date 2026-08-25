// Boots a stigmer-server child process against throwaway state and waits for its
// TCP port to accept connections.
// Domain: conformance harness (server lifecycle).
//
// Each instance owns a temp dir (SQLite DB + storage) and a free port, so suite
// files can boot servers concurrently without colliding. TCP-readiness only
// proves the listener is up; the gRPC-level readiness gate lives in the target.
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { getFreePort } from "./ports";

const TCP_READY_TIMEOUT_MS = 20_000;
const TCP_READY_POLL_MS = 100;
const LOG_TAIL_BYTES = 8_000;

// The OAuth callback URL every conformance server boots with (see the env
// block below). Exported so the OAuth suite can assert the redirect_uri the
// server presents to an authorization server against the value the harness
// configured — one source of truth, no copy drift.
export const CONFORMANCE_OAUTH_REDIRECT_URI = "http://127.0.0.1:8234/auth/oauth/callback";

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
  // for the CRUD slice (Class A): the server is then pointed at a freshly
  // allocated closed port so its non-fatal connection attempt fails fast
  // instead of retrying the live default at localhost:7233. The execution
  // target (Class B) passes its dev-server address so workflowCreator is
  // injected and executions can actually run.
  temporalHostPort?: string;
  // Extra environment for the server process, layered over the fixed base
  // (the target's config seam — e.g. the execution target pins the schedule
  // auto-pause threshold so the firing suite proves the pause in two fires).
  // Keys here win over the base on collision.
  env?: Record<string, string>;
  // Arguments for the spawned executable. The Go server is a bare binary
  // (no args); the TS server target passes its entry module here and node
  // as binaryPath — both servers honor the identical env contract above.
  args?: string[];
}

export async function spawnServer(
  binaryPath: string,
  opts: SpawnServerOptions = {},
): Promise<RunningServer> {
  const port = await getFreePort();
  const artifactHttpPort = await getFreePort();
  const temporalHostPort = opts.temporalHostPort ?? `127.0.0.1:${await getFreePort()}`;
  const stateDir = await mkdtemp(join(tmpdir(), "stigmer-conformance-"));
  // The base path IS the artifact root (#285); mirror the production
  // ~/.stigmer/data/artifacts shape. The runner is pointed at this same dir.
  const artifactBaseDir = join(stateDir, "data", "artifacts");
  const artifactServeUrl = `http://127.0.0.1:${artifactHttpPort}`;

  const child = spawn(binaryPath, opts.args ?? [], {
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      GRPC_PORT: String(port),
      DB_PATH: join(stateDir, "stigmer.db"),
      STORAGE_PATH: join(stateDir, "storage"),
      ARTIFACT_STORAGE_TYPE: "local",
      ARTIFACT_LOCAL_BASE_PATH: artifactBaseDir,
      // Pin the artifact HTTP port to a free port we own so the runner's serve
      // URL is deterministic (the server default is GRPC_PORT+1, which we do not
      // control here).
      ARTIFACT_HTTP_PORT: String(artifactHttpPort),
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
      STIGMER_OAUTH_REDIRECT_URI: CONFORMANCE_OAUTH_REDIRECT_URI,
      ...(opts.env ?? {}),
    },
  });

  let logTail = "";
  // Debug lever: STIGMER_CONFORMANCE_LOG_DIR tees the child's full output
  // to a per-process file that SURVIVES teardown — the in-memory logTail
  // only surfaces on spawn failure, which makes intermittent mid-suite
  // races (writer-ordering flakes) undiagnosable without it.
  const teeStream = process.env.STIGMER_CONFORMANCE_LOG_DIR
    ? createWriteStream(
        join(
          process.env.STIGMER_CONFORMANCE_LOG_DIR,
          `server-${port}-${Date.now()}.log`,
        ),
        { flags: "a" },
      )
    : undefined;
  const appendLog = (chunk: Buffer): void => {
    logTail = (logTail + chunk.toString("utf8")).slice(-LOG_TAIL_BYTES);
    teeStream?.write(chunk);
  };
  child.stdout.on("data", appendLog);
  child.stderr.on("data", appendLog);

  let exit: { code: number | null; signal: NodeJS.Signals | null } | null = null;
  child.on("exit", (code, signal) => {
    exit = { code, signal };
  });

  const stop = async (): Promise<void> => {
    if (exit === null) {
      child.kill("SIGKILL");
    }
    await rm(stateDir, { recursive: true, force: true });
  };

  try {
    await waitForTcp(port, () => exit, () => logTail);
  } catch (err) {
    await stop();
    throw err;
  }

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    port,
    artifactBaseDir,
    artifactServeUrl,
    logTail: () => logTail,
    stop,
  };
}

async function waitForTcp(
  port: number,
  getExit: () => { code: number | null; signal: NodeJS.Signals | null } | null,
  getLog: () => string,
): Promise<void> {
  const deadline = Date.now() + TCP_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const exit = getExit();
    if (exit !== null) {
      throw new Error(
        `stigmer-server exited before becoming ready (code=${exit.code}, signal=${exit.signal})\n--- server log tail ---\n${getLog()}`,
      );
    }
    if (await tcpConnects(port)) return;
    await delay(TCP_READY_POLL_MS);
  }
  throw new Error(
    `stigmer-server did not open port ${port} within ${TCP_READY_TIMEOUT_MS}ms\n--- server log tail ---\n${getLog()}`,
  );
}

function tcpConnects(port: number): Promise<boolean> {
  return new Promise((resolveConnected) => {
    const socket = connect({ port, host: "127.0.0.1" });
    const settle = (connected: boolean): void => {
      socket.destroy();
      resolveConnected(connected);
    };
    socket.once("connect", () => settle(true));
    socket.once("error", () => settle(false));
  });
}
