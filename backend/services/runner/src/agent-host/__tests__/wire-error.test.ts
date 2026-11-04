/**
 * An error crossing the agent host's pipe (`agent-host/protocol.ts`): a
 * failed turn's cause and a thrown adapter error keep their chain (each
 * link's class, name, string code and message, an `AggregateError`'s
 * members), so the runner's failed-turn log can print the network error
 * under a cause, and the runtime words a thrown error for the user exactly
 * as it would have in the runner's own process. A failed call's error
 * crosses flat, with its class. A class name the host sends is read by
 * shape: anything but a plain identifier rebuilds as the base class.
 */
import { describe, expect, it } from "vitest";

import { DEEP_AGENT_CAPABILITIES } from "../../activities/execute-deep-agent/deep-agent-capabilities.js";
import { testConfig } from "../../__test-utils__/config-fixture.js";
import { RecordingTurnSink } from "../../__test-utils__/harness-contract/recording-sink.js";
import { loopbackHostedRow } from "../../__test-utils__/loopback-host.js";
import { turnInputFixture } from "../../__test-utils__/turn-input-fixture.js";
import type { HarnessAdapter, TurnOutcome } from "../../harness/types.js";
import { describeCauseChain } from "../../shared/error-chain.js";
import { describeExecutionError } from "../../shared/model-error.js";
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

/** The MCP adapter's connect error, a class of its own as the adapter's is. */
class MCPClientError extends Error {
  override name = "MCPClientError";
}

/** Undici's socket error, a class of its own whose name it sets. */
class SocketError extends Error {
  override name = "SocketError";
  readonly code = "UND_ERR_SOCKET";
}

/** A connect that failed on a reset socket, with every link its own class, as an engine meets it in process. */
function classedConnectFailure(): Error {
  const fetchFailed = new TypeError("fetch failed", { cause: new SocketError("other side closed") });
  return new MCPClientError("Failed to connect to MCP server \"docs\"", { cause: fetchFailed });
}

/** Each link's class name, outermost first. */
function classesOf(err: unknown): string[] {
  const names: string[] = [];
  for (let current: unknown = err; current instanceof Error; current = current.cause) names.push(current.constructor.name);
  return names;
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

describe("an error's class on the wire", () => {
  it("crosses for every link, and the rebuilt link is an instance of a class of that name", () => {
    const rebuilt = crossed(toWireErrorChain(classedConnectFailure()));
    expect(classesOf(rebuilt)).toEqual(["MCPClientError", "TypeError", "SocketError"]);
    expect(rebuilt).toBeInstanceOf(Error);
    expect((rebuilt.cause as Error).cause).toMatchObject({ name: "SocketError", code: "UND_ERR_SOCKET" });
  });

  it("crosses for an AggregateError and each of its members", () => {
    class ConnectRefusedError extends Error {}
    class FetchAggregateError extends AggregateError {}
    const aggregate = new FetchAggregateError([new ConnectRefusedError("connect ECONNREFUSED ::1:3000"), new Error("plain")], "");
    const rebuilt = crossed(toWireErrorChain(new TypeError("fetch failed", { cause: aggregate })));
    expect(rebuilt.cause).toBeInstanceOf(AggregateError);
    expect((rebuilt.cause as Error).constructor.name).toBe("FetchAggregateError");
    expect((rebuilt.cause as AggregateError).errors.map((member: Error) => member.constructor.name)).toEqual(["ConnectRefusedError", "Error"]);
  });

  it("rebuilds a plain Error as a plain Error, so a reader testing `constructor === Error` reads it as in process", () => {
    const rebuilt = crossed(toWireErrorChain(new Error("plain", { cause: new TypeError("inner") })));
    expect(rebuilt.constructor).toBe(Error);
    expect((rebuilt.cause as Error).constructor.name).toBe("TypeError");
  });

  it("rebuilds as the base class when a host sends a class name that is not a plain identifier", () => {
    const hostile: unknown[] = [7, "", "not an identifier", "a.b", "__proto__", "x".repeat(129), "1abc", "Error\u2028"];
    for (const className of hostile) {
      const rebuilt = crossed({ name: "Probe", message: "m", className } as unknown as WireError);
      expect(rebuilt.constructor).toBe(Error);
      expect(rebuilt.name).toBe("Probe");
    }
    const aggregate = crossed({ name: "AggregateError", message: "", className: "__proto__", errors: [{ name: "Error", message: "m" }] } as unknown as WireError);
    expect(aggregate.constructor).toBe(AggregateError);
  });
});

describe("an error sent flat", () => {
  it("rebuilds flat, as it always has, with its class", () => {
    const rebuilt = crossed(toWireError(classedConnectFailure()));
    expect(rebuilt.constructor.name).toBe("MCPClientError");
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

  async function thrownBy(failure: () => Error): Promise<unknown> {
    const row = hostedRow(async () => {
      throw failure();
    });
    await row.adapter.boot(testConfig());
    try {
      return await row.adapter.runTurn(turnInputFixture(), new RecordingTurnSink()).then(
        () => undefined,
        (err: unknown) => err,
      );
    } finally {
      await row.adapter.shutdown();
    }
  }

  it("whose adapter threw reaches the runtime with its whole chain and each link's class", async () => {
    const thrown = await thrownBy(classedConnectFailure);
    expect(thrown).toBeInstanceOf(Error);
    expect(describeCauseChain(thrown)).toBe(describeCauseChain(classedConnectFailure()));
    expect(classesOf(thrown)).toEqual(["MCPClientError", "TypeError", "SocketError"]);
  });

  it("whose adapter threw is worded for the user as it would be in the runner's own process", async () => {
    const thrown = await thrownBy(classedConnectFailure);
    const ctx = { proxyMode: false };
    expect(describeExecutionError(thrown, ctx)).toEqual(describeExecutionError(classedConnectFailure(), ctx));
    expect(describeExecutionError(thrown, ctx).errorType).toBe("MCPClientError");
  });
});
