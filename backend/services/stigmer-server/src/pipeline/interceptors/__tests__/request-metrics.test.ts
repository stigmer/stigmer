/**
 * Pins the request-metrics interceptor (20260909.02, gate rulings Q1–Q5)
 * against a REAL MeterProvider (in-memory exporter) through the REAL
 * serving chain over the router transport — Java's
 * GrpcRequestMetricsInterceptor contract, label for label:
 *
 *   - one record per RPC with `rpc.service`, `rpc.method` and the gRPC
 *     status NAME (`OK`, `NOT_FOUND`, `UNKNOWN` for a raw throw — the
 *     logging interceptor's derivation, INTERNAL on the wire);
 *   - the health service is never measured; an identity refusal at
 *     position 1 is never counted (the paging property ruling Q1 protects);
 *     the in-process chain records nothing;
 *   - a server stream is measured to its END — OK on completion, the
 *     error's code on a mid-stream throw, CANCELLED when the consumer
 *     stops early — never to the handler's return;
 *   - the count series is born attribute-less at zero and the histogram
 *     is not (the heartbeat's premise);
 *   - instruments resolve lazily, so a provider registered after the
 *     module loaded still receives every record;
 *   - the sixteen Connect codes map to grpc-java's names byte-exact
 *     (CANCELLED, two Ls).
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  Code,
  ConnectError,
  createClient,
  createRouterTransport,
} from "@connectrpc/connect";
import type { Interceptor } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentCommandController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/command_pb";
import { AgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { AgentExecutionQueryController } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/query_pb";
import {
  Health,
  HealthCheckResponse_ServingStatus as ServingStatus,
} from "@stigmer/protos/grpc/health/v1/health_pb";

import { createLogger } from "../../../boot/logger.js";
import {
  inMemoryMeter as inMemoryMeterFor,
  until,
  type CollectedMetrics,
  type CollectedPoint,
} from "../../../observability/__tests__/in-memory-meter.js";
import {
  GRPC_STATUS_OK,
  grpcStatusName,
  initRpcMetrics,
  resetRpcInstruments,
} from "../../../observability/rpc-metrics.js";
import { buildInterceptorChain } from "../../chain.js";
import { createVerifierChainInterceptor } from "../auth.js";
import { createErrorBoundaryInterceptor } from "../error-boundary.js";
import { createRequestMetricsInterceptor } from "../request-metrics.js";

const logger = createLogger({ level: "error", pretty: false });
const inMemoryMeter = () => inMemoryMeterFor(resetRpcInstruments);

const COUNT = "stigmer.grpc.request.count";
const DURATION = "stigmer.grpc.request.duration";
const AGENT_SERVICE = "ai.stigmer.agentic.agent.v1.AgentCommandController";
const EXECUTION_SERVICE =
  "ai.stigmer.agentic.agentexecution.v1.AgentExecutionQueryController";

const VALID_AGENT = {
  apiVersion: "agentic.stigmer.ai/v1",
  kind: "Agent",
  metadata: { name: "request metrics test agent" },
  spec: {
    instructions: "You are a helpful test agent used by interceptor tests.",
  },
} as const;

afterEach(() => {
  resetRpcInstruments();
});

/** A clock the test advances by hand, so durations are exact, never timing-dependent. */
function fakeClock(): { now: () => number; advance: (ms: number) => void } {
  let current = 1_000;
  return {
    now: () => current,
    advance: (ms) => {
      current += ms;
    },
  };
}

/** The count points that carry a status — real requests, not the zero birth. */
function requestPoints(collected: CollectedMetrics): CollectedPoint[] {
  return (collected.get(COUNT) ?? []).filter(
    (point) => "rpc.grpc.status_code" in point.attributes,
  );
}

function durationPoints(collected: CollectedMetrics): CollectedPoint[] {
  return collected.get(DURATION) ?? [];
}

/** A histogram point's recorded sum — one record per RPC makes sum = the duration. */
function sumOf(point: CollectedPoint): number {
  return (point.value as { sum: number }).sum;
}

interface Handlers {
  create?: () => unknown;
  subscribe?: () => AsyncIterable<unknown>;
}

/**
 * The serving chain as compose.ts builds it — boundary, identity source
 * (zero verifiers unless `requireAuthentication`), the metrics emitter
 * under test with a hand-advanced clock, then the ratified inner three.
 */
