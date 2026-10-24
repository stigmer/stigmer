/**
 * Hermetic scenario: the workspace's own `AGENTS.md` files through the whole
 * `ExecuteDeepAgent` activity, on the real graph with the scripted model.
 *
 * The workspace is a git repository with a root `AGENTS.md` and a
 * `pkg/AGENTS.md`, each carrying a marker word. Three arms:
 *  - Shown: the root's file is in the model's system prompt, after the
 *    workspace section; the first read under `pkg/` carries that folder's
 *    file and the second does not; the person's row for the read is the
 *    tool's own output; the built-in explorer, whose scope may read the
 *    workspace, carries the root's file in its prompt and gets the folder's
 *    file on its own first read there.
 *  - Refused: an agent whose lists deny `Read` gets no section, its refused
 *    read carries nothing, and the explorer, under the parent's scope, gets no
 *    section either.
 *  - After a compaction (sqlite): the first message's read carried the
 *    folder's file; a compaction is then recorded in the thread's checkpoint
 *    with its cutoff past that message, as deepagents' summarization records
 *    one, and the next message's read under `pkg/` carries the file again.
 *    A tool call never sees that private cutoff; this proves the middleware
 *    reads the view from the model call, after deepagents' compaction
 *    middleware rebuilt it (`middleware/folder-instructions.ts`).
 *
 * Structure and side effects only; no golden.
 */

