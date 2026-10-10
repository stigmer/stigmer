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
 *
 * And the calls it makes of the runner: a burst of persist requests
 * becomes one write and one follow-up, each resolving once the runner
 * answered; a persist or a progress label that cannot cross never rejects
 * (the contract's promise), it logs; binding the state id writes the two
 * fields the runtime writes on the shared session record, once the runner
 * has written them.
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

function hostTurn(maxCostUsd: number) {
  const [hostEnd, runnerEnd] = loopbackChannels();
  const peer: HostPeer = new Peer<RunnerCalls, HostCalls, HostNotices, RunnerNotices>(hostEnd, "host");
  const runner = new Peer<HostCalls, RunnerCalls, RunnerNotices, HostNotices>(runnerEnd, "runner");
  const usage: number[] = [];
  runner.onNotice("usage", ({ delta }) => usage.push(delta.estimatedCostUsd ?? 0));
  const input = turnInputFixture({ persistedStatus: create(RunStatusSchema, { runConfig: create(RunConfigSchema, { maxCostUsd }) }) });
  const turn = new HostTurn(peer, "turn-1", input, encodeMessage(RunStatusSchema, create(RunStatusSchema)), new TimingRecorder().toWire());
  return { turn, usage, runner, input, runnerEnd };
}

function silenced<T>(work: () => Promise<T>): Promise<{ readonly value: T; readonly warned: string[] }> {
  const warned: string[] = [];
  const warn = console.warn;
  console.warn = (message: string) => void warned.push(message);
  return work()
    .then((value) => ({ value, warned }))
    .finally(() => {
      console.warn = warn;
    });
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

describe("the host sink's calls to the runner", () => {
  it("turns a burst of persist requests into one write and one follow-up", async () => {
    const { turn, runner } = hostTurn(0);
    let writes = 0;
    runner.handle("persist", async () => {
      writes += 1;
      return { runtime: { fields: [], status: encodeMessage(RunStatusSchema, create(RunStatusSchema)) }, offloads: [] };
    });

    await Promise.all([turn.sink.requestPersist(), turn.sink.requestPersist(), turn.sink.requestPersist()]);
    expect(writes).toBe(2);
  });

  it("never rejects a persist or a progress label that cannot cross; it logs", async () => {
    const { turn, runnerEnd } = hostTurn(0);
    runnerEnd.close(new Error("the runner is gone"));

    const { warned } = await silenced(async () => {
      await turn.sink.requestPersist();
      await turn.sink.reportProgress("Creating agent");
    });
    expect(warned).toEqual([
      "[agent-host] persist request failed: turn=turn-1, the runner is gone",
      "[agent-host] progress label not reported: execution=aex_fixture_0001, the runner is gone",
    ]);
  });

  it("writes the state id and clears the slug on the session record once the runner has written them", async () => {
    const { turn, runner, input } = hostTurn(0);
    input.session.metadata!.slug = "server-generated";
    let bound = "";
    runner.handle("bindHarnessState", async ({ harnessStateId }) => {
      bound = harnessStateId;
      expect(input.session.spec!.harnessStateId, "not before the runner wrote it").toBe("");
      return null;
    });

    await turn.sink.bindHarnessState("engine-state-1");
    expect(bound).toBe("engine-state-1");
    expect(input.session.spec!.harnessStateId).toBe("engine-state-1");
    expect(input.session.metadata!.slug).toBe("");
  });
});
