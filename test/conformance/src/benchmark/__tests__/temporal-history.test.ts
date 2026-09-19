// Unit arms for the Temporal history reader, over a fixture in the CLI's
// proto-JSON rendering (`temporal version 1.5.1`, `workflow show --output
// json`, captured 2026-09-19: enum-named `eventType`, `eventTime` per event,
// started/completed events pointing at their scheduled event).
// Domain: conformance benchmark.
//
// Pinned: the reader picks the EXECUTE activity's start, not the EnsureThread
// hop's; EnsureThread's own duration is read scheduled-to-completed; a history
// without the asked-for activity yields null, never zero; a body without an
// events array is refused by name.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  executeActivityNameFor,
  historyAxes,
  invokeWorkflowIdFor,
  readWorkflowHistory,
} from "../temporal-history";

const fixture = readWorkflowHistory(
  JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", "invoke-history.json"), "utf8")),
);

describe("historyAxes", () => {
  it("measures the workflow's start to the execute activity's start, skipping the EnsureThread hop", () => {
    const axes = historyAxes(fixture, executeActivityNameFor("deep-agent"));
    // 18:00:00.000 -> 18:00:00.900: the execute activity, not EnsureThread's 0.120 start.
    expect(axes.before_activity_ms).toBe(900);
  });

  it("reads EnsureThread scheduled-to-completed as its own segment, at millisecond grain", () => {
    const axes = historyAxes(fixture, executeActivityNameFor("deep-agent"));
    // 18:00:00.0505 -> 18:00:00.350; the CLI prints microseconds, the reader keeps milliseconds.
    expect(axes.ensure_thread_ms).toBe(300);
  });

  it("yields null, never zero, when the asked-for activity never started", () => {
    const axes = historyAxes(fixture, executeActivityNameFor("cursor"));
    expect(axes.before_activity_ms).toBeNull();
    expect(axes.ensure_thread_ms).toBe(300);
  });
});

describe("the wire names", () => {
  it("builds the invoke workflow id the server's names module pins", () => {
    expect(invokeWorkflowIdFor("aex_fixture")).toBe("stigmer/agent-execution/invoke/aex_fixture");
  });

  it("maps each harness label to its runner activity", () => {
    expect(executeActivityNameFor("deep-agent")).toBe("ExecuteDeepAgent");
    expect(executeActivityNameFor("cursor")).toBe("ExecuteCursor");
  });
});

describe("readWorkflowHistory", () => {
  it("refuses a body without an events array by name", () => {
    expect(() => readWorkflowHistory({ nope: [] })).toThrow("expected an object with an events array");
  });
});
