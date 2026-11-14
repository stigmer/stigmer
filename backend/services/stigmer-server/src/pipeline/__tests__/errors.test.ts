/**
 * The structured-refusal seam on failedPreconditionError: a reason rides
 * as a google.rpc.ErrorInfo detail beside the byte-pinned message, and
 * reaches a client over a real Connect call. The SDK's getErrorReason
 * reads the detail the same way the round trip below does, so a refusal
 * this helper builds is one a console can branch on. The PermissionDenied
 * twin shares the same detail builder and keeps its own code.
 *
 * And internalError's one code exception (stigmer/stigmer#3086): a
 * database that could not hand out a connection, found anywhere in the
 * cause chain, is Unavailable with the caller's copy and the cause kept;
 * every other cause stays Internal.
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

import { DatabaseUnavailableError } from "../../store/interface.js";
import {
  ERROR_REASON_DOMAIN,
  failedPreconditionError,
  internalError,
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

describe("internalError", () => {
  const unavailable = () =>
    new DatabaseUnavailableError("the connection pool could not hand out a connection", {
      cause: new Error("timeout exceeded when trying to connect"),
    });

  it("is Internal with only the caller's copy for any other cause", () => {
    const cause = new Error("database is locked");
    const error = internalError(cause, "failed to load agent");
    expect(error.code).toBe(Code.Internal);
    expect(error.rawMessage).toBe("failed to load agent");
    expect(error.cause).toBe(cause);
    expect(internalError("a string", "failed to load agent").code).toBe(Code.Internal);
  });

  it("is Unavailable with the same copy when the cause is a DatabaseUnavailableError", () => {
    const cause = unavailable();
    const error = internalError(cause, "failed to load agent");
    expect(error.code).toBe(Code.Unavailable);
    expect(error.rawMessage).toBe("failed to load agent");
    expect(error.cause).toBe(cause);
  });

  it("finds it under wrappers: a step's { cause } and an earlier internalError", () => {
    const wrapped = new Error("load failed", { cause: unavailable() });
    expect(internalError(wrapped, "failed to load agent").code).toBe(Code.Unavailable);
    const rewrapped = internalError(internalError(wrapped, "inner"), "outer");
    expect(rewrapped.code).toBe(Code.Unavailable);
    expect(rewrapped.rawMessage).toBe("outer");
  });

  it("never puts the pool's numbers on the wire", () => {
    const error = internalError(unavailable(), "failed to load agent");
    expect(error.message).not.toContain("pool");
  });
});
