/**
 * The local proxy's Cursor lane: where the agent host's Cursor SDK sends
 * everything, and the one place the Cursor credentials are used (#2016).
 *
 * It is a listener of its own, beside the model lanes' (`server.ts`): TLS on
 * `127.0.0.1` (written as a number, {@link LOOPBACK_AS_NUMBER} says why)
 * with a certificate made at each runner start
 * (`loopback-certificate.ts`), serving HTTP/2 and HTTP/1.1 on one port. The
 * SDK opens its agent run as an HTTP/2 bidirectional stream only for an
 * `https:` backend, and that stream is the wire the Stigmer platform's proxy
 * serves, so the host's SDK is pointed here (`CURSOR_BACKEND_URL`) and
 * trusts this certificate alone (`agent-host/hosting.ts`).
 *
 * The host's Cursor harness runs as a proxy-mode client (its interceptors,
 * `activities/execute-cursor/`), so the lane receives two shapes:
 *
 *  - REST, `/v1/proxy/cursor/<cursor host><path>`, over HTTP/1.1 (the SDK's
 *    `fetch`): the API-key exchange, the model list, agent CRUD. The host's
 *    token is in `Authorization` and the call must name a live execution;
 *    only Cursor's own hosts are reached.
 *  - Connect, `/agent.v1.*` and `/aiserver.v1.*`, over HTTP/2 or HTTP/1.1:
 *    the agent run and the SDK's side calls. `Authorization` carries the
 *    access token the SDK got from the exchange — which, here, is a
 *    stand-in.
 *
 * Custody of the Cursor access token: the exchange is made with the
 * runner's credential (the operator's `CURSOR_API_KEY`, or through the
 * platform's proxy, which adds its key), and the access token that comes
 * back stays here. The host receives a stand-in, random and worthless
 * elsewhere, shaped so the SDK reads the real token's expiry from it (it
 * decodes the second dot-separated part for `exp`, and assumes thirty
 * minutes when it cannot); every Connect call swaps the stand-in back for
 * the real token on its way out. A stand-in the lane does not hold — a new
 * host's, after the old one died — is refused as unauthenticated, and the
 * SDK answers that by exchanging again, as it does when a real token
 * expires.
 *
 * Two upstream modes, as for the model lanes (`lanes.ts`):
 *
 *  - Forward (the runner talks to the Stigmer platform's proxy): REST goes
 *    to the same path there with the runner's proxy credential; Connect goes
 *    to the platform's Cursor lane with the real access token in
 *    `Authorization` and the runner's credential in `x-stigmer-auth`, as the
 *    runner's own interceptors sent it before the harness moved here.
 *  - Terminate (the runner calls Cursor itself): REST and Connect go to
 *    Cursor (`CURSOR_BACKEND_URL` on the runner, else Cursor's own hosts),
 *    REST with the operator's key, Connect with the real access token.
 *
 * Bounds, the same as every lane's: the host's token for REST, a held
 * stand-in for Connect; a live turn's execution for every call but the
 * SDK's unscoped side calls (`/aiserver.v1.*`, the platform's lane serves
 * those unscoped too); the execution id is the one scope header forwarded.
 */

import { randomBytes } from "node:crypto";
import type { IncomingMessage } from "node:http";
import {
  connect as connectHttp2,
  constants as http2Constants,
  createSecureServer,
  type ClientHttp2Session,
  type Http2SecureServer,
  type Http2ServerRequest,
  type Http2ServerResponse,
  type Http2Session,
  type OutgoingHttpHeaders,
} from "node:http2";
import type { AddressInfo, Socket } from "node:net";

import type { Config } from "../config.js";
import { LaneRefusal, laneUrl } from "./lanes.js";
import { mintLoopbackCertificate } from "./loopback-certificate.js";
import { RequestTooLargeError, bearerOf, forwardableHeaders, readBody, relay, requestWhole, type RelayResponse, type Upstream } from "./relay.js";

