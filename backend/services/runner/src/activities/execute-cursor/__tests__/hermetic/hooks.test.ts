/**
 * Hermetic golden: a plugin's tool hook denies, allows and asks on the
 * Cursor engine, through the whole `ExecuteCursor` activity, with the REAL
 * bash gate as the out-of-process half and the runner's REAL hook server
 * behind it.
 *
 * The agent references the `safety` plugin through `AgentSpec.hooks`, as on
 * the native engine (`execute-deep-agent/__tests__/hermetic/hooks.test.ts`
 * runs the same plugin): the runtime mounts it from its verified archive,
 * and the hook is its own bash script, in Claude Code's format. The scripted
 * SDK runs every `.cursor/hooks.json` entry for each call as the real SDK
 * does; the gate's script asks the hook server inside the runner, which runs
 * the hook.
 *
 * Turn 1: the delete is refused (its row fails with the hook's reason and
 * names the hook; nothing pauses), `ls` runs without a card (the shell
 * default would have asked; the server's record names the hook on the row),
 * and the publish waits for a person on a card naming the hook and saying
 * why: WAITING_FOR_APPROVAL. Between turns the person approves. Turn 2: the
 * model re-issues the publish under a fresh id, the hook asks again, the
 * approval's grant answers it, the publish runs: COMPLETED.
 *
 * Also pinned here:
 *  - "approve all" on the hook's card leases that hook's asks on that tool,
 *    never the shell category: the next turn's ask of the hook runs, and the
 *    shell default still asks before a call the hook passes;
 *  - two refusals of one command in a turn that completes stay two rows;
 *  - a person's refusal binds on the retry although the hook now allows;
 *  - only the agent's own hooks run: a repository's `.cursor/hooks.json`
 *    entry and a runner-owned folder's `.claude` settings hook never run
 *    during the turn, and both files are byte-identical after it;
 *  - a person's own folder whose `.claude` settings carry hooks refuses the
 *    turn before any agent exists, naming the file, and the file is left
 *    untouched;
 *  - web fetch and web search, which Cursor shows no hook, are hidden from an
 *    agent whose hooks would take them.
 *
 * Skipped where `bash` is unavailable — reported as SKIPPED, never a silent pass.
 *
 * Regenerate ONLY after a deliberate behavior change:
 *   npx vitest run src/activities/execute-cursor/__tests__/hermetic -u
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { create, toJson } from "@bufbuild/protobuf";
import { ConnectError, Code } from "@connectrpc/connect";
import { AgentRunStatusSchema, type AgentRunStatus } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/api_pb";
import { HookSourceSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import {
  ApprovalAction,
  ApprovalPolicySource,
  RunPhase,
  MessageType,
  ToolCallStatus,
} from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/enum_pb";
import { PluginSchema, type Plugin } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import { HookConfigSchema, HookFormat, HookGroupSchema, HookHandlerSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/hooks_pb";
import { GetArtifactResponseSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/io_pb";
import { ApiResourceReferenceSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { buildZip } from "@stigmer/zip-structure/testing";

vi.mock("@cursor/sdk", async () =>
  (await import("../../__test-utils__/scripted-sdk.js")).scriptedCursorSdkModule(),
);
vi.mock("@cursor/sdk/sqlite", async () =>
  (await import("../../__test-utils__/scripted-sdk.js")).scriptedCursorSqliteModule(),
);
vi.mock("../../../../client/stigmer-client.js", async () =>
  (await import("../../../../__test-utils__/hermetic-activity.js")).hermeticStigmerClientModule(),
);

import { ScriptedClock, createHermeticEnvironment, type HermeticEnvironment } from "../../../../__test-utils__/hermetic-activity.js";
import { localPathEntry } from "../../../../__test-utils__/git-workspace-fixture.js";
import { stubRegistryFetch } from "../../../../__test-utils__/model-registry-fixture.js";
import { isToolCallRowHidden } from "../../../../shared/tool-row.js";
import { hasBash, hookBuiltin } from "../../__test-utils__/cursor-hook-harness.js";
import { ScriptedCursorAgent, sdkEvents, step } from "../../__test-utils__/scripted-agent.js";
import {
  FIXTURE,
  SDK_CATALOG,
  beginCursorScenario,
  cursorExecutionRecord,
  runCursorTurn,
  runWorkspaceHooks,
  sessionWorkspaceDir,
} from "../../__test-utils__/hermetic-cursor.js";

/** Refuses recursive deletes, allows listings, asks before publishing; decides nothing else. */
const GUARD = `#!/usr/bin/env bash
input=$(cat)
case "$input" in
  *'"command":"rm -rf'*)
    echo "recursive deletes are not allowed" >&2
    exit 2 ;;
  *'"command":"ls'*)
    printf '%s' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"}}' ;;
  *'"command":"echo publish'*)
    printf '%s' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"publishing needs a person"}}' ;;
esac
exit 0
`;

