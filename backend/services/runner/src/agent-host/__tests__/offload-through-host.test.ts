/**
 * The runtime's offload of large tool outputs (`shared/status-offload.ts`)
 * through the agent host: a hosted adapter's output is uploaded once, and
 * the host's copy of the status takes the runtime's ref in place of the
 * output, so later persists neither upload it again nor carry it across the
 * pipe.
 *
 * Pinned, through the remote adapter and an in-process host
 * (`__test-utils__/loopback-host.ts`), with a runtime sink whose persist runs
 * the real offload:
 *  - three persists of one oversized text output and one image upload each
 *    once;
 *  - after the first persist the adapter's own status holds the collapsed
 *    result and the ref, as an in-process status would;
 *  - an output the adapter changed after it was offloaded is offloaded
 *    again, as new content.
 */

import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import { AgentMessageSchema, ToolCallSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/message_pb";
import { MessageType } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";

import { DEEP_AGENT_CAPABILITIES } from "../../activities/execute-deep-agent/deep-agent-capabilities.js";
import { testConfig } from "../../__test-utils__/config-fixture.js";
import { RecordingTurnSink } from "../../__test-utils__/harness-contract/recording-sink.js";
import { loopbackHostedRow } from "../../__test-utils__/loopback-host.js";
import { turnInputFixture } from "../../__test-utils__/turn-input-fixture.js";
import type { HarnessAdapter, TurnInput, TurnSink } from "../../harness/types.js";
import type { ArtifactStorage } from "../../shared/artifact-storage.js";
import { offloadOversizedToolOutputs } from "../../shared/status-offload.js";

const BIG_TEXT = "x".repeat(300 * 1024);
const IMAGE = JSON.stringify({ type: "image", data: Buffer.alloc(2048, 7).toString("base64"), mimeType: "image/png" });

/** A runtime sink whose persist runs the chokepoint's offload, with storage that counts uploads. */
class OffloadingSink extends RecordingTurnSink {
  readonly uploads: string[] = [];
  private readonly storage: ArtifactStorage = {
    upload: async (key) => {
      this.uploads.push(key);
      return key;
    },
    download: async () => Buffer.alloc(0),
    exists: async () => false,
  };

  constructor(private readonly executionId: string) {
    super({ executionId });
  }

  override async requestPersist(): Promise<void> {
    await offloadOversizedToolOutputs(this.status, { executionId: this.executionId, artifactStorage: this.storage });
    await super.requestPersist();
  }
}

function adapterThat(turn: (input: TurnInput, sink: TurnSink) => Promise<void>): HarnessAdapter {
  return {
    name: "offload-probe",
    capabilities: DEEP_AGENT_CAPABILITIES,
    boot: async () => {},
    shutdown: async () => {},
    releaseSession: async () => {},
    runTurn: async (input, sink) => {
      await turn(input, sink);
      return { kind: "completed" };
    },
  };
}

describe("the runtime's offload through the agent host", () => {
  it("uploads each large output once over many persists, and the host's copy takes the ref", async () => {
    const seen: { readonly text: string; readonly hasRef: boolean }[] = [];
    const row = loopbackHostedRow({
      harness: "deep-agent",
      adapter: adapterThat(async (_input, sink) => {
        sink.status.messages.push(
          create(AgentMessageSchema, {
            type: MessageType.MESSAGE_AI,
            toolCalls: [create(ToolCallSchema, { id: "tc-big", name: "shell", result: BIG_TEXT }), create(ToolCallSchema, { id: "tc-image", name: "screenshot", result: IMAGE })],
          }),
        );
        for (let i = 0; i < 3; i++) {
          await sink.requestPersist();
          const big = sink.status.messages[0]!.toolCalls[0]!;
          seen.push({ text: big.result ?? "", hasRef: big.outputRef !== undefined });
        }
      }),
    });
    await row.adapter.boot(testConfig());
    const input = turnInputFixture();
    const sink = new OffloadingSink(input.executionId);

    await row.adapter.runTurn(input, sink);

    expect(sink.uploads.sort()).toEqual([`artifacts/${input.executionId}/toolcalls/tc-big.txt`, `artifacts/${input.executionId}/toolcalls/tc-image.png`]);
    for (const after of seen) {
      expect(after.hasRef, "the host's copy holds the ref").toBe(true);
      expect(after.text.length, "and the collapsed result, not the output").toBeLessThan(10_000);
    }
    await row.adapter.shutdown();
  });

  it("offloads an output again once the adapter has changed it", async () => {
    const row = loopbackHostedRow({
      harness: "deep-agent",
      adapter: adapterThat(async (_input, sink) => {
        sink.status.messages.push(create(AgentMessageSchema, { type: MessageType.MESSAGE_AI, toolCalls: [create(ToolCallSchema, { id: "tc-big", name: "shell", result: BIG_TEXT })] }));
        await sink.requestPersist();
        sink.status.messages[0]!.toolCalls[0]!.result = "y".repeat(300 * 1024);
        await sink.requestPersist();
      }),
    });
    await row.adapter.boot(testConfig());
    const input = turnInputFixture();
    const sink = new OffloadingSink(input.executionId);

    await row.adapter.runTurn(input, sink);

    expect(sink.uploads).toHaveLength(2);
    await row.adapter.shutdown();
  });
});