/** Cursor's own hosts: the only ones the REST lane reaches. */
const CURSOR_HOSTS = ["api2.cursor.sh", "api.cursor.com", "api.cursor.sh"];
const REST_PREFIX = "/v1/proxy/cursor/";
const EXCHANGE_PATH = "/auth/exchange_user_api_key";
const AGENT_PREFIX = "/agent.v1.";
const SIDE_CALL_PREFIX = "/aiserver.v1.";
const DEFAULT_CONNECT_UPSTREAM = "https://api2.cursor.sh";

/**
 * 127.0.0.1 written as one number, which every URL parser reads as
 * 127.0.0.1 (WHATWG's IPv4 parser; `fetch`, `http2.connect` and the TLS
 * identity check all see that address). The Cursor SDK sets
 * `NODE_TLS_REJECT_UNAUTHORIZED=0` for its whole process whenever its
 * backend URL's text matches `://localhost` or `://127.0.0.1` (`Agent.create`,
 * SDK 1.0.31): written as a number, the lane's address does not match, so
 * the host and every process an agent starts keep verifying certificates.
 */
const LOOPBACK_AS_NUMBER = "2130706433";

/** What the lane asks of the proxy it belongs to. */
export interface CursorLaneGate {
  /** Is `presented` the current host's token? */
  isHostToken(presented: string | undefined): boolean;
  /** Throws a {@link LaneRefusal} unless the request names a live turn's execution. */
  requireLiveExecution(req: { readonly headers: IncomingMessage["headers"] }): void;
}

type LaneRequest = IncomingMessage | Http2ServerRequest;
type LaneResponse = RelayResponse;

export class CursorLane {
  private readonly custody = new TokenCustody();
  /**
   * The upstream HTTP/2 sessions, by the host's session they serve and then
   * by origin. A host that resets its transport (the Cursor harness does at
   * every turn start and on a transport timeout) gets fresh upstream
   * connections with its new one, so a recovery never reuses a degraded one.
   */
  private readonly upstreams = new Map<Http2Session, Map<string, ClientHttp2Session>>();
  /** Every connection a host has open to the lane, so a close does not wait on them. */
  private readonly inbound = new Set<Socket>();

  private constructor(
    private readonly server: Http2SecureServer,
    /** `https://2130706433:<port>`, 127.0.0.1 written as one number so the Cursor SDK keeps certificate checks on (`agent-proxy/cursor-lane.ts`). */
    readonly endpoint: string,
    /** The certificate the host trusts, PEM. */
    readonly certPem: string,
    private readonly config: Config,
    private readonly gate: CursorLaneGate,
  ) {}