/** Asks the first time it sees a publish and allows every time after (its state in the plugin's data dir). */
const CHANGES_ITS_MIND = `#!/usr/bin/env bash
cat >/dev/null
if [ -f "$CLAUDE_PLUGIN_DATA/asked" ]; then
  printf '%s' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"}}'
else
  mkdir -p "$CLAUDE_PLUGIN_DATA" && touch "$CLAUDE_PLUGIN_DATA/asked"
  printf '%s' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"first time: ask"}}'
fi
`;

/** The `safety` plugin, its one hook the given script, matched on Bash. */
function safetyPlugin(script: string): { readonly plugin: Plugin; readonly archive: Uint8Array } {
  const archive = buildZip([
    { name: ".claude-plugin/plugin.json", content: '{"name":"safety"}' },
    { name: "hooks/guard", content: script },
  ]);
  const plugin = create(PluginSchema, {
    metadata: { id: "plg_safety", org: "hermetic-org", slug: "safety", name: "safety" },
    status: {
      digest: createHash("sha256").update(archive).digest("hex"),
      artifactStorageKey: "plugins/safety.zip",
      hooks: create(HookConfigSchema, {
        format: HookFormat.CLAUDE_CODE,
        groups: [create(HookGroupSchema, {
          event: "PreToolUse",
          matcher: "Bash",
          handlers: [create(HookHandlerSchema, { command: '"${CLAUDE_PLUGIN_ROOT}"/hooks/guard' })],
        })],
      }),
    },
  });
  return { plugin, archive };
}

const SAFETY_REF = create(HookSourceSchema, {
  source: { case: "plugin", value: create(ApiResourceReferenceSchema, { kind: 58, org: "hermetic-org", slug: "safety" }) },
});

/** The client half of a mounted plugin: read by reference, fetched on the unary lane. */
function pluginClient(script: string) {
  const { plugin, archive } = safetyPlugin(script);
  return {
    getPluginByReference: vi.fn(async () => plugin),
    getPluginArtifactDownloadUrl: vi.fn(async () => {
      throw new ConnectError("no download lane", Code.Unimplemented);
    }),
    getPluginArtifact: vi.fn(async () => create(GetArtifactResponseSchema, { artifact: archive })),
  };
}

/** Cursor's preToolUse payload for a shell call. */
const shellHook = (command: string, callId: string) => ({ ...hookBuiltin("Shell", { command, cwd: "", timeout: 30000 }), tool_use_id: callId });

function statusJson(status: AgentRunStatus): string {
  return JSON.stringify(toJson(AgentRunStatusSchema, status), null, 2) + "\n";
}

const row = (status: AgentRunStatus, id: string) => status.messages.flatMap((m) => m.toolCalls).find((tc) => tc.id === id)!;

