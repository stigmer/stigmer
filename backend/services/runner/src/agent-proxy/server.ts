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
 *  - A model call must carry the key of a turn that is live on this runner
 *    (`X-Stigmer-Turn-Key`), and name that turn's own execution
 *    (`X-Stigmer-Execution-Id`). The remote adapter mints a key for each
 *    turn, opens the turn here with it, hands it to the host with the turn,
 *    and closes the turn when it settles (`agent-host/remote-adapter.ts`);
 *    the host's clients stamp both headers from the turn's execution context
 *    (`shared/execution-context.ts`). One host serves every turn of the
 *    runner with one token, so the key is what keeps a turn to its own
 *    execution.
 *  - A checkpoint call must carry a live turn's key and name only that
 *    turn's own thread (the `threadId` its engine checkpoints under), in
 *    its query or, for a write, in every entry of its body.
 *  - The model registry is exempt from the live-turn rule: it is the
 *    catalog every caller may read, and the platform's proxy serves it even
 *    to visitors.
 *  - No lane reaches the Stigmer API beyond the registry: execution reads,
 *    status writes, credential exchanges stay the runner's own calls.
 *  - The Cursor SDK's traffic has a listener of its own, TLS on loopback,
 *    under the same token and live-turn rules (`cursor-lane.ts`).
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
import { TURN_KEY_HEADER } from "../shared/execution-context.js";
import type { LiveTurnRegistry } from "../agent-host/remote-adapter.js";
import type { AgentProxyGate } from "../agent-host/supervisor.js";
import { CursorLane } from "./cursor-lane.js";
import { LaneRefusal, checkpointUpstream, isModelProviderLane, modelUpstream, registryUpstream } from "./lanes.js";
import { RequestTooLargeError, bearerOf, readBody, relay, replyError } from "./relay.js";

const LLM_PREFIX = "/v1/proxy/llm/";
const CHECKPOINT_PREFIX = "/v1/proxy/checkpoints";
const REGISTRY_PATH = "/v1/proxy/model-registry";

/** A turn live at the proxy. */
interface LiveTurn {
  readonly executionId: string;
  readonly threadId: string;
  readonly key: Buffer;
}

export class AgentProxy implements AgentProxyGate, LiveTurnRegistry {
  private hostToken: Buffer | undefined;
  /** Live turns: each one's execution, the thread it checkpoints under, and its key. */
  private readonly live = new Set<LiveTurn>();

  private cursor!: CursorLane;

  private constructor(
    private readonly server: Server,
    readonly endpoint: string,
    private readonly config: Config,
  ) {}

