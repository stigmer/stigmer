/**
 * Hermetic goldens: a Claude call that needs a person waits for one, on the
 * real engine, and a resumed run answers it by the call's id.
 *
 *  - The shell under the default pauses (`defer`): the run waits with one
 *    WAITING row, the card the default's, the call never run. Approved, the
 *    next invocation resumes the engine with no prompt, from the session's
 *    store alone (the engine's per-invocation directory is gone), and the
 *    engine runs exactly that call, once.
 *  - Rejected with a reason, the call never runs, the model reads the
 *    reason, and the runtime settles the row SKIPPED, "Rejected by user".
 *  - "Approve all" on a shell card leases the category: the next shell call
 *    runs without a card.
 *  - Two calls that need a person in one message: the first waits, the
 *    second is refused with the sentence that asks for it alone; the model
 *    asks again alone and that call waits in turn.
 *  - A bridged MCP tool its server marks destructive waits, and approved,
 *    runs on the server the host connected.
 *  - A run stopped while a call waited leaves that call in the engine's
 *    transcript: the next run's engine reaches it, and it is refused as a
 *    call nobody answered, never run.
 *  - A message a person sent before the pause is not taken at it; the
 *    resumed run reads it after the approved call's result.
 *
 * Regenerate ONLY after a deliberate behavior change:
 *   npx vitest run src/activities/execute-claude/__tests__/hermetic/approvals.test.ts -u
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("../../../../client/stigmer-client.js", async () =>
  (await import("../../../../__test-utils__/hermetic-activity.js")).hermeticStigmerClientModule(),
);

import { ScriptedClock, createHermeticEnvironment, rowsGolden, rowsGoldenPath, statusGolden, type ExecutionRecord } from "../../../../__test-utils__/hermetic-activity.js";
import { REJECTED_BY_USER_ERROR } from "../../../../harness/approval-decisions.js";
import { ApprovalAction, ApprovalPolicySource, ToolCallStatus } from "../../../../gen/turn/ai/stigmer/runner/turn/v1/enum_pb.js";
import { personDecisionSentence } from "../../../../shared/hooks/messages.js";
import { getClaudeEngineDir } from "../../../../shared/workspace/platform-dir.js";
import { anthropicText, anthropicToolUses, type WireConversation, type WireScript } from "../../__test-utils__/claude-wire.js";
import { FIXTURE, claudeExecutionRecord, claudeScenarioFile, sessionWorkspaceDir, type ClaudeScenarioFile } from "../../__test-utils__/hermetic-claude.js";
import { HttpMcpServer } from "../../__test-utils__/http-mcp-server.js";
import { ASK_ALONE_MESSAGE, STALE_CALL_MESSAGE } from "../../gate.js";

/** One model step: the calls of one message. */
type Step = readonly { readonly id: string; readonly name: string; readonly input: Record<string, unknown> }[];

/** A script that makes each step once, in order (a step is done once the conversation issued all its calls), then answers `closing`. */
function steps(list: readonly Step[], closing: string): WireScript {
  return (c: WireConversation) => {
    const next = list.find((step) => step.every((call) => !c.issued.has(call.id)));
    return next === undefined ? anthropicText(closing) : anthropicToolUses(next.map((call) => ({ toolCallId: call.id, toolName: call.name, toolInput: call.input })));
  };
}

/** A shell call appending `id` to the workspace's ledger, so its runs are counted from disk. */
function shell(id: string): Step[number] {
  return { id, name: "Bash", input: { command: `echo ${id} >> ledger.txt`, description: `Record ${id}` } };
}

const env = createHermeticEnvironment();
const clock = new ScriptedClock();
const destructive = new HttpMcpServer(
  [{ name: "purge", description: "Purge the cache.", inputSchema: { type: "object" as const, properties: { scope: { type: "string" } } }, annotations: { destructiveHint: true } }],
  async (_tool, args) => `purged ${String(args.scope)}`,
);
let file: ClaudeScenarioFile;

/** How many times each id ran, from the workspace's ledger. */
function runs(): string[] {
  const ledger = join(sessionWorkspaceDir(env), "ledger.txt");
  return existsSync(ledger) ? readFileSync(ledger, "utf8").trim().split("\n").filter(Boolean) : [];
}

function phaseOf(invocation: { readonly outcome: unknown }): unknown {
  return (invocation.outcome as { value?: Record<string, unknown> }).value?.phase;
}

async function goldens(record: ExecutionRecord, name: string): Promise<void> {
  const final = record.lastFullStatus!;
  const json = statusGolden(final);
  expect(json, "no temp path reaches the status").not.toContain(env.workspaceRootDir);
  await expect(json).toMatchFileSnapshot(`./goldens/${name}.status.json`);
  await expect(rowsGolden(record.rowsOf(final))).toMatchFileSnapshot(rowsGoldenPath(`./goldens/${name}.status.json`));
  await expect(record.eventsGolden()).toMatchFileSnapshot(`./goldens/${name}.events.json`);
}

