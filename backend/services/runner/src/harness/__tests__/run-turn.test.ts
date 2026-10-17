/**
 * The turn runtime, proven without any engine: the scripted fake adapter
 * (`__test-utils__/harness-contract/scripted-adapter.ts`) through the kit's
 * runtime-side half (`__test-utils__/harness-contract/runtime-contract.ts`)
 * under `MockActivityEnvironment`, one arm per row of the terminal table.
 *
 * The runtime-side contract itself — the throw-vs-return rule end to end, the
 * single persist chokepoint, the whole-activity heartbeat, the stop
 * controller's four producers, the reinvocation seam, the byte-pinned copy —
 * is the kit's and is registered here through `describeHarnessRuntimeContract`
 * exactly as `activities/execute-cursor/__tests__/hermetic/harness-contract.test.ts`
 * registers it against the real Cursor adapter. An arm that differs between
 * the fake and the real engine is an adapter defect, not a runtime one.
 *
 * What is asserted HERE and not in the kit are the FAKE's facts: the engine
 * cadence a real engine has no reason to share. The fake's `say` awaits its
 * persist and its `propose` persists nothing before returning
 * `awaiting_approval`, so under the runtime its first full write IS the
 * WAITING write (`persistedPhases === [WAITING_FOR_APPROVAL]`) where a
 * streaming engine's IN_PROGRESS writes precede it; the fake has no setup
 * labels of its own, so the runtime's six are the whole list; the fake states
 * its own price, so the cost copy reads exactly `~$0.6000`; and the fake's
 * failure messages reach the status verbatim, where a real engine's
 * classifier rephrases them.
 *
 * The hermetic environment is created at module level because the subject's
 * `config` is read at collection time; the forks pool keeps it private to
 * this file.
 */

import { createServer, connect, type AddressInfo } from "node:net";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";

vi.mock("../../client/stigmer-client.js", async () =>
  (await import("../../__test-utils__/hermetic-activity.js")).hermeticStigmerClientModule(),
);

import { ScriptedClock, createHermeticEnvironment } from "../../__test-utils__/hermetic-activity.js";
import { stubRegistryFetch } from "../../__test-utils__/model-registry-fixture.js";
import { scriptedSubject } from "../../__test-utils__/harness-contract/scripted-adapter.js";
import { initGitWorkspace, localPathEntry } from "../../__test-utils__/git-workspace-fixture.js";
import { scenario } from "../../__test-utils__/harness-contract/types.js";
import { WriteBackCoordinator } from "../../shared/workspace/writeback-coordinator.js";
import {
  COST_CAP_FAKE_PRICE_USD,
  FAILURE_MESSAGES,
  RUNTIME_SETUP_LABELS,
  aiMessages,
  assertApprovalRoundTrip,
  assertCompletedTurn,
  assertCostCapTerminates,
  assertFailedSurfaceWritesItsCopy,
  assertNonExecutingDecisionSettlesSkipped,
  assertRejectedBindFails,
  assertWorkspaceLockTimeoutFails,
  describeHarnessRuntimeContract,
  RuntimeExecutionDriver,
  slimOf,
  systemMessages,
  type RuntimeContractHarness,
} from "../../__test-utils__/harness-contract/runtime-contract.js";
import { captureTimingLines } from "../../__test-utils__/timing-lines.js";
import { TERMINAL_COPY } from "../terminal-table.js";
import { TURN_PHASES_EVENT } from "../turn-timeline.js";
import type { HarnessAdapter } from "../types.js";
import { ApprovalAction } from "../../gen/turn/ai/stigmer/runner/turn/v1/enum_pb.js";

const TASK_QUEUE = "runtime-test-queue";

const env = createHermeticEnvironment();
const clock = new ScriptedClock();
const subject = scriptedSubject({
  pausePrimitive: "interrupt",
  stateIdSource: "engine-minted",
  config: { workspaceRootDir: env.workspaceRootDir, taskQueue: TASK_QUEUE },
});
const harness: RuntimeContractHarness = { subject, env, clock };