  static async start(config: Config, gate: CursorLaneGate): Promise<CursorLane> {
    const { certPem, keyPem } = mintLoopbackCertificate();
    let lane: CursorLane | undefined;
    const server = createSecureServer({ cert: certPem, key: keyPem, allowHTTP1: true }, (req, res) => {
      void lane!.handle(req, res);
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve());
    });
    server.unref();
    const { port } = server.address() as AddressInfo;
    lane = new CursorLane(server, `https://${LOOPBACK_AS_NUMBER}:${port}`, certPem, config, gate);
    const inbound = lane.inbound;
    server.on("connection", (socket: Socket) => {
      inbound.add(socket);
      socket.once("close", () => inbound.delete(socket));
    });
    return lane;
  }

  /** Forget every stand-in: a new host holds none of the old one's. */
  resetCustody(): void {
    this.custody.clear();
  }

  /** Close the listener, ending every connection a host still holds, as the model lanes' listener does. */
  close(): Promise<void> {
    for (const sessions of this.upstreams.values()) for (const session of sessions.values()) session.destroy();
    this.upstreams.clear();
    const closed = new Promise<void>((resolve) => this.server.close(() => resolve()));
    for (const socket of this.inbound) socket.destroy();
    return closed;
  }

  private async handle(req: LaneRequest, res: LaneResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "https://cursor-lane");
    const path = url.pathname;
    try {
      if (path.startsWith(REST_PREFIX)) {
        await this.rest(req, res, path.slice(REST_PREFIX.length), url.search);
        return;
      }
      if (path.startsWith(AGENT_PREFIX) || path.startsWith(SIDE_CALL_PREFIX)) {
        await this.connect(req, res, `${path}${url.search}`, path.startsWith(AGENT_PREFIX));
        return;
      }
      throw new LaneRefusal(404, `the Cursor lane serves no path ${path}`);
    } catch (err) {
      const refusal =
        err instanceof LaneRefusal ? err
        : err instanceof RequestTooLargeError ? new LaneRefusal(413, err.message)
        : new LaneRefusal(502, err instanceof Error ? err.message : String(err));
      console.warn(`[agent-proxy] refused ${req.method ?? "?"} ${path}: ${refusal.status} ${refusal.message}`);
      replyConnectError(res, refusal.status, refusal.message);
    }
  }

  /** `/v1/proxy/cursor/<host><path>`: the host's token, a live execution, a Cursor host. */
  private async rest(req: LaneRequest, res: LaneResponse, hostAndPath: string, search: string): Promise<void> {
    if (!this.gate.isHostToken(bearerOf(req.headers.authorization))) {
      throw new LaneRefusal(401, "the agent proxy accepts the current agent host's token only");
    }
    this.gate.requireLiveExecution(req);
    const slash = hostAndPath.indexOf("/");
    const host = slash === -1 ? hostAndPath : hostAndPath.slice(0, slash);
    const path = slash === -1 ? "" : hostAndPath.slice(slash);
    const rest = `${path}${search}`;
    if (!isCursorHost(host)) throw new LaneRefusal(403, `the Cursor lane reaches Cursor's own hosts only, not ${host}`);
    const exchange = path === EXCHANGE_PATH;
    // Custody turns on this one path. Any other spelling that a server could
    // read as the auth API (a trailing or doubled slash, an escape, another
    // case) is refused, so no answer carrying a token is relayed unchanged.
    if (!exchange && readsAsAuthPath(path)) throw new LaneRefusal(403, "the Cursor lane serves the auth API at its key exchange's own path only");
    const body = await readBody(req);
    const forward = this.config.proxyEndpoint !== null;
    const upstream: Upstream =
      forward ?
        {
          url: laneUrl(this.config.proxyEndpoint!, `/v1/proxy/cursor/${host}${rest}`),
          method: req.method ?? "GET",
          headers: { ...forwardableHeaders(req.headers, true), authorization: `Bearer ${this.runnerCredential()}` },
          body,
        }
      : {
          url: laneUrl(process.env.CURSOR_BACKEND_URL?.trim() || `https://${host}`, rest),
          method: req.method ?? "GET",
          headers: { ...forwardableHeaders(req.headers, false), authorization: `Bearer ${this.operatorKey()}` },
          body,
        };
    if (!exchange) {
      await relay(res, upstream);
      return;
    }
    // The exchange: the access token stays here; the host gets a stand-in.
    const answer = await requestWhole(upstream);
    let out = answer.body;
    if (answer.status === 200) {
      const parsed = parseJsonObject(answer.body);
      if (parsed !== undefined && typeof parsed.accessToken === "string" && parsed.accessToken.length > 0) {
        const { refreshToken: _dropped, ...kept } = parsed;
        out = Buffer.from(JSON.stringify({ ...kept, accessToken: this.custody.hold(parsed.accessToken) }));
      }
    }
    const headers: Record<string, string | string[]> = { ...answer.headers, "content-length": String(out.length) };
    res.writeHead(answer.status, headers);
    res.end(out);
  }

  /** A Connect call: a held stand-in, a live execution for the agent run, the real token on the way out. */
  private async connect(req: LaneRequest, res: LaneResponse, pathAndQuery: string, scoped: boolean): Promise<void> {
    const real = this.custody.real(bearerOf(req.headers.authorization));
    if (real === undefined) throw new LaneRefusal(401, "the Cursor lane holds no such access token; exchange the API key again");
    if (scoped) this.gate.requireLiveExecution(req);
    const forward = this.config.proxyEndpoint !== null;
    const base = forward ? this.config.proxyEndpoint! : process.env.CURSOR_BACKEND_URL?.trim() || DEFAULT_CONNECT_UPSTREAM;
    const headers: Record<string, string | string[]> = {
      ...forwardableHeaders(req.headers, forward),
      authorization: `Bearer ${real}`,
      ...(forward ? { "x-stigmer-auth": `Bearer ${this.runnerCredential()}` } : {}),
    };
    const url = laneUrl(base, pathAndQuery);
    if (req.httpVersionMajor === 2) {
      await this.relayStream(req as Http2ServerRequest, res as Http2ServerResponse, url, headers);
      return;
    }
    await relay(res, { url, method: req.method ?? "POST", headers, body: await readBody(req) });
  }

  /**
   * One HTTP/2 stream, relayed both ways as it flows: the agent run is a
   * bidirectional stream, so neither side is buffered. The upstream's
   * headers, data and trailers come back as they were; either side's reset
   * resets the other.
   */
  private relayStream(req: Http2ServerRequest, res: Http2ServerResponse, url: URL, headers: Record<string, string | string[]>): Promise<void> {
    return new Promise((resolve) => {
      // The host's session is live while its request is handled: the relay
      // starts in the same tick the lane checked the stand-in.
      const session = this.session(req.stream.session!, url.origin);
      const outgoing: OutgoingHttpHeaders = {
        ...headers,
        [http2Constants.HTTP2_HEADER_METHOD]: req.method,
        [http2Constants.HTTP2_HEADER_PATH]: `${url.pathname}${url.search}`,
      };
      const upstream = session.request(outgoing);
      // A host that drops its stream abandons the run: cancel it at Cursor
      // rather than let the request's end read as "nothing more to send".
      // (`res.writableFinished` reads true once the host's stream is gone,
      // so the upstream's own state decides.)
      const abandon = (): void => {
        if (!upstream.closed) upstream.close(http2Constants.NGHTTP2_CANCEL);
      };
      res.on("close", abandon);
      req.pipe(upstream);
      upstream.on("response", (answer) => {
        const relayed: OutgoingHttpHeaders = {};
        for (const [name, value] of Object.entries(answer)) {
          if (!name.startsWith(":") && value !== undefined) relayed[name] = value;
        }
        res.writeHead(Number(answer[http2Constants.HTTP2_HEADER_STATUS] ?? 502), relayed);
        upstream.pipe(res);
      });
      upstream.on("trailers", (trailers) => {
        const relayed: OutgoingHttpHeaders = {};
        for (const [name, value] of Object.entries(trailers)) {
          if (!name.startsWith(":") && value !== undefined) relayed[name] = value;
        }
        res.addTrailers(relayed);
      });
      upstream.on("end", () => resolve());
      upstream.on("error", (err) => {
        res.off("close", abandon);
        console.warn(`[agent-proxy] the Cursor stream ${url.pathname} failed upstream: ${err.message}`);
        if (res.headersSent) res.stream.close(http2Constants.NGHTTP2_INTERNAL_ERROR);
        else replyConnectError(res, 502, `the upstream could not be reached: ${err.message}`);
        resolve();
      });
    });
  }


  /** One HTTP/2 session per upstream origin, opened on first use and dropped when it ends. */
  /** The upstream session to `origin` for the host's session `inbound`, opened on first use and ended with it. */
  private session(inbound: Http2Session, origin: string): ClientHttp2Session {
    let byOrigin = this.upstreams.get(inbound);
    if (byOrigin === undefined) {
      const sessions = new Map<string, ClientHttp2Session>();
      byOrigin = sessions;
      this.upstreams.set(inbound, sessions);
      // Closed, not destroyed: each stream still open is cancelled at Cursor
      // by its own relay as the host's side of it closes.
      inbound.once("close", () => {
        this.upstreams.delete(inbound);
        for (const session of sessions.values()) session.close();
      });
    }
    const open = byOrigin.get(origin);
    if (open && !open.closed && !open.destroyed) return open;
    const session = connectHttp2(origin);
    session.unref();
    const sessions = byOrigin;
    const forget = (): void => {
      if (sessions.get(origin) === session) sessions.delete(origin);
    };
    session.on("close", forget);
    session.on("goaway", forget);
    session.on("error", forget);
    sessions.set(origin, session);
    return session;
  }

  private runnerCredential(): string {
    // The proxy credential the runner's interceptors sent, which the root binds (`config.ts`).
    const token = (this.config.proxyTokenRef ?? this.config.stigmerTokenRef).current;
    if (!token) throw new LaneRefusal(503, "the runner holds no Stigmer credential to forward this call with");
    return token;
  }

  private operatorKey(): string {
    if (!this.config.cursorApiKey) throw new LaneRefusal(500, "the Cursor lane needs CURSOR_API_KEY on the runner");
    return this.config.cursorApiKey;
  }
}

