/**
 * The runner's local proxy: the one door through which the agent host
 * reaches anything that needs a credential of the runner's (#2016).
 *
 * The host holds no key. Its model clients, its checkpoint saver and its
 * model-registry reads all call this server on loopback with the host's
 * token, a random value minted at each host start (`agent-host/
 * supervisor.ts`); a lane (`lanes.ts`) swaps that token for the runner's
 * credential and forwards the bytes (`relay.ts`). What a host token buys is
 * bounded here, and nothing else in the runner serves the host:
 *
 *  - Only the current host's token is accepted, in `Authorization: Bearer`
 *    or `x-api-key` (the two places the host's SDKs put a key), compared in
 *    constant time.
 *  - A model call must name a turn that is live on this runner, by the
 *    `X-Stigmer-Execution-Id` the host's clients stamp on every model call
 *    (`shared/model-client.ts`); the remote adapter opens a turn when it
 *    starts one and closes it when it settles (`agent-host/
 *    remote-adapter.ts`).
 *  - A checkpoint call must name the thread of a live turn (the turn's own
 *    `threadId`, the one its engine checkpoints under), in its query or,
 *    for a write, in every entry of its body.
 *  - The model registry is exempt from the live-turn rule: it is the
 *    catalog every caller may read, and the platform's proxy serves it even
 *    to visitors.
 *  - No lane reaches the Stigmer API beyond the registry: execution reads,
 *    status writes, credential exchanges stay the runner's own calls.
 *
 * Every refusal is answered in the shape the providers' SDKs parse as an
 * API error, and logged once with its reason (never a token or a body).
 *
 * The residual, stated plainly: while a turn is live, whoever holds the
 * host's token can make model calls on the runner's account through this
 * server, as the agent's engine does by design — model calls only, each
 * lane serving its provider's inference paths and nothing else under its
 * root (`lanes.ts`). It can no longer take a key away.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import type { AddressInfo } from "node:net";

import type { Config } from "../config.js";
import type { LiveTurnRegistry } from "../agent-host/remote-adapter.js";
import type { AgentProxyGate } from "../agent-host/supervisor.js";
import { LaneRefusal, checkpointUpstream, isModelProviderLane, modelUpstream, registryUpstream } from "./lanes.js";
import { RequestTooLargeError, readBody, relay, replyError } from "./relay.js";

const LLM_PREFIX = "/v1/proxy/llm/";
const CHECKPOINT_PREFIX = "/v1/proxy/checkpoints";
const REGISTRY_PATH = "/v1/proxy/model-registry";

export class AgentProxy implements AgentProxyGate, LiveTurnRegistry {
  private hostToken: Buffer | undefined;
  /** Live turns by execution id: the thread each checkpoints under, and how many are open. */
  private readonly live = new Map<string, { readonly threadId: string; open: number }>();

  private constructor(
    private readonly server: Server,
    readonly endpoint: string,
    private readonly config: Config,
  ) {}

  /** Listen on an ephemeral loopback port and forward with `config`'s credentials, read per request. */
  static async start(config: Config): Promise<AgentProxy> {
    let proxy: AgentProxy | undefined;
    const server = createServer((req, res) => {
      void proxy!.handle(req, res);
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve());
    });
    server.unref();
    const { port } = server.address() as AddressInfo;
    proxy = new AgentProxy(server, `http://127.0.0.1:${port}`, config);
    return proxy;
  }

  authorizeHost(token: string): void {
    this.hostToken = Buffer.from(token);
  }

  openTurn(turn: { readonly executionId: string; readonly threadId: string }): () => void {
    const entry = this.live.get(turn.executionId) ?? { threadId: turn.threadId, open: 0 };
    entry.open += 1;
    this.live.set(turn.executionId, entry);
    let closed = false;
    return () => {
      if (closed) return;
      closed = true;
      entry.open -= 1;
      if (entry.open === 0 && this.live.get(turn.executionId) === entry) this.live.delete(turn.executionId);
    };
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      this.server.closeAllConnections();
      this.server.close(() => resolve());
    });
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://agent-proxy");
    const path = url.pathname;
    try {
      if (!this.authenticated(req)) throw new LaneRefusal(401, "the agent proxy accepts the current agent host's token only");
      if (path === REGISTRY_PATH) {
        if (req.method !== "GET") throw new LaneRefusal(405, "the model registry is read with GET");
        await relay(req, res, registryUpstream(req));
        return;
      }
      if (path.startsWith(LLM_PREFIX)) {
        const [lane = "", ...segments] = path.slice(LLM_PREFIX.length).split("/");
        if (!isModelProviderLane(lane)) throw new LaneRefusal(404, `no model lane '${lane}'`);
        this.requireLiveExecution(req);
        const body = await readBody(req);
        const rest = `/${segments.join("/")}${url.search}`;
        await relay(req, res, await modelUpstream(this.config, lane, rest, req, body));
        return;
      }
      if (path === CHECKPOINT_PREFIX || path.startsWith(`${CHECKPOINT_PREFIX}/`)) {
        const body = await readBody(req);
        this.requireLiveThreads(url, body);
        await relay(req, res, checkpointUpstream(this.config, `${path.slice(CHECKPOINT_PREFIX.length)}${url.search}`, req, body));
        return;
      }
      throw new LaneRefusal(404, `the agent proxy serves no lane at ${path}`);
    } catch (err) {
      const refusal =
        err instanceof LaneRefusal ? err
        : err instanceof RequestTooLargeError ? new LaneRefusal(413, err.message)
        : new LaneRefusal(502, err instanceof Error ? err.message : String(err));
      console.warn(`[agent-proxy] refused ${req.method ?? "?"} ${path}: ${refusal.status} ${refusal.message}`);
      replyError(res, refusal.status, refusal.message);
    }
  }

  private authenticated(req: IncomingMessage): boolean {
    const expected = this.hostToken;
    if (!expected) return false;
    const presented = bearerOf(req.headers.authorization) ?? headerValue(req.headers["x-api-key"]);
    if (presented === undefined) return false;
    const candidate = Buffer.from(presented);
    return candidate.length === expected.length && timingSafeEqual(candidate, expected);
  }

  private requireLiveExecution(req: IncomingMessage): void {
    const executionId = headerValue(req.headers["x-stigmer-execution-id"]);
    if (!executionId) throw new LaneRefusal(403, "a model call must name its execution (X-Stigmer-Execution-Id)");
    if (!this.live.has(executionId)) throw new LaneRefusal(403, `execution ${executionId} has no turn running on this runner`);
  }

  /** Every thread a checkpoint call names must be a live turn's. */
  private requireLiveThreads(url: URL, body: Buffer): void {
    const threads = new Set<string>();
    const queried = url.searchParams.get("thread_id");
    if (queried !== null) threads.add(queried);
    for (const thread of threadsInBody(body)) threads.add(thread);
    if (threads.size === 0) throw new LaneRefusal(403, "a checkpoint call must name its thread");
    const liveThreads = new Set([...this.live.values()].map((t) => t.threadId));
    for (const thread of threads) {
      if (!liveThreads.has(thread)) throw new LaneRefusal(403, `thread ${thread} belongs to no turn running on this runner`);
    }
  }
}

/** The `thread_id`s a checkpoint write names: the checkpoint's own, or each write entry's. */
function threadsInBody(body: Buffer): string[] {
  if (body.length === 0) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.toString("utf8"));
  } catch {
    throw new LaneRefusal(400, "a checkpoint write must be JSON");
  }
  const threads: string[] = [];
  const collect = (value: unknown): void => {
    if (typeof value === "object" && value !== null && "thread_id" in value) {
      const thread = (value as { thread_id: unknown }).thread_id;
      threads.push(typeof thread === "string" ? thread : "");
    }
  };
  collect(parsed);
  const writes = typeof parsed === "object" && parsed !== null ? (parsed as { writes?: unknown }).writes : undefined;
  if (Array.isArray(writes)) for (const write of writes) collect(write);
  return threads;
}

/** The token of an `Authorization: Bearer <token>` header, read without a backtracking pattern (the header is the host's to send). */
export function bearerOf(header: string | undefined): string | undefined {
  if (header === undefined || !/^bearer\s/i.test(header)) return undefined;
  const token = header.slice("bearer".length).trim();
  return token.length > 0 ? token : undefined;
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
