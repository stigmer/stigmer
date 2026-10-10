/**
 * The agent host as production runs it: a real child process, the channel
 * on its fd 3, the runner's real supervisor and remote adapter in front.
 * The engine is a probe (`__test-utils__/agent-host-probe-child.ts`), because
 * what is under test is the process boundary, not an engine; the engines
 * cross the same boundary in the hermetic suites, over the loopback.
 *
 * What these pin, each against a process the test can kill:
 *
 *  - a turn crosses the real pipe: the adapter's rows reach the runtime's
 *    status, its awaited persist reaches the runtime's sink, its usage too;
 *  - the runtime's stop reaches an engine parked mid-step, which settles
 *    `interrupted`;
 *  - a host killed mid-turn settles that turn `failed` on the `internal`
 *    surface at once, and the next turn runs on a host the supervisor
 *    started again; one that dies after the runtime asked the turn to stop
 *    settles it `interrupted`, the stop the runtime already decided;
 *  - an adapter that throws reaches the runtime as a throw, its rows kept;
 *  - a host that speaks another protocol version is refused at boot;
 *  - shutting the last harness down ends the host process.
 */

import type { ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { MessageType } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";

import { DEEP_AGENT_CAPABILITIES } from "../../activities/execute-deep-agent/deep-agent-capabilities.js";
import { RecordingTurnSink } from "../../__test-utils__/harness-contract/recording-sink.js";
import { testConfig } from "../../__test-utils__/config-fixture.js";
import { turnInputFixture } from "../../__test-utils__/turn-input-fixture.js";
import type { HarnessAdapter, TurnOutcome } from "../../harness/types.js";
import { createRemoteAdapter } from "../remote-adapter.js";
import { AgentHostSupervisor, spawnHostProcess, type HostStarter } from "../supervisor.js";

const CHILD = fileURLToPath(new URL("../../__test-utils__/agent-host-probe-child.ts", import.meta.url));

/** The bound a stopped or orphaned turn must settle within. */
const SETTLE_BOUND_MS = 5_000;

const spawned: ChildProcess[] = [];

afterEach(() => {
  for (const child of spawned.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }
});

function probeStarter(arm: "serve" | "stale"): HostStarter {
  return () => {
    const { started, child } = spawnHostProcess(process.execPath, ["--import", "tsx", CHILD, arm], { ...process.env });
    spawned.push(child);
    return started;
  };
}

function hostedProbe(arm: "serve" | "stale" = "serve"): { readonly adapter: HarnessAdapter; readonly supervisor: AgentHostSupervisor } {
  const proxy = { endpoint: "http://127.0.0.1:9", authorizeHost: () => {}, openTurn: () => () => {} };
  const supervisor = new AgentHostSupervisor({ proxy, start: probeStarter(arm), firstRestartDelayMs: 50, log: () => {} });
  const local: HarnessAdapter = {
    name: "probe",
    capabilities: DEEP_AGENT_CAPABILITIES,
    boot: async () => {},
    shutdown: async () => {},
    releaseSession: async () => {},
    runTurn: async () => ({ kind: "completed" }),
  };
  return { adapter: createRemoteAdapter("deep-agent", local, supervisor, proxy), supervisor };
}

function startTurn(adapter: HarnessAdapter, message: string): { readonly sink: RecordingTurnSink; readonly settled: Promise<TurnOutcome> } {
  const input = turnInputFixture({ message });
  const sink = new RecordingTurnSink({ executionId: input.executionId });
  return { sink, settled: adapter.runTurn(input, sink) };
}

/** Resolves once the engine reported it is parked mid-step. */
async function whenParked(sink: RecordingTurnSink): Promise<void> {
  const deadline = Date.now() + SETTLE_BOUND_MS;
  while (!sink.events.some((e) => e.kind === "activity" && e.detail === "parked")) {
    if (Date.now() > deadline) throw new Error("the probe never parked");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function withinBound<T>(promise: Promise<T>): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`not settled within ${SETTLE_BOUND_MS}ms`)), SETTLE_BOUND_MS)),
  ]);
}

