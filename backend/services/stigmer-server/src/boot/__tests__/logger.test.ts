/**
 * Pins the logger mechanism: threshold filtering, structured fields in the
 * NDJSON shape, pretty output for ENV=local, the unknown-level → info
 * fallback, and the sink seam — the structured entry a deployable's
 * exporter receives after the line is written, only for lines that passed
 * the threshold, with the written output untouched. The per-RPC level
 * TIERING contract is asserted in the logging interceptor's tests, not here.
 */
import { describe, expect, it } from "vitest";

import { createLogger, type LogEntry } from "../logger.js";

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
    expect(JSON.parse(lines[0]!)).toMatchObject({
      level: "warn",
      message: "w",
    });
    expect(JSON.parse(lines[1]!)).toMatchObject({
      level: "error",
      message: "e",
    });
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

  describe("sink", () => {
    it("receives the structured entry for every line that passed the threshold, and nothing below it", () => {
      const { write } = capture();
      const entries: LogEntry[] = [];
      const logger = createLogger({
        level: "warn",
        pretty: false,
        write,
        sink: (entry) => entries.push(entry),
      });

      logger.info("below");
      logger.warn("at", { code: 7 });
      logger.error("above");

      expect(entries.map((entry) => entry.level)).toEqual(["warn", "error"]);
      expect(entries[0]).toMatchObject({ message: "at", fields: { code: 7 } });
      expect(entries[0]!.time).toBeInstanceOf(Date);
      expect(entries[1]!.fields).toBeUndefined();
    });

    it("hands the sink the same instant the written line carries", () => {
      const { lines, write } = capture();
      const entries: LogEntry[] = [];
      const logger = createLogger({
        level: "info",
        pretty: false,
        write,
        sink: (entry) => entries.push(entry),
      });

      logger.info("stamped");

      const written = JSON.parse(lines[0]!) as { time: string };
      expect(entries[0]!.time.toISOString()).toBe(written.time);
    });

    it("leaves the written output unchanged in both shapes when a sink is present", () => {
      const ndjson = capture();
      const pretty = capture();
      const sink = (): void => {};
      createLogger({
        level: "info",
        pretty: false,
        write: ndjson.write,
        sink,
      }).info("rpc completed", { code: "ok" });
      createLogger({
        level: "info",
        pretty: true,
        write: pretty.write,
        sink,
      }).warn("something odd", { detail: 7 });

      expect(JSON.parse(ndjson.lines[0]!)).toMatchObject({
        level: "info",
        message: "rpc completed",
        code: "ok",
      });
      expect(pretty.lines[0]).toMatch(/WARN {2}something odd \{"detail":7\}$/);
    });

    it("writes the line before it calls the sink", () => {
      const order: string[] = [];
      const logger = createLogger({
        level: "info",
        pretty: false,
        write: () => order.push("write"),
        sink: () => order.push("sink"),
      });

      logger.info("ordered");

      expect(order).toEqual(["write", "sink"]);
    });
  });
});
