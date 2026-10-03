/**
 * The attach waiter: a sandbox that has no work yet, waiting to be told which
 * task queue to serve, and then running the runner for it.
 *
 * Why a waiter and not a waiting runner. A sandbox platform that snapshots a
 * started sandbox once and starts every later sandbox from that snapshot
 * (Agent Substrate's golden snapshot) clones the snapshotted processes'
 * memory into all of them. Measured on 2026-10-03 (gVisor, Node 22.23.2,
 * OpenSSL 3.5.7): every clone of one snapshot produced the same
 * `crypto.randomBytes`, the same x25519 keys, the same `randomUUID` and the
 * same `Math.random`, even when the process drew nothing before the snapshot
 * (Node seeds OpenSSL at process start) and even eight minutes later
 * (OpenSSL reseeds from its own cloned state). A process started after the
 * restore draws its own. So the snapshot holds this small process, which
 * never makes a network call or uses randomness, and the runner always
 * starts fresh, after the push, with its credentials in hand. The same
 * measurement put a fresh slim runner at about 1.6 s from start to polling
 * its queue.
 *
 * What it does:
 *
 *   - `GET /readyz` answers 200 as soon as the listener is up. A platform
 *     that takes its snapshot once its readiness probe answers therefore
 *     snapshots this process idle, never a runner mid-boot.
 *   - `POST /attach` takes a push (`push.ts`). The first accepted push starts
 *     the runner, with this sandbox's own environment plus
 *     `STIGMER_TASK_QUEUE` and the pushed secrets: exactly the environment a
 *     sandbox pod gives the runner at start, so the runner boots in its
 *     ordinary static mode, unchanged. A later push for the same queue (a
 *     driver pushes on every wakeup, with a fresh token) may only rotate
 *     `STIGMER_TOKEN`: the token it carries is the one the runner restarts
 *     with, and every other secret must be the first push's, so a caller
 *     inside the sandbox (its agent can reach the listener over loopback)
 *     cannot swap the runner's other secrets or drop its token. The live
 *     runner keeps renewing its own token as it does in a pod. A push for
 *     another queue is refused.
 *   - It supervises the runner the way a pod's restart policy does: a runner
 *     that exits is started again, after a delay that grows to a cap, with
 *     the latest pushed environment. Stopping the waiter stops the runner
 *     first and waits for its graceful shutdown.
 *
 * One limit, the same as a pod's: a restart uses the latest PUSHED token, not
 * the one the live runner renewed in-process (`sandbox-token-renewal.ts`).
 * A runner that crashes after that token has expired restarts with a dead
 * credential and retries at the delay cap until the driver's next push. So a
 * driver pushes on every wakeup, and again before the pushed token's
 * lifetime ends while the sandbox runs.
 *
 * Neither the token nor any secret is ever logged.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import { verifyAttachPush, type AttachPush } from "./push.js";

/** Largest push body accepted; a real push is a few kilobytes. */
const MAX_PUSH_BYTES = 64 * 1024;

/** Variables that configure the waiter itself and are not passed to the runner. */
export const WAITER_ENV_KEYS: readonly string[] = [
  "STIGMER_ATTACH_PORT",
  "STIGMER_SANDBOX_NAME_FILE",
];

export type RunnerSpawner = (entry: string, env: NodeJS.ProcessEnv) => ChildProcess;

export interface AttachWaiterOptions {
  /** Port the listener binds; 0 picks a free one (tests). */
  readonly port: number;
  /** This sandbox's own name, read at push time (it differs per clone). */
  readonly readSandboxName: () => string;
  /** The runner's entry module, started with the current Node. */
  readonly runnerEntry: string;
  /** This sandbox's own environment, the base of the runner's. */
  readonly baseEnv: NodeJS.ProcessEnv;
  /** Seconds since the epoch. */
  readonly now?: () => number;
  readonly spawnRunner?: RunnerSpawner;
  /** First restart delay; doubles per consecutive exit up to `maxRestartDelayMs`. */
  readonly restartDelayMs?: number;
  readonly maxRestartDelayMs?: number;
  readonly log?: (message: string) => void;
}

