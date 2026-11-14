// Tests for the load test's engine (burst.ts) over a scripted server: one
// agent of its own, every turn fired together as a new conversation with an
// even share of the budget; a refused create kept as its code and sentence;
// the largest wait for a sandbox kept after the liveness that clears it; a
// run the watch outlives read as still waiting; Ctrl-C aborts every follow
// and the cleanup still terminates what is open and deletes every
// conversation and the agent; what could not be deleted is returned.

import { Code } from "@connectrpc/connect";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { StigmerError } from "@stigmer/client";
import { describe, expect, it } from "vitest";
import { frameOf, phase, user } from "../../../resources/__test-utils__/session-events.js";
import { completes, liveness, LoadTestServer, runOf } from "../../__test-utils__/load-test-server.js";
import { AGENT_INSTRUCTIONS, type BurstOptions, type BurstProgress, refusalOf, runBurst } from "../burst.js";

const PLAN_SENTENCE = "Your organization is at its plan's number of agents running at once.";

function options(overrides: Partial<BurstOptions> = {}): BurstOptions {
  return {
    org: "acme",
    agents: 2,
    model: "",
    message: "Say hello in one word.",
    shareUsd: 0.5,
    waitMs: 5_000,
    signal: new AbortController().signal,
    nonce: "abc123",
    ...overrides,
  };
}

/** A turn that waits for a sandbox (0 s, then 20 s), starts, and completes. */
function waitsThenCompletes(runId: string) {
  return {
    frames: [
      frameOf(user(runId, "hi")),
      frameOf(phase(runId, "pending")),
      liveness(runId, 0),
      liveness(runId, 20),
      liveness(runId),
      frameOf(phase(runId, "running")),
      frameOf(phase(runId, "completed")),
    ],
    run: runOf({ phase: RunPhase.RUN_COMPLETED, startedAt: "2026-11-14T10:00:27.000Z", cost: 0.001 }),
  };
}

/** A turn that waits for a sandbox and never starts while watched. */
function waitsOn(runId: string, seconds: number) {
  return {
    frames: [frameOf(user(runId, "hi")), frameOf(phase(runId, "pending")), liveness(runId, seconds)],
    run: runOf({ phase: RunPhase.RUN_PENDING }),
  };
}

