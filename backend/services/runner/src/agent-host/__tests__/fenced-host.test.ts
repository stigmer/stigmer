/**
 * The runner's two hosts (`hosting.ts`, `remote-adapter.ts`, `supervisor.ts`):
 * which host runs a turn, when the locked host starts, what the runner takes
 * as proof of its lock, and how a locked host's saved state is stored.
 *
 * The hosts here are in-process peers speaking the raw protocol over a
 * loopback channel, so each test states exactly what a host announces and
 * asks. That Node itself enforces the lock is shown by the built entry's
 * locked boot (`scripts/verify-agent-host-boot.mjs --fenced`).
 */

import { describe, expect, it } from "vitest";

import { DEEP_AGENT_CAPABILITIES } from "../../activities/execute-deep-agent/deep-agent-capabilities.js";
import { testConfig } from "../../__test-utils__/config-fixture.js";
import { RecordingTurnSink } from "../../__test-utils__/harness-contract/recording-sink.js";
import { turnInputFixture } from "../../__test-utils__/turn-input-fixture.js";
import type { HarnessAdapter, TurnInput, TurnOutcome } from "../../harness/types.js";
import { NO_TURN_INPUTS } from "../../shared/inputs-reader.js";
import { newOutputsBuffer } from "../../shared/outputs-buffer.js";
import type { CheckpointRowsOp } from "../../shared/checkpointer/relayed-rows.js";
import { Peer, loopbackChannels } from "../channel.js";
import { FenceRefusedError, type HostFenceReport } from "../fence.js";
import { createRemoteAdapter } from "../remote-adapter.js";
import { AgentHostSupervisor, type HostStarter } from "../supervisor.js";
import { AGENT_HOST_PROTOCOL_VERSION, type HostCalls, type HostNotices, type RunnerCalls, type RunnerNotices, type WireSettlement } from "../protocol.js";

type HostSide = Peer<RunnerCalls, HostCalls, HostNotices, RunnerNotices>;

const LOCK = ["--permission", "--allow-fs-read=/opt/runner"] as const;
const LOCKED: HostFenceReport = { permission: true, execArgv: [...LOCK], fsReadHome: false, fsWrite: false, childProcess: false, worker: false };

/** What a test's host does inside a turn, before it answers `runTurn`. */
type InTurn = (host: HostSide, turnId: string) => Promise<void>;

/** A starter of in-process hosts, each recorded with what it was asked. */
interface Hosts {
  readonly start: HostStarter;
  readonly started: number;
  readonly booted: string[];
  readonly turns: string[];
  readonly checkpointCalls: { readonly sessionId: string; readonly op: CheckpointRowsOp }[];
  readonly closed: string[];
}

function hosts(
  options: {
    readonly fence?: HostFenceReport | undefined;
    readonly execArgv?: readonly string[];
    readonly inTurn?: InTurn;
    readonly startError?: Error;
    readonly dieBeforeHello?: boolean;
  } = {},
): Hosts {
  const state = {
    started: 0,
    booted: [] as string[],
    turns: [] as string[],
    checkpointCalls: [] as { sessionId: string; op: CheckpointRowsOp }[],
    closed: [] as string[],
    start: (() => {
      if (options.startError) throw options.startError;
      state.started += 1;
      const [runnerEnd, hostEnd] = loopbackChannels();
      const host: HostSide = new Peer<RunnerCalls, HostCalls, HostNotices, RunnerNotices>(hostEnd, "host");
      host.handle("boot", async ({ harness }) => {
        state.booted.push(harness);
        return null;
      });
      host.handle("shutdown", async () => null);
      host.handle("releaseSession", async () => null);
      host.handle("checkpointRows", async ({ sessionId, op }) => {
        state.checkpointCalls.push({ sessionId, op });
        return null;
      });
      host.handle("closeCheckpointRows", async ({ sessionId }) => {
        state.closed.push(sessionId);
        return null;
      });
      host.handle("runTurn", async ({ turnId }): Promise<WireSettlement> => {
        state.turns.push(turnId);
        await options.inTurn?.(host, turnId);
        return { outcome: { kind: "completed" }, thrown: null, projection: { rows: "" }, cas: null };
      });
      // A process that dies at start: its pipe closes once the runner holds it.
      if (options.dieBeforeHello) setTimeout(() => hostEnd.close(new Error("agent host process ended (1)")), 5);
      else host.sendHello(AGENT_HOST_PROTOCOL_VERSION, options.fence === undefined ? {} : { fence: options.fence });
      return {
        channel: runnerEnd,
        kill: () => hostEnd.close(),
        ...(options.execArgv !== undefined ? { execArgv: options.execArgv } : {}),
      };
    }) as HostStarter,
  };
  return state;
}

