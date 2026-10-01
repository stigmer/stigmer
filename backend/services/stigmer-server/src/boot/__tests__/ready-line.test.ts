/**
 * Pins the ready line a spawning harness reads the bound ports from
 * (stigmer#1469): nothing is written unless the operator asked; when asked,
 * exactly one newline-terminated JSON line under the namespaced key carries
 * both ports, a lane that never bound as null; and a request before the
 * ports are known is refused rather than printed.
 */
import { describe, expect, it } from "vitest";

import { announceReady, READY_LINE_KEY } from "../ready-line.js";

function capture(): { lines: string[]; write: (line: string) => void } {
  const lines: string[] = [];
  return { lines, write: (line) => lines.push(line) };
}

describe("announceReady", () => {
  it("writes nothing when the operator did not ask", () => {
    const out = capture();
    announceReady(undefined, { grpc: 51234, artifactHttp: 51235 }, out.write);
    announceReady(undefined, undefined, out.write);
    expect(out.lines).toEqual([]);
  });

  it("writes one JSON line carrying both bound ports", () => {
    const out = capture();
    announceReady("stdout", { grpc: 51234, artifactHttp: 51235 }, out.write);
    expect(out.lines).toHaveLength(1);
    const [line] = out.lines;
    expect(line).toBe(
      '{"stigmerServerReady":{"grpcPort":51234,"artifactHttpPort":51235}}\n',
    );
    expect(JSON.parse(line!)).toEqual({
      [READY_LINE_KEY]: { grpcPort: 51234, artifactHttpPort: 51235 },
    });
  });

  it("reports an artifact lane that never bound as null", () => {
    const out = capture();
    announceReady(
      "stdout",
      { grpc: 51234, artifactHttp: undefined },
      out.write,
    );
    expect(JSON.parse(out.lines[0]!)).toEqual({
      [READY_LINE_KEY]: { grpcPort: 51234, artifactHttpPort: null },
    });
  });

  it("refuses a request made before the server bound its ports", () => {
    const out = capture();
    expect(() => announceReady("stdout", undefined, out.write)).toThrow(
      "the ready line was requested before the server bound its ports",
    );
    expect(out.lines).toEqual([]);
  });
});
