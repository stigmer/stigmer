/**
 * Hermetic golden: a turn with an UNGATED TOOL CALL through the whole
 * `ExecuteDeepAgent` activity — the deepagents built-in `read_file` on a
 * file seeded in the session workspace.
 *
 * Invariant pinned: the model's turn ("Let me read it." plus one `read_file`
 * proposal), the tools node's `tool-started` / `tool-finished` events (status
 * RUNNING then COMPLETED, `result` from the tool's output, `startedAt` /
 * `completedAt` on the scripted clock), and the follow-up assistant turn fold
 * into ONE tool row, and the turn ends COMPLETED. A read-only built-in is never
 * gated (`shared/tool-kind.ts` FILE_READ), so no approval fields are set. The
 * mid-stream persist the tool-call boundary forces (`persist-decision.ts`
 * `contentDirty`) is what the platform-stop arm relies on.
 *
 * What the golden shows about TODAY's transcript shape, recorded as found
 * (S3 M0 finding F-M0-1, for the owner before M2b): the row does NOT sit on
 * the AI message that carries the text of the same LLM turn. LangGraph 1.3.2
 * stamps the model's events with namespace `["model_request:<uuid>"]` and the
 * tools node's with `["tools:<uuid>"]`; `V3StatusBuilder.ensureAiMessage`
 * files the text under the raw namespace while `handleToolStarted` looks the
 * parent up under `resolveAgentNamespace(...)`, which strips only `tools:`
 * segments and so resolves to `""` — a miss, and `ensureAiMessageForToolCall`
 * appends an EMPTY AI message for the row. So the transcript is THREE AI
 * messages: the text, an empty one carrying the row, the closing text. The
 * hand-authored fixtures in `v3-event-fixtures.ts` use `namespace: []` and
 * never reached this arm; this golden, on the real graph, does. The golden
 * (`goldens/tool-call.status.json`) is the shape S4's canonical transcript
 * builder is measured against, and the shape any fix must change on purpose.
 *
 * Regenerate ONLY after a deliberate behavior change:
 *   npx vitest run src/activities/execute-deep-agent/__tests__/hermetic -u
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { toJson } from "@bufbuild/protobuf";
import { AgentExecutionStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ExecutionPhase, MessageType, ToolCallStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

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
import { stubRegistryFetch } from "../../../../__test-utils__/model-registry-fixture.js";
import {
  beginDeepAgentScenario,
  deepAgentExecutionRecord,
  runDeepAgentTurn,
  sessionWorkspaceDir,
} from "../../__test-utils__/hermetic-deep-agent.js";

const CALL_ID = "call-hermetic-read-0001";
const USER_MESSAGE = "What is in README.md?";
const README = "# Hermetic\n\nA fixture readme.\n";
const ASSISTANT_TEXT = "README.md holds a one-line fixture description.";

describe("ExecuteDeepAgent hermetic — ungated tool call", () => {
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

  it("folds the proposal and the tools node's events into one COMPLETED tool row and completes", async () => {
    // ── Arrange ──────────────────────────────────────────────────────────────
    const record = deepAgentExecutionRecord({ message: USER_MESSAGE });
    const scenario = beginDeepAgentScenario({
      env,
      clock,
      record,
      script: () => ({
        turns: [
          {
            text: "Let me read it.",
            toolCalls: [{ id: CALL_ID, name: "read_file", args: { file_path: "/README.md" } }],
            usage: { inputTokens: 1_500, outputTokens: 60 },
          },
          { text: ASSISTANT_TEXT, usage: { inputTokens: 1_700, outputTokens: 30 } },
        ],
      }),
    });
    // Seeded AFTER the scenario begins: beginning a scenario clears the
    // session workspace so every scenario starts where a new session starts.
    const workspace = sessionWorkspaceDir(env);
    mkdirSync(workspace, { recursive: true });
    writeFileSync(join(workspace, "README.md"), README, "utf-8");

    // ── Act ──────────────────────────────────────────────────────────────────
    const invocation = await runDeepAgentTurn(scenario);

    // ── Assert: outcome and phases ───────────────────────────────────────────
    expect(invocation.outcome.kind).toBe("returned");
    const slim = (invocation.outcome as { value: Record<string, unknown> }).value;
    expect(slim.phase).toBe("EXECUTION_COMPLETED");
    expect(record.persistedPhases).toEqual([
      ExecutionPhase.EXECUTION_IN_PROGRESS,
      ExecutionPhase.EXECUTION_COMPLETED,
    ]);
    expect(record.persisted.length, "the tool-call boundary forces a mid-stream persist").toBeGreaterThan(2);

    // ── Assert: the one tool-call row ────────────────────────────────────────
    const rows = record.toolCalls();
    expect(rows, "proposal + started + finished fold into ONE row, never two").toHaveLength(1);
    const row = rows[0];
    expect(row.id).toBe(CALL_ID);
    expect(row.name).toBe("read_file");
    expect(row.status).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
    expect(row.args).toEqual({ file_path: "/README.md" });
    expect(row.result, "the built-in's numbered listing of the seeded file").toContain("A fixture readme.");
    expect(row.requiresApproval, "a read-only built-in is not gated").toBe(false);

    // ── Assert: the transcript, as it is today (F-M0-1 in the header) ────────
    const final = record.lastFullStatus!;
    const ai = final.messages.filter((m) => m.type === MessageType.MESSAGE_AI);
    expect(ai.map((m) => m.content), "text, an EMPTY message carrying the row, closing text").toEqual([
      "Let me read it.",
      "",
      ASSISTANT_TEXT,
    ]);
    expect(ai[1].toolCalls.map((tc) => tc.id), "the row sits on the empty message, not beside its text").toEqual([
      CALL_ID,
    ]);
    expect(final.streamingUsage?.turnCount).toBe(2);

    // ── Assert: hermeticity ──────────────────────────────────────────────────
    expect(registry.urls.every((u) => u.includes("/model-registry"))).toBe(true);

    // ── Assert: the golden ───────────────────────────────────────────────────
    const json = JSON.stringify(toJson(AgentExecutionStatusSchema, final), null, 2) + "\n";
    await expect(json).toMatchFileSnapshot("./goldens/tool-call.status.json");
  });
});
