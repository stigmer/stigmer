/**
 * The structured-refusal seam on failedPreconditionError: a reason rides
 * as a google.rpc.ErrorInfo detail beside the byte-pinned message, and
 * reaches a client over a real Connect call. The SDK's getErrorReason
 * reads the detail the same way the round trip below does, so a refusal
 * this helper builds is one a console can branch on. The PermissionDenied
 * twin shares the same detail builder and keeps its own code.
 */
import { create } from "@bufbuild/protobuf";
import {
  Code,
  ConnectError,
  createClient,
  createRouterTransport,
} from "@connectrpc/connect";
import { ErrorInfoSchema } from "@stigmer/apis/google/rpc/error_details_pb";
import { Health, HealthCheckRequestSchema } from "@stigmer/apis/grpc/health/v1/health_pb";
import { describe, expect, it } from "vitest";

import {
  ERROR_REASON_DOMAIN,
  failedPreconditionError,
  permissionDeniedWithReasonError,
  quoteJoin,
} from "../errors.js";

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
      metadata: { feature: "teams", org: "org_1" },
    });

    expect(error.rawMessage).toBe("Teams need the Team plan or above.");
    const [info] = error.findDetails(ErrorInfoSchema);
    expect(info?.reason).toBe("PLAN_UPGRADE_REQUIRED");
    expect(info?.domain).toBe(ERROR_REASON_DOMAIN);
    expect(info?.metadata).toEqual({ feature: "teams", org: "org_1" });
  });

  it("delivers the detail to a client across a Connect call", async () => {
    const transport = createRouterTransport((router) => {
      router.service(Health, {
        check: () => {
          throw failedPreconditionError("A saved payment method is required.", {
            reason: "PAYMENT_METHOD_REQUIRED",
            metadata: { org: "org_2" },
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
    expect(info?.metadata).toEqual({ org: "org_2" });
  });
});

describe("permissionDeniedWithReasonError", () => {
  it("keeps the PermissionDenied code and carries the reason beside the message", () => {
    const error = permissionDeniedWithReasonError("Only listed accounts may do this.", {
      reason: "ORGANIZATION_CREATOR_NOT_LISTED",
      metadata: { account: "ida_0123456789abcdefghjkmnpqrs" },
    });

    expect(error.code).toBe(Code.PermissionDenied);
    expect(error.rawMessage).toBe("Only listed accounts may do this.");
    const [info] = error.findDetails(ErrorInfoSchema);
    expect(info?.reason).toBe("ORGANIZATION_CREATOR_NOT_LISTED");
    expect(info?.domain).toBe(ERROR_REASON_DOMAIN);
    expect(info?.metadata).toEqual({ account: "ida_0123456789abcdefghjkmnpqrs" });
  });
});

describe("quoteJoin", () => {
  it("quotes each name in single quotes, comma-separated", () => {
    expect(quoteJoin(["a", "b c"])).toBe("'a', 'b c'");
  });

  it("renders an empty list as an empty string", () => {
    expect(quoteJoin([])).toBe("");
  });
});