  /** Listen on ephemeral loopback ports and forward with `config`'s credentials, read per request. */
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
    const self = proxy;
    proxy.cursor = await CursorLane.start(config, {
      isHostToken: (presented) => self.isHostToken(presented),
      requireLiveExecution: (req) => self.requireLiveExecution(req),
    });
    return proxy;
  }

  /** The Cursor lane, `https://2130706433:<port>`, 127.0.0.1 written as one number so the Cursor SDK keeps certificate checks on (`agent-proxy/cursor-lane.ts`). */
  get cursorEndpoint(): string {
    return this.cursor.endpoint;
  }

  /** The certificate the Cursor lane serves, which the host trusts (PEM). */
  get cursorCertificate(): string {
    return this.cursor.certPem;
  }

  authorizeHost(token: string): void {
    this.hostToken = Buffer.from(token);
    this.cursor.resetCustody();
  }

  openTurn(turn: { readonly executionId: string; readonly threadId: string; readonly turnKey: string }): () => void {
    const live: LiveTurn = { executionId: turn.executionId, threadId: turn.threadId, key: Buffer.from(turn.turnKey) };
    this.live.add(live);
    return () => {
      this.live.delete(live);
    };
  }

  async close(): Promise<void> {
    await Promise.all([
      this.cursor.close(),
      new Promise<void>((resolve) => {
        this.server.closeAllConnections();
        this.server.close(() => resolve());
      }),
    ]);
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://agent-proxy");
    const path = url.pathname;
    try {
      if (!this.authenticated(req)) throw new LaneRefusal(401, "the agent proxy accepts the current agent host's token only");
      if (path === REGISTRY_PATH) {
        if (req.method !== "GET") throw new LaneRefusal(405, "the model registry is read with GET");
        await relay(res, registryUpstream(req));
        return;
      }
      if (path.startsWith(LLM_PREFIX)) {
        const [lane = "", ...segments] = path.slice(LLM_PREFIX.length).split("/");
        if (!isModelProviderLane(lane)) throw new LaneRefusal(404, `no model lane '${lane}'`);
        this.requireLiveExecution(req);
        const body = await readBody(req);
        const rest = `/${segments.join("/")}${url.search}`;
        await relay(res, await modelUpstream(this.config, lane, rest, req, body));
        return;
      }
      if (path === CHECKPOINT_PREFIX || path.startsWith(`${CHECKPOINT_PREFIX}/`)) {
        const body = await readBody(req);
        this.requireLiveThreads(req, url, body, req.method === "PUT" && path === `${CHECKPOINT_PREFIX}/writes`);
        await relay(res, checkpointUpstream(this.config, `${path.slice(CHECKPOINT_PREFIX.length)}${url.search}`, req, body));
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
    return this.isHostToken(bearerOf(req.headers.authorization) ?? headerValue(req.headers["x-api-key"]));
  }

  private isHostToken(presented: string | undefined): boolean {
    const expected = this.hostToken;
    if (!expected) return false;
    if (presented === undefined) return false;
    const candidate = Buffer.from(presented);
    return candidate.length === expected.length && timingSafeEqual(candidate, expected);
  }

  /** The live turn whose key the request carries, compared in constant time. */
  private liveTurnOf(req: { readonly headers: IncomingMessage["headers"] }): LiveTurn {
    const presented = headerValue(req.headers[TURN_KEY_HEADER]);
    if (!presented) throw new LaneRefusal(403, "a call must carry its turn's key (X-Stigmer-Turn-Key)");
    const candidate = Buffer.from(presented);
    for (const turn of this.live) {
      if (candidate.length === turn.key.length && timingSafeEqual(candidate, turn.key)) return turn;
    }
    throw new LaneRefusal(403, "the turn key names no turn running on this runner");
  }

  private requireLiveExecution(req: { readonly headers: IncomingMessage["headers"] }): void {
    const turn = this.liveTurnOf(req);
    const executionId = headerValue(req.headers["x-stigmer-execution-id"]);
    if (!executionId) throw new LaneRefusal(403, "a model call must name its execution (X-Stigmer-Execution-Id)");
    if (executionId !== turn.executionId) throw new LaneRefusal(403, `the turn key is not execution ${executionId}'s`);
  }

  /** Every thread a checkpoint call names must be its turn's own. */
  private requireLiveThreads(req: IncomingMessage, url: URL, body: Buffer, isWriteBatch: boolean): void {
    const turn = this.liveTurnOf(req);
    const threads = new Set<string>();
    const queried = url.searchParams.get("thread_id");
    if (queried !== null) threads.add(queried);
    for (const thread of threadsInBody(body)) threads.add(thread);
    // An empty write batch names no thread and writes nothing: LangGraph sends
    // one for a task whose writes all go to untracked channels, and the
    // platform answers it as a no-op.
    if (threads.size === 0 && isWriteBatch && isEmptyWriteBatch(body)) return;
    if (threads.size === 0) throw new LaneRefusal(403, "a checkpoint call must name its thread");
    for (const thread of threads) {
      if (thread !== turn.threadId) throw new LaneRefusal(403, `thread ${thread} is not the turn's own`);
    }
  }
}

/** A body that is exactly a write batch with no writes. */
function isEmptyWriteBatch(body: Buffer): boolean {
  if (body.length === 0) return false;
  const parsed: unknown = JSON.parse(body.toString("utf8"));
  return typeof parsed === "object" && parsed !== null && Array.isArray((parsed as { writes?: unknown }).writes) && (parsed as { writes: unknown[] }).writes.length === 0;
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

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