export interface AttachWaiter {
  readonly server: Server;
  /** The bound port. */
  readonly port: number;
  /** The queue being served, once attached. */
  attachedQueue(): string | undefined;
  /** Stop the runner (waiting for its exit) and close the listener. */
  close(): Promise<void>;
}

const defaultSpawner: RunnerSpawner = (entry, env) =>
  spawn(process.execPath, [entry], { env, stdio: "inherit" });

/** The runner's environment for one push: the sandbox's own, minus the waiter's, plus the push. */
export function runnerEnvFor(baseEnv: NodeJS.ProcessEnv, push: AttachPush): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...baseEnv };
  for (const key of WAITER_ENV_KEYS) delete env[key];
  return { ...env, STIGMER_TASK_QUEUE: push.taskQueue, ...push.secrets };
}

/**
 * Why a later push may not be accepted, or undefined when it only rotates the
 * token: every secret but `STIGMER_TOKEN` must equal the first push's, and a
 * token the first push carried may be replaced but not dropped.
 */
export function onlyTokenRotated(
  first: Readonly<Record<string, string>>,
  later: Readonly<Record<string, string>>,
): string | undefined {
  const names = new Set([...Object.keys(first), ...Object.keys(later)]);
  names.delete("STIGMER_TOKEN");
  for (const name of names) {
    if (first[name] !== later[name]) {
      return `a later push may only rotate STIGMER_TOKEN; ${name} differs from the first push`;
    }
  }
  if ((first.STIGMER_TOKEN ?? "") !== "" && (later.STIGMER_TOKEN ?? "") === "") {
    return "a later push may not drop STIGMER_TOKEN";
  }
  return undefined;
}

/** An error's code (or name), never its message, which may quote a pushed value. */
export function spawnErrorCode(err: unknown): string {
  if (typeof err === "object" && err !== null) {
    const code = (err as { code?: unknown }).code;
    if (typeof code === "string") return code;
    if (err instanceof Error) return err.name;
  }
  return "unknown error";
}

function reply(res: ServerResponse, status: number, body: Record<string, unknown>): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string | undefined> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    // An oversized body is drained and discarded rather than cut off, so the
    // sender still reads the refusal.
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size <= MAX_PUSH_BYTES) chunks.push(chunk);
    });
    req.on("end", () =>
      resolve(size > MAX_PUSH_BYTES ? undefined : Buffer.concat(chunks).toString("utf8")),
    );
    req.on("error", reject);
  });
}

