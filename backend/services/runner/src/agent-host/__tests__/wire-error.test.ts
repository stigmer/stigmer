/**
 * An error crossing the agent host's pipe (`agent-host/protocol.ts`): a
 * failed turn's cause keeps its chain (each link's name, string code and
 * message, an `AggregateError`'s members), so the runner's failed-turn log
 * can print the network error under it; every other error crosses flat, as
 * it always has, so what the runtime words for the user does not change.
 */
import { describe, expect, it } from "vitest";

import { DEEP_AGENT_CAPABILITIES } from "../../activities/execute-deep-agent/deep-agent-capabilities.js";
import { testConfig } from "../../__test-utils__/config-fixture.js";
import { RecordingTurnSink } from "../../__test-utils__/harness-contract/recording-sink.js";
import { loopbackHostedRow } from "../../__test-utils__/loopback-host.js";
import { turnInputFixture } from "../../__test-utils__/turn-input-fixture.js";
import type { HarnessAdapter, TurnOutcome } from "../../harness/types.js";
import { describeCauseChain } from "../../shared/error-chain.js";
import { MAX_WIRE_CAUSE_LINKS, fromWireError, toWireError, toWireErrorChain, type WireError } from "../protocol.js";

function coded(message: string, code: string | number, name = "Error"): Error {
  const err = Object.assign(new Error(message), { code });
  err.name = name;
  return err;
}

/** An MCP connect that failed on a reset socket, as the runner sees it once the network error is attached. */
function connectFailure(): Error {
  const socket = coded("other side closed", "UND_ERR_SOCKET", "SocketError");
  const fetchFailed = new TypeError("fetch failed", { cause: socket });
  const outer = new Error("Failed to connect to MCP server \"docs\"", { cause: fetchFailed });
  outer.name = "MCPClientError";
  return outer;
}

/** As it crosses: through the pipe's JSON. */
function crossed(wire: WireError): Error {
  return fromWireError(JSON.parse(JSON.stringify(wire)) as WireError);
}

describe("a failed turn's cause on the wire", () => {
  it("crosses with every link's name, string code and message", () => {
    const rebuilt = crossed(toWireErrorChain(connectFailure()));
    expect(describeCauseChain(rebuilt)).toBe(describeCauseChain(connectFailure()));
    expect(rebuilt.name).toBe("MCPClientError");
    expect((rebuilt.cause as Error).cause).toMatchObject({ name: "SocketError", code: "UND_ERR_SOCKET" });
  });

  it("keeps the outermost link's stack and no other", () => {
    const failure = connectFailure();
    const wire = toWireErrorChain(failure);
    expect(wire.stack).toBe(failure.stack);
    expect(wire.cause?.stack).toBeUndefined();
  });

  it("crosses an AggregateError with its members", () => {
    const aggregate = Object.assign(
      new AggregateError([coded("connect ECONNREFUSED ::1:3000", "ECONNREFUSED"), coded("connect ECONNREFUSED 127.0.0.1:3000", "ECONNREFUSED")], ""),
      { code: "ECONNREFUSED" },
    );
    const rebuilt = crossed(toWireErrorChain(new TypeError("fetch failed", { cause: aggregate })));
    expect(rebuilt.cause).toBeInstanceOf(AggregateError);
    expect(describeCauseChain(rebuilt)).toBe(
      "TypeError: fetch failed <- AggregateError ECONNREFUSED [Error ECONNREFUSED: connect ECONNREFUSED ::1:3000; Error ECONNREFUSED: connect ECONNREFUSED 127.0.0.1:3000]",
    );
  });

  it("crosses a cycle's links once, and a cause that is not an error as its string", () => {
    const a = new Error("a");
    const b = new Error("b", { cause: a });
    a.cause = b;
    expect(describeCauseChain(crossed(toWireErrorChain(a)))).toBe("Error: a <- Error: b");
    expect(describeCauseChain(crossed(toWireErrorChain(new Error("outer", { cause: "hang up" }))))).toBe("Error: outer <- Error: hang up");
  });

  it("crosses an AggregateError member that is not an error as its string", () => {
    const rebuilt = crossed(toWireErrorChain(new AggregateError(["refused", coded("reset", "ECONNRESET")], "both failed")));
    expect(describeCauseChain(rebuilt)).toBe("AggregateError: both failed [Error: refused; Error ECONNRESET: reset]");
  });

  it("crosses a value that is not an error as its string", () => {
    expect(describeCauseChain(crossed(toWireErrorChain("boom")))).toBe("Error: boom");
  });

  it("leaves a numeric code behind", () => {
    expect(toWireErrorChain(coded("connect failed", 14, "ConnectError")).code).toBeUndefined();
  });

  it("rebuilds no more than the bound's links from a host that sends more", () => {
    let wire: WireError = { name: "Error", message: "root" };
    for (let link = 0; link < MAX_WIRE_CAUSE_LINKS + 10; link++) wire = { name: "Error", message: `link ${link}`, cause: wire };
    let depth = 0;
    for (let current: unknown = fromWireError(wire); current instanceof Error; current = current.cause) depth++;
    expect(depth).toBe(MAX_WIRE_CAUSE_LINKS);
  });

  it("drops fields of the wrong shape a host sends", () => {
    const hostile = { name: "Error", message: "outer", code: 7, cause: "not a link", errors: "not a list" } as unknown as WireError;
    const rebuilt = crossed(hostile);
    expect(rebuilt).not.toBeInstanceOf(AggregateError);
    expect(rebuilt.cause).toBeUndefined();
    expect((rebuilt as { code?: unknown }).code).toBeUndefined();
  });
});

