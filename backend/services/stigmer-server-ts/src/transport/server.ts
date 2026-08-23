/**
 * The unified-port server: one TCP port serving native gRPC, gRPC-Web, the
 * Connect protocol, and the plain-HTTP REST lanes — the TS equivalent of
 * the Go server's Run() routing block (pkg/server/server.go:775-843).
 *
 * Lane priority ports Go's verified if-chain exactly (server.go:812-836):
 *
 *   1. exact match  /v1/proxy/task-kind-registry   (registry proxy)
 *   2. exact match  /v1/proxy/model-registry       (registry proxy)
 *   3. prefix       /v1/skill-artifacts            (seam — lands with the
 *                                                   skill domain sub-project)
 *   4. [reserved]   console statics                (phase 2, DD-005 — the
 *                                                   branch slot exists, no code)
 *   5. RPC adapter  gRPC + gRPC-Web + Connect      (replaces Go's lanes
 *                                                   4–5; WebSocket retired
 *                                                   per ratified delta 1)
 *   6. 404          (the adapter's fallback — CW-10 asserts unknown
 *                    /v1/proxy/* paths land here)
 *
 * The demux (demux.ts) fronts the port; both protocol servers run this same
 * lane router. Shutdown is Go's order (grpc lib Stop, server.go:247-265):
 * health NOT_SERVING first, drain in-flight requests up to 10s, then
 * destroy what remains.
 */
import type { ConnectRouter, Interceptor } from "@connectrpc/connect";
import { connectNodeAdapter } from "@connectrpc/connect-node";
import { createServer as createHttp1Server } from "node:http";
import { createServer as createHttp2Server } from "node:http2";
import type { ServerHttp2Session } from "node:http2";
import type { Socket } from "node:net";

import type { Logger } from "../boot/logger.js";
import {
  KEEPALIVE_PING_INTERVAL_MS,
  KEEPALIVE_PING_TIMEOUT_MS,
  MAX_MESSAGE_BYTES,
  MODEL_REGISTRY_PATH,
  SHUTDOWN_DRAIN_TIMEOUT_MS,
  SKILL_ARTIFACTS_PATH_PREFIX,
  TASK_KIND_REGISTRY_PATH,
} from "./constants.js";
import { applyRpcCorsHeaders, handleRpcPreflight, isRpcPreflight } from "./cors.js";
import { createProtocolDemuxServer } from "./demux.js";
import type { LaneHandler, LaneRequest, LaneResponse } from "./lanes.js";

export type { LaneHandler } from "./lanes.js";

export interface UnifiedPortServerOptions {
  logger: Logger;
  /** RPC surface registration (health service now; domains per sub-project). */
  routes: (router: ConnectRouter) => void;
  /** The pipeline chain, outermost first (pipeline/interceptors). */
  interceptors: Interceptor[];
  /** Lane 1: bundled task-kind registry proxy. */
  taskKindRegistryLane: LaneHandler;
  /** Lane 2: bundled + refreshed model registry proxy. */
  modelRegistryLane: LaneHandler;
  /**
   * Lane 3 seam: skill artifact transfer (#675). Absent until the skill
   * domain sub-project lands its handlers; the prefix then falls through to
   * the adapter's 404, which is also what Go answers for unknown paths.
   */
  skillTransferLane?: LaneHandler;
}

export interface UnifiedPortServer {
  /** Binds the port. Call only after the composition root completed (the CLI's serverGate treats port-bind as readiness). */
  listen(port: number, host?: string): Promise<number>;
  /** Drains and closes: callers flip health NOT_SERVING before invoking. */
  shutdown(): Promise<void>;
}