describe("runBurst", () => {
  it("makes one agent, fires every turn as a new conversation with its share, and deletes all it made", async () => {
    const server = new LoadTestServer([completes("run_1"), completes("run_2")]);
    const seen: BurstProgress[] = [];
    const result = await runBurst(server, options({ model: "claude-haiku-4-5", onProgress: (p) => seen.push(p) }));

    expect(server.agentsMade).toEqual([
      { name: "load-test-abc123", org: "acme", description: "Made by stigmer load-test and deleted when it ends.", instructions: AGENT_INSTRUCTIONS },
    ]);
    expect(server.runsMade).toHaveLength(2);
    expect(server.runsMade[0]).toMatchObject({
      org: "acme",
      message: "Say hello in one word.",
      sessionSpec: { agentRef: { org: "acme", slug: "load-test-abc123" }, includeMyVault: true },
      runConfig: { maxCostUsd: 0.5, modelName: "claude-haiku-4-5" },
    });
    expect(result.agent).toBe("load-test-abc123");
    expect(result.sightings.map((s) => [s.index, s.runId, s.sessionId, s.run?.metadata?.id])).toEqual([
      [1, "run_1", "ses_1", "run_1"],
      [2, "run_2", "ses_2", "run_2"],
    ]);
    expect(result.sightings.every((s) => s.waitedMs === undefined)).toBe(true);
    expect(server.terminated).toEqual([]);
    expect(server.sessionsDeleted.sort()).toEqual(["ses_1", "ses_2"]);
    expect(server.agentsDeleted).toEqual(["agt_1"]);
    expect(result.leftBehind).toEqual([]);
    expect(result.interrupted).toBe(false);
    expect(seen).toEqual([
      { sent: 2, started: 0, waiting: 2, refused: 0 },
      { sent: 2, started: 1, waiting: 1, refused: 0 },
      { sent: 2, started: 2, waiting: 0, refused: 0 },
    ]);
  });

  it("leaves the model to the agent when none is asked for", async () => {
    const server = new LoadTestServer([completes("run_1")]);
    await runBurst(server, options({ agents: 1 }));
    expect(server.runsMade[0]?.runConfig).toEqual({ maxCostUsd: 0.5 });
  });

  it("keeps a refused create as its code and the server's sentence, and counts it", async () => {
    const refusal = new StigmerError("resource-exhausted", PLAN_SENTENCE, Code.ResourceExhausted);
    const server = new LoadTestServer([completes("run_1"), { refuse: refusal }]);
    const seen: BurstProgress[] = [];
    const result = await runBurst(server, options({ onProgress: (p) => seen.push(p) }));

    expect(result.sightings[1]).toEqual({ index: 2, runId: "", sessionId: "", refusal: { code: "resource-exhausted", message: PLAN_SENTENCE } });
    expect(seen[0]).toEqual({ sent: 2, started: 0, waiting: 1, refused: 1 });
    expect(server.sessionsDeleted).toEqual(["ses_1"]);
  });

  it("keeps the largest wait for a sandbox, after the liveness that clears it", async () => {
    const server = new LoadTestServer([waitsThenCompletes("run_1")]);
    const result = await runBurst(server, options({ agents: 1 }));
    expect(result.sightings[0]?.waitedMs).toBe(20_000);
  });

  it("calls a run the watch outlived still open: terminated, then its conversation deleted", async () => {
    const server = new LoadTestServer([completes("run_1"), waitsOn("run_2", 40)]);
    const seen: BurstProgress[] = [];
    const result = await runBurst(server, options({ waitMs: 50, onProgress: (p) => seen.push(p) }));

    expect(result.sightings[1]?.waitedMs).toBe(40_000);
    expect(result.sightings[1]?.run?.status?.phase).toBe(RunPhase.RUN_PENDING);
    expect(server.follows.get("ses_2")?.aborted).toBe(true);
    expect(server.terminated).toEqual(["run_2"]);
    expect(server.sessionsDeleted.sort()).toEqual(["ses_1", "ses_2"]);
    expect(result.interrupted).toBe(false);
    expect(seen.at(-1)).toEqual({ sent: 2, started: 1, waiting: 1, refused: 0 });
  });

  it("on Ctrl-C aborts every follow, cleans up, and says it was interrupted", async () => {
    const server = new LoadTestServer([waitsOn("run_1", 5), waitsOn("run_2", 10)]);
    const ctrlC = new AbortController();
    server.onAllFollowing = () => ctrlC.abort();
    const result = await runBurst(server, options({ waitMs: 60_000, signal: ctrlC.signal }));

    expect(result.interrupted).toBe(true);
    expect([...server.follows.values()].every((signal) => signal.aborted)).toBe(true);
    expect(server.terminated.sort()).toEqual(["run_1", "run_2"]);
    expect(server.sessionsDeleted.sort()).toEqual(["ses_1", "ses_2"]);
    expect(server.agentsDeleted).toEqual(["agt_1"]);
  });

  it("returns what it could not delete, and terminates a run it could not read", async () => {
    const server = new LoadTestServer([{ frames: [frameOf(user("run_1", "hi")), frameOf(phase("run_1", "completed"))] }]);
    server.undeletableSessions.add("ses_1");
    server.agentDeleteFails = true;
    const result = await runBurst(server, options({ agents: 1 }));

    expect(result.sightings[0]?.run).toBeUndefined();
    expect(server.terminated).toEqual(["run_1"]);
    expect(result.leftBehind).toEqual(["conversation ses_1", "agent agt_1"]);
  });

  it("reads the run after a follow the server refused", async () => {
    const server = new LoadTestServer([{ frames: [], streamError: new StigmerError("permission-denied", "no", Code.PermissionDenied), run: runOf({ phase: RunPhase.RUN_PENDING }) }]);
    const result = await runBurst(server, options({ agents: 1 }));
    expect(result.sightings[0]?.run?.status?.phase).toBe(RunPhase.RUN_PENDING);
  });

  it("refuses nothing itself when the agent's create is refused: the refusal throws through", async () => {
    const server = new LoadTestServer([]);
    server.agentCreateRefusal = new StigmerError("permission-denied", "not a member", Code.PermissionDenied);
    await expect(runBurst(server, options())).rejects.toThrow("not a member");
    expect(server.runsMade).toEqual([]);
  });

  it("names the agent's organization when the server filled it", async () => {
    const server = new LoadTestServer([completes("run_1")]);
    await runBurst(server, options({ org: "", agents: 1 }));
    expect(server.runsMade[0]).toMatchObject({ org: "solo", sessionSpec: { agentRef: { org: "solo" } } });
  });
});

describe("refusalOf", () => {
  it("reads a StigmerError's code and sentence, and any other error's message", () => {
    expect(refusalOf(new StigmerError("unavailable", "down", Code.Unavailable))).toEqual({ code: "unavailable", message: "down" });
    expect(refusalOf(new Error("socket hang up"))).toEqual({ code: "unknown", message: "socket hang up" });
    expect(refusalOf("odd")).toEqual({ code: "unknown", message: "odd" });
  });
});
