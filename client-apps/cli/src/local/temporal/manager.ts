// Lifecycle manager for the local Temporal dev server.
//
// Faithful TS port of the Go CLI's `temporal.Manager`, reorganized around the
// shared primitives (file lock, PID file, TCP readiness). It installs the
// `temporal` binary on demand, starts the dev server in its own process group,
// and answers "is it really running?" with the same layered check the Go CLI
// uses (PID present -> alive -> actually Temporal -> port listening). Start is
// idempotent: a healthy instance — ours or another process's — is reused.

import { mkdirSync, openSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import { log } from "../../logger.js";
import { CliExitError } from "../../errors/cli-exit-error.js";
import { ExitCode } from "../../errors/exit-codes.js";
import { tcpConnects, waitForTcp } from "../net/tcp.js";
import { binDir, logDir, temporalDataDir, temporalLockFile, temporalPidFile } from "../paths.js";
import { TEMPORAL_PORT, TEMPORAL_UI_PORT } from "../constants.js";
import { type FileLock, acquireLock } from "../state/lock.js";
import { readPidFile, removePidFile, writePidFile } from "../state/pidfile.js";
import { findProcessByPort, isProcessAlive, killProcessGroup } from "../state/proc.js";
import { DEFAULT_TEMPORAL_VERSION, downloadTemporalCli, isTemporalInstalled } from "./download.js";
import { isLikelyTemporal } from "./inspect.js";

const READY_TIMEOUT_MS = 10_000;
const STOP_POLL_MS = 500;
const STOP_TIMEOUT_MS = 10_000;

export interface TemporalManagerOptions {
  /** Path to the temporal binary (~/.stigmer/bin/temporal). */
  binPath: string;
  /** Temporal dev-server data directory (~/.stigmer/temporal-data). */
  dataDir: string;
  /** Log file the dev server's output is appended to. */
  logFile: string;
  /** PID file (kept for debugging; the lock is the source of truth). */
  pidFile: string;
  /** Single-instance lock file. */
  lockFile: string;
  version?: string;
  port?: number;
  uiPort?: number;
}

export class TemporalManager {
  private readonly binPath: string;
  private readonly dataDir: string;
  private readonly logFile: string;
  private readonly pidFile: string;
  private readonly lockFile: string;
  private readonly version: string;
  private readonly port: number;
  private readonly uiPort: number;
  private lock: FileLock | null = null;

  constructor(options: TemporalManagerOptions) {
    this.binPath = options.binPath;
    this.dataDir = options.dataDir;
    this.logFile = options.logFile;
    this.pidFile = options.pidFile;
    this.lockFile = options.lockFile;
    this.version = options.version ?? DEFAULT_TEMPORAL_VERSION;
    this.port = options.port ?? TEMPORAL_PORT;
    this.uiPort = options.uiPort ?? TEMPORAL_UI_PORT;
  }

  /** Build a manager from the standard ~/.stigmer layout. */
  static forHome(home: string = homedir()): TemporalManager {
    return new TemporalManager({
      binPath: join(binDir(home), "temporal"),
      dataDir: temporalDataDir(home),
      logFile: join(logDir(home), "temporal.log"),
      pidFile: temporalPidFile(home),
      lockFile: temporalLockFile(home),
    });
  }

  /** host:port of the Temporal frontend. */
  get address(): string {
    return `127.0.0.1:${this.port}`;
  }

  /** PID of the running dev server, or null. */
  getPid(): number | null {
    return readPidFile(this.pidFile);
  }

  /** Install the Temporal binary on demand if it is not already present. */
  async ensureInstalled(): Promise<void> {
    if (isTemporalInstalled(this.binPath)) {
      log.debug("temporal CLI already installed", { path: this.binPath });
      return;
    }
    log.info("downloading Temporal CLI", { version: this.version });
    await downloadTemporalCli({ version: this.version, binPath: this.binPath });
    log.info("Temporal CLI installed", { path: this.binPath });
  }

  /**
   * Start the dev server. Idempotent: reuses a healthy instance, reclaims a lock
   * left by a dead daemon, and refuses to start only when another live process
   * holds the lock without a responding server.
   */
  async start(): Promise<void> {
    if (await this.isRunning()) {
      log.info("Temporal already running and healthy — reusing", { address: this.address });
      return;
    }

    // A lock we still hold means Temporal died under us; drop it so we can
    // re-acquire cleanly.
    if (this.lock !== null) {
      log.info("releasing stale Temporal lock (server died while we held it)");
      this.lock.release();
      this.lock = null;
      removePidFile(this.pidFile);
    }

    this.cleanupStaleProcesses();

    const lock = acquireLock(this.lockFile);
    if (lock === null) {
      // Another live process owns the lock. If its server answers, reuse it;
      // otherwise we cannot safely start a competing instance.
      if (await this.isPortInUse()) {
        log.info("Temporal lock held by another process and port is active — reusing");
        return;
      }
      throw new CliExitError("Temporal lock held by another process but the service is not responding", ExitCode.General);
    }
    this.lock = lock;

    try {
      await this.ensureInstalled();
      mkdirSync(this.dataDir, { recursive: true });
      mkdirSync(dirname(this.logFile), { recursive: true });

      const pid = this.spawnServer();
      writePidFile(this.pidFile, pid);
      log.info("Temporal dev server started", { pid, port: this.port });

      await waitForTcp({ port: this.port, timeoutMs: READY_TIMEOUT_MS, label: "temporal dev server" });
      log.info("Temporal is ready", { address: this.address });
    } catch (err) {
      const pid = this.getPid();
      if (pid !== null) killProcessGroup(pid, "SIGKILL");
      removePidFile(this.pidFile);
      this.lock?.release();
      this.lock = null;
      throw err;
    }
  }

  /** Stop the dev server gracefully (SIGTERM, then SIGKILL), releasing the lock. */
  async stop(): Promise<void> {
    const pid = this.getPid();
    if (pid === null) {
      this.lock?.release();
      this.lock = null;
      return;
    }

    killProcessGroup(pid, "SIGTERM");
    log.info("sent SIGTERM to Temporal process group", { pid });

    const deadline = Date.now() + STOP_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (!(await this.isRunning())) {
        this.finishStop();
        log.info("Temporal stopped");
        return;
      }
      await sleep(STOP_POLL_MS);
    }

    log.warn("Temporal did not stop gracefully — force killing process group", { pid });
    killProcessGroup(pid, "SIGKILL");
    this.finishStop();
  }

  /** Layered liveness: PID present -> alive -> actually Temporal -> port open. */
  async isRunning(): Promise<boolean> {
    const pid = this.getPid();
    if (pid === null) return false;
    if (!isProcessAlive(pid)) return false;
    if (!isLikelyTemporal(pid, this.binPath)) return false;
    return this.isPortInUse();
  }

  private isPortInUse(): Promise<boolean> {
    return tcpConnects(this.port, "127.0.0.1", 100);
  }

  private finishStop(): void {
    removePidFile(this.pidFile);
    this.lock?.release();
    this.lock = null;
  }

  // Start the dev server detached in its own process group so the whole tree can
  // later be signaled, with output appended to the Temporal log file.
  private spawnServer(): number {
    const out = openSync(this.logFile, "a");
    const child = spawn(
      this.binPath,
      [
        "server",
        "start-dev",
        "--port",
        String(this.port),
        "--db-filename",
        join(this.dataDir, "temporal.db"),
        "--ui-port",
        String(this.uiPort),
        "--log-format",
        "json",
      ],
      { detached: true, stdio: ["ignore", out, out] },
    );
    child.unref();
    if (child.pid === undefined) {
      throw new CliExitError("failed to start Temporal process", ExitCode.General);
    }
    return child.pid;
  }

  // Remove a stale PID file, or kill an orphaned Temporal occupying our port.
  private cleanupStaleProcesses(): void {
    const pid = this.getPid();
    if (pid !== null) {
      if (!isProcessAlive(pid) || !isLikelyTemporal(pid, this.binPath)) {
        removePidFile(this.pidFile);
      }
      return;
    }
    const orphan = findProcessByPort(this.port);
    if (orphan !== null && isLikelyTemporal(orphan, this.binPath)) {
      log.warn("killing orphaned Temporal found via port", { pid: orphan, port: this.port });
      killProcessGroup(orphan, "SIGKILL");
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
