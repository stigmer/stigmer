// Unit tests for the memory-domain error projection: the verbatim message
// and status name always; the google.rpc.ErrorInfo reason only when the
// server attached one with a non-empty reason (absence means the message
// alone carries the contract — "memory is full" needs no reason code to
// be relayed honestly).

import { Code, ConnectError } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import { ErrorInfoSchema } from "@stigmer/protos/google/rpc/error_details_pb";

import { domainError } from "./errors";

function preconditionWith(reason: string): ConnectError {
  return new ConnectError(
    "memory is disabled for this organization",
    Code.FailedPrecondition,
    undefined,
    [
      {
        desc: ErrorInfoSchema,
        value: create(ErrorInfoSchema, { reason, domain: "stigmer.ai" }),
      },
    ],
  );
}

describe("domainError", () => {
  it("carries the ErrorInfo reason when the server attached one", () => {
    expect(domainError(preconditionWith("MEMORY_DISABLED_FOR_ORG"))).toEqual({
      error: "memory is disabled for this organization",
      code: "FAILED_PRECONDITION",
      reason: "MEMORY_DISABLED_FOR_ORG",
    });
  });

  it("omits the reason key when the attached ErrorInfo has an empty reason", () => {
    expect(domainError(preconditionWith(""))).toEqual({
      error: "memory is disabled for this organization",
      code: "FAILED_PRECONDITION",
    });
  });

  it("omits the reason key when no ErrorInfo detail is attached", () => {
    const ce = new ConnectError(
      "memory content must be 1..500 characters",
      Code.InvalidArgument,
    );
    expect(domainError(ce)).toEqual({
      error: "memory content must be 1..500 characters",
      code: "INVALID_ARGUMENT",
    });
  });
});
