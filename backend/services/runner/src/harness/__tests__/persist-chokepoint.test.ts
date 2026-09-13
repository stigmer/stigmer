/**
 * The persist chokepoint's two contracts: what one write does (the secret
 * backstop, the usage summary, the heartbeat, the STOP), and how requests
 * coalesce (one write in flight, one follow-up at most, every request's
 * promise resolving only once its state is on the wire).
 */

import { describe, expect, it, vi } from "vitest";
import { create } from "@bufbuild/protobuf";
import { AgentExecutionStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { UpdateStatusResponseSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/io_pb";
import { AgentMessageSchema, ToolCallSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { ExecutionControlSignal, FileChangeKind, MessageType, ServiceTier, ThinkingMode, ToolCallStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

import type { StigmerClient } from "../../client/stigmer-client.js";
import type { TurnProgress } from "../capture.js";
import { newProgressCaptureState, type ProgressSubstrate } from "../../shared/filereview/progress.js";
import { PersistChokepoint } from "../persist-chokepoint.js";
import { UsageAccumulator } from "../usage-accumulator.js";

interface Gate {
  readonly open: () => void;
  readonly opened: Promise<void>;
}

function gate(): Gate {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => (open = resolve));
  return { open, opened };
}

/** A client whose `updateStatus` answers through a gate the test opens, so writes can be held in flight. */
function heldClient(answers: ExecutionControlSignal[] = []) {
  const gates: Gate[] = [];
  const writes: number[] = [];
  const client = {
    updateStatus: vi.fn(async (_id: string, status: { messages: unknown[] }) => {
      const g = gate();
      gates.push(g);
      writes.push(status.messages.length);
      await g.opened;
      return create(UpdateStatusResponseSchema, { signal: answers.shift() ?? ExecutionControlSignal.UNSPECIFIED });
    }),
  } as unknown as StigmerClient;
  return { client, gates, writes };
}

function chokepointOver(
  client: StigmerClient,
  options: { usage?: UsageAccumulator; progress?: TurnProgress; onPlatformStop?: () => void } = {},
) {
  const status = create(AgentExecutionStatusSchema, {});
  const heartbeat = vi.fn();
  const onPlatformStop = options.onPlatformStop ?? vi.fn();
  const chokepoint = new PersistChokepoint({
    client,
    executionId: "aex_test",
    status,
    offload: undefined,
    usage: () => options.usage,
    progress: () => options.progress,
    heartbeat,
    onPlatformStop,
  });
  return { chokepoint, status, heartbeat, onPlatformStop };
}

describe("PersistChokepoint: one write", () => {
  it("withholds secret content, refreshes streaming_usage, writes, heartbeats, and relays STOP", async () => {
    const { client, gates } = heldClient([ExecutionControlSignal.STOP]);
    const usage = new UsageAccumulator(ServiceTier.STANDARD, ThinkingMode.DISABLED);
    usage.addTurn({ inputTokens: 10, estimatedCostUsd: 0.01, model: "m" });
    const onPlatformStop = vi.fn();
    const { chokepoint, status, heartbeat } = chokepointOver(client, { usage, onPlatformStop });
    status.messages.push(
      create(AgentMessageSchema, {
        type: MessageType.MESSAGE_AI,
        toolCalls: [
          create(ToolCallSchema, {
            id: "w1",
            name: "write",
            status: ToolCallStatus.TOOL_CALL_COMPLETED,
            args: { path: ".env", content: "SECRET=1" },
          }),
        ],
      }),
    );

    const written = chokepoint.write();
    gates[0]!.open();
    await written;

    expect(status.messages[0]!.toolCalls[0]!.args, "the secret backstop ran before the write").not.toMatchObject({ content: "SECRET=1" });
    expect(status.streamingUsage?.estimatedCostUsd).toBe(0.01);
    expect(heartbeat).toHaveBeenCalledTimes(1);
    expect(onPlatformStop).toHaveBeenCalledTimes(1);
  });

  it("refreshes file_change_progress from the turn's capture before the write, and re-attaches only when the tree moved", async () => {
    const { client, gates } = heldClient();
    const captures: boolean[] = [true, false];
    const substrate: ProgressSubstrate = {
      capture: async () => ({
        delta: { entries: [{ pathBefore: "a.md", pathAfter: "a.md", kind: FileChangeKind.MODIFY, linesAdded: 2, linesRemoved: 0 }] },
        changed: captures.shift() ?? false,
      }),
    };
    const { chokepoint, status } = chokepointOver(client, {
      progress: { changeSetId: "aex_test:0", substrate, state: newProgressCaptureState() },
    });

    const first = chokepoint.write();
    await vi.waitFor(() => expect(gates).toHaveLength(1));
    expect(status.fileChangeProgress?.changeSetId, "attached before the bytes leave").toBe("aex_test:0");
    expect(status.fileChangeProgress?.linesAdded).toBe(2);
    const attachedAt = status.fileChangeProgress?.capturedAt;
    gates[0]!.open();
    await first;

    // The floor (2 s) has not elapsed for the second write: no capture, the
    // snapshot stands; a capture that reports `changed: false` would stand too.
    const second = chokepoint.write();
    await vi.waitFor(() => expect(gates).toHaveLength(2));
    expect(status.fileChangeProgress?.capturedAt).toBe(attachedAt);
    gates[1]!.open();
    await second;
  });

  it("writes no streaming_usage when no turn was reported", async () => {
    const { client, gates } = heldClient();
    const { chokepoint, status } = chokepointOver(client, { usage: new UsageAccumulator() });
    const written = chokepoint.write();
    gates[0]!.open();
    await written;
    expect(status.streamingUsage).toBeUndefined();
  });
});

describe("PersistChokepoint: coalescing", () => {
  it("a request while a write is in flight schedules ONE follow-up and resolves only when it lands", async () => {
    const { client, gates, writes } = heldClient();
    const { chokepoint, status } = chokepointOver(client);

    status.messages.push(create(AgentMessageSchema, { content: "one" }));
    const first = chokepoint.request();
    status.messages.push(create(AgentMessageSchema, { content: "two" }));
    const second = chokepoint.request();
    status.messages.push(create(AgentMessageSchema, { content: "three" }));
    const third = chokepoint.request();

    let secondSettled = false;
    let thirdSettled = false;
    void second.then(() => (secondSettled = true));
    void third.then(() => (thirdSettled = true));

    expect(gates, "one write in flight, the follow-up waits").toHaveLength(1);
    gates[0]!.open();
    await first;
    await Promise.resolve();
    expect(secondSettled, "the follow-up has not landed yet").toBe(false);

    await vi.waitFor(() => expect(gates).toHaveLength(2));
    expect(writes, "the follow-up carries the state as of the LAST request").toEqual([1, 3]);
    gates[1]!.open();
    await Promise.all([second, third]);
    expect(secondSettled && thirdSettled).toBe(true);
    expect(client.updateStatus).toHaveBeenCalledTimes(2);
  });

  it("sequential awaited requests write once each, in order", async () => {
    const { client, gates } = heldClient();
    const { chokepoint } = chokepointOver(client);
    const first = chokepoint.request();
    gates[0]!.open();
    await first;
    const second = chokepoint.request();
    await vi.waitFor(() => expect(gates).toHaveLength(2));
    gates[1]!.open();
    await second;
    expect(client.updateStatus).toHaveBeenCalledTimes(2);
  });
});