describe("the agent host as a child process", () => {
  it("carries a turn across the real pipe: rows, the awaited persist and the usage reach the runtime", async () => {
    const { adapter } = hostedProbe();
    await adapter.boot(testConfig());
    const { sink, settled } = startTurn(adapter, "say");

    expect(await settled).toEqual({ kind: "completed" });
    const ai = sink.status.messages.filter((m) => m.type === MessageType.MESSAGE_AI);
    expect(ai.map((m) => m.content), "the engine's row is on the runtime's status").toEqual(["probe says hello"]);
    expect(sink.persistRequests, "the engine's awaited persist reached the runtime's chokepoint").toBeGreaterThanOrEqual(1);
    expect(sink.usageDeltas).toEqual([
      expect.objectContaining({ inputTokens: 10, outputTokens: 5, estimatedCostUsd: 0.001, model: "probe-model" }),
    ]);
    await adapter.shutdown();
  });

  it("delivers the runtime's stop to an engine parked mid-step, which settles interrupted", async () => {
    const { adapter } = hostedProbe();
    await adapter.boot(testConfig());
    const { sink, settled } = startTurn(adapter, "hang");
    await whenParked(sink);
    sink.abort("kit: user pause");

    expect(await withinBound(settled)).toEqual({ kind: "interrupted" });
    await adapter.shutdown();
  });

  it("settles a turn whose host was killed as an internal failure at once, and runs the next turn on a restarted host", async () => {
    const { adapter } = hostedProbe();
    await adapter.boot(testConfig());
    const { sink, settled } = startTurn(adapter, "hang");
    await whenParked(sink);
    spawned[0]!.kill("SIGKILL");

    const outcome = await withinBound(settled);
    expect(outcome.kind).toBe("failed");
    expect(outcome.kind === "failed" && outcome.surface, "the runner, not the user, broke").toBe("internal");
    expect(outcome.kind === "failed" && outcome.message).toMatch(/^The agent process stopped before the turn finished: /);

    const next = startTurn(adapter, "say");
    expect(await withinBound(next.settled), "the next turn runs on a new host").toEqual({ kind: "completed" });
    expect(spawned, "the supervisor started a second host").toHaveLength(2);
    await adapter.shutdown();
  });

  it("settles a turn whose host died after the runtime stopped it as interrupted", async () => {
    const { adapter } = hostedProbe();
    await adapter.boot(testConfig());
    const { sink, settled } = startTurn(adapter, "deaf");
    await whenParked(sink);
    sink.abort("kit: worker shutdown");
    spawned[0]!.kill("SIGKILL");

    expect(await withinBound(settled)).toEqual({ kind: "interrupted" });
    await adapter.shutdown();
  });

  it("hands an adapter's throw to the runtime as a throw, the rows it folded first kept", async () => {
    const { adapter } = hostedProbe();
    await adapter.boot(testConfig());
    const { sink, settled } = startTurn(adapter, "throw");

    await expect(settled).rejects.toThrow("probe broke its contract");
    expect(sink.status.messages.map((m) => m.content), "the runtime settles over the rows the engine produced").toEqual(["before the break"]);
    await adapter.shutdown();
  });

  it("refuses a host that speaks another protocol version at boot", async () => {
    const { adapter } = hostedProbe("stale");
    await expect(adapter.boot(testConfig())).rejects.toThrow(/speaks protocol \d+; this runner speaks \d+/);
  });

  it("ends the host process when the last harness shuts down", async () => {
    const { adapter } = hostedProbe();
    await adapter.boot(testConfig());
    const child = spawned[0]!;
    const exited = new Promise<number | null>((resolve) => child.once("exit", (code) => resolve(code)));

    await adapter.shutdown();
    expect(await withinBound(exited), "the host saw its channel end and exited cleanly").toBe(0);
  });
});
