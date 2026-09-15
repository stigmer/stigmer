/**
 * `StreamingSideEffects`: a `tool_started` carries the tool INPUT and a
 * `tool_finished` its completion, so the trigger correlates the two by
 * `callId` and publishes a file-modifying tool's target path once the call
 * has finished. Driven the way the loop drives it (S4 M2 C3b): raw v3 events
 * through the translator, the canonical events into the trigger.
 *
 * Carried from the legacy v3 loop's suite (`streaming-v3.test.ts`, retired
 * with the loop at S3 M2b) — the trigger itself never had a test of its own.
 */

import { describe, it, expect, vi } from "vitest";

import { StreamingSideEffects } from "../streaming-side-effects.js";
import { DeepAgentTranslator } from "../translator.js";
import type { InlinePublisher } from "../inline-publisher.js";
import type { V3ProtocolEvent } from "../v3-event-recorder.js";
import { makeToolFinished, makeToolStarted, resetSeq } from "../__test-utils__/v3-event-fixtures.js";

/** What the loop does per raw event: translate, then hand every canonical event to the trigger. */
function feed(effects: StreamingSideEffects, raw: V3ProtocolEvent): void {
  for (const event of new DeepAgentTranslator(null).translate(raw)) effects.onEvent(event);
}

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

    feed(effects, makeToolStarted("toolu_1", "write_file", { file_path: "/ws/index.ts", content: "x" }));
    expect(publish, "not before the call finishes").not.toHaveBeenCalled();

    feed(effects, makeToolFinished("toolu_1", "written"));
    expect(publish).toHaveBeenCalledWith("/ws/index.ts");
    expect(effects.pendingPublishPromises).toHaveLength(1);
  });

  it("ignores tools that do not modify files", () => {
    resetSeq();
    const { publisher, publish } = publisherDouble();
    const effects = new StreamingSideEffects({ inlinePublisher: publisher });

    feed(effects, makeToolStarted("toolu_2", "read_file", { path: "/ws/index.ts" }));
    feed(effects, makeToolFinished("toolu_2", "contents"));
    expect(publish).not.toHaveBeenCalled();
    expect(effects.pendingPublishPromises).toHaveLength(0);
  });

  it("reads the path from every key the two taxonomies use, camelCase included", () => {
    resetSeq();
    const { publisher, publish } = publisherDouble();
    const effects = new StreamingSideEffects({ inlinePublisher: publisher });

    feed(effects, makeToolStarted("toolu_3", "edit", { filePath: "/ws/a.ts" }));
    feed(effects, makeToolFinished("toolu_3", "ok"));
    feed(effects, makeToolStarted("toolu_4", "write", JSON.stringify({ path: "/ws/b.ts" })));
    feed(effects, makeToolFinished("toolu_4", "ok"));
    expect(publish.mock.calls.map((c) => c[0])).toEqual(["/ws/a.ts", "/ws/b.ts"]);
  });

  it("a finish with no matching start, or a start with no path, publishes nothing", () => {
    resetSeq();
    const { publisher, publish } = publisherDouble();
    const effects = new StreamingSideEffects({ inlinePublisher: publisher });

    feed(effects, makeToolFinished("toolu_never_started", "ok"));
    feed(effects, makeToolStarted("toolu_5", "write_file", { content: "no path" }));
    feed(effects, makeToolFinished("toolu_5", "ok"));
    expect(publish).not.toHaveBeenCalled();
  });

  it("does nothing at all without a publisher", () => {
    resetSeq();
    const effects = new StreamingSideEffects({});
    feed(effects, makeToolStarted("toolu_6", "write_file", { path: "/ws/x" }));
    feed(effects, makeToolFinished("toolu_6", "ok"));
    expect(effects.pendingPublishPromises).toHaveLength(0);
  });
});
