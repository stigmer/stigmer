// Unit tests for the channels-domain error projection: the verbatim
// message and status name always; the google.rpc.ErrorInfo reason only
// when the server attached one with a non-empty reason (DD-005 D8 —
// absence means the message alone carries the contract).

import { Code, ConnectError } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import { ErrorInfoSchema } from "@stigmer/protos/google/rpc/error_details_pb";

import { domainError } from "./errors";

function preconditionWith(reason: string): ConnectError {
  return new ConnectError(
    "registry misconfigured",
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
    expect(
      domainError(preconditionWith("WHATSAPP_MANAGEMENT_SCOPE_MISSING")),
    ).toEqual({
      error: "registry misconfigured",
      code: "FAILED_PRECONDITION",
      reason: "WHATSAPP_MANAGEMENT_SCOPE_MISSING",
    });
  });

  it("omits the reason key when the attached ErrorInfo has an empty reason", () => {
    expect(domainError(preconditionWith(""))).toEqual({
      error: "registry misconfigured",
      code: "FAILED_PRECONDITION",
    });
  });

  it("omits the reason key when no ErrorInfo detail is attached", () => {
    const ce = new ConnectError("channel is required", Code.InvalidArgument);
    expect(domainError(ce)).toEqual({
      error: "channel is required",
      code: "INVALID_ARGUMENT",
    });
  });
});
