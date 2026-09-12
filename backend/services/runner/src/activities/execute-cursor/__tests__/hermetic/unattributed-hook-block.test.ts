/**
 * Hermetic golden: UNATTRIBUTED HOOK BLOCK (issue #205) — a tool blocked by a
 * hook Stigmer does not own fails the turn with a diagnosable reason, never a
 * silent completion.
 *
 * Invariant pinned: Cursor runs EVERY hook in the workspace's `.cursor/hooks.json`
 * and a deny from any of them blocks the tool. Stigmer's own hook records every
 * deny it issues to the denial ledger, so a FAILED tool call carrying Cursor's
 * hook-block error text with NO ledger entry was blocked by a FOREIGN hook. No
 * approval can unblock it (an approval grants a token only OUR hook reads), so
 * the turn boundary reports it and the activity RETURNS EXECUTION_FAILED with an
 * error that names the blocked tool and the foreign hook command the gate
 * install found beside ours. The golden (`goldens/unattributed-hook-block.status.json`)
 * pins that copy.
 *
 * What the scenario ALSO pins, because it is the point of #173 and the reason
 * #205 exists at all: the gate MERGES into the user's `hooks.json` (their hook
 * survives the turn and is reported as the culprit) and the teardown restores
 * their file byte for byte.
 *
 * Engine disposition on this arm, today: the handle is `close()`d, not parked
 * (index.ts `enterUnattributedHookBlockFailure`).
 *
 * Parent phase rows exercised beyond the earlier scenarios: the gate install's
 * foreign-hook detection (`workspace-setup.ts` `mergeHooks`); the FAILED
 * tool-call row built from a single `status: "error"` event; the boundary's
 * `detectUnattributedHookBlocks` pass over an EMPTY ledger; the
 * `enterUnattributedHookBlockFailure` terminal; the `finally`'s hooks.json restore.
 *
 * Regenerate ONLY after a deliberate behavior change:
 *   npx vitest run src/activities/execute-cursor/__tests__/hermetic -u
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { toJson } from "@bufbuild/protobuf";
import { AgentExecutionStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import {
  ExecutionPhase,
  MessageType,
  ToolCallStatus,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

vi.mock("@cursor/sdk", async () =>
  (await import("../../__test-utils__/scripted-sdk.js")).scriptedCursorSdkModule(),
);
vi.mock("../../../../client/stigmer-client.js", async () =>
  (await import("../../../../__test-utils__/hermetic-activity.js")).hermeticStigmerClientModule(),
);

import {
  ScriptedClock,
  createHermeticEnvironment,
  type HermeticEnvironment,
} from "../../../../__test-utils__/hermetic-activity.js";
import { _parkedAgentCountForTests } from "../../agent-session-cache.js";
import { ScriptedCursorAgent, sdkEvents, step } from "../../__test-utils__/scripted-agent.js";
import {
  SDK_CATALOG,
  beginCursorScenario,
  cursorExecutionRecord,
  runCursorTurn,
  sessionWorkspaceDir,
} from "../../__test-utils__/hermetic-cursor.js";
import { stubRegistryFetch } from "../../../../__test-utils__/model-registry-fixture.js";

const AGENT_ID = "agent-hermetic-hookblock-0001";
const RUN_ID = "run-hermetic-hookblock-0001";
const CALL_ID = "call-hermetic-hookblock-0001";
const USER_MESSAGE = "Clean the build directory.";
const SHELL_ARGS = { command: "rm -rf build" };
/** The user's own gating hook — a team policy script the merge must preserve. */
const FOREIGN_HOOK_COMMAND = "./scripts/team-policy-hook.sh";
/**
 * The user's hooks.json exactly as they wrote it (formatting included): the
 * teardown must hand back these bytes, not a re-serialization.
 */
const USER_HOOKS_JSON =
  JSON.stringify({ version: 1, hooks: { preToolUse: [{ command: FOREIGN_HOOK_COMMAND }] } }, null, 2) + "\n";
/**
 * The error text Cursor stamps on a hook-blocked tool call
 * (`message-translator.ts` HOOK_BLOCK_ERROR_MARKERS). The SDK has no structured
 * "denied by hook" signal; this text is the only stream-side trace.
 */
const HOOK_BLOCK_ERROR = "blocked by a hook";
const FINAL_TEXT = "I could not clean the build directory: the shell command was blocked.";

