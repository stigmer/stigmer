/**
 * Hermetic golden: a plugin's tool hook denies, allows and asks on the
 * native engine — the real activity, two invocations, a real command hook.
 *
 * The agent references the `safety` plugin through `AgentSpec.hooks`. The
 * runtime reads it by reference, fetches its archive (the unary lane; the
 * download lane answers Unimplemented here), verifies it against the
 * installed digest and mounts it; the hook is the plugin's own extensionless
 * bash script, made executable by its `#!` line, run in shell form from
 * `${CLAUDE_PLUGIN_ROOT}`. It reads the call on stdin and answers as Claude
 * Code's hooks do: exit 2 with a reason refuses `rm -rf`, JSON allows `ls`,
 * and JSON asks before publishing.
 *
 * Turn 1: the model proposes all three at once. The delete is refused (its
 * row fails with the hook's reason and names the hook), `ls` runs without a
 * card (the shell default would have asked; the gate's `tool_policy` event
 * stamps the hook on the row), and the publish waits for a person on a card
 * naming the hook: WAITING_FOR_APPROVAL.
 *
 * Between turns: the person approves the publish.
 *
 * Turn 2: the graph resumes inside the gate; the hook runs again (as
 * Claude's `defer` re-fires PreToolUse), asks again, and the stored decision
 * answers it; the publish runs; COMPLETED. Every row says the hook decided.
 *
 * Regenerate ONLY after a deliberate behavior change:
 *   npx vitest run src/activities/execute-deep-agent/__tests__/hermetic -u
 */

