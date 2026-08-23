/**
 * Pins the logger mechanism: threshold filtering, structured fields in the
 * NDJSON shape, pretty output for ENV=local, and the unknown-level → info
 * fallback. The per-RPC level TIERING contract is asserted in the logging
 * interceptor's tests, not here.
 */
import { describe, expect, it } from "vitest";

import { createLogger } from "../logger.js";

function capture(): { lines: string[]; write: (line: string) => void } {
  const lines: string[] = [];
  return { lines, write: (line) => lines.push(line) };
}

describe("createLogger", () => {
  it("drops entries below the threshold", () => {
    const { lines, write } = capture();
    const logger = createLogger({ level: "warn", pretty: false, write });

    logger.debug("d");
    logger.info("i");
    logger.warn("w");
    logger.error("e");

    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!)).toMatchObject({ level: "warn", message: "w" });
    expect(JSON.parse(lines[1]!)).toMatchObject({ level: "error", message: "e" });
  });

  it("emits NDJSON with structured fields merged at the top level", () => {
    const { lines, write } = capture();
    const logger = createLogger({ level: "info", pretty: false, write });

    logger.info("rpc completed", { procedure: "/x.Y/z", code: "ok" });

    const entry = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(entry["message"]).toBe("rpc completed");
    expect(entry["procedure"]).toBe("/x.Y/z");
    expect(entry["code"]).toBe("ok");
    expect(typeof entry["time"]).toBe("string");
  });

  it("renders human-readable lines in pretty mode", () => {
    const { lines, write } = capture();
    const logger = createLogger({ level: "info", pretty: true, write });

    logger.warn("something odd", { detail: 7 });

    expect(lines[0]).toMatch(/WARN {2}something odd \{"detail":7\}$/);
  });

  it("treats an unknown level string as info (never silently mute a server)", () => {
    const { lines, write } = capture();
    const logger = createLogger({ level: "verbose", pretty: false, write });

    logger.debug("hidden");
    logger.info("visible");

    expect(lines).toHaveLength(1);
  });
});
