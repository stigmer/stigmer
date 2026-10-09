/**
 * The agent host's sink (`agent-host/host-sink.ts`), where it decides
 * something itself rather than asking the runner.
 *
 * Pinned: the cost cap stops the adapter inside the `reportUsage` call that
 * reaches it, synchronously, as the runtime's own sink does in-process. A
 * stop that waited for the runner's verdict to cross the pipe would land a
 * step later, with the engine's next model call already in flight. Below
 * the cap, nothing stops; with no cap, nothing ever does. The usage still
 * reaches the runner, whose own watch decides the terminal.
 */

import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import { RunStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { RunConfigSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/invocation_pb";

import { turnInputFixture } from "../../__test-utils__/turn-input-fixture.js";
import { TimingRecorder } from "../../shared/cold-start-timing.js";
import { Peer, loopbackChannels } from "../channel.js";
import { encodeMessage } from "../codec.js";
import { HostTurn, type HostPeer } from "../host-sink.js";
import type { HostCalls, HostNotices, RunnerCalls, RunnerNotices } from "../protocol.js";

function hostTurn(maxCostUsd: number): { readonly turn: HostTurn; readonly usage: number[] } {
  const [hostEnd, runnerEnd] = loopbackChannels();
  const peer: HostPeer = new Peer<RunnerCalls, HostCalls, HostNotices, RunnerNotices>(hostEnd, "host");
  const runner = new Peer<HostCalls, RunnerCalls, RunnerNotices, HostNotices>(runnerEnd, "runner");
  const usage: number[] = [];
  runner.onNotice("usage", ({ delta }) => usage.push(delta.estimatedCostUsd ?? 0));
  const input = turnInputFixture({ persistedStatus: create(RunStatusSchema, { runConfig: create(RunConfigSchema, { maxCostUsd }) }) });
  const turn = new HostTurn(peer, "turn-1", input, encodeMessage(RunStatusSchema, create(RunStatusSchema)), new TimingRecorder().toWire());
  return { turn, usage };
}

describe("the host sink's cost cap", () => {
  it("stops the adapter inside the reportUsage call that reaches the cap", async () => {
    const { turn, usage } = hostTurn(0.5);

    turn.sink.reportUsage({ estimatedCostUsd: 0.3 });
    expect(turn.sink.stopSignal.aborted, "below the cap").toBe(false);
    turn.sink.reportUsage({ estimatedCostUsd: 0.3 });
    expect(turn.sink.stopSignal.aborted, "the call that crossed it, before it returned").toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(usage, "and the runtime still hears every delta").toEqual([0.3, 0.3]);
  });

  it("never stops a turn that has no cap", () => {
    const { turn } = hostTurn(0);
    turn.sink.reportUsage({ estimatedCostUsd: 1_000 });
    expect(turn.sink.stopSignal.aborted).toBe(false);
  });
});