interface Runner {
  readonly adapter: HarnessAdapter;
  readonly tokens: Map<string, string[]>;
  readonly log: string[];
}

function runner(open: Hosts, locked: Hosts): Runner {
  const tokens = new Map<string, string[]>();
  const log: string[] = [];
  const proxy = {
    endpoint: "http://127.0.0.1:9",
    authorizeHost: (slot: string, token: string) => void tokens.set(slot, [...(tokens.get(slot) ?? []), token]),
    openTurn: () => () => {},
  };
  const openSupervisor = new AgentHostSupervisor({ proxy, slot: "open", start: open.start, log: (m) => void log.push(m) });
  const fenced = new AgentHostSupervisor({ proxy, slot: "fenced", fenced: true, startOnFirstUse: true, start: locked.start, log: (m) => void log.push(m) });
  const local: HarnessAdapter = {
    name: "stigmer",
    capabilities: DEEP_AGENT_CAPABILITIES,
    boot: async () => {},
    shutdown: async () => {},
    releaseSession: async () => {},
    runTurn: async () => ({ kind: "completed" }),
  };
  return { adapter: createRemoteAdapter("stigmer", local, { open: openSupervisor, fenced }, proxy), tokens, log };
}

function withoutComputer(): TurnInput {
  return { ...turnInputFixture(), workspace: { computer: false as const, files: { inputs: NO_TURN_INPUTS, outputs: newOutputsBuffer() } } };
}

async function run(adapter: HarnessAdapter, input: TurnInput): Promise<TurnOutcome> {
  return adapter.runTurn(input, new RecordingTurnSink({ executionId: input.executionId }));
}

describe("which host runs a turn", () => {
  it("runs a turn without a computer in the locked host, started at its first such turn, and every other turn in the open one", async () => {
    const open = hosts();
    const locked = hosts({ fence: LOCKED, execArgv: LOCK });
    const { adapter, tokens, log } = runner(open, locked);
    await adapter.boot(testConfig());
    expect(open.started, "the open host starts at boot").toBe(1);
    expect(locked.started, "the locked host waits for its first turn").toBe(0);

    expect(await run(adapter, turnInputFixture())).toEqual({ kind: "completed" });
    expect([open.turns.length, locked.turns.length]).toEqual([1, 0]);

    expect(await run(adapter, withoutComputer())).toEqual({ kind: "completed" });
    expect([open.turns.length, locked.turns.length]).toEqual([1, 1]);
    expect(locked.booted, "booted with the harness the runner booted").toEqual(["stigmer"]);
    expect(log, "its start is said once, with its lock").toEqual(["[agent-host] the locked agent host started (--permission --allow-fs-read=/opt/runner)"]);
    expect([...tokens.keys()].sort(), "each host has its own slot at the proxy").toEqual(["fenced", "open"]);
    await adapter.shutdown();
  });
});