function servingTransport(
  handlers: Handlers,
  now: () => number,
  options: { requireAuthentication?: boolean } = {},
) {
  return createRouterTransport(
    (router) => {
      router.service(AgentCommandController, {
        create: () =>
          (handlers.create?.() as never) ?? create(AgentSchema, VALID_AGENT),
        apply: (request) => request,
        update: (request) => request,
        updateVisibility: () => create(AgentSchema, VALID_AGENT),
        delete: () => create(AgentSchema, VALID_AGENT),
      });
      router.service(AgentExecutionQueryController, {
        subscribe: () => (handlers.subscribe?.() ?? emptyStream()) as never,
      });
      router.service(Health, {
        check: () => ({ status: ServingStatus.SERVING }),
        list: () => ({ statuses: {} }),
        watch: async function* () {},
      });
    },
    {
      router: {
        interceptors: buildInterceptorChain(
          logger,
          createVerifierChainInterceptor(
            [],
            [],
            logger,
            options.requireAuthentication ?? false,
          ),
          {
            errorBoundary: createErrorBoundaryInterceptor(logger),
            requestMetrics: createRequestMetricsInterceptor(now),
          },
        ),
      },
    },
  );
}

async function* emptyStream(): AsyncIterable<unknown> {}

function execution(id: string) {
  return create(AgentExecutionSchema, { metadata: { id } });
}