/** Is `host` one of Cursor's own, read as a URL parser reads it (no userinfo, port or escape)? */
function isCursorHost(host: string): boolean {
  let parsed: string;
  try {
    parsed = new URL(`https://${host}`).hostname;
  } catch {
    return false;
  }
  return parsed === host.toLowerCase() && CURSOR_HOSTS.some((known) => parsed === known || parsed.endsWith(`.${known}`));
}

/** Does `path` read as the auth API once decoded, lower-cased and stripped of repeated or trailing slashes? */
function readsAsAuthPath(path: string): boolean {
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return true;
  }
  let canonical = decoded.toLowerCase().replace(/\/{2,}/g, "/");
  while (canonical.endsWith("/")) canonical = canonical.slice(0, -1);
  return canonical === "/auth" || canonical.startsWith("/auth/");
}

/**
 * The access tokens the lane holds, by the stand-in the host was given for
 * each. A token is held until its own expiry (a day when it names none),
 * and at most {@link MAX_HELD} at once, the oldest let go first.
 */
class TokenCustody {
  private readonly held = new Map<string, { readonly real: string; readonly until: number }>();

  hold(real: string): string {
    const exp = expiryOf(real);
    const random = randomBytes(32).toString("base64url");
    const claims = Buffer.from(JSON.stringify(exp === undefined ? {} : { exp })).toString("base64url");
    const standIn = `stigmer.${claims}.${random}`;
    this.held.set(standIn, { real, until: exp === undefined ? Date.now() + DEFAULT_HOLD_MS : exp * 1000 });
    for (const oldest of this.held.keys()) {
      if (this.held.size <= MAX_HELD) break;
      this.held.delete(oldest);
    }
    return standIn;
  }

