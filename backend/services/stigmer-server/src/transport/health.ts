/**
 * gRPC health service (grpc.health.v1) — the readiness gate.
 *
 * The overall status ("" service) starts NOT_SERVING at construction and
 * flips SERVING only after the composition root completes — "ready" means
 * "wired and answering RPCs", never merely "port bound". Shutdown flips
 * NOT_SERVING FIRST, before the drain.
 * The CLI's serverGate TCP probe keys off the port bind, which the boot
 * sequence therefore performs only after this state is SERVING.
 *
 * One named service beside it, stigmer.sandboxes, says whether a new
 * session can start now: NOT_SERVING while the sandbox driver builds what
 * every new sandbox starts from (Agent Substrate's golden snapshot),
 * SERVING once it exists, and SERVING from boot under a driver with no such
 * image. It never touches the overall status, so the console and the API
 * answer while the image builds; an installer that wants an install Ready
 * only when sessions can start asks it by name (the Kubernetes operator's
 * runner component does).
 *
 * Semantics are the gRPC health protocol's: Check on an unknown service is
 * NOT_FOUND; Watch answers immediately with the current status
 * (SERVICE_UNKNOWN if unset), stays open, and streams changes; List names
 * every service with a status.
 */
import { Code, ConnectError } from "@connectrpc/connect";
import type { ConnectRouter } from "@connectrpc/connect";
import {
  Health,
  HealthCheckResponse_ServingStatus as ServingStatus,
} from "@stigmer/apis/grpc/health/v1/health_pb";

type StatusListener = (status: ServingStatus) => void;

/** The "" service name = the server's overall health (gRPC convention). */
const OVERALL = "";

/** The named service that says whether a new session can start now. */
export const SANDBOXES_HEALTH_SERVICE = "stigmer.sandboxes";

export class HealthState {
  private readonly statuses = new Map<string, ServingStatus>();
  private readonly listeners = new Map<string, Set<StatusListener>>();

  constructor() {
    this.statuses.set(OVERALL, ServingStatus.NOT_SERVING);
  }

  setOverall(status: ServingStatus): void {
    this.set(OVERALL, status);
  }

  /** Sets one service's status and tells its watchers. */
  set(service: string, status: ServingStatus): void {
    this.statuses.set(service, status);
    for (const listener of this.listeners.get(service) ?? []) {
      listener(status);
    }
  }

  /** Every service with a status, by name. */
  services(): ReadonlyMap<string, ServingStatus> {
    return this.statuses;
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
      for (const [service, status] of state.services()) {
        statuses[service] = { status };
      }
      return { statuses };
    },

    watch: async function* (request, context) {
      // Immediate current status (SERVICE_UNKNOWN for unset — the stream
      // stays OPEN in that case rather than failing, so a client can watch
      // a service that registers later).
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