const AT = "2026-01-01T00:00:30.000Z";

describe("ExecuteClaude hermetic — approvals", () => {
  beforeAll(async () => {
    await destructive.start();
    file = claudeScenarioFile(env, clock, {}, [destructive.url]);
    await file.start();
  });
  afterAll(async () => {
    await file.stop();
    await destructive.stop();
  });

  it("an approved shell call waits for a person, then runs exactly once from the store alone", async () => {
    const record = claudeExecutionRecord({ message: "Clean the build." });
    const script = steps([[shell("toolu_clean")]], "Cleaned.");
    const paused = await file.run(record, script);

    expect(phaseOf(paused)).toBe("RUN_WAITING_FOR_APPROVAL");
    const [row] = record.waitingToolCalls();
    expect([row?.id, row?.name, row?.approvalPolicySource, row?.requiresApproval]).toEqual(["toolu_clean", "Bash", ApprovalPolicySource.BUILTIN_CATEGORY, true]);
    expect(row?.approvalMessage).toContain("echo toolu_clean >> ledger.txt");
    expect(row?.args, "the row keeps the model's own call").toEqual({ command: "echo toolu_clean >> ledger.txt", description: "Record toolu_clean" });
    expect(runs(), "nothing ran while it waited").toEqual([]);
    expect(readdirSync(getClaudeEngineDir(FIXTURE.sessionId)), "only the transcripts outlive the invocation").toEqual(["transcripts"]);

    expect(record.decideWaitingToolCalls(ApprovalAction.APPROVE, AT)).toBe(1);
    const before = file.wire().conversations.length;
    const resumed = await file.resume(record, script, { turnSeq: 1 });

    expect(phaseOf(resumed)).toBe("RUN_COMPLETED");
    expect(runs()).toEqual(["toolu_clean"]);
    const done = record.toolCalls().find((r) => r.id === "toolu_clean")!;
    expect([done.status, done.approvalAction]).toEqual([ToolCallStatus.TOOL_CALL_COMPLETED, ApprovalAction.APPROVE]);
    const after = file.wire().conversations.slice(before);
    expect(after.every((c) => c.userTexts.filter((t) => t.includes("Clean the build.")).length === 1), "the task is never handed again").toBe(true);
    expect(after.at(-1)!.toolResults.get("toolu_clean")?.isError).toBe(false);
    await goldens(record, "shell-approved");
  });

  it("a rejected call never runs, and the model reads the person's reason", async () => {
    const record = claudeExecutionRecord({ message: "Release it." });
    const script = steps([[shell("toolu_release")]], "Not releasing.");
    expect(phaseOf(await file.run(record, script))).toBe("RUN_WAITING_FOR_APPROVAL");

    expect(record.decideWaitingToolCalls(ApprovalAction.REJECT, AT, undefined, "not today")).toBe(1);
    const resumed = await file.resume(record, script, { turnSeq: 1 });

    expect(phaseOf(resumed)).toBe("RUN_COMPLETED");
    expect(runs()).toEqual([]);
    const row = record.toolCalls().find((r) => r.id === "toolu_release")!;
    expect([row.status, row.error, row.approvalAction]).toEqual([ToolCallStatus.TOOL_CALL_SKIPPED, REJECTED_BY_USER_ERROR, ApprovalAction.REJECT]);
    expect(file.wire().conversations.at(-1)!.toolResults.get("toolu_release")?.text).toContain(personDecisionSentence("Bash", "reject", "not today"));
    await goldens(record, "shell-rejected");
  });

  it("approve all on a shell card lets the next shell call run without one", async () => {
    const record = claudeExecutionRecord({ message: "Build and test." });
    const script = steps([[shell("toolu_build")], [shell("toolu_test")]], "Built and tested.");
    expect(phaseOf(await file.run(record, script))).toBe("RUN_WAITING_FOR_APPROVAL");

    expect(record.decideWaitingToolCalls(ApprovalAction.APPROVE_ALL, AT)).toBe(1);
    const resumed = await file.resume(record, script, { turnSeq: 1 });

    expect(phaseOf(resumed)).toBe("RUN_COMPLETED");
    expect(runs()).toEqual(["toolu_build", "toolu_test"]);
    const next = record.toolCalls().find((r) => r.id === "toolu_test")!;
    expect([next.status, next.requiresApproval, next.approvalPolicySource]).toEqual([ToolCallStatus.TOOL_CALL_COMPLETED, false, ApprovalPolicySource.APPROVAL_LEASE]);
  });

  it("two calls that need a person at once: the first waits, the second is asked for alone and waits in turn", async () => {
    const record = claudeExecutionRecord({ message: "Clean, then release." });
    const script = steps([[shell("toolu_first"), shell("toolu_second")], [shell("toolu_second_alone")]], "Both done.");
    expect(phaseOf(await file.run(record, script))).toBe("RUN_WAITING_FOR_APPROVAL");
    expect(record.waitingToolCalls().map((r) => r.id)).toEqual(["toolu_first"]);
    const refused = record.toolCalls().find((r) => r.id === "toolu_second")!;
    expect([refused.status, refused.error]).toEqual([ToolCallStatus.TOOL_CALL_FAILED, ASK_ALONE_MESSAGE]);

    expect(record.decideWaitingToolCalls(ApprovalAction.APPROVE, AT)).toBe(1);
    expect(phaseOf(await file.resume(record, script, { turnSeq: 1 }))).toBe("RUN_WAITING_FOR_APPROVAL");
    expect(record.waitingToolCalls().map((r) => r.id)).toEqual(["toolu_second_alone"]);
    expect(runs()).toEqual(["toolu_first"]);

    expect(record.decideWaitingToolCalls(ApprovalAction.APPROVE, AT)).toBe(1);
    expect(phaseOf(await file.resume(record, script, { turnSeq: 2 }))).toBe("RUN_COMPLETED");
    expect(runs()).toEqual(["toolu_first", "toolu_second_alone"]);
    await goldens(record, "ask-alone");
  });

  it("a destructive tool of a bridged server waits, and approved, runs on that server", async () => {
    const record = claudeExecutionRecord({ message: "Purge the cache.", mcpServers: [{ name: "ops", url: `${destructive.url}/mcp` }] });
    const script = steps(
      [
        [{ id: "toolu_load", name: "ToolSearch", input: { query: "select:mcp__ops__purge", max_results: 1 } }],
        [{ id: "toolu_purge", name: "mcp__ops__purge", input: { scope: "all" } }],
      ],
      "Purged.",
    );
    expect(phaseOf(await file.run(record, script))).toBe("RUN_WAITING_FOR_APPROVAL");
    const [row] = record.waitingToolCalls();
    expect([row?.id, row?.mcpServerSlug, row?.approvalPolicySource]).toEqual(["toolu_purge", "ops", ApprovalPolicySource.ANNOTATION_DESTRUCTIVE_TIGHTEN]);
    expect(destructive.calls).toEqual([]);

    expect(record.decideWaitingToolCalls(ApprovalAction.APPROVE, AT)).toBe(1);
    expect(phaseOf(await file.resume(record, script, { turnSeq: 1 }))).toBe("RUN_COMPLETED");
    expect(destructive.calls).toEqual([{ tool: "purge", args: { scope: "all" } }]);
    expect(record.toolCalls().find((r) => r.id === "toolu_purge")?.result).toBe("purged all");
  });

  it("a call a stopped run left waiting is refused in the next run, never run", async () => {
    const first = claudeExecutionRecord({ message: "Delete the build." });
    expect(phaseOf(await file.run(first, steps([[shell("toolu_stale")]], "Deleted.")))).toBe("RUN_WAITING_FOR_APPROVAL");

    // The person stops the run instead of answering, and sends another message: a new run on the same session.
    const second = claudeExecutionRecord({ message: "Never mind, just say hi.", executionId: "aex_claude_0002" });
    const before = file.wire().conversations.length;
    const next = await file.resume(second, () => anthropicText("Hi."));

    expect(phaseOf(next)).toBe("RUN_COMPLETED");
    expect(runs()).toEqual([]);
    const read = file.wire().conversations.slice(before);
    expect(read.some((c) => c.toolResults.get("toolu_stale")?.text.includes(STALE_CALL_MESSAGE)), "the model reads why it did not run").toBe(true);
    expect(read.at(-1)!.userTexts.some((t) => t.includes("Never mind, just say hi."))).toBe(true);
  });

  it("a message sent before the pause is read after the approved call's result", async () => {
    const record = claudeExecutionRecord({ message: "Clean the build." });
    let sent = false;
    const script = steps([[shell("toolu_queued")]], "Cleaned, and noted.");
    expect(
      phaseOf(
        await file.run(record, (c) => {
          if (!sent) {
            sent = true;
            record.sendMessage("Also keep the logs.");
          }
          return script(c);
        }),
      ),
    ).toBe("RUN_WAITING_FOR_APPROVAL");
    expect(file.wire().conversations.some((c) => c.userTexts.some((t) => t.includes("Also keep the logs."))), "not taken at the pause").toBe(false);

    expect(record.decideWaitingToolCalls(ApprovalAction.APPROVE, AT)).toBe(1);
    const before = file.wire().conversations.length;
    expect(phaseOf(await file.resume(record, script, { turnSeq: 1 }))).toBe("RUN_COMPLETED");
    expect(runs()).toEqual(["toolu_queued"]);
    const reading = file.wire().conversations.slice(before).find((c) => c.userTexts.some((t) => t.includes("Also keep the logs.")) || [...c.toolResults.values()].some((r) => r.text.includes("Also keep the logs.")));
    expect(reading, "the resumed run reads the message").toBeDefined();
    expect(reading!.toolResults.has("toolu_queued"), "after the approved call's result").toBe(true);
  });
});