export function createUnifiedPortServer(options: UnifiedPortServerOptions): UnifiedPortServer {
  const rpcHandler = connectNodeAdapter({
    routes: options.routes,
    interceptors: options.interceptors,
    readMaxBytes: MAX_MESSAGE_BYTES,
    writeMaxBytes: MAX_MESSAGE_BYTES,
  });

  const laneRouter = (request: LaneRequest, response: LaneResponse): void => {
    const path = (request.url ?? "").split("?", 1)[0] ?? "";

    if (path === TASK_KIND_REGISTRY_PATH) {
      options.taskKindRegistryLane(request, response);
      return;
    }
    if (path === MODEL_REGISTRY_PATH) {
      options.modelRegistryLane(request, response);
      return;
    }
    if (options.skillTransferLane !== undefined && path.startsWith(SKILL_ARTIFACTS_PATH_PREFIX)) {
      options.skillTransferLane(request, response);
      return;
    }
    // Reserved: console statics branch (phase 2, DD-005) slots in here.

    if (isRpcPreflight(request)) {
      // Go answers preflights for ALL endpoints, registered or not
      // (WithCorsForRegisteredEndpointsOnly(false), server.go:777-784).
      handleRpcPreflight(request, response);
      return;
    }
    applyRpcCorsHeaders(request, response);
    rpcHandler(request, response);
  };

  const http1 = createHttp1Server(laneRouter);
  const http2 = createHttp2Server(laneRouter);

  const liveSessions = new Set<ServerHttp2Session>();
  http2.on("session", (session) => {
    liveSessions.add(session);
    session.on("close", () => liveSessions.delete(session));
    armKeepalivePings(session, options.logger);
  });
  // Protocol-level session failures (bad frames, resets) are a client's
  // problem, not a server crash; Go's h2c stack likewise swallows them.
  http2.on("sessionError", (error) => {
    options.logger.debug("http2 session error", { error: String(error) });
  });

  const demux = createProtocolDemuxServer({ http1, http2 });

  const liveSockets = new Set<Socket>();
  demux.on("connection", (socket: Socket) => {
    liveSockets.add(socket);
    socket.on("close", () => liveSockets.delete(socket));
  });

  return {
    listen(port: number, host = "0.0.0.0"): Promise<number> {
      return new Promise<number>((resolve, reject) => {
        demux.once("error", reject);
        demux.listen(port, host, () => {
          const address = demux.address();
          if (address === null || typeof address === "string") {
            reject(new Error("unified port bound without a TCP address"));
            return;
          }
          resolve(address.port);
        });
      });
    },

    async shutdown(): Promise<void> {
      // Go's Shutdown closes idle connections immediately and waits only
      // for active work. Node needs that spelled out: GOAWAY every h2
      // session (in-flight streams finish, idle sessions close now) and
      // drop idle http1 keep-alives; then the drain race below only ever
      // waits on genuinely active requests.
      const closed = new Promise<void>((resolve) => demux.close(() => resolve()));
      http1.close();
      http1.closeIdleConnections();
      http2.close();
      for (const session of liveSessions) {
        session.close();
      }

      const drained = await Promise.race([
        closed.then(() => true),
        new Promise<boolean>((resolve) =>
          setTimeout(() => resolve(false), SHUTDOWN_DRAIN_TIMEOUT_MS).unref(),
        ),
      ]);

      if (!drained) {
        options.logger.warn("shutdown drain budget exhausted; destroying remaining connections", {
          remaining: liveSockets.size,
        });
      }
      for (const socket of liveSockets) {
        socket.destroy();
      }
      await closed;
    },
  };
}

/**
 * Server-initiated keepalive pings (constants.ts carries the values and the
 * MinTime-enforcement caveat). One interval per session; an unacked ping
 * past the timeout destroys the session — the same liveness contract Go's
 * keepalive.ServerParameters provides.
 */
function armKeepalivePings(session: ServerHttp2Session, logger: Logger): void {
  const interval = setInterval(() => {
    let acked = false;
    const deadline = setTimeout(() => {
      if (!acked && !session.destroyed) {
        logger.debug("closing http2 session: keepalive ping unacknowledged");
        session.destroy();
      }
    }, KEEPALIVE_PING_TIMEOUT_MS);
    deadline.unref();
    try {
      session.ping(() => {
        acked = true;
        clearTimeout(deadline);
      });
    } catch {
      clearTimeout(deadline);
      if (!session.destroyed) {
        session.destroy();
      }
    }
  }, KEEPALIVE_PING_INTERVAL_MS);
  interval.unref();
  session.on("close", () => clearInterval(interval));
}