describe("the request-metrics interceptor on the serving chain", () => {
  it("records one OK count and one duration per unary RPC, labelled with the service and the bare method", async () => {
    const meter = await inMemoryMeter();
    const clock = fakeClock();
    try {
      const transport = servingTransport(
        {
          create: () => {
            clock.advance(12.5);
            return create(AgentSchema, VALID_AGENT);
          },
        },
        clock.now,
      );

      await createClient(AgentCommandController, transport).create(VALID_AGENT);

      const collected = await until(
        meter.collect,
        (m) => requestPoints(m).length >= 1,
      );
      expect(requestPoints(collected)).toHaveLength(1);
      expect(requestPoints(collected)[0]).toMatchObject({
        value: 1,
        attributes: {
          "rpc.service": AGENT_SERVICE,
          "rpc.method": "create",
          "rpc.grpc.status_code": "OK",
        },
      });
      const durations = durationPoints(collected);
      expect(durations).toHaveLength(1);
      expect(durations[0]!.attributes).toEqual(
        requestPoints(collected)[0]!.attributes,
      );
      // Fractional milliseconds, Java's nanoTime / 1e6 — never rounded.
      expect(sumOf(durations[0]!)).toBe(12.5);
    } finally {
      await meter.dispose();
    }
  });

  it("labels a ConnectError failure with the gRPC status name", async () => {
    const meter = await inMemoryMeter();
    try {
      const transport = servingTransport(
        {
          create: () => {
            throw new ConnectError('agent "ghost" not found', Code.NotFound);
          },
        },
        fakeClock().now,
      );

      const failure = await createClient(AgentCommandController, transport)
        .create(VALID_AGENT)
        .then(() => null)
        .catch((error: unknown) => ConnectError.from(error));
      expect(failure?.code).toBe(Code.NotFound);

      const collected = await until(
        meter.collect,
        (m) => requestPoints(m).length >= 1,
      );
      expect(requestPoints(collected)[0]!.attributes).toMatchObject({
        "rpc.method": "create",
        "rpc.grpc.status_code": "NOT_FOUND",
      });
    } finally {
      await meter.dispose();
    }
  });

  it("labels a raw throw UNKNOWN — the code before the boundary's INTERNAL rewrite, the logging interceptor's derivation", async () => {
    const meter = await inMemoryMeter();
    try {
      const transport = servingTransport(
        {
          create: () => {
            throw new Error("sqlite exploded");
          },
        },
        fakeClock().now,
      );

      const failure = await createClient(AgentCommandController, transport)
        .create(VALID_AGENT)
        .then(() => null)
        .catch((error: unknown) => ConnectError.from(error));
      // The wire sees the boundary's conversion …
      expect(failure?.code).toBe(Code.Internal);

      // … the metric sees the raw error's Connect mapping, as the log does.
      const collected = await until(
        meter.collect,
        (m) => requestPoints(m).length >= 1,
      );
      expect(requestPoints(collected)[0]!.attributes).toMatchObject({
        "rpc.grpc.status_code": "UNKNOWN",
      });
    } finally {
      await meter.dispose();
    }
  });

  it("never measures the health service (probe chatter would own the request-rate signal)", async () => {
    const meter = await inMemoryMeter();
    try {
      const transport = servingTransport({}, fakeClock().now);

      await createClient(Health, transport).check({});
      // A measured RPC afterwards proves the pipeline is live, so the
      // absence above is the interceptor's choice, not a collection race.
      await createClient(AgentCommandController, transport).create(VALID_AGENT);

      const collected = await until(
        meter.collect,
        (m) => requestPoints(m).length >= 1,
      );
      expect(
        requestPoints(collected).map((p) => p.attributes["rpc.service"]),
      ).toEqual([AGENT_SERVICE]);
    } finally {
      await meter.dispose();
    }
  });

  it("does not count an identity refusal — position 1's own record, Java's position (ruling Q1)", async () => {
    const meter = await inMemoryMeter();
    try {
      const transport = servingTransport({}, fakeClock().now, {
        requireAuthentication: true,
      });
      const client = createClient(AgentCommandController, transport);

      const refused = await client
        .create(VALID_AGENT)
        .then(() => null)
        .catch((error: unknown) => ConnectError.from(error));
      expect(refused?.code).toBe(Code.Unauthenticated);
      // A credentialed call passes position 1 (zero verifiers claim it →
      // trusted-local) and IS measured; waiting for it makes the refusal's
      // absence a fact, not a collection race. An emitter placed outside
      // the identity source would show two points here.
      await client.create(VALID_AGENT, {
        headers: { authorization: "Bearer any-token" },
      });

      const collected = await until(
        meter.collect,
        (m) => requestPoints(m).length >= 1,
      );
      expect(
        requestPoints(collected).map(
          (p) => p.attributes["rpc.grpc.status_code"],
        ),
      ).toEqual(["OK"]);
      expect(durationPoints(collected)).toHaveLength(1);
    } finally {
      await meter.dispose();
    }
  });

  it("measures a server stream to its END, not to the handler's return", async () => {
    const meter = await inMemoryMeter();
    const clock = fakeClock();
    try {
      const transport = servingTransport(
        {
          subscribe: async function* () {
            clock.advance(5);
            yield execution("e1");
            clock.advance(40);
            yield execution("e2");
            clock.advance(55);
          },
        },
        clock.now,
      );

      const seen: string[] = [];
      for await (const message of createClient(
        AgentExecutionQueryController,
        transport,
      ).subscribe({ value: "exec-1" })) {
        seen.push(message.metadata?.id ?? "");
      }
      expect(seen).toEqual(["e1", "e2"]);

      const collected = await until(
        meter.collect,
        (m) => requestPoints(m).length >= 1,
      );
      expect(requestPoints(collected)).toHaveLength(1);
      expect(requestPoints(collected)[0]!.attributes).toEqual({
        "rpc.service": EXECUTION_SERVICE,
        "rpc.method": "subscribe",
        "rpc.grpc.status_code": "OK",
      });
      expect(sumOf(durationPoints(collected)[0]!)).toBe(100);
    } finally {
      await meter.dispose();
    }
  });

  it("labels a mid-stream throw with the error's code, once", async () => {
    const meter = await inMemoryMeter();
    try {
      const transport = servingTransport(
        {
          subscribe: async function* () {
            yield execution("e1");
            throw new ConnectError("engine went away", Code.Unavailable);
          },
        },
        fakeClock().now,
      );

      const failure = await (async () => {
        try {
          for await (const _ of createClient(
            AgentExecutionQueryController,
            transport,
          ).subscribe({ value: "exec-1" })) {
            // drain
          }
          return null;
        } catch (error) {
          return ConnectError.from(error);
        }
      })();
      expect(failure?.code).toBe(Code.Unavailable);

      const collected = await until(
        meter.collect,
        (m) => requestPoints(m).length >= 1,
      );
      expect(requestPoints(collected)).toHaveLength(1);
      expect(requestPoints(collected)[0]!.attributes).toMatchObject({
        "rpc.method": "subscribe",
        "rpc.grpc.status_code": "UNAVAILABLE",
      });
    } finally {
      await meter.dispose();
    }
  });

  it("labels a stream the consumer abandoned CANCELLED, once — Java's client-cancel status", async () => {
    // Exercised on the interceptor directly: the transport's own abort
    // plumbing is not under test here, the interceptor's `finally` arm is.
    const meter = await inMemoryMeter();
    const clock = fakeClock();
    try {
      const interceptor = createRequestMetricsInterceptor(clock.now);
      const next = async () =>
        ({
          stream: true,
          message: (async function* () {
            yield "m1";
            clock.advance(7);
            yield "m2";
            yield "never-pulled";
          })(),
        }) as never;
      const request = {
        service: { typeName: EXECUTION_SERVICE },
        method: { name: "subscribe" },
      } as never;

      const response = (await interceptor(next)(request)) as {
        message: AsyncIterable<string>;
      };
      for await (const message of response.message) {
        if (message === "m2") break; // the consumer goes away
      }

      const collected = await until(
        meter.collect,
        (m) => requestPoints(m).length >= 1,
      );
      expect(requestPoints(collected)).toHaveLength(1);
      expect(requestPoints(collected)[0]!.attributes).toMatchObject({
        "rpc.grpc.status_code": "CANCELLED",
      });
      expect(sumOf(durationPoints(collected)[0]!)).toBe(7);
    } finally {
      await meter.dispose();
    }
  });

  it("is absent from the in-process chain — a hop is not a request", async () => {
    const meter = await inMemoryMeter();
    try {
      const inProcess = createRouterTransport(
        (router) => {
          router.service(AgentCommandController, {
            create: () => create(AgentSchema, VALID_AGENT),
            apply: (request) => request,
            update: (request) => request,
            updateVisibility: () => create(AgentSchema, VALID_AGENT),
            delete: () => create(AgentSchema, VALID_AGENT),
          });
        },
        {
          router: {
            // inprocess.ts's shape: no serving extras.
            interceptors: buildInterceptorChain(
              logger,
              createVerifierChainInterceptor([], [], logger),
            ),
          },
        },
      );

      await createClient(AgentCommandController, inProcess).create(VALID_AGENT);
      // One measured call through a serving chain afterwards, on a
      // DIFFERENT method: records resolve in call order, so once `delete`
      // is exported any record `create` made is already there — the
      // absence is a fact, not a race.
      await createClient(
        AgentCommandController,
        servingTransport({}, fakeClock().now),
      ).delete({ value: "agent-1" });

      const collected = await until(meter.collect, (m) =>
        requestPoints(m).some((p) => p.attributes["rpc.method"] === "delete"),
      );
      expect(
        requestPoints(collected).map((p) => p.attributes["rpc.method"]),
      ).toEqual(["delete"]);
      expect(durationPoints(collected)).toHaveLength(1);
    } finally {
      await meter.dispose();
    }
  });
});