import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { HumanMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import { maxChannelVersion, uuid6, type Checkpoint } from "@langchain/langgraph-checkpoint";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";

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
import {
  FIXTURE,
  beginDeepAgentScenario,
  continueDeepAgentScenario,
  deepAgentExecutionRecord,
  runDeepAgentTurn,
} from "../../__test-utils__/hermetic-deep-agent.js";
import type { ScriptedTurn } from "../../__test-utils__/scripted-model.js";
import { SqliteCheckpointSaver } from "../../../../shared/checkpointer/sqlite-saver.js";
import { getCheckpointDbPath } from "../../../../shared/workspace/platform-dir.js";
import { ToolCallStatus } from "../../../../gen/turn/ai/stigmer/runner/turn/v1/enum_pb.js";

const ROOT_MARK = "ROOT-NOTES-7731";
const PKG_MARK = "PKG-NOTES-4410";
const FILES = {
  "AGENTS.md": `# Root guide\n\nEvery change runs \`make check\` (${ROOT_MARK}).\n`,
  "pkg/AGENTS.md": `# The package\n\nTests run with \`make test-pkg\` (${PKG_MARK}).\n`,
  "pkg/x.ts": "export const x = 1;\n",
  "pkg/y.ts": "export const y = 2;\n",
};
/** The built-in explorer's prompt opens with this (`subagent-transformer.ts`). */
const EXPLORER = "You are an exploration specialist.";
const SUMMARY = "Summary (seeded): the package was read.";

/** The text of the tool result answering `callId`, as the model was handed it. */
function toolResult(transcript: readonly BaseMessage[], callId: string): string | undefined {
  const message = transcript.find((m) => ToolMessage.isInstance(m) && m.tool_call_id === callId);
  if (message === undefined) return undefined;
  const content = message.content;
  if (typeof content === "string") return content;
  return content.map((block) => (block.type === "text" && typeof block.text === "string" ? block.text : "")).join("\n");
}

function occurrences(text: string, mark: string): number {
  return text.split(mark).length - 1;
}

describe("ExecuteDeepAgent hermetic — the workspace's own instruction files", () => {
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

  /** One turn: two reads under `pkg/`, then a delegation to the explorer, which reads there too. */
  async function readAndDelegate(name: string, disallowedTools: string[]) {
    clock.reset();
    const repo = join(env.workspaceRootDir, "repos", name);
    initGitWorkspace(repo, FILES);
    const record = deepAgentExecutionRecord({
      message: "Fix the package's test.",
      resources: [localPathEntry("repo", repo)],
      autoApproveAll: true,
      disallowedTools,
    });
    const ids = { read1: `call-${name}-read-1`, read2: `call-${name}-read-2`, task: `call-${name}-task`, subRead: `call-${name}-sub-read` };
    const seen: { rootPrompt?: string; explorerPrompt?: string; read1?: string; read2?: string; subRead?: string; report?: string } = {};
    const scenario = beginDeepAgentScenario({
      env,
      clock,
      record,
      script: (_tools, context) => (transcript): ScriptedTurn => {
        if (context.systemPrompt.includes(EXPLORER)) {
          seen.explorerPrompt ??= context.systemPrompt;
          seen.subRead ??= toolResult(transcript, ids.subRead);
          return seen.subRead === undefined
            ? { text: "Reading.", toolCalls: [{ id: ids.subRead, name: "read_file", args: { file_path: "/pkg/x.ts" } }] }
            : { text: "Read it." };
        }
        seen.rootPrompt ??= context.systemPrompt;
        seen.read1 ??= toolResult(transcript, ids.read1);
        seen.read2 ??= toolResult(transcript, ids.read2);
        seen.report ??= toolResult(transcript, ids.task);
        if (seen.read1 === undefined) return { text: "Reading.", toolCalls: [{ id: ids.read1, name: "read_file", args: { file_path: "/pkg/x.ts" } }] };
        if (seen.read2 === undefined) return { text: "Reading more.", toolCalls: [{ id: ids.read2, name: "read_file", args: { file_path: "/pkg/y.ts" } }] };
        if (seen.report === undefined) {
          return { text: "Delegating.", toolCalls: [{ id: ids.task, name: "task", args: { description: "Read pkg/x.ts.", subagent_type: "explore" } }] };
        }
        return { text: "Done." };
      },
    });
    const invocation = await runDeepAgentTurn(scenario);
    expect((invocation.outcome as { value: Record<string, unknown> }).value.phase).toBe("RUN_COMPLETED");
    return { record, ids, seen };
  }

  it("shows the root's file in the prompt and a folder's file on the first read beneath it, to the parent and to the explorer", async () => {
    const { record, ids, seen } = await readAndDelegate("shown", []);

    const prompt = seen.rootPrompt!;
    expect(occurrences(prompt, ROOT_MARK)).toBe(1);
    expect(prompt).toContain('<instructions path="/AGENTS.md">');
    expect(prompt.indexOf("## Repository instructions")).toBeGreaterThan(prompt.indexOf("## Workspace"));
    expect(prompt.indexOf("## Repository instructions")).toBeLessThan(prompt.indexOf("## Response rules"));
    expect(prompt).not.toContain(PKG_MARK);

    expect(occurrences(seen.read1!, PKG_MARK), "the first read beneath pkg/").toBe(1);
    expect(seen.read1).toContain('<instructions path="/pkg/AGENTS.md">');
    expect(seen.read2, "already in the model's view").not.toContain(PKG_MARK);

    const row = record.toolCalls().find((tc) => tc.id === ids.read1)!;
    expect(row.status).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
    expect(row.result).toContain("export const x = 1;");
    expect(row.result, "the person's row is the tool's own output").not.toContain(PKG_MARK);

    expect(occurrences(seen.explorerPrompt!, ROOT_MARK), "the explorer may read the workspace").toBe(1);
    expect(occurrences(seen.subRead!, PKG_MARK), "the explorer's own first read beneath pkg/").toBe(1);
  });

  it("shows nothing to an agent whose lists refuse a workspace read, nor to the explorer under its scope", async () => {
    const { seen } = await readAndDelegate("refused", ["Read"]);

    expect(seen.rootPrompt).not.toContain("## Repository instructions");
    expect(seen.rootPrompt).not.toContain(ROOT_MARK);
    expect(seen.read1, "the read was refused").not.toContain("export const x");
    expect(seen.read1).not.toContain(PKG_MARK);
    expect(seen.explorerPrompt).not.toContain(ROOT_MARK);
    expect(seen.subRead).not.toContain(PKG_MARK);
  });

  it("shows a folder's file again once a compaction's cutoff passes the message that carried it (sqlite)", async () => {
    clock.reset();
    const repo = join(env.workspaceRootDir, "repos", "compacted");
    initGitWorkspace(repo, FILES);
    const resources = [localPathEntry("repo", repo)];
    const READ_X = "call-compacted-read-x";
    const READ_Y = "call-compacted-read-y";

    let firstRead: string | undefined;
    const first = beginDeepAgentScenario({
      env,
      clock,
      record: deepAgentExecutionRecord({ message: "Read x.", resources, autoApproveAll: true }),
      checkpointer: "sqlite",
      script: () => (transcript): ScriptedTurn => {
        firstRead ??= toolResult(transcript, READ_X);
        return firstRead === undefined
          ? { text: "Reading.", toolCalls: [{ id: READ_X, name: "read_file", args: { file_path: "/pkg/x.ts" } }] }
          : { text: "Read x." };
      },
    });
    await runDeepAgentTurn(first);
    expect(first.record.lastFullStatus!.phase).toBe(RunPhase.RUN_COMPLETED);
    expect(occurrences(firstRead!, PKG_MARK)).toBe(1);

    // Record a compaction whose cutoff passes every message so far, as
    // deepagents' summarization records one (its `_summarizationEvent`).
    const saver = new SqliteCheckpointSaver(getCheckpointDbPath(FIXTURE.sessionId));
    try {
      const tuple = (await saver.getTuple({ configurable: { thread_id: FIXTURE.threadId, checkpoint_ns: "" } }))!;
      const messages = tuple.checkpoint.channel_values.messages as BaseMessage[];
      expect(messages.some((m) => ToolMessage.isInstance(m) && m.tool_call_id === READ_X)).toBe(true);
      const next = saver.getNextVersion(Number(maxChannelVersion(...Object.values(tuple.checkpoint.channel_versions))));
      const checkpoint: Checkpoint = {
        ...tuple.checkpoint,
        id: uuid6(-1),
        ts: new Date().toISOString(),
        channel_values: {
          ...tuple.checkpoint.channel_values,
          _summarizationEvent: {
            cutoffIndex: messages.length,
            summaryMessage: new HumanMessage({ content: SUMMARY, additional_kwargs: { lc_source: "summarization" } }),
            filePath: null,
          },
        },
        channel_versions: { ...tuple.checkpoint.channel_versions, _summarizationEvent: next },
      };
      await saver.put(tuple.config, checkpoint, { ...tuple.metadata!, source: "update", step: (tuple.metadata?.step ?? 0) + 1, parents: {} }, { _summarizationEvent: next });
    } finally {
      saver.close();
    }

    const transcripts: BaseMessage[][] = [];
    let secondRead: string | undefined;
    const next = continueDeepAgentScenario(first, {
      record: deepAgentExecutionRecord({ message: "Now read y.", resources, autoApproveAll: true, executionId: "aex_hermetic_0002" }),
      script: () => (transcript): ScriptedTurn => {
        transcripts.push([...transcript]);
        secondRead ??= toolResult(transcript, READ_Y);
        return secondRead === undefined
          ? { text: "Reading.", toolCalls: [{ id: READ_Y, name: "read_file", args: { file_path: "/pkg/y.ts" } }] }
          : { text: "Read y." };
      },
    });
    await runDeepAgentTurn(next);
    expect(next.record.lastFullStatus!.phase).toBe(RunPhase.RUN_COMPLETED);

    const conversation = transcripts[0]!.filter((m) => m.getType() !== "system");
    expect(conversation[0]!.text, "the model sees the summary, not the earlier read").toBe(SUMMARY);
    expect(transcripts[0]!.some((m) => ToolMessage.isInstance(m) && m.tool_call_id === READ_X)).toBe(false);
    expect(occurrences(secondRead!, PKG_MARK), "shown again: the model no longer sees it").toBe(1);
  });
});
