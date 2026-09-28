/**
 * The structured-refusal seam on failedPreconditionError: a reason rides
 * as a google.rpc.ErrorInfo detail beside the byte-pinned message, and
 * reaches a client over a real Connect call. The SDK's getErrorReason
 * reads the detail the same way the round trip below does, so a refusal
 * this helper builds is one a console can branch on.
 */
import { create } from "@bufbuild/protobuf";
import {
  Code,
  ConnectError,
  createClient,
  createRouterTransport,
} from "@connectrpc/connect";
import { ErrorInfoSchema } from "@stigmer/protos/google/rpc/error_details_pb";
import { Health, HealthCheckRequestSchema } from "@stigmer/protos/grpc/health/v1/health_pb";
import { describe, expect, it } from "vitest";

import { ERROR_REASON_DOMAIN, failedPreconditionError } from "../errors.js";

describe("failedPreconditionError", () => {
  it("carries no detail without a reason", () => {
    const error = failedPreconditionError("Add a payment method first.");

    expect(error.code).toBe(Code.FailedPrecondition);
    expect(error.rawMessage).toBe("Add a payment method first.");
    expect(error.findDetails(ErrorInfoSchema)).toEqual([]);
  });

  it("attaches the reason as an ErrorInfo detail and leaves the message as written", () => {
    const error = failedPreconditionError("Teams need the Team plan or above.", {
      reason: "PLAN_UPGRADE_REQUIRED",
      metadata: { feature: "teams", org_id: "org_1" },
    });

    expect(error.rawMessage).toBe("Teams need the Team plan or above.");
    const [info] = error.findDetails(ErrorInfoSchema);
    expect(info?.reason).toBe("PLAN_UPGRADE_REQUIRED");
    expect(info?.domain).toBe(ERROR_REASON_DOMAIN);
    expect(info?.metadata).toEqual({ feature: "teams", org_id: "org_1" });
  });

  it("delivers the detail to a client across a Connect call", async () => {
    const transport = createRouterTransport((router) => {
      router.service(Health, {
        check: () => {
          throw failedPreconditionError("A saved payment method is required.", {
            reason: "PAYMENT_METHOD_REQUIRED",
            metadata: { org_id: "org_2" },
          });
        },
        list: () => ({ statuses: {} }),
        watch: async function* () {},
      });
    });
    const client = createClient(Health, transport);

    const caught = await client.check(create(HealthCheckRequestSchema)).then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(caught).toBeInstanceOf(ConnectError);
    const error = caught as ConnectError;
    expect(error.code).toBe(Code.FailedPrecondition);
    expect(error.rawMessage).toBe("A saved payment method is required.");
    const [info] = error.findDetails(ErrorInfoSchema);
    expect(info?.reason).toBe("PAYMENT_METHOD_REQUIRED");
    expect(info?.domain).toBe(ERROR_REASON_DOMAIN);
    expect(info?.metadata).toEqual({ org_id: "org_2" });
  });
});
