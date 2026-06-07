import { describe, it, expect } from "vitest";
import { IPC_PROTOCOL_VERSION, buildReadyMessage } from "../ipc-protocol.js";

/**
 * Locks the wire shape of the `ready` handshake. Hosts (runner.rs, unified_runner.go, and
 * external embedders) read `protocolVersion` to decide compatibility, so a silent change to
 * its value or type is a breaking protocol change — these assertions make that change loud.
 */
describe("ipc-protocol ready handshake", () => {
  it("advertises an integer protocol version", () => {
    expect(IPC_PROTOCOL_VERSION).toBe(1);
    expect(Number.isInteger(IPC_PROTOCOL_VERSION)).toBe(true);
  });

  it("builds the exact ready message the host expects", () => {
    expect(buildReadyMessage()).toEqual({
      type: "ready",
      protocolVersion: IPC_PROTOCOL_VERSION,
    });
  });

  it("emits protocolVersion as a number, not a string", () => {
    expect(typeof buildReadyMessage().protocolVersion).toBe("number");
  });

  it("carries exactly the type and protocolVersion fields", () => {
    expect(Object.keys(buildReadyMessage()).sort()).toEqual([
      "protocolVersion",
      "type",
    ]);
  });
});
