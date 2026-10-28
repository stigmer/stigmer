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
 * The long-turn arms the fake fails today (a silent operation, streamed
 * output, a continued turn) are the runtime's gaps, marked by their issue;
 * the fake has no subagents and no context, so those two arms are off.
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
 * The runtime's wait on the sandbox's Environment install
 * (`environment/install.ts`) is pinned here too: a turn awaits the boot's
 * install before its resolution, so a failed install fails the turn with
 * the install's own message and nothing of the engine runs, and a clean one
 * lets the turn run. The install is started through its own seam
 * (`startEnvironmentInstall` with a stand-in command runner) and forgotten
 * after each arm.
 *
 * The outputs folder is collected here, on every outcome of a turn whose
 * engine ran, before its final write, and never for a turn settled before
 * its engine: the rule lives in `run-turn.ts`, so its proof lives here. So
 * does the plan a Plan-mode turn returns: its final message saved into the
 * folder and returned as one File of the turn, with no artifact store.
 *
 * So is the interval of the turn's whole-activity heartbeat: the cancellation
 * pulse (`shared/heartbeat.ts`), half the bound on how soon a pause reaches a
 * turn; the module's `startHeartbeat` is spied on, calling through.
 *
 * The hermetic environment is created at module level because the subject's
 * `config` is read at collection time; the forks pool keeps it private to
 * this file.
 */

import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { create } from "@bufbuild/protobuf";
import { FileMountSchema } from "@stigmer/apis/ai/stigmer/agentic/file/v1/run_files_pb";
import { createServer, connect, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { InteractionMode, RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { isPlanFileName, PLAN_STAGING_FILE, planFileName } from "../../shared/plan-file.js";
import { getPlatformDir } from "../../shared/workspace/platform-dir.js";
import { acquireWorkspaceLock } from "../../shared/workspace/workspace-lock.js";
import { CANCELLATION_PULSE_MS, startHeartbeat } from "../../shared/heartbeat.js";

vi.mock("../../client/stigmer-client.js", async () =>
  (await import("../../__test-utils__/hermetic-activity.js")).hermeticStigmerClientModule(),
);
vi.mock("../../shared/heartbeat.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../shared/heartbeat.js")>();
  return { ...actual, startHeartbeat: vi.fn(actual.startHeartbeat) };
});

import {
  ScriptedClock,
  continuationCauseOf,
  createHermeticEnvironment,
  threwCancelledFailure,
  type InvocationControls,
} from "../../__test-utils__/hermetic-activity.js";
import { HERMETIC_UPLOAD_ORIGIN, hermeticUploads, stubRegistryFetch } from "../../__test-utils__/model-registry-fixture.js";
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
import { environmentInstalled, resetEnvironmentInstallForTests, startEnvironmentInstall, type CommandRunner } from "../../environment/install.js";
import { TURN_PHASES_EVENT } from "../turn-timeline.js";
import type { HarnessAdapter } from "../types.js";
import { ApprovalAction } from "../../gen/turn/ai/stigmer/runner/turn/v1/enum_pb.js";

const TASK_QUEUE = "runtime-test-queue";