export async function startAttachWaiter(options: AttachWaiterOptions): Promise<AttachWaiter> {
  const now = options.now ?? (() => Math.floor(Date.now() / 1000));
  const spawnRunner = options.spawnRunner ?? defaultSpawner;
  const log = options.log ?? ((message: string) => console.warn(message));
  const firstDelay = options.restartDelayMs ?? 1000;
  const maxDelay = options.maxRestartDelayMs ?? 30_000;

  // The queue this sandbox serves, once attached, the first push's secrets
  // (fixed for the sandbox's life but for the token), and the environment
  // the runner (re)starts with.
  let attachedQueue: string | undefined;
  let attachedSecrets: Readonly<Record<string, string>> = {};
  let runnerEnv: NodeJS.ProcessEnv = {};
  let child: ChildProcess | undefined;
  let restartTimer: NodeJS.Timeout | undefined;
  let nextDelay = firstDelay;
  let stopping = false;

  // A spawn can throw synchronously (an environment value Node refuses);
  // its message may quote the value, so only the error's code is logged.
  function spawnSafely(env: NodeJS.ProcessEnv): ChildProcess | undefined {
    try {
      return spawnRunner(options.runnerEntry, env);
    } catch (err: unknown) {
      log(`[attach] the runner could not be started (${spawnErrorCode(err)})`);
      return undefined;
    }
  }

  // close() clears a pending restart, so none runs once the waiter is stopping.
  function scheduleRestart(how: string): void {
    log(`[attach] runner ${how}; restarting in ${nextDelay}ms`);
    restartTimer = setTimeout(restart, nextDelay);
    nextDelay = Math.min(nextDelay * 2, maxDelay);
  }

  function restart(): void {
    const started = spawnSafely(runnerEnv);
    if (started === undefined) {
      scheduleRestart("could not be started");
      return;
    }
    supervise(started);
  }

  function supervise(started: ChildProcess): void {
    child = started;
    const startedAt = Date.now();
    let settled = false;
    const onGone = (how: string) => {
      if (settled) return;
      settled = true;
      if (child === started) child = undefined;
      if (stopping) return;
      // A runner that served for a while restarts promptly; one that dies at
      // once backs off, so a broken boot cannot spin.
      if (Date.now() - startedAt > maxDelay) nextDelay = firstDelay;
      scheduleRestart(how);
    };
    started.on("exit", (code, signal) => onGone(`exited (${signal ?? code})`));
    started.on("error", (err) => onGone(`failed to start (${spawnErrorCode(err)})`));
  }

  async function handleAttach(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const raw = await readBody(req);
    if (raw === undefined) {
      reply(res, 413, { error: `the push exceeds ${MAX_PUSH_BYTES} bytes` });
      return;
    }
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      reply(res, 400, { error: "the push is not JSON" });
      return;
    }
    const verdict = verifyAttachPush(body, options.readSandboxName(), now());
    if (!verdict.ok) {
      // JSON-encoded: the reason may quote the pushed queue, untrusted text.
      log(`[attach] push refused (${verdict.status}): ${JSON.stringify(verdict.reason)}`);
      reply(res, verdict.status, { error: verdict.reason });
      return;
    }
    const { push } = verdict;
    // One sandbox serves one queue for its life. The name binding already
    // ties a queue to one sandbox; this holds even if two queues' names met.
    if (attachedQueue !== undefined && attachedQueue !== push.taskQueue) {
      reply(res, 409, { error: `this sandbox serves ${attachedQueue}` });
      return;
    }
    const first = attachedQueue === undefined;
    if (!first) {
      const rotation = onlyTokenRotated(attachedSecrets, push.secrets);
      if (rotation !== undefined) {
        log(`[attach] push refused (409): ${JSON.stringify(rotation)}`);
        reply(res, 409, { error: rotation });
        return;
      }
    }
    const env = runnerEnvFor(options.baseEnv, push);
    if (first) {
      // The attachment is recorded only once a runner has started, so a push
      // whose runner cannot start leaves the sandbox free for a corrected one.
      const started = spawnSafely(env);
      if (started === undefined) {
        reply(res, 500, { error: "the runner could not be started" });
        return;
      }
      attachedSecrets = push.secrets;
      log(`[attach] attached to ${JSON.stringify(push.taskQueue)}; the runner started`);
      attachedQueue = push.taskQueue;
      runnerEnv = env;
      supervise(started);
    } else {
      runnerEnv = env;
    }
    reply(res, 200, { taskQueue: push.taskQueue, started: first });
  }

  const server = createServer((req, res) => {
    if (req.url === "/readyz" && req.method === "GET") {
      reply(res, 200, { ready: true });
      return;
    }
    if (req.url === "/attach") {
      if (req.method !== "POST") {
        reply(res, 405, { error: "POST only" });
        return;
      }
      handleAttach(req, res).catch((err: unknown) => {
        log(`[attach] push failed: ${err instanceof Error ? err.message : String(err)}`);
        if (!res.headersSent) reply(res, 500, { error: "the push could not be read" });
      });
      return;
    }
    reply(res, 404, { error: "not found" });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, () => resolve());
  });
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : options.port;

  return {
    server,
    port,
    attachedQueue: () => attachedQueue,
    async close(): Promise<void> {
      stopping = true;
      if (restartTimer) clearTimeout(restartTimer);
      const running = child;
      if (running && running.exitCode === null && running.signalCode === null) {
        await new Promise<void>((resolve) => {
          running.once("exit", () => resolve());
          running.kill("SIGTERM");
        });
      }
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
    },
  };
}