import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { create, toJson } from "@bufbuild/protobuf";
import { ConnectError, Code } from "@connectrpc/connect";
import { AgentExecutionStatusSchema, type AgentExecutionStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { HookSourceSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import {
  ApprovalAction,
  ApprovalPolicySource,
  ExecutionPhase,
  ToolCallStatus,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { PluginSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import { HookConfigSchema, HookFormat, HookGroupSchema, HookHandlerSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/hooks_pb";
import { GetArtifactResponseSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/io_pb";
import { ApiResourceReferenceSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { buildZip } from "@stigmer/zip-structure/testing";

vi.mock("../../../../shared/model-client.js", async () =>
  (await import("../../__test-utils__/scripted-model-module.js")).scriptedModelClientModule(),
);
vi.mock("../../../../client/stigmer-client.js", async () =>
  (await import("../../../../__test-utils__/hermetic-activity.js")).hermeticStigmerClientModule(),
);

import { ScriptedClock, createHermeticEnvironment, type HermeticEnvironment } from "../../../../__test-utils__/hermetic-activity.js";
import { stubRegistryFetch } from "../../../../__test-utils__/model-registry-fixture.js";
import { beginDeepAgentScenario, deepAgentExecutionRecord, runDeepAgentTurn } from "../../__test-utils__/hermetic-deep-agent.js";
import type { ScriptedToolCall } from "../../__test-utils__/scripted-model.js";
import { CLOSING_TURN } from "../../__test-utils__/hitl-script.js";

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

const ARCHIVE = buildZip([
  { name: ".claude-plugin/plugin.json", content: '{"name":"safety"}' },
  { name: "hooks/guard", content: GUARD },
]);

const SAFETY = create(PluginSchema, {
  metadata: { id: "plg_safety", org: "hermetic-org", slug: "safety", name: "safety" },
  status: {
    digest: createHash("sha256").update(ARCHIVE).digest("hex"),
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

const DELETE: ScriptedToolCall = { id: "call-hooks-delete", name: "execute", args: { command: "rm -rf build" } };
const LIST: ScriptedToolCall = { id: "call-hooks-list", name: "execute", args: { command: "ls" } };
const PUBLISH: ScriptedToolCall = { id: "call-hooks-publish", name: "execute", args: { command: "echo publish" } };

function statusJson(status: AgentExecutionStatus): string {
  return JSON.stringify(toJson(AgentExecutionStatusSchema, status), null, 2) + "\n";
}

describe("ExecuteDeepAgent hermetic — a plugin's hook denies, allows and asks", () => {
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

  it("refuses the delete, runs the listing, and holds the publish for a person", async () => {
    const record = deepAgentExecutionRecord({
      message: "Clean the build, list the files, then publish.",
      hooks: [create(HookSourceSchema, {
        source: { case: "plugin", value: create(ApiResourceReferenceSchema, { kind: 58, org: "hermetic-org", slug: "safety" }) },
      })],
    });
    const getPluginArtifact = vi.fn(async () => create(GetArtifactResponseSchema, { artifact: ARCHIVE }));
    const scenario = beginDeepAgentScenario({
      env,
      clock,
      record,
      clientOverrides: {
        getPluginByReference: vi.fn(async () => SAFETY),
        getPluginArtifactDownloadUrl: vi.fn(async () => {
          throw new ConnectError("no download lane", Code.Unimplemented);
        }),
        getPluginArtifact,
      },
      script: () => ({
        turns: [
          { text: "Cleaning, listing and publishing.", toolCalls: [DELETE, LIST, PUBLISH], usage: { inputTokens: 1_400, outputTokens: 80 } },
          CLOSING_TURN,
        ],
      }),
    });

    // ── Turn 1 ───────────────────────────────────────────────────────────────
    const turn1 = await runDeepAgentTurn(scenario, { turnSeq: 0 });
    expect(turn1.outcome.kind).toBe("returned");
    expect(record.persistedPhases.at(-1)).toBe(ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL);

    const run1 = record.lastFullStatus!;
    const row = (status: AgentExecutionStatus, id: string) => status.messages.flatMap((m) => m.toolCalls).find((tc) => tc.id === id)!;

    const deleted = row(run1, DELETE.id);
    expect(deleted.status).toBe(ToolCallStatus.TOOL_CALL_FAILED);
    expect(deleted.error).toBe("The safety plugin's hook refused this call: recursive deletes are not allowed");
    expect([deleted.approvalPolicySource, deleted.approvalPolicyHook]).toEqual([ApprovalPolicySource.HOOK, "safety"]);

    const listed = row(run1, LIST.id);
    expect(listed.status).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
    expect(listed.requiresApproval, "the hook's allow skips the shell default's card").toBe(false);
    expect([listed.approvalPolicySource, listed.approvalPolicyHook]).toEqual([ApprovalPolicySource.HOOK, "safety"]);

    const held = row(run1, PUBLISH.id);
    expect(held.status).toBe(ToolCallStatus.TOOL_CALL_WAITING_APPROVAL);
    expect(held.approvalMessage).toBe("publishing needs a person");
    expect([held.approvalPolicySource, held.approvalPolicyHook]).toEqual([ApprovalPolicySource.HOOK, "safety"]);
    await expect(statusJson(run1)).toMatchFileSnapshot("./goldens/hooks.turn1.status.json");

    // ── Between turns: approve the publish ───────────────────────────────────
    expect(record.decideWaitingToolCalls(ApprovalAction.APPROVE, "2026-01-01T00:00:30.000Z")).toBe(1);

    // ── Turn 2 ───────────────────────────────────────────────────────────────
    const turn2 = await runDeepAgentTurn(scenario, { turnSeq: 1 });
    expect(turn2.outcome.kind).toBe("returned");
    expect(record.persistedPhases.at(-1)).toBe(ExecutionPhase.EXECUTION_COMPLETED);

    const final = record.lastFullStatus!;
    const published = row(final, PUBLISH.id);
    expect(published.status).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
    expect(published.result).toContain("publish");
    expect([published.approvalPolicySource, published.approvalPolicyHook]).toEqual([ApprovalPolicySource.HOOK, "safety"]);
    expect(published.approvalAction).toBe(ApprovalAction.APPROVE);
    expect(row(final, DELETE.id).status, "the refusal stays refused").toBe(ToolCallStatus.TOOL_CALL_FAILED);

    // The second turn mounts from the session's verified cache.
    expect(getPluginArtifact).toHaveBeenCalledTimes(1);
    expect(registry.urls.every((u) => u.includes("/model-registry"))).toBe(true);
    await expect(statusJson(final)).toMatchFileSnapshot("./goldens/hooks.turn2.status.json");
  });
});