const env = createHermeticEnvironment();
const clock = new ScriptedClock();
const subject = scriptedSubject({
  pausePrimitive: "interrupt",
  stateIdSource: "engine-minted",
  continuation: "digest",
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

  describeHarnessRuntimeContract(harness, {
    subagentOperation: false,
    compaction: false,
  });

  describe("the fake's own facts", () => {
    beforeAll(async () => {
      await subject.adapter.boot(subject.config);
    });

    it("a message sent with a file while the turn works is read by it, its file mounted as the turn's own are", async () => {
      clock.reset();
      const bytes = Buffer.from("# notes\n");
      hermeticUploads.set("/file_notes", bytes);
      const url = `${HERMETIC_UPLOAD_ORIGIN}/file_notes`;
      const driver = new RuntimeExecutionDriver(harness, "fake-message-file");
      driver.record.sendMessage("Read my notes.", ["file_notes"]);
      const mount = create(FileMountSchema, { fileId: "file_notes", mountPath: "notes.md", filename: "notes.md", mimeType: "text/markdown", sizeBytes: BigInt(bytes.length), url });
      const turn = await driver.turn([scenario.say("Done.")], { clientOverrides: { mountRunFiles: vi.fn(async () => [mount]) } });
      expect(slimOf(subject, turn).phase).toBe("RUN_COMPLETED");
      expect(subject.longTurn!.messagesRead(driver.sessionId, "Read my notes."), "the turn read the message").toBe(1);
      expect(readFileSync(join(getPlatformDir(driver.sessionId), "uploads", "notes.md"), "utf8"), "its file is mounted").toBe("# notes\n");
      // The File's link is the one fetch besides the registry; the other
      // tests' "registry only" reads hold for every turn but this one.
      expect(registry.urls.filter((u) => u === url)).toHaveLength(1);
      registry.urls.splice(registry.urls.indexOf(url), 1);
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
      const { driver } = await assertApprovalRoundTrip(harness, undefined, "fake-approval");
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
      const { driver, final } = await assertNonExecutingDecisionSettlesSkipped(harness, "", undefined, "fake-reject");
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

  describe("the outputs folder", () => {
    beforeAll(async () => {
      await subject.adapter.boot(subject.config);
    });

    /** Put a file in the session's outputs folder, as the agent would have saved it. */
    function saveOutput(driver: RuntimeExecutionDriver, outputPath: string, content: string): void {
      const path = join(getPlatformDir(driver.sessionId), "outputs", outputPath);
      mkdirSync(join(path, ".."), { recursive: true });
      writeFileSync(path, content, "utf-8");
    }

    function assertReturnedBeforeTheFinalWrite(driver: RuntimeExecutionDriver, outputPath: string): void {
      expect(driver.record.registeredOutputs.map((o) => o.outputPath)).toEqual([outputPath]);
      const [output] = driver.record.registeredOutputs;
      expect(output!.persistedBefore, "registered before the turn's final write").toBeLessThan(driver.record.persisted.length);
    }

    it.each([
      ["completed", [scenario.say("Saved the report.")], "RUN_COMPLETED"],
      ["waiting for an approval", [scenario.propose("fake-outputs-shell", { kind: "shell", resource: "make report" })], "RUN_WAITING_FOR_APPROVAL"],
      ["failed", [scenario.fail("the engine broke", "engine")], "RUN_FAILED"],
      ["at its tool-call limit", [scenario.limit()], "RUN_TERMINATED"],
    ] as const)("a turn %s returns what was saved", async (label, turn, phase) => {
      clock.reset();
      const driver = new RuntimeExecutionDriver(harness, `fake-outputs-${label.replace(/ /g, "-")}`);
      saveOutput(driver, "reports/summary.md", "# Summary\n");
      const invocation = await driver.turn([...turn]);
      expect(slimOf(subject, invocation).phase).toBe(phase);
      assertReturnedBeforeTheFinalWrite(driver, "reports/summary.md");
    });

    it("a turn a person stopped returns what was saved before the stop", async () => {
      clock.reset();
      const driver = new RuntimeExecutionDriver(harness, "fake-outputs-stopped");
      saveOutput(driver, "draft.md", "half done\n");
      let controls: { cancel(): void } | undefined;
      void subject.whenHanging().then(() => controls!.cancel());
      await driver.turn([scenario.say("Starting."), scenario.hang()], { onControls: (c) => (controls = c) });
      assertReturnedBeforeTheFinalWrite(driver, "draft.md");
    });

    it("a Plan-mode turn returns its plan as one File of the turn, with no artifact store", async () => {
      clock.reset();
      const plan = "# Migrate billing\n\n1. Move the ledger.\n2. Switch the reads.\n";
      const saved = process.env.ARTIFACT_STORAGE_TYPE;
      process.env.ARTIFACT_STORAGE_TYPE = "none";
      try {
        const driver = new RuntimeExecutionDriver(harness, "fake-outputs-plan");
        driver.record.execution.spec!.interactionMode = InteractionMode.PLAN;
        const invocation = await driver.turn([scenario.say(plan)]);
        expect(slimOf(subject, invocation).phase).toBe("RUN_COMPLETED");
        assertReturnedBeforeTheFinalWrite(driver, planFileName(plan));
        const [output] = driver.record.registeredOutputs;
        expect(isPlanFileName(output!.outputPath)).toBe(true);
        expect(output!.runId, "a File of this turn").toBe(driver.record.executionId);
        expect(new TextDecoder().decode(hermeticUploads.get(`/${output!.uploadRef}`)), "the plan's own text").toBe(plan);
      } finally {
        if (saved === undefined) delete process.env.ARTIFACT_STORAGE_TYPE;
        else process.env.ARTIFACT_STORAGE_TYPE = saved;
      }
    });

    it("a Plan-mode turn whose plan cannot be saved still completes, returns no plan and warns once", async () => {
      clock.reset();
      const driver = new RuntimeExecutionDriver(harness, "fake-outputs-plan-unsaved");
      driver.record.execution.spec!.interactionMode = InteractionMode.PLAN;
      // A directory where the plan is staged: the save's write fails for real.
      mkdirSync(join(getPlatformDir(driver.sessionId), PLAN_STAGING_FILE), { recursive: true });
      const warn = vi.spyOn(console, "warn");
      try {
        const invocation = await driver.turn([scenario.say("# Migrate billing\n\n1. Move the ledger.\n")]);
        expect(slimOf(subject, invocation).phase).toBe("RUN_COMPLETED");
        expect(driver.record.registeredOutputs, "no plan File").toEqual([]);
        const unsaved = warn.mock.calls.map((args) => String(args[0])).filter((line) => line.includes("plan not saved"));
        expect(unsaved).toHaveLength(1);
        expect(unsaved[0]).toContain(`execution=${driver.record.executionId}`);
      } finally {
        warn.mockRestore();
      }
    });

    it("a turn settled before its engine ran returns nothing", async () => {
      clock.reset();
      const driver = new RuntimeExecutionDriver(harness, "fake-outputs-lock-timeout");
      saveOutput(driver, "earlier.md", "from an earlier turn\n");
      mkdirSync(driver.workspaceDir, { recursive: true });
      const release = await acquireWorkspaceLock(driver.workspaceDir);
      try {
        const invocation = await driver.turn([scenario.say("never")], { config: { workspaceLockTimeoutMs: 500 } });
        expect(slimOf(subject, invocation).phase).toBe("RUN_FAILED");
      } finally {
        await release();
      }
      expect(driver.record.registeredOutputs).toEqual([]);
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

  describe("a drain the turn meets", () => {
    beforeAll(async () => {
      await subject.adapter.boot(subject.config);
    });

    for (const [when, signal] of [
      ["a drain", (c: InvocationControls) => c.signalWorkerShutdown()],
      ["a second signal", (c: InvocationControls) => c.signalWorkerStopNow()],
    ] as const) {
      it(`${when} that began before the turn: the engine does no work, and the turn continues with the drain's note`, async () => {
        clock.reset();
        const driver = new RuntimeExecutionDriver(harness, `fake-${when.replaceAll(" ", "-")}-before`);
        const invocation = await driver.turn([scenario.read("never-read", "README.md")], { onControls: signal });

        expect(continuationCauseOf(invocation.outcome)).toBe("drain");
        expect(subject.executionCount("never-read"), "the engine was entered and yielded before its first step").toBe(0);
        const settle = driver.record.persisted.at(-1)!;
        expect([settle.phase, settle.error, settle.completedAt]).toEqual([RunPhase.RUN_PHASE_UNSPECIFIED, "", ""]);
        expect(systemMessages(driver.record.rowsOf(settle))).toEqual([TERMINAL_COPY.continuation.notes.drain]);
      });
    }

    it("an error an engine throws after an infrastructure cancel writes no ending and throws the after-error copy", async () => {
      let controls: InvocationControls | undefined;
      const throwsWhenStopped: HarnessAdapter = {
        ...subject.adapter,
        name: "throws-when-stopped",
        boot: (config) => subject.adapter.boot(config),
        shutdown: () => subject.adapter.shutdown(),
        releaseSession: (sessionId) => subject.adapter.releaseSession(sessionId),
        async runTurn() {
          // Temporal times the activity out, and the engine's teardown throws.
          controls!.cancelTimedOut();
          throw new Error("teardown broke mid-flight");
        },
      };
      const throwing: RuntimeContractHarness = { ...harness, subject: { ...subject, name: throwsWhenStopped.name, adapter: throwsWhenStopped } };
      clock.reset();
      const driver = new RuntimeExecutionDriver(throwing, "fake-throws-after-cancel");
      const invocation = await driver.turn([], { onControls: (c) => (controls = c) });

      expect(threwCancelledFailure(invocation.outcome)).toBe(true);
      if (!threwCancelledFailure(invocation.outcome)) throw new Error("unreachable");
      expect(invocation.outcome.error.message).toBe(TERMINAL_COPY.infrastructureCancel.throwMessageAfterError);
      const settle = driver.record.persisted.at(-1)!;
      expect([settle.phase, settle.error, settle.completedAt, settle.stopCause]).toEqual([RunPhase.RUN_PHASE_UNSPECIFIED, "", "", ""]);
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

  describe("the sandbox's Environment install", () => {
    const NEVER_RUN = "This turn must not reach the engine.";
    let dir: string;
    let programs: string;
    let consoleError: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), "run-turn-environment-"));
      programs = join(dir, "programs");
      mkdirSync(programs);
      writeFileSync(join(programs, "npm"), "#!/bin/sh\nexit 0\n");
      chmodSync(join(programs, "npm"), 0o755);
      consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
      resetEnvironmentInstallForTests();
      consoleError.mockRestore();
      rmSync(dir, { recursive: true, force: true });
    });

    function startInstall(run: CommandRunner): void {
      startEnvironmentInstall(
        { network: "unrestricted", packages: { apt: [], cargo: [], gem: [], go: [], npm: ["express"], pip: [] } },
        { identity: null, prefix: join(dir, "prefix"), env: { PATH: programs }, run, log: () => {} },
      );
    }

    it("a failed install fails the turn with the install's message, and the engine never runs", async () => {
      startInstall(async () => ({ exitCode: 1, timedOut: false, output: "npm ERR! 404 express" }));
      await environmentInstalled().catch(() => undefined);
      clock.reset();
      const driver = new RuntimeExecutionDriver(harness, "fake-environment-failed");
      const invocation = await driver.turn([scenario.say(NEVER_RUN)]);

      expect(slimOf(subject, invocation).phase).toBe("RUN_FAILED");
      const final = driver.record.lastFullStatus!;
      expect(final.error).toContain("the environment's npm packages did not install: `npm install` exited 1");
      expect(aiMessages(driver.record.rowsOf(final))).not.toContain(NEVER_RUN);
      expect(driver.record.harnessBinds, "the engine was never reached").toHaveLength(0);
    });

    it("a clean install lets the turn run", async () => {
      const installs: string[][] = [];
      startInstall(async (argv) => {
        installs.push([...argv]);
        return { exitCode: 0, timedOut: false, output: "" };
      });
      clock.reset();
      const driver = new RuntimeExecutionDriver(harness, "fake-environment-installed");
      const invocation = await driver.turn([scenario.say("Installed and running.")]);

      expect(slimOf(subject, invocation).phase).toBe("RUN_COMPLETED");
      expect(installs.map((argv) => argv[0])).toEqual(["npm"]);
      expect(aiMessages(driver.record.rowsOf(driver.record.lastFullStatus!))).toContain("Installed and running.");
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

  describe("the runtime's cancellation pulse", () => {
    // A pause reaches a turn only on a heartbeat, and a turn waiting on a
    // silent model call or a long tool sends none but this pulse, so its
    // interval bounds how soon such a turn stops (stigmer#1378); the worker's
    // throttle is the other bound (`__tests__/worker.test.ts`).
    it("pulses the activity's heartbeat every CANCELLATION_PULSE_MS for the whole turn", async () => {
      clock.reset();
      vi.mocked(startHeartbeat).mockClear();
      const driver = new RuntimeExecutionDriver(harness, "fake-cancellation-pulse");
      const invocation = await driver.turn([scenario.say("Done.")]);

      expect(slimOf(subject, invocation).phase).toBe("RUN_COMPLETED");
      expect(vi.mocked(startHeartbeat).mock.calls.map(([intervalMs]) => intervalMs)).toEqual([CANCELLATION_PULSE_MS]);
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
      const driver = new RuntimeExecutionDriver(harness, label, { resources: [localPathEntry("notes", repo)], fileReview });
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
