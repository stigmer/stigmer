/**
 * Spike SP-B (D2 spike register): `createRouterTransport` traverses the
 * FULL interceptor chain on in-process calls.
 *
 * Why this matters: Go serves internal calls (project reconcile deletes,
 * cascades, schedule RunStarter creates) through the same *grpc.Server over
 * an in-memory bufconn precisely so validation parity holds — an internal
 * call is validated exactly like an external one. The TS equivalent is
 * ConnectRPC's router transport; these tests verify the properties the
 * design depends on BEFORE the composition root is built on them:
 *
 *   1. every interceptor runs for an in-process call,
 *   2. in registration order (outermost first — the chain contract),
 *   3. an interceptor rejection short-circuits with a ConnectError the
 *      caller sees (how protovalidate will refuse invalid internal writes).
 *
 * A failure here is a protocol surprise (collaboration protocol): the
 * fallback (a bufconn-equivalent in-memory HTTP pair) is an OWNER decision.
 */
import {
  Code,
  ConnectError,
  createClient,
  createRouterTransport,
} from "@connectrpc/connect";
import type { Interceptor } from "@connectrpc/connect";
import {
  Health,
  HealthCheckResponse_ServingStatus,
} from "@stigmer/protos/grpc/health/v1/health_pb";
import { describe, expect, it } from "vitest";

function recordingInterceptor(name: string, log: string[]): Interceptor {
  return (next) => async (req) => {
    log.push(`${name}:before`);
    const response = await next(req);
    log.push(`${name}:after`);
    return response;
  };
}

describe("SP-B: interceptors traverse createRouterTransport in-process calls", () => {
  it("runs every interceptor, in registration order, around the handler", async () => {
    const log: string[] = [];
    const transport = createRouterTransport(
      (router) => {
        router.service(Health, {
          check: () => {
            log.push("handler");
            return { status: HealthCheckResponse_ServingStatus.SERVING };
          },
          list: () => ({ statuses: {} }),
          watch: async function* () {},
        });
      },
      {
        router: {
          interceptors: [
            recordingInterceptor("first", log),
            recordingInterceptor("second", log),
          ],
        },
      },
    );

    const response = await createClient(Health, transport).check({});

    expect(response.status).toBe(HealthCheckResponse_ServingStatus.SERVING);
    expect(log).toEqual([
      "first:before",
      "second:before",
      "handler",
      "second:after",
      "first:after",
    ]);
  });

  it("surfaces an interceptor rejection to the in-process caller as a ConnectError", async () => {
    const log: string[] = [];
    const rejecting: Interceptor = () => () => {
      throw new ConnectError("refused by the chain", Code.InvalidArgument);
    };
    const transport = createRouterTransport(
      (router) => {
        router.service(Health, {
          check: () => {
            log.push("handler");
            return { status: HealthCheckResponse_ServingStatus.SERVING };
          },
          list: () => ({ statuses: {} }),
          watch: async function* () {},
        });
      },
      { router: { interceptors: [rejecting] } },
    );

    const failure = await createClient(Health, transport)
      .check({})
      .then(() => null)
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ConnectError);
    expect((failure as ConnectError).code).toBe(Code.InvalidArgument);
    expect(log, "the handler never ran — the chain short-circuited").toEqual(
      [],
    );
  });
});
