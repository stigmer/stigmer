/**
 * Interceptor-chain behavior tests, exercised through the REAL stigmer
 * service descriptors over the in-process router transport (the SP-B path,
 * so these tests double as proof that in-process calls get full pipeline
 * treatment — the Go bufconn parity property).
 *
 * Pinned behaviors:
 *   - protovalidate refuses an invalid Agent BEFORE the handler runs,
 *     with InvalidArgument (D2 §2);
 *   - a valid request reaches the handler with the apiresource kind
 *     injected from the service option (interceptor.go parity);
 *   - the logging tiers (grpc lib server.go:295-345): success info,
 *     health success debug, NotFound debug, InvalidArgument warn, other
 *     errors error — and the REAL error message is logged while the wire
 *     carries whatever the handler threw.
 */
import {
  Code,
  ConnectError,
  createClient,
  createRouterTransport,
} from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";
import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentCommandController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/command_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import {
  Health,
  HealthCheckResponse_ServingStatus as ServingStatus,
} from "@stigmer/protos/grpc/health/v1/health_pb";
import { describe, expect, it } from "vitest";

import { createLogger } from "../../boot/logger.js";
import type { LogFields } from "../../boot/logger.js";
import { buildInterceptorChain } from "../chain.js";
import { apiResourceKindKey } from "../interceptors/apiresource.js";

const VALID_AGENT = {
  apiVersion: "agentic.stigmer.ai/v1",
  kind: "Agent",
  metadata: { name: "chain test agent" },
  spec: {
    instructions: "You are a helpful test agent used by interceptor tests.",
  },
} as const;

interface CapturedLine {
  level: string;
  message: string;
  [key: string]: unknown;
}

function testHarness(handlers: {
  create?: (context: { values: { get<T>(key: { id: symbol }): T } }) => unknown;
}) {
  const lines: CapturedLine[] = [];
  const logger = createLogger({
    level: "debug",
    pretty: false,
    write: (line) => lines.push(JSON.parse(line) as CapturedLine),
  });
  const transport = createRouterTransport(
    (router) => {
      router.service(AgentCommandController, {
        create: (request, context) =>
          (handlers.create?.(context) as never) ?? create(AgentSchema, request),
        apply: (request) => request,
        update: (request) => request,
        updateVisibility: () => create(AgentSchema, VALID_AGENT),
        delete: () => create(AgentSchema, VALID_AGENT),
      });
      router.service(Health, {
        check: () => ({ status: ServingStatus.SERVING }),
        list: () => ({ statuses: {} }),
        watch: async function* () {},
      });
    },
    { router: { interceptors: buildInterceptorChain(logger) } },
  );
  return { transport, lines };
}

function rpcLines(lines: CapturedLine[]): CapturedLine[] {
  return lines.filter((line) => line.message.startsWith("rpc"));
}

describe("interceptor chain over the in-process transport", () => {
  it("refuses an invalid Agent with InvalidArgument before the handler runs", async () => {
    let handlerRan = false;
    const { transport, lines } = testHarness({
      create: () => {
        handlerRan = true;
        return create(AgentSchema, VALID_AGENT);
      },
    });

    const failure = await createClient(AgentCommandController, transport)
      .create({})
      .then(() => null)
      .catch((error: unknown) => ConnectError.from(error));

    expect(failure?.code).toBe(Code.InvalidArgument);
    expect(failure?.rawMessage).toContain("api_version");
    expect(handlerRan, "validation must reject at the boundary").toBe(false);

    // InvalidArgument is the client's mistake: warn tier, never error.
    const logged = rpcLines(lines);
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({
      level: "warn",
      message: "rpc client error",
    });
  });

  it("passes a valid Agent through and injects the service's api_resource_kind", async () => {
    let observedKind: ApiResourceKind | undefined;
    const { transport, lines } = testHarness({
      create: (context) => {
        observedKind = context.values.get(apiResourceKindKey);
        return create(AgentSchema, VALID_AGENT);
      },
    });

    await createClient(AgentCommandController, transport).create(VALID_AGENT);

    expect(
      observedKind,
      "AgentCommandController carries option api_resource_kind = agent",
    ).toBe(ApiResourceKind.agent);
    const logged = rpcLines(lines);
    expect(logged[0]).toMatchObject({
      level: "info",
      message: "rpc completed",
    });
  });

  it("logs health-service successes at debug, not info (polled chatter)", async () => {
    const { transport, lines } = testHarness({});

    await createClient(Health, transport).check({});

    const logged = rpcLines(lines);
    expect(logged[0]).toMatchObject({
      level: "debug",
      message: "rpc completed",
      procedure: "/grpc.health.v1.Health/Check",
    });
  });

  it("logs NotFound at debug with the real error message", async () => {
    const { transport, lines } = testHarness({
      create: () => {
        throw new ConnectError('agent "ghost" not found', Code.NotFound);
      },
    });

    const failure = await createClient(AgentCommandController, transport)
      .create(VALID_AGENT)
      .then(() => null)
      .catch((error: unknown) => ConnectError.from(error));

    expect(failure?.code).toBe(Code.NotFound);
    const logged = rpcLines(lines);
    expect(logged[0]).toMatchObject({
      level: "debug",
      message: "rpc returned not found",
    });
    expect(String(logged[0]?.["error"])).toContain('agent "ghost" not found');
  });

  it("logs unexpected failures at error tier", async () => {
    const { transport, lines } = testHarness({
      create: () => {
        throw new Error("sqlite exploded");
      },
    });

    const failure = await createClient(AgentCommandController, transport)
      .create(VALID_AGENT)
      .then(() => null)
      .catch((error: unknown) => ConnectError.from(error));

    // ConnectRPC surfaces an uncaught non-ConnectError as Internal.
    expect(failure?.code).toBe(Code.Internal);
    const logged = rpcLines(lines);
    expect(logged[0]).toMatchObject({ level: "error", message: "rpc failed" });
    expect(String(logged[0]?.["error"])).toContain("sqlite exploded");
  });
});
