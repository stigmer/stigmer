// gRPC error-code assertions for the conformance contract.
// Domain: conformance contract.
import { Code, ConnectError } from "@connectrpc/connect";
import { expect } from "vitest";

// Asserts that an RPC fails with a specific gRPC code. Returns the ConnectError
// so callers can make further assertions on the message. Fails loudly if the
// call unexpectedly succeeds.
export async function expectGrpcCode(
  op: () => Promise<unknown>,
  expected: Code,
  context: string,
): Promise<ConnectError> {
  try {
    await op();
  } catch (err) {
    const connectErr = ConnectError.from(err);
    expect(
      connectErr.code,
      `${context}: expected gRPC ${Code[expected]} but got ${Code[connectErr.code]} (${connectErr.message})`,
    ).toBe(expected);
    return connectErr;
  }
  throw new Error(`${context}: expected gRPC ${Code[expected]} but the call succeeded`);
}