describe("the rpc-metrics registry", () => {
  it("births the count series attribute-less at zero and leaves the histogram untouched", async () => {
    const meter = await inMemoryMeter();
    try {
      await initRpcMetrics();

      const collected = await until(meter.collect, (m) => m.has(COUNT));
      expect(collected.get(COUNT)).toEqual([{ value: 0, attributes: {} }]);
      expect(collected.has(DURATION)).toBe(false);
    } finally {
      await meter.dispose();
    }
  });

  it("resolves instruments lazily — a provider registered after the module loaded receives the records", async () => {
    // The module was imported at the top of this file, long before any
    // provider existed; the API has no proxy meter, so eager instruments
    // would be permanent no-ops. The registry must defer to first use.
    const meter = await inMemoryMeter();
    try {
      const transport = servingTransport({}, fakeClock().now);
      await createClient(AgentCommandController, transport).create(VALID_AGENT);

      const collected = await until(
        meter.collect,
        (m) => requestPoints(m).length >= 1,
      );
      expect(requestPoints(collected)).toHaveLength(1);
    } finally {
      await meter.dispose();
    }
  });

  it("maps every Connect code to grpc-java's status name, byte-exact", () => {
    const expected: Record<Code, string> = {
      [Code.Canceled]: "CANCELLED",
      [Code.Unknown]: "UNKNOWN",
      [Code.InvalidArgument]: "INVALID_ARGUMENT",
      [Code.DeadlineExceeded]: "DEADLINE_EXCEEDED",
      [Code.NotFound]: "NOT_FOUND",
      [Code.AlreadyExists]: "ALREADY_EXISTS",
      [Code.PermissionDenied]: "PERMISSION_DENIED",
      [Code.ResourceExhausted]: "RESOURCE_EXHAUSTED",
      [Code.FailedPrecondition]: "FAILED_PRECONDITION",
      [Code.Aborted]: "ABORTED",
      [Code.OutOfRange]: "OUT_OF_RANGE",
      [Code.Unimplemented]: "UNIMPLEMENTED",
      [Code.Internal]: "INTERNAL",
      [Code.Unavailable]: "UNAVAILABLE",
      [Code.DataLoss]: "DATA_LOSS",
      [Code.Unauthenticated]: "UNAUTHENTICATED",
    };
    for (const [code, name] of Object.entries(expected)) {
      expect(grpcStatusName(Number(code) as Code)).toBe(name);
    }
    expect(Object.keys(expected)).toHaveLength(16);
    expect(GRPC_STATUS_OK).toBe("OK");
    // The naive port — Connect's enum key upper-cased — would say CANCELED.
    expect(Code[Code.Canceled].toUpperCase()).not.toBe(
      grpcStatusName(Code.Canceled),
    );
  });
});

// Type-level pin: the interceptor is a plain Connect Interceptor, so
// chain.ts can hold it where the ruling placed it.
const _typed: Interceptor = createRequestMetricsInterceptor();
void _typed;
