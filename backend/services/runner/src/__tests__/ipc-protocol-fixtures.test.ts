import { describe, it, expect } from "vitest";
import committed from "../../fixtures/ipc-protocol.generated.json" with { type: "json" };
import { IPC_PROTOCOL_VERSION, buildReadyMessage } from "../ipc-protocol.js";
import { buildFixtures } from "../ipc-protocol-fixtures.js";

/**
 * The TS side of the golden-fixture conformance suite. Its job is narrow and honest: keep
 * the committed artifact fresh and bind the runtime `ready` builder to it. The cross-
 * language contract assurance comes from the Rust and Go mirrors asserting against the same
 * committed file — see crates/stigmer-runner-host/src/protocol.rs and
 * test/integration/harness/ipc_fixtures_test.go.
 */
describe("ipc-protocol golden fixtures", () => {
  it("matches the committed artifact (regenerate with `make gen-ipc-fixtures` if this fails)", () => {
    expect(committed).toEqual(buildFixtures());
  });

  it("sources the `ready` fixture from the real builder", () => {
    expect(buildFixtures().responses.ready).toEqual(buildReadyMessage());
  });

  it("advertises the crate-shared integer protocol version", () => {
    expect(buildFixtures().ipcProtocolVersion).toBe(IPC_PROTOCOL_VERSION);
    expect(Number.isInteger(IPC_PROTOCOL_VERSION)).toBe(true);
  });

  it("covers every command and response in the contract", () => {
    const { commands, responses } = buildFixtures();
    // Locks the catalog so a new message cannot be added to ipc-protocol.ts without a
    // fixture — the mirrors would otherwise have nothing to conform against.
    expect(Object.keys(commands).sort()).toEqual([
      "addSession",
      "addWorkflowExecution",
      "removeSession",
      "removeWorkflowExecution",
      "shutdown",
      "updateTokenCleared",
      "updateTokenSet",
    ]);
    expect(Object.keys(responses).sort()).toEqual([
      "error",
      "ready",
      "readyLegacy",
      "sessionAdded",
      "sessionRemoved",
      "shutdownComplete",
      "tokenUpdated",
      "workflowExecutionAdded",
      "workflowExecutionRemoved",
    ]);
  });

  it("encodes the token set/clear distinction the wire depends on", () => {
    const { commands } = buildFixtures();
    expect(commands.updateTokenSet.token).toBe("tok_example");
    // `null` is the canonical "clear the token" shape; absence is a host quirk, not the
    // contract. The Rust and Go mirrors are checked against this exact value.
    expect(commands.updateTokenCleared.token).toBeNull();
  });

  it("keeps a legacy `ready` without a protocolVersion for backward-compat hosts", () => {
    const { readyLegacy } = buildFixtures().responses;
    expect(readyLegacy).toEqual({ type: "ready" });
    expect("protocolVersion" in readyLegacy).toBe(false);
  });
});
