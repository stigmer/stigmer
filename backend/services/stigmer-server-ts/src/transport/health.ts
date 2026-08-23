/**
 * gRPC health service (grpc.health.v1) — the readiness gate.
 *
 * Ports the Go server's health posture (backend/libs/go/grpc/server.go):
 * the overall status ("" service) starts NOT_SERVING at construction and
 * flips SERVING only after the composition root completes — "ready" means
 * "wired and answering RPCs", never merely "port bound" (server.go:739-742).
 * Shutdown flips NOT_SERVING FIRST, before the drain (Stop, :247-265).
 * The CLI's serverGate TCP probe keys off the port bind, which the boot
 * sequence therefore performs only after this state is SERVING.
 *
 * Semantics match grpc-go's health server: Check on an unknown service is
 * NOT_FOUND; Watch answers immediately with the current status
 * (SERVICE_UNKNOWN if unset), stays open, and streams changes.
 */
import { Code, ConnectError } from "@connectrpc/connect";
import type { ConnectRouter } from "@connectrpc/connect";
import {
  Health,
  HealthCheckResponse_ServingStatus as ServingStatus,
} from "@stigmer/protos/grpc/health/v1/health_pb";

type StatusListener = (status: ServingStatus) => void;

/** The "" service name = the server's overall health (gRPC convention). */
const OVERALL = "";

export class HealthState {
  private readonly statuses = new Map<string, ServingStatus>();
  private readonly listeners = new Map<string, Set<StatusListener>>();

  constructor() {
    this.statuses.set(OVERALL, ServingStatus.NOT_SERVING);
  }

  setOverall(status: ServingStatus): void {
    this.statuses.set(OVERALL, status);
    for (const listener of this.listeners.get(OVERALL) ?? []) {
      listener(status);
    }
  }

  status(service: string): ServingStatus | undefined {
    return this.statuses.get(service);
  }

  subscribe(service: string, listener: StatusListener): () => void {
    const set = this.listeners.get(service) ?? new Set<StatusListener>();
    set.add(listener);
    this.listeners.set(service, set);
    return () => {
      set.delete(listener);
    };
  }
}

/** Registers the health service backed by the given state. */
export function registerHealthService(
  router: ConnectRouter,
  state: HealthState,
): void {
  router.service(Health, {
    check: (request) => {
      const status = state.status(request.service);
      if (status === undefined) {
        throw new ConnectError(
          `unknown service ${request.service}`,
          Code.NotFound,
        );
      }
      return { status };
    },

    list: () => {
      const statuses: Record<string, { status: ServingStatus }> = {};
      const overall = state.status(OVERALL);
      if (overall !== undefined) {
        statuses[OVERALL] = { status: overall };
      }
      return { statuses };
    },

    watch: async function* (request, context) {
      // Immediate current status (SERVICE_UNKNOWN for unset — grpc-go keeps
      // the stream OPEN in that case rather than failing, so a client can
      // watch a service that registers later).
      let latest =
        state.status(request.service) ?? ServingStatus.SERVICE_UNKNOWN;
      yield { status: latest };

      // Stream every change until the client disconnects. The queue-plus-
      // notify shape keeps updates ordered even if several arrive while the
      // consumer is mid-yield.
      const pending: ServingStatus[] = [];
      let notify: (() => void) | undefined;
      const unsubscribe = state.subscribe(request.service, (status) => {
        pending.push(status);
        notify?.();
      });
      const abort = new Promise<void>((resolve) => {
        context.signal.addEventListener("abort", () => resolve(), {
          once: true,
        });
      });

      try {
        while (!context.signal.aborted) {
          if (pending.length === 0) {
            await Promise.race([
              abort,
              new Promise<void>((resolve) => (notify = resolve)),
            ]);
            notify = undefined;
            continue;
          }
          const next = pending.shift();
          if (next !== undefined && next !== latest) {
            latest = next;
            yield { status: next };
          }
        }
      } finally {
        unsubscribe();
      }
    },
  });
}
