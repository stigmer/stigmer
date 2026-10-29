/**
 * Hermetic scenario: a long tool result is kept whole, and the model sees its
 * start, its end and where the rest is, through the whole `ExecuteDeepAgent`
 * activity on the real graph with the scripted model.
 *
 * The run sets `max_tool_result_chars` to 4,000 and the command prints about
 * 20,000 characters: 2,000 numbered lines with a marked line in the middle,
 * then a failure on stderr and exit code 3. Before the truncation middleware
 * kept the end (`middleware/tool-truncation.ts`), the model saw the first
 * 4,000 characters and lost the failure, the exit status and the middle
 * together.
 *
 * Two arms:
 *  - The parent: the model's next request holds the start, the stderr line,
 *    the exit status and the pointer, within the bound; a `read_file` of the
 *    pointer from the offset the gap line names returns the marked line; the
 *    session's offload directory holds the whole output and the person's
 *    repository is untouched (`git status` clean); the person's row keeps the
 *    tool's own output, whole.
 *  - A sub-agent: the run's bound reaches it (it cut at 30,000 whatever the
 *    run said), its own long result is kept in the same session folder, and
 *    its long report reaches the parent cut, with its file, never whole
 *    through `task`'s Command.
 *
 * The shell's own 100,000-character capture is `run-command.test.ts`'s, on
 * real processes. Structure and side effects only; no golden.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { create } from "@bufbuild/protobuf";
import { ToolMessage, type BaseMessage } from "@langchain/core/messages";
import { AgentSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";

vi.mock("../../../../shared/model-client.js", async () =>
  (await import("../../__test-utils__/scripted-model-module.js")).scriptedModelClientModule(),
);
vi.mock("../../../../client/stigmer-client.js", async () =>
  (await import("../../../../__test-utils__/hermetic-activity.js")).hermeticStigmerClientModule(),
);

import {
  ScriptedClock,
  createHermeticEnvironment,
  type HermeticEnvironment,
} from "../../../../__test-utils__/hermetic-activity.js";
import { initGitWorkspace, localPathEntry } from "../../../../__test-utils__/git-workspace-fixture.js";
import { stubRegistryFetch } from "../../../../__test-utils__/model-registry-fixture.js";
import { FIXTURE, beginDeepAgentScenario, deepAgentExecutionRecord, runDeepAgentTurn } from "../../__test-utils__/hermetic-deep-agent.js";
import type { ScriptedTurn } from "../../__test-utils__/scripted-model.js";
import { getOffloadDir } from "../../../../shared/workspace/platform-dir.js";
import { ToolCallStatus } from "../../../../gen/turn/ai/stigmer/runner/turn/v1/enum_pb.js";

const BOUND = 4_000;
const MARKER = "MIDDLE-MARKER";
/** 2,000 lines of 10 characters, line 1,000 the marker, then a failure on stderr and exit 3. */
const LONG_FAILING_COMMAND =
  `for i in $(seq 1 2000); do if [ $i -eq 1000 ]; then echo ${MARKER}; else printf 'line %04d\\n' $i; fi; done; ` +
  "echo 'FAILED: 3 tests' >&2; exit 3";
const POINTER = /The whole result is kept at (\/large_tool_results\/[^:]+\.txt): read_file it from offset (\d+)/;

/** The text of the tool result answering `callId`, as the model was handed it (a string, or its text blocks). */
function toolResult(transcript: readonly BaseMessage[], callId: string): string | undefined {
  const message = transcript.find((m) => ToolMessage.isInstance(m) && m.tool_call_id === callId);
  if (message === undefined) return undefined;
  const content = message.content;
  if (typeof content === "string") return content;
  return content.map((block) => (block.type === "text" && typeof block.text === "string" ? block.text : "")).join("");
}

function keptFile(callId: string): string {
  return join(getOffloadDir(FIXTURE.sessionId), "large_tool_results", `${callId}.txt`);
}