describe("the locked host's proof of its lock", () => {
  it("refuses a turn without a computer, on the actionable surface, when the hello's fence is not the lock built, and never starts another host to learn it again", async () => {
    const open = hosts();
    const locked = hosts({ fence: { ...LOCKED, fsWrite: true }, execArgv: LOCK });
    const { adapter, log } = runner(open, locked);
    await adapter.boot(testConfig());

    const first = await run(adapter, withoutComputer());
    expect(first).toMatchObject({ kind: "failed", surface: "actionable" });
    expect((first as { message: string }).message).toBe(
      "This runner can't lock the agent program for a conversation without a computer (the locked agent program may still write files), and it won't run one unlocked.",
    );
    const second = await run(adapter, withoutComputer());
    expect(second).toEqual(first);
    expect(locked.started, "one Node can't grow a lock later: the refusal is final").toBe(1);
    expect(locked.turns, "no turn ran unlocked").toEqual([]);
    expect(log.filter((line) => line.includes("can't run on this runner")), "logged once").toHaveLength(1);

    expect(await run(adapter, turnInputFixture()), "turns with a computer are untouched").toEqual({ kind: "completed" });
    await adapter.shutdown();
  });

  it("refuses a host that reports no fence, or was started without one", async () => {
    for (const [fence, execArgv] of [
      [undefined, LOCK],
      [LOCKED, undefined],
    ] as const) {
      const { adapter } = runner(hosts(), hosts({ fence, ...(execArgv !== undefined ? { execArgv } : {}) }));
      await adapter.boot(testConfig());
      expect(await run(adapter, withoutComputer())).toMatchObject({ kind: "failed", surface: "actionable" });
      await adapter.shutdown();
    }
  });

  it("refuses for good when the lock can't be built, naming why", async () => {
    const locked = hosts({ startError: new FenceRefusedError("this Node (v18.0.0) has no permission model") });
    const { adapter } = runner(hosts(), locked);
    await adapter.boot(testConfig());
    const outcome = await run(adapter, withoutComputer());
    expect(outcome).toMatchObject({ kind: "failed", surface: "actionable" });
    expect((outcome as { message: string }).message).toContain("this Node (v18.0.0) has no permission model");
    await adapter.shutdown();
  });

  it("refuses for good when the locked host ends before it announces itself", async () => {
    const locked = hosts({ dieBeforeHello: true, execArgv: LOCK });
    const { adapter } = runner(hosts(), locked);
    await adapter.boot(testConfig());
    const outcome = await run(adapter, withoutComputer());
    expect((outcome as { message: string }).message).toContain("the locked agent program exited before it started");
    await run(adapter, withoutComputer());
    expect(locked.started).toBe(1);
    await adapter.shutdown();
  });
});

describe("a locked host's saved state", () => {
  const ownOp = (threadId: string): CheckpointRowsOp => ({ op: "get", threadId, checkpointNs: "", checkpointId: null });

  it("is stored by the open host for the turn's own session, and its file closed once the turn settles", async () => {
    const open = hosts();
    const input = withoutComputer();
    const locked = hosts({
      fence: LOCKED,
      execArgv: LOCK,
      inTurn: async (host, turnId) => {
        await host.call("checkpointRows", { turnId, op: ownOp(input.threadId) });
      },
    });
    const { adapter } = runner(open, locked);
    await adapter.boot(testConfig());
    expect(await run(adapter, input)).toEqual({ kind: "completed" });
    expect(open.checkpointCalls).toEqual([{ sessionId: input.sessionId, op: ownOp(input.threadId) }]);
    expect(open.closed).toEqual([input.sessionId]);
    await adapter.shutdown();
  });

  it("refuses an op naming another thread, or of a kind the runner does not know, and stores nothing", async () => {
    const open = hosts();
    const input = withoutComputer();
    const refusals: string[] = [];
    const locked = hosts({
      fence: LOCKED,
      execArgv: LOCK,
      inTurn: async (host, turnId) => {
        const attempt = async (op: unknown): Promise<void> => {
          await host.call("checkpointRows", { turnId, op: op as CheckpointRowsOp }).catch((err: Error) => void refusals.push(err.message));
        };
        await attempt(ownOp("thread-another-conversation"));
        await attempt({ op: "put", row: { threadId: "thread-another-conversation" } });
        await attempt({ op: "list", threadId: undefined });
        await attempt({ op: "vacuum", threadId: input.threadId });
      },
    });
    const { adapter } = runner(open, locked);
    await adapter.boot(testConfig());
    await run(adapter, input);
    expect(refusals).toEqual([
      "thread thread-another-conversation is not the turn's own",
      "thread thread-another-conversation is not the turn's own",
      "thread undefined is not the turn's own",
      "the agent program sent a checkpoint call this runner does not know",
    ]);
    expect(open.checkpointCalls).toEqual([]);
    expect(open.closed, "a turn that stored nothing closes nothing").toEqual([]);
    await adapter.shutdown();
  });
});