describe("an error sent flat", () => {
  it("rebuilds flat, as it always has", () => {
    const rebuilt = crossed(toWireError(connectFailure()));
    expect(rebuilt.name).toBe("MCPClientError");
    expect(rebuilt.message).toBe("Failed to connect to MCP server \"docs\"");
    expect(rebuilt.cause).toBeUndefined();
  });
});

describe("a hosted turn", () => {
  function hostedRow(runTurn: HarnessAdapter["runTurn"]): ReturnType<typeof loopbackHostedRow> {
    return loopbackHostedRow({
      harness: "stigmer",
      adapter: {
        name: "wire-error-probe",
        capabilities: DEEP_AGENT_CAPABILITIES,
        boot: async () => {},
        shutdown: async () => {},
        releaseSession: async () => {},
        runTurn,
      },
    });
  }

  it("that failed reaches the runtime with its cause's whole chain", async () => {
    const row = hostedRow(async () => ({ kind: "failed", surface: "engine", message: "the MCP server is unreachable", cause: connectFailure() }));
    await row.adapter.boot(testConfig());
    try {
      const outcome: TurnOutcome = await row.adapter.runTurn(turnInputFixture(), new RecordingTurnSink());
      expect(outcome.kind).toBe("failed");
      const cause = outcome.kind === "failed" ? outcome.cause : undefined;
      expect(describeCauseChain(cause)).toBe(
        "MCPClientError: Failed to connect to MCP server \"docs\" <- TypeError: fetch failed <- SocketError UND_ERR_SOCKET: other side closed",
      );
    } finally {
      await row.adapter.shutdown();
    }
  });

  it("whose adapter threw still reaches the runtime flat", async () => {
    const row = hostedRow(async () => {
      throw connectFailure();
    });
    await row.adapter.boot(testConfig());
    try {
      const thrown = await row.adapter.runTurn(turnInputFixture(), new RecordingTurnSink()).then(
        () => undefined,
        (err: unknown) => err,
      );
      expect(thrown).toBeInstanceOf(Error);
      expect((thrown as Error).name).toBe("MCPClientError");
      expect((thrown as Error).cause).toBeUndefined();
    } finally {
      await row.adapter.shutdown();
    }
  });
});
