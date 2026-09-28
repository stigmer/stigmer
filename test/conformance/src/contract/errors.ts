// gRPC error-code assertions for the conformance contract.
// Domain: conformance contract.
import { setTimeout as delay } from "node:timers/promises";

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

// Runs an RPC that must fail and returns its gRPC code WITHOUT asserting it,
// so a caller can observe several lanes and assert them together — an
// expectGrpcCode chain aborts at the first mismatch and hides every lane
// after it. Fails loudly if the call unexpectedly succeeds.
export async function grpcCodeOf(op: () => Promise<unknown>, context: string): Promise<Code> {
  try {
    await op();
  } catch (err) {
    return ConnectError.from(err).code;
  }
  throw new Error(`${context}: expected the call to fail but it succeeded`);
}

// How long an authorization answer may trail a role change. An engine that
// caches checks (the cloud's OpenFGA keeps its check cache for 10 s) can
// answer from before the change for up to that long, so a refusal that must
// follow a demotion is awaited, never slept for.
export const AUTHORIZATION_CHANGE_TIMEOUT_MS = 30_000;
const AUTHORIZATION_CHANGE_POLL_MS = 500;

// Asserts that an RPC comes to fail with `expected` within `timeoutMs`,
// retrying while it still succeeds or fails with another code. Returns the
// ConnectError of the first matching attempt. For a contract that holds
// only once an authorization change has propagated; everything else uses
// expectGrpcCode.
export async function expectGrpcCodeWithin(
  op: () => Promise<unknown>,
  expected: Code,
  context: string,
  timeoutMs: number = AUTHORIZATION_CHANGE_TIMEOUT_MS,
): Promise<ConnectError> {
  const deadline = Date.now() + timeoutMs;
  let last = "no attempt";
  for (;;) {
    try {
      await op();
      last = "the call succeeded";
    } catch (err) {
      const connectErr = ConnectError.from(err);
      if (connectErr.code === expected) return connectErr;
      last = `gRPC ${Code[connectErr.code]} (${connectErr.message})`;
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `${context}: expected gRPC ${Code[expected]} within ${timeoutMs} ms, but the last attempt answered ${last}`,
      );
    }
    await delay(AUTHORIZATION_CHANGE_POLL_MS);
  }
}