describe.skipIf(!hasBash)("ExecuteCursor hermetic — a plugin's hook denies, allows and asks", () => {
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

  it("refuses the delete, runs the listing, and holds the publish for a person; the approval runs it", async () => {
    const workspaceRoot = sessionWorkspaceDir(env);
    const answers: string[] = [];
    const hook = (label: string, command: string, callId: string) =>
      step.effect(label, async () => {
        answers.push((await runWorkspaceHooks(workspaceRoot, shellHook(command, callId))).permission);
      });
    const ev1 = sdkEvents("agent-hooks-0001", "run-hooks-0001");
    const ev2 = sdkEvents("agent-hooks-0001", "run-hooks-0002");
    const agent = new ScriptedCursorAgent({
      agentId: "agent-hooks-0001",
      runIds: ["run-hooks-0001", "run-hooks-0002"],
      observeStep: () => clock.tick(),
      turns: [
        [
          step.event(ev1.init()),
          step.event(ev1.assistant("Cleaning the build.")),
          step.event(ev1.toolCall("call-delete", "shell", "running", { command: "rm -rf build" })),
          hook("hook: the delete (expect deny)", "rm -rf build", "call-delete"),
          step.event(ev1.toolCall("call-delete", "shell", "error", { command: "rm -rf build" }, "Blocked by a hook")),
          step.event(ev1.assistant("Listing the files.")),
          step.event(ev1.toolCall("call-list", "shell", "running", { command: "ls" })),
          hook("hook: the listing (expect allow)", "ls", "call-list"),
          step.event(ev1.toolCall("call-list", "shell", "completed", { command: "ls" }, "src\n")),
          step.event(ev1.assistant("Publishing.")),
          step.event(ev1.toolCall("call-publish", "shell", "running", { command: "echo publish" })),
          hook("hook: the publish (expect deny for the card)", "echo publish", "call-publish"),
          step.event(ev1.toolCall("call-publish", "shell", "error", { command: "echo publish" }, "Blocked by a hook")),
          // Never reached: the card's denial cancels the run.
          step.finished({ result: "never" }),
        ],
        [
          hook("hook: the approved publish (expect allow)", "echo publish", "call-publish-2"),
          step.event(ev2.toolCall("call-publish-2", "shell", "running", { command: "echo publish" })),
          step.event(ev2.toolCall("call-publish-2", "shell", "completed", { command: "echo publish" }, "publish\n")),
          step.event(ev2.assistant("Published.")),
          step.turnEnded({ inputTokens: 3_100, outputTokens: 60, cacheReadTokens: 0, cacheWriteTokens: 0 }),
          step.finished({ result: "Published.", model: { id: FIXTURE.model, params: [] } }),
        ],
      ],
    });
    const record = cursorExecutionRecord({ message: "Clean the build, list the files, then publish.", hooks: [SAFETY_REF] });
    const client = pluginClient(GUARD);
    const scenario = beginCursorScenario({ env, clock, record, sdk: { agents: [agent], catalog: SDK_CATALOG }, clientOverrides: client });

    // ── Turn 1 ───────────────────────────────────────────────────────────────
    const turn1 = await runCursorTurn(scenario, { threadId: "", turnSeq: 0 });
    expect(turn1.outcome.kind).toBe("returned");
    expect(answers).toEqual(["deny", "allow", "deny"]);
    expect(record.persistedPhases.at(-1)).toBe(RunPhase.RUN_WAITING_FOR_APPROVAL);
    const run1 = record.lastFullStatus!;

    const deleted = row(run1, "call-delete");
    expect(deleted.status).toBe(ToolCallStatus.TOOL_CALL_FAILED);
    expect(deleted.error).toBe("The safety plugin's hook refused this call: recursive deletes are not allowed");
    expect([deleted.approvalPolicySource, deleted.approvalPolicyHook]).toEqual([ApprovalPolicySource.HOOK, "safety"]);

    const listed = row(run1, "call-list");
    expect(listed.status).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
    expect(listed.requiresApproval, "the hook's allow skips the shell default's card").toBe(false);
    expect([listed.approvalPolicySource, listed.approvalPolicyHook]).toEqual([ApprovalPolicySource.HOOK, "safety"]);

    const held = row(run1, "call-publish");
    expect(held.status).toBe(ToolCallStatus.TOOL_CALL_WAITING_APPROVAL);
    expect(held.approvalMessage).toBe("publishing needs a person");
    expect([held.approvalPolicySource, held.approvalPolicyHook]).toEqual([ApprovalPolicySource.HOOK, "safety"]);
    await expect(statusJson(run1)).toMatchFileSnapshot("./goldens/hooks.turn1.status.json");

    // ── Between turns: approve the publish ───────────────────────────────────
    expect(record.decideWaitingToolCalls(ApprovalAction.APPROVE, "2026-01-01T00:00:30.000Z")).toBe(1);

    // ── Turn 2 ───────────────────────────────────────────────────────────────
    const turn2 = await runCursorTurn(scenario, { threadId: "agent-hooks-0001", turnSeq: 1 });
    expect(turn2.outcome.kind).toBe("returned");
    expect(answers.at(-1), "the approval's grant answers the hook's second ask").toBe("allow");
    expect(record.persistedPhases.at(-1)).toBe(RunPhase.RUN_COMPLETED);
    const final = record.lastFullStatus!;
    const published = row(final, "call-publish");
    expect(published.status).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
    expect(published.approvalAction).toBe(ApprovalAction.APPROVE);
    expect([published.approvalPolicySource, published.approvalPolicyHook]).toEqual([ApprovalPolicySource.HOOK, "safety"]);
    expect(row(final, "call-delete").status, "the refusal stays refused").toBe(ToolCallStatus.TOOL_CALL_FAILED);
    expect(client.getPluginArtifact, "the second turn mounts from the session's verified cache").toHaveBeenCalledTimes(1);
    expect(registry.urls.every((u) => u.includes("/model-registry"))).toBe(true);
    await expect(statusJson(final)).toMatchFileSnapshot("./goldens/hooks.turn2.status.json");
  });

  it("approve all on the hook's card leases that hook's asks, never the whole shell", async () => {
    clock.reset();
    const workspaceRoot = sessionWorkspaceDir(env);
    const answers: string[] = [];
    const hook = (command: string, callId: string) =>
      step.effect(`hook: ${command}`, async () => {
        answers.push((await runWorkspaceHooks(workspaceRoot, shellHook(command, callId))).permission);
      });
    const ev1 = sdkEvents("agent-lease-0001", "run-lease-0001");
    const ev2 = sdkEvents("agent-lease-0001", "run-lease-0002");
    const agent = new ScriptedCursorAgent({
      agentId: "agent-lease-0001",
      runIds: ["run-lease-0001", "run-lease-0002"],
      observeStep: () => clock.tick(),
      turns: [
        [
          step.event(ev1.init()),
          step.event(ev1.toolCall("call-pub", "shell", "running", { command: "echo publish" })),
          hook("echo publish", "call-pub"),
          step.event(ev1.toolCall("call-pub", "shell", "error", { command: "echo publish" }, "Blocked by a hook")),
          step.finished({ result: "never" }),
        ],
        [
          hook("echo publish", "call-pub-2"),
          step.event(ev2.toolCall("call-pub-2", "shell", "running", { command: "echo publish" })),
          step.event(ev2.toolCall("call-pub-2", "shell", "completed", { command: "echo publish" }, "publish\n")),
          step.event(ev2.toolCall("call-again", "shell", "running", { command: "echo publish again" })),
          hook("echo publish again", "call-again"),
          step.event(ev2.toolCall("call-again", "shell", "completed", { command: "echo publish again" }, "publish again\n")),
          step.event(ev2.toolCall("call-where", "shell", "running", { command: "pwd" })),
          hook("pwd", "call-where"),
          step.event(ev2.toolCall("call-where", "shell", "error", { command: "pwd" }, "Blocked by a hook")),
          step.finished({ result: "never" }),
        ],
      ],
    });
    const record = cursorExecutionRecord({ message: "Publish twice, then show where you are.", hooks: [SAFETY_REF] });
    const scenario = beginCursorScenario({ env, clock, record, sdk: { agents: [agent], catalog: SDK_CATALOG }, clientOverrides: pluginClient(GUARD) });

    await runCursorTurn(scenario, { threadId: "", turnSeq: 0 });
    expect(record.persistedPhases.at(-1)).toBe(RunPhase.RUN_WAITING_FOR_APPROVAL);
    expect(record.decideWaitingToolCalls(ApprovalAction.APPROVE_ALL, "2026-01-01T00:00:30.000Z")).toBe(1);

    await runCursorTurn(scenario, { threadId: "agent-lease-0001", turnSeq: 1 });
    // The approved publish and the later one run on the hook's lease; the
    // shell default still asks before pwd, which the hook passes.
    expect(answers).toEqual(["deny", "allow", "allow", "deny"]);
    expect(record.persistedPhases.at(-1), "the shell default still asks before pwd").toBe(RunPhase.RUN_WAITING_FOR_APPROVAL);
    const status = record.lastFullStatus!;
    const approved = row(status, "call-pub");
    expect([approved.approvalPolicySource, approved.approvalPolicyHook, approved.approvalAction]).toEqual([
      ApprovalPolicySource.HOOK, "safety", ApprovalAction.APPROVE_ALL,
    ]);
    const again = row(status, "call-again");
    expect(again.status).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
    expect([again.approvalPolicySource, again.approvalPolicyHook]).toEqual([ApprovalPolicySource.APPROVAL_LEASE, "safety"]);
    const where = row(status, "call-where");
    expect(where.status).toBe(ToolCallStatus.TOOL_CALL_WAITING_APPROVAL);
    expect(where.approvalPolicySource, "the default asked, not a hook").toBe(ApprovalPolicySource.BUILTIN_CATEGORY);
  });

  it("keeps both refusals of one command in a turn that completes, each on its own row", async () => {
    clock.reset();
    const workspaceRoot = sessionWorkspaceDir(env);
    const answers: string[] = [];
    const hook = (command: string, callId: string) =>
      step.effect(`hook: ${command}`, async () => {
        answers.push((await runWorkspaceHooks(workspaceRoot, shellHook(command, callId))).permission);
      });
    const ev = sdkEvents("agent-twice-0001", "run-twice-0001");
    const agent = new ScriptedCursorAgent({
      agentId: "agent-twice-0001",
      runIds: ["run-twice-0001"],
      observeStep: () => clock.tick(),
      turns: [
        [
          step.event(ev.init()),
          step.event(ev.toolCall("call-rm-1", "shell", "running", { command: "rm -rf build" })),
          hook("rm -rf build", "call-rm-1"),
          step.event(ev.toolCall("call-rm-1", "shell", "error", { command: "rm -rf build" }, "Blocked by a hook")),
          step.event(ev.toolCall("call-ls", "shell", "running", { command: "ls" })),
          hook("ls", "call-ls"),
          step.event(ev.toolCall("call-ls", "shell", "completed", { command: "ls" }, "build\n")),
          step.event(ev.toolCall("call-rm-2", "shell", "running", { command: "rm -rf build" })),
          hook("rm -rf build", "call-rm-2"),
          step.event(ev.toolCall("call-rm-2", "shell", "error", { command: "rm -rf build" }, "Blocked by a hook")),
          step.event(ev.assistant("Both deletes were refused.")),
          step.turnEnded({ inputTokens: 2_000, outputTokens: 40, cacheReadTokens: 0, cacheWriteTokens: 0 }),
          step.finished({ result: "Both deletes were refused.", model: { id: FIXTURE.model, params: [] } }),
        ],
      ],
    });
    const record = cursorExecutionRecord({ message: "Delete the build, list, then delete it again.", hooks: [SAFETY_REF] });
    const scenario = beginCursorScenario({ env, clock, record, sdk: { agents: [agent], catalog: SDK_CATALOG }, clientOverrides: pluginClient(GUARD) });

    const turn = await runCursorTurn(scenario, { threadId: "", turnSeq: 0 });
    expect(turn.outcome.kind).toBe("returned");
    expect(answers).toEqual(["deny", "allow", "deny"]);
    expect(record.persistedPhases.at(-1)).toBe(RunPhase.RUN_COMPLETED);
    const final = record.lastFullStatus!;
    // Two refusals of one command are two acts: the terminal twin collapse
    // keeps the rows the boundary settled from the refusals (#1967).
    for (const id of ["call-rm-1", "call-rm-2"]) {
      const refused = row(final, id);
      expect(isToolCallRowHidden(refused), `${id} stays visible`).toBe(false);
      expect([refused.status, refused.error, refused.approvalPolicyHook]).toEqual([
        ToolCallStatus.TOOL_CALL_FAILED,
        "The safety plugin's hook refused this call: recursive deletes are not allowed",
        "safety",
      ]);
    }
  });

  it("a person's refusal binds on the retry although the hook now allows", async () => {
    clock.reset();
    const workspaceRoot = sessionWorkspaceDir(env);
    const answers: string[] = [];
    const raws: string[] = [];
    const hook = (callId: string) =>
      step.effect(`hook: ${callId}`, async () => {
        const answer = await runWorkspaceHooks(workspaceRoot, shellHook("echo publish", callId));
        answers.push(answer.permission);
        raws.push(...answer.raws);
      });
    const ev1 = sdkEvents("agent-reject-0001", "run-reject-0001");
    const ev2 = sdkEvents("agent-reject-0001", "run-reject-0002");
    const agent = new ScriptedCursorAgent({
      agentId: "agent-reject-0001",
      runIds: ["run-reject-0001", "run-reject-0002"],
      observeStep: () => clock.tick(),
      turns: [
        [
          step.event(ev1.init()),
          step.event(ev1.toolCall("call-first", "shell", "running", { command: "echo publish" })),
          hook("call-first"),
          step.event(ev1.toolCall("call-first", "shell", "error", { command: "echo publish" }, "Blocked by a hook")),
          step.finished({ result: "never" }),
        ],
        [
          step.event(ev2.toolCall("call-retry", "shell", "running", { command: "echo publish" })),
          hook("call-retry"),
          step.event(ev2.toolCall("call-retry", "shell", "error", { command: "echo publish" }, "Blocked by a hook")),
          step.event(ev2.assistant("I will not publish.")),
          step.turnEnded({ inputTokens: 1_000, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0 }),
          step.finished({ result: "I will not publish.", model: { id: FIXTURE.model, params: [] } }),
        ],
      ],
    });
    const record = cursorExecutionRecord({ message: "Publish.", hooks: [SAFETY_REF] });
    const scenario = beginCursorScenario({ env, clock, record, sdk: { agents: [agent], catalog: SDK_CATALOG }, clientOverrides: pluginClient(CHANGES_ITS_MIND) });

    await runCursorTurn(scenario, { threadId: "", turnSeq: 0 });
    expect(record.persistedPhases.at(-1)).toBe(RunPhase.RUN_WAITING_FOR_APPROVAL);
    expect(record.decideWaitingToolCalls(ApprovalAction.REJECT, "2026-01-01T00:00:30.000Z")).toBe(1);

    await runCursorTurn(scenario, { threadId: "agent-reject-0001", turnSeq: 1 });
    expect(answers, "the hook allows the retry; the person's refusal still refuses it").toEqual(["deny", "deny"]);
    expect(raws.at(-1), "the model reads the person's decision").toContain(
      "Tool 'shell' was rejected by the user. Do not retry it; proceed by taking their objection into account.",
    );
    expect(record.persistedPhases.at(-1)).toBe(RunPhase.RUN_COMPLETED);
    const status = record.lastFullStatus!;
    expect(row(status, "call-first").approvalAction).toBe(ApprovalAction.REJECT);
    // The retry is the rejected call's twin: kept in place, hidden, never run.
    const retry = row(status, "call-retry");
    expect(retry.status).toBe(ToolCallStatus.TOOL_CALL_SKIPPED);
    expect(isToolCallRowHidden(retry)).toBe(true);
  });

  it("runs only the agent's own hooks: a repository's hook files are set aside for the turn and handed back", async () => {
    clock.reset();
    const workspaceRoot = sessionWorkspaceDir(env);
    const marker = join(workspaceRoot, "repository-hook-ran");
    mkdirSync(join(workspaceRoot, ".cursor"), { recursive: true });
    mkdirSync(join(workspaceRoot, ".claude"), { recursive: true });
    const cursorHooks = `${JSON.stringify({ version: 1, hooks: { preToolUse: [{ command: `touch ${marker}; echo '{}'` }] } }, null, 2)}\n`;
    const claudeSettings = `${JSON.stringify({ model: "x", hooks: { PreToolUse: [{ matcher: "", hooks: [{ type: "command", command: `touch ${marker}` }] }] } })}\n`;
    writeFileSync(join(workspaceRoot, ".cursor", "hooks.json"), cursorHooks, "utf-8");
    writeFileSync(join(workspaceRoot, ".claude", "settings.json"), claudeSettings, "utf-8");

    let duringClaude = "";
    let readAnswer = "";
    const ev = sdkEvents("agent-files-0001", "run-files-0001");
    const agent = new ScriptedCursorAgent({
      agentId: "agent-files-0001",
      runIds: ["run-files-0001"],
      observeStep: () => clock.tick(),
      turns: [
        [
          step.event(ev.init()),
          step.event(ev.toolCall("call-read", "read", "running", { path: join(workspaceRoot, "README.md") })),
          step.effect("every registered preToolUse entry, as the SDK runs them", async () => {
            readAnswer = (await runWorkspaceHooks(workspaceRoot, hookBuiltin("Read", { file_path: join(workspaceRoot, "README.md") }))).permission;
            duringClaude = readFileSync(join(workspaceRoot, ".claude", "settings.json"), "utf-8");
          }),
          step.event(ev.toolCall("call-read", "read", "completed", { path: join(workspaceRoot, "README.md") }, "# readme")),
          step.event(ev.assistant("Read it.")),
          step.turnEnded({ inputTokens: 1_000, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0 }),
          step.finished({ result: "Read it.", model: { id: FIXTURE.model, params: [] } }),
        ],
      ],
    });
    const record = cursorExecutionRecord({ message: "Read the readme." });
    const scenario = beginCursorScenario({ env, clock, record, sdk: { agents: [agent], catalog: SDK_CATALOG } });

    await runCursorTurn(scenario, { threadId: "", turnSeq: 0 });
    expect(record.persistedPhases.at(-1)).toBe(RunPhase.RUN_COMPLETED);
    expect(readAnswer).toBe("allow");
    expect(existsSync(marker), "neither repository hook ran").toBe(false);
    expect(JSON.parse(duringClaude), "the .claude hooks were set aside during the turn, every other key kept").toEqual({ model: "x" });
    expect(readFileSync(join(workspaceRoot, ".cursor", "hooks.json"), "utf-8")).toBe(cursorHooks);
    expect(readFileSync(join(workspaceRoot, ".claude", "settings.json"), "utf-8")).toBe(claudeSettings);
  });

  it("hides web fetch and web search from an agent whose hooks would take them", async () => {
    clock.reset();
    const ev = sdkEvents("agent-hide-0001", "run-hide-0001");
    const agent = new ScriptedCursorAgent({
      agentId: "agent-hide-0001",
      runIds: ["run-hide-0001"],
      observeStep: () => clock.tick(),
      turns: [[
        step.event(ev.init()),
        step.event(ev.assistant("Done.")),
        step.turnEnded({ inputTokens: 500, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 }),
        step.finished({ result: "Done.", model: { id: FIXTURE.model, params: [] } }),
      ]],
    });
    const everyCall = create(HookSourceSchema, {
      source: {
        case: "inline",
        value: create(HookConfigSchema, {
          format: HookFormat.CLAUDE_CODE,
          groups: [create(HookGroupSchema, { event: "PreToolUse", matcher: "", handlers: [create(HookHandlerSchema, { command: "true" })] })],
        }),
      },
    });
    const record = cursorExecutionRecord({ message: "Say done.", hooks: [everyCall] });
    const scenario = beginCursorScenario({ env, clock, record, sdk: { agents: [agent], catalog: SDK_CATALOG } });

    await runCursorTurn(scenario, { threadId: "", turnSeq: 0 });
    expect(record.persistedPhases.at(-1)).toBe(RunPhase.RUN_COMPLETED);
    const options = scenario.sdk.resolutions[0]!.options as { disallowedTools?: string[] };
    expect(options.disallowedTools).toEqual(["webFetch", "webSearch"]);
  });

  it("refuses a person's own folder whose .claude settings carry hooks, naming the file, and leaves it untouched", async () => {
    clock.reset();
    const folder = mkdtempSync(join(tmpdir(), "own-folder-"));
    mkdirSync(join(folder, ".claude"), { recursive: true });
    const settingsPath = join(folder, ".claude", "settings.local.json");
    const settings = JSON.stringify({ hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "true" }] }] } });
    writeFileSync(settingsPath, settings, "utf-8");
    const record = cursorExecutionRecord({ message: "Look around.", workspaceEntries: [localPathEntry("mine", folder)] });
    const scenario = beginCursorScenario({
      env,
      clock,
      record,
      sdk: { agents: [new ScriptedCursorAgent({ agentId: "agent-own-never", turns: [] })], catalog: SDK_CATALOG },
    });

    const invocation = await runCursorTurn(scenario);
    expect((invocation.outcome as { value: Record<string, unknown> }).value.phase).toBe("RUN_FAILED");
    const final = scenario.record.lastFullStatus!;
    expect(final.error).toContain(settingsPath);
    expect(final.error).toContain("Run this session on Stigmer's native engine");
    expect(final.messages.filter((m) => m.type === MessageType.MESSAGE_SYSTEM).map((m) => m.content)).toEqual([
      `Execution failed: ${final.error}`,
    ]);
    expect(scenario.sdk.resolutions, "the SDK was never reached").toHaveLength(0);
    expect(readFileSync(settingsPath, "utf-8")).toBe(settings);
  });
});
