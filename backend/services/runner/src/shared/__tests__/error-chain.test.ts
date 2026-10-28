/**
 * An error's cause chain (`../error-chain.ts`): walked outermost first, each
 * error once, and printed on one line with each link's name, string code and
 * message, an `AggregateError`'s members, repeated wrappers dropped and the
 * whole line capped.
 */

import { describe, expect, it } from "vitest";

import { MAX_CAUSE_CHAIN_CHARS, causeChainOf, describeCauseChain } from "../error-chain.js";

function coded(message: string, code: string | number, name = "Error"): Error {
  const err = Object.assign(new Error(message), { code });
  err.name = name;
  return err;
}

describe("causeChainOf", () => {
  it("lists the error and its causes, outermost first", () => {
    const root = new Error("root");
    const middle = new Error("middle", { cause: root });
    const outer = new Error("outer", { cause: middle });
    expect(causeChainOf(outer)).toEqual([outer, middle, root]);
  });

  it("ends a cycle at the first error seen twice", () => {
    const a = new Error("a");
    const b = new Error("b", { cause: a });
    a.cause = b;
    expect(causeChainOf(a)).toEqual([a, b]);
  });

  it("holds nothing for a value that is not an error", () => {
    expect(causeChainOf("boom")).toEqual([]);
  });
});

describe("describeCauseChain", () => {
  it("prints one link as its name and message", () => {
    expect(describeCauseChain(new TypeError("fetch failed"))).toBe("TypeError: fetch failed");
  });

  it("prints every link with its string code, outermost first", () => {
    const socket = coded("other side closed", "UND_ERR_SOCKET", "SocketError");
    const fetchFailed = new TypeError("fetch failed", { cause: socket });
    const outer = new Error("Failed to connect to server", { cause: fetchFailed });
    outer.name = "MCPClientError";
    expect(describeCauseChain(outer)).toBe(
      "MCPClientError: Failed to connect to server <- TypeError: fetch failed <- SocketError UND_ERR_SOCKET: other side closed",
    );
  });

  it("leaves a numeric code out", () => {
    expect(describeCauseChain(coded("connect failed", 14, "ConnectError"))).toBe("ConnectError: connect failed");
  });

  it("prints an AggregateError's members after its link", () => {
    const aggregate = Object.assign(
      new AggregateError(
        [coded("connect ECONNREFUSED ::1:80", "ECONNREFUSED"), coded("connect ECONNREFUSED 127.0.0.1:80", "ECONNREFUSED")],
        "",
      ),
      { code: "ECONNREFUSED" },
    );
    const outer = new TypeError("fetch failed", { cause: aggregate });
    expect(describeCauseChain(outer)).toBe(
      "TypeError: fetch failed <- AggregateError ECONNREFUSED [Error ECONNREFUSED: connect ECONNREFUSED ::1:80; Error ECONNREFUSED: connect ECONNREFUSED 127.0.0.1:80]",
    );
  });

  it("drops a link that repeats the one above it", () => {
    const root = coded("read ECONNRESET", "ECONNRESET");
    let current: Error = new Error("model call failed", { cause: root });
    for (let wrap = 0; wrap < 12; wrap++) {
      const wrapper = new Error("model call failed", { cause: current });
      current = wrapper;
    }
    expect(describeCauseChain(current)).toBe("Error: model call failed <- Error ECONNRESET: read ECONNRESET");
  });

  it("prints a cycle's links once", () => {
    const a = new Error("a");
    const b = new Error("b", { cause: a });
    a.cause = b;
    expect(describeCauseChain(a)).toBe("Error: a <- Error: b");
  });

  it("ends with a cause that is not an error as its string", () => {
    expect(describeCauseChain(new Error("outer", { cause: "socket hang up" }))).toBe("Error: outer <- socket hang up");
    expect(describeCauseChain(42)).toBe("42");
  });

  it("caps the line and marks the cut", () => {
    let current: Error = new Error("root");
    for (let link = 0; link < 200; link++) current = new Error(`wrapper ${link} ${"x".repeat(40)}`, { cause: current });
    const line = describeCauseChain(current);
    expect(line.length).toBeLessThanOrEqual(MAX_CAUSE_CHAIN_CHARS);
    expect(line.startsWith("Error: wrapper 199 ")).toBe(true);
    expect(line.endsWith(" …[cut]")).toBe(true);
  });
});
