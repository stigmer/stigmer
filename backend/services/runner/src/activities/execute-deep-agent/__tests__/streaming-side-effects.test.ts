/**
 * `StreamingSideEffects`: the v3 `tools` events carry the tool INPUT on
 * `tool-started` and the OUTPUT on `tool-finished`, so the trigger correlates
 * the two by `tool_call_id` and publishes a file-modifying tool's target path
 * once the call has finished.
 *
 * Carried from the legacy v3 loop's suite (`streaming-v3.test.ts`, retired
 * with the loop at S3 M2b) — the trigger itself never had a test of its own.
 */

import { describe, it, expect, vi } from "vitest";

import { StreamingSideEffects } from "../streaming-side-effects.js";
import type { InlinePublisher } from "../inline-publisher.js";
import { makeToolFinished, makeToolStarted, resetSeq } from "../__test-utils__/v3-event-fixtures.js";

function publisherDouble(): { publisher: InlinePublisher; publish: ReturnType<typeof vi.fn> } {
  const publish = vi.fn(async (_path: string) => undefined);
  // The trigger reads exactly one member of the publisher.
  return { publisher: { publish } as unknown as InlinePublisher, publish };
}

describe("StreamingSideEffects", () => {
  it("publishes a file-modifying tool's path once tool-started and tool-finished have both arrived", () => {
    resetSeq();
    const { publisher, publish } = publisherDouble();
    const effects = new StreamingSideEffects({ inlinePublisher: publisher });

    effects.onProtocolEvent(makeToolStarted("toolu_1", "write_file", { file_path: "/ws/index.ts", content: "x" }));
    expect(publish, "not before the call finishes").not.toHaveBeenCalled();

    effects.onProtocolEvent(makeToolFinished("toolu_1", "written"));
    expect(publish).toHaveBeenCalledWith("/ws/index.ts");
    expect(effects.pendingPublishPromises).toHaveLength(1);
  });

  it("ignores tools that do not modify files", () => {
    resetSeq();
    const { publisher, publish } = publisherDouble();
    const effects = new StreamingSideEffects({ inlinePublisher: publisher });

    effects.onProtocolEvent(makeToolStarted("toolu_2", "read_file", { path: "/ws/index.ts" }));
    effects.onProtocolEvent(makeToolFinished("toolu_2", "contents"));
    expect(publish).not.toHaveBeenCalled();
    expect(effects.pendingPublishPromises).toHaveLength(0);
  });

  it("reads the path from every key the two taxonomies use, camelCase included", () => {
    resetSeq();
    const { publisher, publish } = publisherDouble();
    const effects = new StreamingSideEffects({ inlinePublisher: publisher });

    effects.onProtocolEvent(makeToolStarted("toolu_3", "edit", { filePath: "/ws/a.ts" }));
    effects.onProtocolEvent(makeToolFinished("toolu_3", "ok"));
    effects.onProtocolEvent(makeToolStarted("toolu_4", "write", JSON.stringify({ path: "/ws/b.ts" })));
    effects.onProtocolEvent(makeToolFinished("toolu_4", "ok"));
    expect(publish.mock.calls.map((c) => c[0])).toEqual(["/ws/a.ts", "/ws/b.ts"]);
  });

  it("a finish with no matching start, or a start with no path, publishes nothing", () => {
    resetSeq();
    const { publisher, publish } = publisherDouble();
    const effects = new StreamingSideEffects({ inlinePublisher: publisher });

    effects.onProtocolEvent(makeToolFinished("toolu_never_started", "ok"));
    effects.onProtocolEvent(makeToolStarted("toolu_5", "write_file", { content: "no path" }));
    effects.onProtocolEvent(makeToolFinished("toolu_5", "ok"));
    expect(publish).not.toHaveBeenCalled();
  });

  it("does nothing at all without a publisher", () => {
    resetSeq();
    const effects = new StreamingSideEffects({});
    effects.onProtocolEvent(makeToolStarted("toolu_6", "write_file", { path: "/ws/x" }));
    effects.onProtocolEvent(makeToolFinished("toolu_6", "ok"));
    expect(effects.pendingPublishPromises).toHaveLength(0);
  });
});