  real(standIn: string | undefined): string | undefined {
    if (standIn === undefined) return undefined;
    const entry = this.held.get(standIn);
    if (entry === undefined) return undefined;
    if (entry.until <= Date.now()) {
      this.held.delete(standIn);
      return undefined;
    }
    return entry.real;
  }

  clear(): void {
    this.held.clear();
  }
}

const MAX_HELD = 1024;
const DEFAULT_HOLD_MS = 24 * 60 * 60 * 1000;

/** The `exp` a JWT-shaped token names, read as the SDK reads it; `undefined` when it names none. */
function expiryOf(token: string): number | undefined {
  const claims = parseJsonObject(Buffer.from(token.split(".")[1] ?? "", "base64url"));
  const exp = claims?.exp;
  return typeof exp === "number" && Number.isFinite(exp) && exp > 0 ? exp : undefined;
}

function parseJsonObject(bytes: Buffer): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(bytes.toString("utf8"));
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * A refusal in the shape a Connect client reads (`{"code","message"}` with
 * the matching HTTP status), which the SDK turns into its own errors: an
 * `unauthenticated` one is what makes it exchange its key again.
 */
function replyConnectError(res: LaneResponse, status: number, message: string): void {
  const code =
    status === 401 ? "unauthenticated"
    : status === 403 ? "permission_denied"
    : status === 404 ? "unimplemented"
    : status === 413 ? "resource_exhausted"
    : status === 503 ? "unavailable"
    : "internal";
  const body = JSON.stringify({ code, message });
  res.writeHead(status, { "content-type": "application/json", "content-length": String(Buffer.byteLength(body)) });
  res.end(body);
}

