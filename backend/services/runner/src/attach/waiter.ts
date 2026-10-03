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
 *     driver pushes on every wakeup, with a fresh token) replaces the
 *     environment the runner restarts with; the live runner keeps renewing
 *     its own token as it does in a pod. A push for another queue is refused.
 *   - It supervises the runner the way a pod's restart policy does: a runner
 *     that exits is started again, after a delay that grows to a cap, with
 *     the latest pushed environment. Stopping the waiter stops the runner
 *     first and waits for its graceful shutdown.
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

  let attached: { taskQueue: string; env: NodeJS.ProcessEnv } | undefined;
  let child: ChildProcess | undefined;
  let restartTimer: NodeJS.Timeout | undefined;
  let nextDelay = firstDelay;
  let stopping = false;

  function startRunner(): void {
    if (!attached || stopping) return;
    const started = spawnRunner(options.runnerEntry, attached.env);
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
      log(`[attach] runner ${how}; restarting in ${nextDelay}ms`);
      restartTimer = setTimeout(startRunner, nextDelay);
      nextDelay = Math.min(nextDelay * 2, maxDelay);
    };
    started.on("exit", (code, signal) => onGone(`exited (${signal ?? code})`));
    started.on("error", (err) => onGone(`failed to start (${err.message})`));
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
      log(`[attach] push refused (${verdict.status}): ${verdict.reason}`);
      reply(res, verdict.status, { error: verdict.reason });
      return;
    }
    const { push } = verdict;
    if (stopping) {
      reply(res, 503, { error: "the sandbox is stopping" });
      return;
    }
    if (attached && attached.taskQueue !== push.taskQueue) {
      reply(res, 409, { error: `this sandbox serves ${attached.taskQueue}` });
      return;
    }
    const first = attached === undefined;
    attached = { taskQueue: push.taskQueue, env: runnerEnvFor(options.baseEnv, push) };
    if (first) {
      log(`[attach] attached to ${push.taskQueue}; starting the runner`);
      startRunner();
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
    attachedQueue: () => attached?.taskQueue,
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