describe("ExecuteCursor hermetic — unattributed hook block (#205)", () => {
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

  it("fails the turn naming the blocked tool and the foreign hook, and restores the user's hooks.json", async () => {
    // ── Arrange: the user's own gating hook is already in the workspace ─────
    const workspaceDir = sessionWorkspaceDir(env);
    const hooksJsonPath = join(workspaceDir, ".cursor", "hooks.json");
    mkdirSync(join(workspaceDir, ".cursor"), { recursive: true });
    writeFileSync(hooksJsonPath, USER_HOOKS_JSON, "utf-8");

    const ev = sdkEvents(AGENT_ID, RUN_ID);
    const agent = new ScriptedCursorAgent({
      agentId: AGENT_ID,
      runIds: [RUN_ID],
      observeStep: () => clock.tick(),
      turns: [
        [
          step.event(ev.init()),
          step.event(ev.assistant("Removing the build directory.")),
          // The foreign hook denied the shell; Cursor reports the call as
          // failed with its generic hook-block text. Our ledger never saw it.
          step.event(ev.toolCall(CALL_ID, "shell", "error", SHELL_ARGS, HOOK_BLOCK_ERROR)),
          step.event(ev.assistant(FINAL_TEXT)),
          step.turnEnded({ inputTokens: 1_500, outputTokens: 40 }),
          step.finished({ result: FINAL_TEXT }),
        ],
      ],
    });
    const record = cursorExecutionRecord({ message: USER_MESSAGE });
    const scenario = beginCursorScenario({ env, clock, record, sdk: { agents: [agent], catalog: SDK_CATALOG } });

    // ── Act ──────────────────────────────────────────────────────────────────
    const invocation = await runCursorTurn(scenario);

    // ── Assert: outcome and phases ───────────────────────────────────────────
    expect(invocation.outcome.kind, "an unattributed block RETURNS a terminal status").toBe("returned");
    const slim = (invocation.outcome as { value: Record<string, unknown> }).value;
    expect(slim.phase).toBe("EXECUTION_FAILED");
    expect(record.persistedPhases).toEqual([
      ExecutionPhase.EXECUTION_IN_PROGRESS,
      ExecutionPhase.EXECUTION_FAILED,
    ]);

    // ── Assert: the diagnosable reason ───────────────────────────────────────
    const final = record.lastFullStatus!;
    expect(final.error).toBe(
      `A Cursor hook outside Stigmer's approval gate blocked tool(s): shell.` +
        ` The workspace's .cursor/hooks.json registers hook(s) outside Stigmer's control ` +
        `[${FOREIGN_HOOK_COMMAND}], which most likely denied it.` +
        ` Stigmer cannot request approval on a foreign hook's behalf — remove or adjust ` +
        `the hook in .cursor/hooks.json and retry.`,
    );
    expect(final.completedAt, "a failed turn is complete").not.toBe("");
    expect(
      final.messages.filter((m) => m.type === MessageType.MESSAGE_SYSTEM).map((m) => m.content),
    ).toEqual([`Execution failed: ${final.error}`]);

    // The blocked row stays FAILED with Cursor's text — never silently
    // completed, never collapsed into a Stigmer gate row.
    const rows = record.toolCalls();
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe(ToolCallStatus.TOOL_CALL_FAILED);
    expect(rows[0].error).toBe(HOOK_BLOCK_ERROR);
    expect(record.waitingToolCalls(), "no approval is pending — none could unblock it").toHaveLength(0);

    // ── Assert: engine disposition (today's) ─────────────────────────────────
    expect(agent.closeCalls, "the handle is closed on this failure").toBe(1);
    expect(_parkedAgentCountForTests(), "and not parked").toBe(0);
    expect(agent.runs[0].cancelCalls, "the run completed on its own — nothing cancelled it").toHaveLength(0);
    expect(record.sessionUpdates, "the one harness_state_id bind").toHaveLength(1);

    // ── Assert: the user's hooks.json survived the turn byte for byte (#173) ─
    expect(readFileSync(hooksJsonPath, "utf-8")).toBe(USER_HOOKS_JSON);

    // ── Assert: hermeticity ──────────────────────────────────────────────────
    expect(registry.urls.every((u) => u.includes("/model-registry"))).toBe(true);
    expect(invocation.heartbeats.length).toBeGreaterThan(0);

    // ── Assert: the golden ───────────────────────────────────────────────────
    const json = JSON.stringify(toJson(AgentExecutionStatusSchema, final), null, 2) + "\n";
    await expect(json).toMatchFileSnapshot("./goldens/unattributed-hook-block.status.json");
  });
});