describe("run-turn: the fake adapter through the real runtime", () => {
  let registry: ReturnType<typeof stubRegistryFetch>;

  beforeAll(() => {
    registry = stubRegistryFetch();
    clock.install();
  });

  afterAll(() => {
    clock.uninstall();
    registry.restore();
    env.dispose();
  });

  describeHarnessRuntimeContract(harness);

  describe("the fake's own facts", () => {
    beforeAll(async () => {
      await subject.adapter.boot(subject.config);
    });

    it("a completed turn: the runtime's six labels are the whole list, the phases, the stated price and its basis", async () => {
      clock.reset();
      const { driver, final } = await assertCompletedTurn(harness, "fake-completed");
      expect(driver.record.persistedPhases).toEqual([RunPhase.RUN_IN_PROGRESS, RunPhase.RUN_COMPLETED]);
      expect(driver.record.setupProgress).toEqual([...RUNTIME_SETUP_LABELS]);
      expect(final.streamingUsage?.estimatedCostUsd, "the summary is the adapter's stated price, summed").toBeCloseTo(0.00136, 9);
      expect(final.streamingUsage?.model, "the basis the adapter named").toBe("fixture-model");
      expect(registry.urls.every((u) => u.includes("/model-registry"))).toBe(true);
    });

    it("the approval round trip: the WAITING write is the fake's first full persist", async () => {
      clock.reset();
      const { driver } = await assertApprovalRoundTrip(harness, "fake-approval");
      expect(driver.record.persistedPhases).toEqual([
        RunPhase.RUN_WAITING_FOR_APPROVAL,
        RunPhase.RUN_IN_PROGRESS,
        RunPhase.RUN_COMPLETED,
      ]);
      expect(driver.record.harnessBinds, "an engine-minted adapter binds once across the round trip").toHaveLength(1);
    });

    it("the cost cap: the fake's stated price reads exactly in the copy", async () => {
      clock.reset();
      const { final } = await assertCostCapTerminates(harness, "fake-cost-cap");
      expect(final.error).toBe(`Agent reached the cost limit for this message (~$${COST_CAP_FAKE_PRICE_USD.toFixed(4)} of the $0.50 budget). Send another message to continue.`);
      expect(final.streamingUsage?.estimatedCostUsd).toBe(COST_CAP_FAKE_PRICE_USD);
    });

    it.each([
      ["engine", []],
      ["actionable", [`Execution failed: ${FAILURE_MESSAGES.actionable}`]],
      ["internal", [TERMINAL_COPY.internalFailure.row, `Error details: ${FAILURE_MESSAGES.internal}`]],
    ] as const)("a %s failure: the fake's message reaches the status verbatim, with that surface's rows", async (surface, rows) => {
      clock.reset();
      const { driver, final } = await assertFailedSurfaceWritesItsCopy(harness, surface, FAILURE_MESSAGES[surface], `fake-failed-${surface}`);
      expect(driver.record.persistedPhases).toEqual([RunPhase.RUN_IN_PROGRESS, RunPhase.RUN_FAILED]);
      expect(final.error).toBe(FAILURE_MESSAGES[surface]);
      expect(systemMessages(driver.record.rowsOf(final))).toEqual(rows);
    });

    it("a rejected bind: the fake names the failure and nothing of the scenario was folded in", async () => {
      clock.reset();
      const { driver, final } = await assertRejectedBindFails(harness, "fake-bind-rejects");
      expect(final.error).toContain("could not bind engine state");
      expect(aiMessages(driver.record.rowsOf(final))).toEqual([]);
    });

    it("REJECT continues the run without the tool and the row settles SKIPPED with its reason (stigmer#197)", async () => {
      // Until #1096 this arm pinned the opposite: the runtime FAILED a
      // reinvocation carrying any REJECT (`rejectedByUserArm`, Cursor's
      // legacy), against the proto's `APPROVAL_ACTION_REJECT` doc, the
      // conformance suite and the native harness.
      // The kit's runtime half now carries the contract for every subject;
      // what is the fake's own here is the persist cadence around it.
      clock.reset();
      const { driver, final } = await assertNonExecutingDecisionSettlesSkipped(harness, "", "fake-reject");
      expect(driver.record.persistedPhases).toEqual([
        RunPhase.RUN_WAITING_FOR_APPROVAL,
        RunPhase.RUN_IN_PROGRESS,
        RunPhase.RUN_COMPLETED,
      ]);
      expect(aiMessages(driver.record.rowsOf(final))).toContain("Moving on.");
      expect(systemMessages(driver.record.rowsOf(final)), "no terminal copy: the run ended normally").toEqual([]);
    });

    it("a resumed invocation that writes no message still reports the run's answer: its newest answer in the log", async () => {
      // Turn 1 answers and asks; the approved resume only runs the call and
      // writes no message of its own. The run's answer is turn 1's, read
      // from the session's log, and the structured output the execution
      // asked for is extracted from it at the completion.
      clock.reset();
      const driver = new RuntimeExecutionDriver(harness, "fake-resumed-answer", {
        structuredOutputSchema: { type: "object", properties: { answer: { type: "number" } }, required: ["answer"] },
      });
      const propose = scenario.propose("fake-resumed-answer-shell", { kind: "shell", resource: "make report" });
      const first = await driver.turn([scenario.say('{"answer": 42}'), propose]);
      expect(slimOf(subject, first).phase).toBe("RUN_WAITING_FOR_APPROVAL");
      expect(driver.decide(ApprovalAction.APPROVE)).toBe(1);

      // The read's awaited persist lands the approved call's write before the
      // turn completes, so the completion is the turn's one write in flight.
      const second = await driver.turn([propose, scenario.read("fake-resumed-answer-read", "notes.md")]);
      expect(slimOf(subject, second).phase).toBe("RUN_COMPLETED");
      expect(aiMessages(driver.record.lastFullRows!), "the resumed invocation wrote no message").toEqual([]);
      expect(driver.record.lastFullRows?.structuredOutput, "the run's answer is reported").toEqual({ answer: 42 });
      const outputs = driver.record.sessionEvents.flatMap((e) => (e.event.case === "stigmerAgentStructuredOutput" ? [e.event.value.output] : []));
      expect(outputs, "and written to the log").toEqual([{ answer: 42 }]);
      expect(driver.record.refusedAppends).toEqual([]);
    });

    it("structured output on a turn with captured edits is resolved at its completion: review never holds the answer back", async () => {
      clock.reset();
      const driver = new RuntimeExecutionDriver(harness, "fake-review-structured", {
        fileReview: true,
        structuredOutputSchema: { type: "object", properties: { answer: { type: "number" } }, required: ["answer"] },
      });
      initGitWorkspace(driver.workspaceDir, { "README.md": "# kit\n" });

      // The engine edits a file and answers in JSON (tier 1 extracts it; no
      // LLM is asked); the edit is captured and the turn completes with it.
      const first = await driver.turn([scenario.flowingWrite("fake-review-structured-w", "answer.md"), scenario.say('{"answer": 42}')]);
      expect(slimOf(subject, first).phase).toBe("RUN_COMPLETED");
      expect(driver.record.lastFullRows?.structuredOutput, "resolved on the completion write").toEqual({ answer: 42 });
      expect(driver.record.lastFullRows?.fileReviewEventStream?.events.map((e) => e.payload.case)).toEqual(["baselineCaptured", "candidateCaptured"]);
    });
  });

  describe("the runtime's own transcript rules", () => {
    it("finalizes the transcript once runTurn returns: an adapter that leaves its last message streaming still persists a settled one", async () => {
      // A harness that streams text and returns without closing the run —
      // the shape of a turn that fails or is cut off before its own settle
      // (native's thrown recursion limit; either harness's internal failure
      // before its settle ran). Before the runtime owned the close, that
      // message persisted `isStreaming: true` in a terminal execution: a
      // spinner the console never stopped, seen by the kit on both real
      // adapters. The rule lives in `run-turn.ts`, so its proof lives here.
      const streamsAndLeaves: HarnessAdapter = {
        ...subject.adapter,
        name: "streams-and-leaves",
        boot: (config) => subject.adapter.boot(config),
        shutdown: () => subject.adapter.shutdown(),
        releaseSession: (sessionId) => subject.adapter.releaseSession(sessionId),
        async runTurn(_input, sink) {
          sink.transcript.apply({ kind: "message_start", runId: "r1" });
          sink.transcript.apply({ kind: "text_delta", runId: "r1", text: "half a thou" });
          sink.transcript.apply({ kind: "tool_started", callId: "t1", name: "shell", input: { command: "make" }, mcpServerSlug: "" });
          sink.transcript.apply({ kind: "tool_output_delta", callId: "t1", delta: "building" });
          return { kind: "completed" };
        },
      };
      const leaving: RuntimeContractHarness = { ...harness, subject: { ...subject, name: streamsAndLeaves.name, adapter: streamsAndLeaves } };
      await streamsAndLeaves.boot(subject.config);
      clock.reset();
      const driver = new RuntimeExecutionDriver(leaving, "fake-streams-and-leaves");
      const invocation = await driver.turn([]);

      expect(slimOf(leaving.subject, invocation).phase).toBe("RUN_COMPLETED");
      const final = driver.record.lastFullRows!;
      expect(final.messages.map((m) => [m.content, m.isStreaming]), "the message the adapter left open is closed").toEqual([["half a thou", false]]);
      const row = final.messages[0]!.toolCalls[0]!;
      expect([row.id, row.isStreaming, row.result], "the row the adapter left streaming output is closed, its output kept").toEqual(["t1", false, "building"]);
    });
  });

  describe("a write the agent host requests", () => {
    // The host's calls reach the runner on its pipe's I/O events, which carry
    // no activity context (stigmer#2090). A server made here, outside the
    // activity, runs the request on its own socket's event the same way.
    function outsideTheActivity(): Promise<{ readonly run: <T>(call: () => Promise<T>) => Promise<T>; readonly close: () => void }> {
      return new Promise((ready) => {
        const queue: (() => void)[] = [];
        const server = createServer((socket) => socket.on("data", () => queue.shift()?.()));
        server.listen(0, "127.0.0.1", () => {
          const client = connect((server.address() as AddressInfo).port, "127.0.0.1", () =>
            ready({
              run: (call) =>
                new Promise((resolve, reject) => {
                  queue.push(() => void call().then(resolve, reject));
                  client.write("x");
                }),
              close: () => {
                client.destroy();
                server.close();
              },
            }),
          );
        });
      });
    }

    it("persists it, heartbeat included, when it arrives outside the activity's async context", async () => {
      const outside = await outsideTheActivity();
      let persisted: string | undefined;
      const persistsFromOutside: HarnessAdapter = {
        ...subject.adapter,
        name: "persists-from-outside",
        boot: (config) => subject.adapter.boot(config),
        shutdown: () => subject.adapter.shutdown(),
        releaseSession: (sessionId) => subject.adapter.releaseSession(sessionId),
        async runTurn(_input, sink) {
          sink.transcript.apply({ kind: "message_start", runId: "r1" });
          sink.transcript.apply({ kind: "text_delta", runId: "r1", text: "from the host" });
          persisted = await outside.run(() => sink.requestPersist()).then(
            () => "persisted",
            (err: unknown) => (err instanceof Error ? err.message : String(err)),
          );
          return { kind: "completed" };
        },
      };
      const fromOutside: RuntimeContractHarness = { ...harness, subject: { ...subject, name: persistsFromOutside.name, adapter: persistsFromOutside } };
      await persistsFromOutside.boot(subject.config);
      clock.reset();
      const driver = new RuntimeExecutionDriver(fromOutside, "fake-persists-from-outside");
      const invocation = await driver.turn([]).finally(() => outside.close());

      expect(persisted).toBe("persisted");
      expect(slimOf(fromOutside.subject, invocation).phase).toBe("RUN_COMPLETED");
    });
  });

  describe("the runtime's turn timeline", () => {
    // `run-turn.ts` emits the `turn_phases` line once, after the adapter
    // returns and the transcript is finalized, on every outcome; a turn that
    // never reached the engine emits none. The line's CONTENT is
    // `turn-timeline.test.ts`'s; what is pinned here is the runtime's act:
    // that the fold is installed on the one builder the adapter is handed,
    // that the line names the adapter and the activity's turn, and that it is
    // written for a failed turn as for a completed one.
    const turnPhasesLines = (act: () => Promise<void>) => captureTimingLines(TURN_PHASES_EVENT, act);

    it("writes one turn_phases line for a completed turn, naming the adapter, the turn and what the fold saw", async () => {
      clock.reset();
      const driver = new RuntimeExecutionDriver(harness, "fake-timeline-completed");
      const lines = await turnPhasesLines(async () => {
        const invocation = await driver.turn([scenario.say("Reading it."), scenario.read("t1", "notes.md"), scenario.say("Done.")]);
        expect(slimOf(subject, invocation).phase).toBe("RUN_COMPLETED");
      });

      expect(lines).toHaveLength(1);
      const [line] = lines;
      expect(line!.harness).toBe(subject.adapter.name);
      expect(line!.outcome).toBe("completed");
      expect(line!.turn_seq).toBeTypeOf("number");
      expect(line!.rounds, "two `say`s, two rounds").toBe(2);
      expect(line!.tool_calls, "one `read`").toBe(1);
      expect(line!.first_text_ms).toBeTypeOf("number");
    });

    it("writes the line for a failed turn too: every outcome is measured", async () => {
      clock.reset();
      const driver = new RuntimeExecutionDriver(harness, "fake-timeline-failed");
      const lines = await turnPhasesLines(async () => {
        const invocation = await driver.turn([scenario.say("Checking."), scenario.fail("engine gave up")]);
        expect(slimOf(subject, invocation).phase).toBe("RUN_FAILED");
      });

      expect(lines).toHaveLength(1);
      expect(lines[0]!.outcome).toBe("failed");
      expect(lines[0]!.rounds).toBe(1);
    });

    it("writes no line for a turn that settled during resolution: no engine, no phases", async () => {
      clock.reset();
      const lines = await turnPhasesLines(async () => {
        await assertWorkspaceLockTimeoutFails(harness, "fake-timeline-no-engine");
      });
      expect(lines).toEqual([]);
    });
  });

  describe("the runtime's write-back rule", () => {
    // `run-turn.ts` calls `frame.writeback.finalize()` in exactly two places:
    // once when a completed turn reaches its epilogue, and once when a
    // reconcile turn puts undone files back cleanly — never when the undo
    // failed, since diverged bytes must not reach a remote. These arms pin the CALL and its
    // guards, not the coordinator's own behaviour (`writeback-coordinator.test.ts`
    // does that): the session mounts a local path so a coordinator exists
    // (`provisionWorkspace` builds one whenever the session has an entry; with
    // no git remote it has nothing eligible and `finalize` is a no-op loop), and
    // the spy sits on the prototype because the coordinator is constructed
    // inside `provisionWorkspace` with no injection seam — adding one for a
    // test would be a production change the arm does not need.
    const finalize = vi.spyOn(WriteBackCoordinator.prototype, "finalize");

    afterAll(() => {
      finalize.mockRestore();
    });

    function driverWithLocalWorkspace(label: string, fileReview = false): { driver: RuntimeExecutionDriver; repo: string } {
      const repo = join(env.workspaceRootDir, "repos", label);
      initGitWorkspace(repo, { "README.md": "# write-back\n" });
      const driver = new RuntimeExecutionDriver(harness, label, { workspaceEntries: [localPathEntry("notes", repo)], fileReview });
      return { driver, repo };
    }

    it("a completed turn finalizes the write-back exactly once", async () => {
      clock.reset();
      finalize.mockClear();
      const { driver } = driverWithLocalWorkspace("fake-writeback-completed");

      const invocation = await driver.turn([scenario.say("Nothing to change.")]);

      expect(slimOf(subject, invocation).phase).toBe("RUN_COMPLETED");
      expect(finalize, "the completion epilogue's one call").toHaveBeenCalledTimes(1);
    });

    it("a turn with review on finalizes at its completion, and a reconcile turn that puts an undo back finalizes once more", async () => {
      clock.reset();
      finalize.mockClear();
      const { driver } = driverWithLocalWorkspace("fake-writeback-review", true);

      const first = await driver.turn([scenario.flowingWrite("fake-writeback-review-w", "answer.md"), scenario.say("Written.")]);
      expect(slimOf(subject, first).phase).toBe("RUN_COMPLETED");
      expect(finalize, "the completion epilogue's one call: review never holds the push").toHaveBeenCalledTimes(1);

      clock.tick();
      driver.record.decideCapturedFileChanges({ reject: ["answer.md"] }, new Date().toISOString());
      const { invocation: second } = await driver.reconcileTurn();

      expect(slimOf(subject, second).phase).toBe("RUN_COMPLETED");
      expect(finalize, "the reconcile turn's one call pushes the tree with the file put back").toHaveBeenCalledTimes(2);
    });

    it("a reconcile turn whose undo fails never finalizes", async () => {
      clock.reset();
      finalize.mockClear();
      const { driver } = driverWithLocalWorkspace("fake-writeback-diverged", true);

      const first = await driver.turn([scenario.flowingWrite("fake-writeback-diverged-w", "answer.md"), scenario.say("Written.")]);
      expect(slimOf(subject, first).phase).toBe("RUN_COMPLETED");
      expect(finalize).toHaveBeenCalledTimes(1);

      // What is undone must be what was reviewed. On the git substrate the
      // undo restores from the pinned refs, so the failure path is the
      // ledger's digest disagreeing with the captured bytes — the same
      // divergence `capture.test.ts` drives at unit level. The undo then
      // restores nothing, the reconcile turn completes with the refusal on
      // its transcript — and nothing may be pushed from the tree.
      clock.tick();
      driver.record.decideCapturedFileChanges({ reject: ["answer.md"] }, new Date().toISOString());
      const decided = driver.record.status!.fileChanges.at(-1)!.changes.find((c) => c.pathAfter === "answer.md")!;
      decided.afterSha256 = "deadbeef".repeat(8);
      const { invocation: second } = await driver.reconcileTurn();

      expect(slimOf(subject, second).phase).toBe("RUN_COMPLETED");
      const final = driver.record.rowsOf(driver.record.reconcileFinalStatus!);
      expect(
        final.messages.some((m) => m.content.startsWith(TERMINAL_COPY.fileReview.applyFailedPrefix)),
        "the reconcile turn reported its refusal",
      ).toBe(true);
      expect(finalize, "diverged bytes never reach a remote").toHaveBeenCalledTimes(1);
    });
  });
});
