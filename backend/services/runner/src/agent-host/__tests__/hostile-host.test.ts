/**
 * The runner's side of the pipe against a host that does not follow the
 * rules. Whatever runs as the agent can take the host over, so the remote
 * adapter (`agent-host/remote-adapter.ts`) treats every value the host sends
 * as the agent's. This test is that host: it speaks the raw protocol
 * (`protocol.ts`) from a loopback channel, with no `serveAgentHost` between
 * it and the runner, and tries each thing the runner must refuse or bound:
 *
 *  - a persist that also carries status fields or runtime rows: only the
 *    adapter-owned rows land;
 *  - usage with negative or non-finite counts: clamped to zero;
 *  - a plugin verify for a plugin the turn does not have: refused;
 *  - a notice for a turn that has settled: dropped, and the runner sends
 *    none once a turn settled (a person's stop of a background command);
 *  - tool-output refs that point outside the turn's own key prefix
 *    (another execution's, a traversal): dropped, refs the turn started
 *    with kept; CAS paths that are absolute or leave the workspace:
 *    dropped;
 *  - an outcome of a kind the runner does not know, or a failure on a
 *    surface it does not know: settled as an internal failure, never taken
 *    as the host named it.
 */

import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import { RunStatusSchema, type RunStatus } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { ToolCallOutputRefSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/message_pb";

import { DEEP_AGENT_CAPABILITIES } from "../../activities/execute-deep-agent/deep-agent-capabilities.js";
import { testConfig } from "../../__test-utils__/config-fixture.js";
import { RecordingTurnSink } from "../../__test-utils__/harness-contract/recording-sink.js";
import { turnInputFixture } from "../../__test-utils__/turn-input-fixture.js";
import type { HarnessAdapter } from "../../harness/types.js";
import { Peer, loopbackChannels } from "../channel.js";
import { encodeMessage } from "../codec.js";
import { confineCasSnapshot, createRemoteAdapter, isTurnArtifactKey } from "../remote-adapter.js";
import { AgentHostSupervisor } from "../supervisor.js";
import {
  AGENT_HOST_PROTOCOL_VERSION,
  type HostCalls,
  type HostNotices,
  type RunnerCalls,
  type RunnerNotices,
  type WireSettlement,
} from "../protocol.js";
import { AgentMessageSchema, ToolCallSchema, SubAgentRunSchema } from "../../gen/turn/ai/stigmer/runner/turn/v1/rows_pb.js";
import { MessageType } from "../../gen/turn/ai/stigmer/runner/turn/v1/enum_pb.js";
import { TurnRowsSchema, type TurnRows } from "../../gen/turn/ai/stigmer/runner/turn/v1/rows_pb.js";
import type { WireProjection } from "../codec.js";

type HostilePeer = Peer<RunnerCalls, HostCalls, HostNotices, RunnerNotices>;

/** What the hostile host does inside a turn, before it answers `runTurn`. */
type Attack = (peer: HostilePeer, turnId: string, args: HostCalls["runTurn"]["args"]) => Promise<void>;

/** What the runner opened at its proxy for each turn, and which keys it closed. */
interface ProxyTurns {
  readonly opened: { readonly executionId: string; readonly threadId: string; readonly turnKey: string }[];
  readonly closed: string[];
}

/** What a hostile host may put in a projection: any rows and any status fields, as it chooses. */
interface Forged {
  readonly status?: RunStatus;
  readonly rows?: TurnRows;
}

/** A projection as a hostile host would send it: every field it chose, encoded as is, a status beside the rows included. */
function forgedProjection(forged: Forged): WireProjection {
  const projection = {
    rows: encodeMessage(TurnRowsSchema, forged.rows ?? create(TurnRowsSchema)),
    status: encodeMessage(RunStatusSchema, forged.status ?? create(RunStatusSchema)),
  };
  return projection;
}

function hostileHarness(
  attack: Attack,
  outcome: unknown = { kind: "completed" },
  settledProjection: Forged = {},
  turns: ProxyTurns = { opened: [], closed: [] },
): HarnessAdapter {
  const proxy = {
    endpoint: "http://127.0.0.1:9",
    authorizeHost: () => {},
    openTurn: (turn: ProxyTurns["opened"][number]) => {
      turns.opened.push(turn);
      return () => void turns.closed.push(turn.turnKey);
    },
  };
  const supervisor = new AgentHostSupervisor({
    proxy,
    log: () => {},
    start: () => {
      const [runnerEnd, hostEnd] = loopbackChannels();
      const host: HostilePeer = new Peer<RunnerCalls, HostCalls, HostNotices, RunnerNotices>(hostEnd, "hostile host");
      host.handle("boot", async () => null);
      host.handle("shutdown", async () => null);
      host.handle("runTurn", async (args): Promise<WireSettlement> => {
        await attack(host, args.turnId, args);
        return { outcome: outcome as WireSettlement["outcome"], thrown: null, projection: forgedProjection(settledProjection), cas: null };
      });
      host.sendHello(AGENT_HOST_PROTOCOL_VERSION);
      return { channel: runnerEnd, kill: () => hostEnd.close() };
    },
  });
  const local: HarnessAdapter = {
    name: "hostile",
    capabilities: DEEP_AGENT_CAPABILITIES,
    boot: async () => {},
    shutdown: async () => {},
    releaseSession: async () => {},
    runTurn: async () => ({ kind: "completed" }),
  };
  return createRemoteAdapter("stigmer", local, supervisor, proxy);
}

describe("a host that does not follow the rules", () => {
  it("keeps a projection's output refs to the turn's own keys", async () => {
    const input = turnInputFixture();
    const forged: Forged = {
      rows: create(TurnRowsSchema, {
        messages: [
          create(AgentMessageSchema, {
            type: MessageType.MESSAGE_AI,
            toolCalls: [
              create(ToolCallSchema, { id: "tc-foreign", result: "[image]", outputRef: create(ToolCallOutputRefSchema, { storageKey: "artifacts/aex_someone_else/shot.png" }) }),
              create(ToolCallSchema, { id: "tc-own", result: "[image]", outputRef: create(ToolCallOutputRefSchema, { storageKey: `artifacts/${input.executionId}/toolcalls/tc-own.png` }) }),
              create(ToolCallSchema, { id: "tc-traversal", result: "[image]", outputRef: create(ToolCallOutputRefSchema, { storageKey: `artifacts/${input.executionId}/../aex_someone_else/x` }) }),
            ],
          }),
        ],
      }),
    };
    const persisted: Array<string | undefined>[] = [];
    const sink = new RecordingTurnSink({ executionId: input.executionId });
    const adapter = hostileHarness(
      async (host, turnId) => {
        await host.call("persist", { turnId, projection: forgedProjection(forged) });
        persisted.push(sink.rows.messages[0]!.toolCalls.map((tc) => tc.outputRef?.storageKey));
      },
      { kind: "completed" },
      forged,
    );
    await adapter.boot(testConfig());

    await adapter.runTurn(input, sink);

    const own = `artifacts/${input.executionId}/toolcalls/tc-own.png`;
    expect(persisted, "at a persist").toEqual([[undefined, own, undefined]]);
    const [foreign, ownCall, traversal] = sink.rows.messages[0]!.toolCalls;
    expect(foreign!.outputRef, "a ref to another execution's object is dropped").toBeUndefined();
    expect(traversal!.outputRef, "a ref that climbs out of the turn's prefix is dropped").toBeUndefined();
    expect(ownCall!.outputRef?.storageKey, "at the settlement").toBe(own);
  });

  it("keeps a ref the turn began with, a sub-agent's included, and confines a mid-turn CAS read", async () => {
    const input = turnInputFixture();
    const seededRef = create(ToolCallOutputRefSchema, { storageKey: "artifacts/earlier/shot.png" });
    const subAgent = (ref: typeof seededRef) =>
      create(SubAgentRunSchema, { messages: [create(AgentMessageSchema, { type: MessageType.MESSAGE_AI, toolCalls: [create(ToolCallSchema, { id: "tc-sub", result: "[image]", outputRef: ref })] })] });
    const forged: Forged = { rows: create(TurnRowsSchema, { subAgentRuns: [subAgent(seededRef)] }) };
    const sink = new RecordingTurnSink({ executionId: input.executionId, rows: create(TurnRowsSchema, { subAgentRuns: [subAgent(seededRef)] }) });
    let midTurn: string[] = [];
    const adapter = hostileHarness(
      async (host, turnId) => {
        host.handle("readCasObservations", async () => ({ before: [["ok.ts", null], ["../escape", null]], blockedSecretPaths: [] }));
        host.notify("bindCas", { turnId });
        await new Promise((resolve) => setImmediate(resolve));
        midTurn = [...(await sink.casObservations!()).before.keys()];
      },
      { kind: "completed" },
      forged,
    );
    await adapter.boot(testConfig());

    await adapter.runTurn(input, sink);

    expect(sink.rows.subAgentRuns[0]!.messages[0]!.toolCalls[0]!.outputRef?.storageKey).toBe("artifacts/earlier/shot.png");
    expect(midTurn).toEqual(["ok.ts"]);
  });

  it("opens the turn at the proxy under the key it hands the host, and closes it when the turn settles", async () => {
    const turns: ProxyTurns = { opened: [], closed: [] };
    let handed: string | undefined;
    let closedDuringTurn: readonly string[] = [];
    const adapter = hostileHarness(
      async (_host, _turnId, args) => {
        handed = args.turnKey;
        closedDuringTurn = [...turns.closed];
      },
      undefined,
      undefined,
      turns,
    );
    await adapter.boot(testConfig());
    const input = turnInputFixture();

    await adapter.runTurn(input, new RecordingTurnSink({ executionId: input.executionId }));

    expect(turns.opened).toEqual([{ executionId: input.executionId, threadId: input.threadId, turnKey: handed }]);
    expect(handed, "a fresh key, long enough to guess at nothing").toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(closedDuringTurn, "open while the turn runs").toEqual([]);
    expect(turns.closed).toEqual([handed]);
  });

  it("keeps a CAS snapshot's paths inside the workspace", () => {
    const confined = confineCasSnapshot({
      before: new Map<string, Uint8Array | null>([
        ["src/ok.ts", null],
        ["../../etc/passwd", null],
        ["/etc/shadow", null],
        ["a/../../b", null],
        ["a/./b.ts", null],
        ["C:/Windows/win.ini", null],
        ["c:relative", null],
        ["..\\outside.txt", null],
        ["a\\..\\..\\b", null],
        ["ok.ts\0/../../etc/passwd", null],
        ["", null],
        ["src\\win\\ok.ts", null],
      ]),
      blockedSecretPaths: new Set([".env", "../outside/.env"]),
    });
    expect([...confined.before.keys()], "a drive letter, a backslash escape, a NUL and the empty path are refused").toEqual(["src/ok.ts", "a/./b.ts", "src\\win\\ok.ts"]);
    expect([...confined.blockedSecretPaths]).toEqual([".env"]);
  });

  it("lands only the adapter-owned rows of a persist, never a status field", async () => {
    const adapter = hostileHarness(async (host, turnId) => {
      const forged: Forged = {
        status: create(RunStatusSchema, { phase: RunPhase.RUN_COMPLETED, error: "forged by the host", startedAt: "forged" }),
        rows: create(TurnRowsSchema, {
          messages: [create(AgentMessageSchema, { type: MessageType.MESSAGE_AI, content: "the host's row" })],
          fileReviewEventStream: { runId: "forged ledger" },
        }),
      };
      await host.call("persist", { turnId, projection: forgedProjection(forged) });
    });
    await adapter.boot(testConfig());
    const input = turnInputFixture();
    const sink = new RecordingTurnSink({ executionId: input.executionId, status: create(RunStatusSchema, { phase: RunPhase.RUN_IN_PROGRESS, startedAt: "t0" }) });

    await adapter.runTurn(input, sink);

    expect(sink.status.phase, "the phase is the runtime's").toBe(RunPhase.RUN_IN_PROGRESS);
    expect(sink.status.error).toBe("");
    expect(sink.status.startedAt).toBe("t0");
    expect(sink.rows.fileReviewEventStream, "the turn's ledger is the runtime's").toBeUndefined();
  });

  it("clamps usage counts to finite, non-negative numbers", async () => {
    const adapter = hostileHarness(async (host, turnId) => {
      host.notify("usage", { turnId, delta: { inputTokens: -1_000_000, outputTokens: Number.NaN, estimatedCostUsd: -5, cacheReadTokens: 12 } });
      await host.call("reportProgress", { turnId, label: "flush" });
    });
    await adapter.boot(testConfig());
    const input = turnInputFixture();
    const sink = new RecordingTurnSink({ executionId: input.executionId });

    await adapter.runTurn(input, sink);

    expect(sink.usageDeltas).toEqual([expect.objectContaining({ inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0, cacheReadTokens: 12 })]);
  });

  it("refuses a verify for a plugin the turn does not have", async () => {
    let refusal = "";
    const adapter = hostileHarness(async (host, turnId) => {
      await host.call("verifyPlugin", { turnId, slug: "not-mine" }).catch((err: Error) => {
        refusal = err.message;
      });
    });
    await adapter.boot(testConfig());
    const input = turnInputFixture();

    await adapter.runTurn(input, new RecordingTurnSink({ executionId: input.executionId }));

    expect(refusal).toBe("plugin 'not-mine' is not one of this turn's");
  });

  it("tells the host a turn the runtime had already stopped, with the stop's reason", async () => {
    let stopped: string | null = null;
    const adapter = hostileHarness(async (_host, _turnId, args) => {
      stopped = args.stopped;
    });
    await adapter.boot(testConfig());
    const input = turnInputFixture();
    const sink = new RecordingTurnSink({ executionId: input.executionId });
    sink.abort(new Error("kit: the stall watchdog"));

    await adapter.runTurn(input, sink);
    expect(stopped).toBe("kit: the stall watchdog");
  });

  it("tells the host a turn the runtime had already asked to yield, and forwards a yield asked mid-turn once", async () => {
    let yieldedAtStart = false;
    const before = hostileHarness(async (_host, _turnId, args) => {
      yieldedAtStart = args.yielded;
    });
    await before.boot(testConfig());
    const input = turnInputFixture();
    const drained = new RecordingTurnSink({ executionId: input.executionId });
    drained.requestYield();
    await before.runTurn(input, drained);
    expect(yieldedAtStart).toBe(true);

    let notices = 0;
    let asked: () => void = () => {};
    const yieldAsked = new Promise<void>((resolve) => (asked = resolve));
    const sink = new RecordingTurnSink({ executionId: input.executionId });
    const during = hostileHarness(async (host, turnId) => {
      host.onNotice("yieldTurn", (args) => {
        if (args.turnId === turnId) notices += 1;
        asked();
      });
      sink.requestYield();
      await yieldAsked;
    });
    await during.boot(testConfig());
    await during.runTurn(input, sink);
    expect(notices).toBe(1);
  });

  it("forwards a person's stop of a background command to the host by its call id, and nothing once the turn settled", async () => {
    const input = turnInputFixture();
    const sink = new RecordingTurnSink({ executionId: input.executionId });
    const forwarded: string[] = [];
    let heard: () => void = () => {};
    const stopHeard = new Promise<void>((resolve) => (heard = resolve));
    const adapter = hostileHarness(async (host, turnId) => {
      host.onNotice("stopBackgroundCommand", (args) => {
        if (args.turnId === turnId) forwarded.push(args.callId);
        heard();
      });
      sink.stopBackground("bg-1");
      await stopHeard;
    });
    await adapter.boot(testConfig());
    await adapter.runTurn(input, sink);
    sink.stopBackground("bg-late");
    expect(forwarded).toEqual(["bg-1"]);
  });

  it("settles a turn asked to yield as interrupted when the host is lost", async () => {
    const input = turnInputFixture();
    const sink = new RecordingTurnSink({ executionId: input.executionId });
    const adapter = hostileHarness(async (host) => {
      sink.requestYield();
      host.close();
      await new Promise(() => {});
    });
    await adapter.boot(testConfig());
    expect(await adapter.runTurn(input, sink)).toEqual({ kind: "interrupted" });
  });

  it("settles an outcome it does not know as an internal failure", async () => {
    for (const forged of [
      { kind: "exfiltrate" },
      { kind: "failed", message: "chosen by the host", surface: "root" },
      { kind: "failed", message: 42, surface: "engine" },
      { kind: "cancelled" },
    ]) {
      const adapter = hostileHarness(async () => {}, forged);
      await adapter.boot(testConfig());
      const input = turnInputFixture();
      const outcome = await adapter.runTurn(input, new RecordingTurnSink({ executionId: input.executionId }));
      expect(outcome, JSON.stringify(forged)).toMatchObject({ kind: "failed", surface: "internal" });
      await adapter.shutdown();
    }
  });

  it("drops a notice for a turn that has settled", async () => {
    const adapter = hostileHarness(async (host, turnId) => {
      // Sent once the runTurn answer is on its way: a late fact about a turn the runtime has settled.
      setTimeout(() => host.notify("usage", { turnId, delta: { inputTokens: 999 } }), 0);
    });
    await adapter.boot(testConfig());
    const input = turnInputFixture();
    const sink = new RecordingTurnSink({ executionId: input.executionId });

    await adapter.runTurn(input, sink);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(sink.usageDeltas).toEqual([]);
  });
});

describe("the turn's key prefix", () => {
  it.each([
    ["artifacts/aex_1/report.md", true],
    ["artifacts/aex_1/nested/report.md", true],
    ["artifacts/aex_2/report.md", false],
    ["artifacts/aex_1/../aex_2/report.md", false],
    ["artifacts/aex_1/./report.md", false],
    ["artifacts/aex_1//report.md", false],
    ["artifacts/aex_1\\report.md", false],
    ["artifacts/aex_1/", false],
  ])("%s → %s", (key, allowed) => {
    expect(isTurnArtifactKey(key, "aex_1")).toBe(allowed);
  });
});