describe("ExecuteDeepAgent hermetic — a long tool result kept whole", () => {
  let env: HermeticEnvironment;
  let registry: ReturnType<typeof stubRegistryFetch>;
  const clock = new ScriptedClock();

  beforeAll(() => {
    env = createHermeticEnvironment();
    registry = stubRegistryFetch();
    clock.install();
  });

  afterAll(() => {
    clock.uninstall();
    registry.restore();
    env.dispose();
  });

  it("shows the model the start, the failure and a pointer it reads the middle back from; the repository stays clean", async () => {
    clock.reset();
    const repo = join(env.workspaceRootDir, "repos", "long-output");
    initGitWorkspace(repo, { "README.md": "# fixture\n" });
    const record = deepAgentExecutionRecord({
      message: "Run the test suite.",
      resources: [localPathEntry("repo", repo)],
      maxToolResultChars: BOUND,
      autoApproveAll: true,
    });
    const RUN = "call-hermetic-long-run-0001";
    const READ = "call-hermetic-long-read-0001";
    const seen: { run?: string; read?: string } = {};
    const scenario = beginDeepAgentScenario({
      env,
      clock,
      record,
      script: () => (transcript): ScriptedTurn => {
        seen.run ??= toolResult(transcript, RUN);
        seen.read ??= toolResult(transcript, READ);
        if (seen.run === undefined) {
          return { text: "Running it.", toolCalls: [{ id: RUN, name: "execute", args: { command: LONG_FAILING_COMMAND } }] };
        }
        if (seen.read === undefined) {
          const [, path, offset] = POINTER.exec(seen.run) ?? [];
          if (path === undefined) return { text: "No pointer." };
          // The marker is line 1,000; the gap line names where the omitted part starts.
          expect(Number(offset)).toBeLessThan(999);
          return { text: "Reading the middle.", toolCalls: [{ id: READ, name: "read_file", args: { file_path: path, offset: 999, limit: 1 } }] };
        }
        return { text: "Three tests failed." };
      },
    });

    const invocation = await runDeepAgentTurn(scenario);
    expect((invocation.outcome as { value: Record<string, unknown> }).value.phase).toBe("RUN_COMPLETED");

    // What the model was handed: within the bound, both ends, the pointer.
    const run = seen.run!;
    expect(run.length).toBeLessThanOrEqual(BOUND);
    expect(run.startsWith("line 0001\n")).toBe(true);
    expect(run).toContain("[stderr] FAILED: 3 tests");
    expect(run).toContain("Exit code: 3");
    expect(run.endsWith("[Command failed with exit code 3]")).toBe(true);
    expect(run).not.toContain(MARKER);
    expect(POINTER.exec(run)?.[1]).toBe(`/large_tool_results/${RUN}.txt`);

    // The middle, read back instead of re-run.
    expect(seen.read).toContain(MARKER);

    // Kept in the session's offload directory, whole; nothing in the repository.
    const kept = readFileSync(keptFile(RUN), "utf8");
    expect(kept).toContain(MARKER);
    expect(kept).toContain("line 2000\n");
    expect(kept.endsWith("[Command failed with exit code 3]")).toBe(true);
    expect(existsSync(join(repo, "large_tool_results"))).toBe(false);
    expect(execFileSync("git", ["status", "--porcelain"], { cwd: repo, encoding: "utf8" })).toBe("");

    // The person's row is the tool's own output, whole.
    const row = record.toolCalls().find((tc) => tc.id === RUN)!;
    expect(row.status).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
    expect(row.result).toBe(kept);
  });

  it("cuts a sub-agent's results at the run's bound, keeping its own and its report in the session's folder", async () => {
    clock.reset();
    const repo = join(env.workspaceRootDir, "repos", "long-output-sub");
    initGitWorkspace(repo, { "README.md": "# fixture\n" });
    const HELPER_INSTRUCTIONS = "You are the hermetic test runner. Report the whole log.";
    const helper = create(AgentSchema, {
      metadata: { id: "agt_runner", name: "runner", slug: "runner" },
      spec: { description: "Runs the suite and reports.", instructions: HELPER_INSTRUCTIONS },
      status: { versionHash: "f".repeat(64) },
    });
    const record = deepAgentExecutionRecord({
      message: "Have the runner run the suite.",
      resources: [localPathEntry("repo", repo)],
      subagents: [helper],
      maxToolResultChars: BOUND,
      autoApproveAll: true,
    });
    const TASK = "call-hermetic-long-task-0001";
    const SUB_RUN = "call-hermetic-long-sub-run-0001";
    const REPORT = Array.from({ length: 1_000 }, (_, i) => `report ${String(i + 1).padStart(4, "0")}`).join("\n");
    const seen: { subRun?: string; report?: string } = {};
    const scenario = beginDeepAgentScenario({
      env,
      clock,
      record,
      clientOverrides: { getAgentByReference: vi.fn(async () => helper) },
      script: (_tools, context) => (transcript): ScriptedTurn => {
        if (context.systemPrompt.includes(HELPER_INSTRUCTIONS)) {
          seen.subRun ??= toolResult(transcript, SUB_RUN);
          return seen.subRun === undefined
            ? { text: "Running.", toolCalls: [{ id: SUB_RUN, name: "execute", args: { command: LONG_FAILING_COMMAND } }] }
            : { text: REPORT };
        }
        seen.report ??= toolResult(transcript, TASK);
        return seen.report === undefined
          ? { text: "Delegating.", toolCalls: [{ id: TASK, name: "task", args: { description: "Run the suite.", subagent_type: "runner" } }] }
          : { text: "The runner reported." };
      },
    });

    const invocation = await runDeepAgentTurn(scenario);
    expect((invocation.outcome as { value: Record<string, unknown> }).value.phase).toBe("RUN_COMPLETED");

    // The sub-agent's own result, at the run's bound, kept.
    expect(seen.subRun!.length).toBeLessThanOrEqual(BOUND);
    expect(seen.subRun).toContain("[stderr] FAILED: 3 tests");
    expect(POINTER.exec(seen.subRun!)?.[1]).toBe(`/large_tool_results/${SUB_RUN}.txt`);
    expect(readFileSync(keptFile(SUB_RUN), "utf8")).toContain(MARKER);

    // Its report, cut on its way to the parent, kept.
    expect(seen.report!.length).toBeLessThanOrEqual(BOUND);
    expect(seen.report!.startsWith("report 0001\n")).toBe(true);
    expect(seen.report!.endsWith("report 1000")).toBe(true);
    expect(POINTER.exec(seen.report!)?.[1]).toBe(`/large_tool_results/${TASK}.txt`);
    expect(readFileSync(keptFile(TASK), "utf8")).toBe(REPORT);

    expect(readdirSync(join(getOffloadDir(FIXTURE.sessionId), "large_tool_results")).sort()).toEqual([`${SUB_RUN}.txt`, `${TASK}.txt`].sort());
    expect(execFileSync("git", ["status", "--porcelain"], { cwd: repo, encoding: "utf8" })).toBe("");
  });
});
