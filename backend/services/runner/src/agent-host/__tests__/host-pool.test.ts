/**
 * The locked hosts' pool (`host-pool.ts`) behind the remote adapter
 * (`remote-adapter.ts`): one locked host per turn slot, one turn per host,
 * each turn opened at the local proxy in its own host's slot under its own
 * run credential, and a host that dies of its heap cap ending only the turn
 * it served.
 *
 * The hosts are in-process peers speaking the raw protocol over a loopback
 * channel, so each test holds a turn open, or kills its host, exactly when
 * it means to. That a real process dies of a real heap cap and is read as
 * such is the spawned host's test (`spawned-host.test.ts`); that the proxy
 * refuses one slot's host another slot's turn is the proxy's
 * (`agent-proxy/__tests__/turn-credential.test.ts`).
 *
 * What these pin:
 *  - two turns of two organizations at once each get a host of their own,
 *    and each is opened at the proxy in that host's slot with the
 *    credential its own activity entered;
 *  - a turn that finds every host busy waits for the next one released;
 *  - a host that dies of its heap cap settles its turn `failed` on the
 *    actionable surface with the sentence naming the cap, the other turn
 *    completes, and only the dead slot starts again;
 *  - a fence refusal one slot learned refuses every later turn at once,
 *    starting no other slot;
 *  - a runner that serves only conversations without a computer refuses a
 *    turn with one before any host is lent.
 */

import { describe, expect, it } from "vitest";

import { DEEP_AGENT_CAPABILITIES } from "../../activities/execute-deep-agent/deep-agent-capabilities.js";
import { testConfig } from "../../__test-utils__/config-fixture.js";
import { RecordingTurnSink } from "../../__test-utils__/harness-contract/recording-sink.js";
import { turnInputFixture } from "../../__test-utils__/turn-input-fixture.js";
import type { HarnessAdapter, TurnInput, TurnOutcome } from "../../harness/types.js";
import { NO_TURN_INPUTS } from "../../shared/inputs-reader.js";
import { newOutputsBuffer } from "../../shared/outputs-buffer.js";
import { withRunCredential } from "../../shared/run-credential-store.js";
import { Peer, loopbackChannels, type LineChannel } from "../channel.js";
import { FenceRefusedError } from "../fence.js";
import { LockedHostPool } from "../host-pool.js";
import { createRemoteAdapter, type LiveTurnOpening } from "../remote-adapter.js";
import { AgentHostSupervisor, HostHeapExhaustedError } from "../supervisor.js";
import { AGENT_HOST_PROTOCOL_VERSION, type HostCalls, type HostNotices, type RunnerCalls, type RunnerNotices, type WireSettlement } from "../protocol.js";

type HostSide = Peer<RunnerCalls, HostCalls, HostNotices, RunnerNotices>;

/** One slot's in-process hosts: how many started, the turns each served, and a hand on the live one's channel. */
interface Slot {
  started: number;
  readonly turns: string[];
  /** Ends the live host's channel as its process's death would. */
  die(reason: Error): void;
  /** Answers every `runTurn` once released; a turn is held open until then. */
  readonly gate: { release: () => void; readonly opened: Promise<void> };
}

function gate(): Slot["gate"] {
  let release = (): void => {};
  const opened = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { release, opened };
}

interface Runner {
  readonly adapter: HarnessAdapter;
  readonly slots: Slot[];
  readonly opened: LiveTurnOpening[];
}

function runner(options: { readonly slots: number; readonly computerless?: boolean; readonly refuseLock?: boolean; readonly heapMb?: number }): Runner {
  const opened: LiveTurnOpening[] = [];
  const proxy = {
    endpoint: "http://127.0.0.1:9",
    authorizeHost: () => {},
    openTurn: (turn: LiveTurnOpening) => {
      opened.push(turn);
      return () => {};
    },
  };
  const slots: Slot[] = [];
  const supervisors = Array.from({ length: options.slots }, (_, i) => {
    let live: LineChannel | undefined;
    const slot: Slot = { started: 0, turns: [], die: (reason) => live?.close(reason), gate: gate() };
    slots.push(slot);
    return new AgentHostSupervisor({
      proxy,
      slot: `fenced-${i}`,
      startOnFirstUse: true,
      firstRestartDelayMs: 10,
      log: () => {},
      ...(options.heapMb === undefined ? {} : { heapMb: options.heapMb }),
      start: () => {
        if (options.refuseLock) throw new FenceRefusedError("this Node has no permission model");
        slot.started += 1;
        const [runnerEnd, hostEnd] = loopbackChannels();
        live = hostEnd;
        const host: HostSide = new Peer<RunnerCalls, HostCalls, HostNotices, RunnerNotices>(hostEnd, "host");
        host.handle("boot", async () => null);
        host.handle("shutdown", async () => null);
        host.handle("releaseSession", async () => null);
        host.handle("runTurn", async ({ turnId }): Promise<WireSettlement> => {
          slot.turns.push(turnId);
          await slot.gate.opened;
          return { outcome: { kind: "completed" }, thrown: null, projection: { rows: "" }, cas: null };
        });
        host.sendHello(AGENT_HOST_PROTOCOL_VERSION);
        return { channel: runnerEnd, kill: () => hostEnd.close() };
      },
    });
  });
  // The open host is never reached by a turn without a computer; a stand-in that would fail loudly.
  const open = new AgentHostSupervisor({ proxy, log: () => {}, startOnFirstUse: true, start: () => Promise.reject(new Error("the open host was started")) });
  const local: HarnessAdapter = {
    name: "stigmer",
    capabilities: DEEP_AGENT_CAPABILITIES,
    boot: async () => {},
    shutdown: async () => {},
    releaseSession: async () => {},
    runTurn: async () => ({ kind: "completed" }),
  };
  const adapter = createRemoteAdapter("stigmer", local, { open, fenced: new LockedHostPool(supervisors), computerless: options.computerless ?? false }, proxy);
  return { adapter, slots, opened };
}

function withoutComputer(executionId: string): TurnInput {
  return { ...turnInputFixture({ executionId }), workspace: { computer: false as const, files: { inputs: NO_TURN_INPUTS, outputs: newOutputsBuffer() } } };
}

/** Run a turn as its activity would: inside the run credential the activity boundary entered. */
function runAs(adapter: HarnessAdapter, input: TurnInput, credential: string): Promise<TurnOutcome> {
  return withRunCredential(credential, () => adapter.runTurn(input, new RecordingTurnSink({ executionId: input.executionId })));
}

async function until(condition: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`never: ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe("the locked hosts' pool", () => {
  it("gives two turns of two organizations at once a host each, each opened at the proxy in its host's slot under its own credential", async () => {
    const { adapter, slots, opened } = runner({ slots: 2 });
    await adapter.boot(testConfig());

    const a = runAs(adapter, withoutComputer("run_org_a"), "credential-of-org-a");
    const b = runAs(adapter, withoutComputer("run_org_b"), "credential-of-org-b");
    await until(() => slots.every((slot) => slot.turns.length === 1), "both turns running");
    for (const slot of slots) slot.gate.release();

    expect(await Promise.all([a, b])).toEqual([{ kind: "completed" }, { kind: "completed" }]);
    expect(slots.map((slot) => slot.turns.length), "one turn per host").toEqual([1, 1]);
    expect(opened.map(({ executionId, slot, credential }) => ({ executionId, slot, credential }))).toEqual([
      { executionId: "run_org_a", slot: "fenced-0", credential: "credential-of-org-a" },
      { executionId: "run_org_b", slot: "fenced-1", credential: "credential-of-org-b" },
    ]);
    await adapter.shutdown();
  });

  it("holds a turn that finds every host busy until the next host is released", async () => {
    const { adapter, slots } = runner({ slots: 1 });
    await adapter.boot(testConfig());

    const first = runAs(adapter, withoutComputer("run_first"), "c1");
    await until(() => slots[0]!.turns.length === 1, "the first turn running");
    const second = runAs(adapter, withoutComputer("run_second"), "c2");
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(slots[0]!.turns, "the second turn has not reached the busy host").toHaveLength(1);

    slots[0]!.gate.release();
    expect(await first).toEqual({ kind: "completed" });
    expect(await second).toEqual({ kind: "completed" });
    expect(slots[0]!.turns).toHaveLength(2);
    await adapter.shutdown();
  });

  it("ends only the turn whose host ran out of its heap cap, with the person's sentence, and restarts only that slot", async () => {
    const { adapter, slots } = runner({ slots: 2, heapMb: 256 });
    await adapter.boot(testConfig());

    const a = runAs(adapter, withoutComputer("run_greedy"), "credential-of-org-a");
    const b = runAs(adapter, withoutComputer("run_modest"), "credential-of-org-b");
    await until(() => slots.every((slot) => slot.turns.length === 1), "both turns running");
    slots[0]!.die(new HostHeapExhaustedError("agent host process ran out of memory (SIGABRT)"));

    const greedy = await a;
    expect(greedy).toMatchObject({
      kind: "failed",
      surface: "actionable",
      message: "This turn ran out of memory (256 MB) and was stopped. Start a new turn or simplify the request.",
    });
    slots[1]!.gate.release();
    expect(await b, "the other organization's turn ran on").toEqual({ kind: "completed" });

    await until(() => slots[0]!.started === 2, "the dead slot started again");
    expect(slots[1]!.started, "the other slot was never restarted").toBe(1);
    await adapter.shutdown();
  });

  it("refuses every turn once one slot learned the lock can't be built, starting no other slot", async () => {
    const { adapter, slots } = runner({ slots: 3, refuseLock: true });
    await adapter.boot(testConfig());

    const first = await runAs(adapter, withoutComputer("run_1"), "c");
    const second = await runAs(adapter, withoutComputer("run_2"), "c");
    for (const outcome of [first, second]) {
      expect(outcome).toMatchObject({ kind: "failed", surface: "actionable" });
      expect(outcome.kind === "failed" && outcome.message).toContain("this Node has no permission model");
    }
    expect(slots.map((slot) => slot.started)).toEqual([0, 0, 0]);
  });

  it("refuses a turn with a computer on a runner that serves only conversations without one, lending it no host", async () => {
    const { adapter, slots, opened } = runner({ slots: 1, computerless: true });
    await adapter.boot(testConfig());

    const outcome = await runAs(adapter, turnInputFixture(), "c");

    expect(outcome).toMatchObject({ kind: "failed", surface: "actionable" });
    expect(outcome.kind === "failed" && outcome.message).toContain("STIGMER_RUNNER_SERVES=computerless");
    expect(opened, "no turn was opened at the proxy").toEqual([]);
    expect(slots[0]!.started).toBe(0);
  });
});
