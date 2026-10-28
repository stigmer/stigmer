/**
 * Hermetic goldens: a Claude turn's sub-agents, on the real engine, each
 * run to its end before the main agent goes on (`agents.ts`), held by the
 * gate as its own caller (`gate.ts`).
 *
 *  - A saved sub-agent runs on its own definition: its lists, its own skill
 *    (loaded by the Skill tool), its own server and none of the main
 *    agent's, its own shell values in a shell that is the host's child,
 *    and no tool that hands work on. Its spend reaches the turn's count:
 *    each of its calls' input as it arrives, its output when the round
 *    ends, the totals what the model served.
 *  - A plugin's agent runs on the main agent's servers, with its file's
 *    skill.
 *  - A delegation that sets a model or an isolation, or names a helper the
 *    turn does not define, is refused and starts nothing; a sub-agent's
 *    call that would ask a person is refused with the helper's sentence,
 *    and on an unattended lane skipped with the shared one.
 *  - A message sent while a sub-agent works reaches the main agent after
 *    it, never the sub-agent.
 *  - A runner lost while a sub-agent works: the next invocation continues
 *    from the session store, the sub-agent's row settles, and nothing the
 *    sub-agent ran runs twice.
 *
 * Regenerate ONLY after a deliberate behavior change:
 *   npx vitest run src/activities/execute-claude/__tests__/hermetic/subagents.test.ts -u
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { create } from "@bufbuild/protobuf";
import { AgentMcpServerSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/spec_pb";
import { ApprovalMode } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { SkillSchema, type Skill } from "@stigmer/apis/ai/stigmer/agentic/skill/v1/api_pb";
import { ExecutionValuesSchema } from "@stigmer/apis/ai/stigmer/agentic/vault/v1/values_pb";
import { ApiResourceReferenceSchema, type ApiResourceReference } from "@stigmer/apis/ai/stigmer/commons/apiresource/io_pb";
import type { AnthropicMessageBody } from "@stigmer/test-support/llm-wire";
import type { RoutedResponse } from "@stigmer/test-support/mock-llm";

vi.mock("../../../../client/stigmer-client.js", async () =>
  (await import("../../../../__test-utils__/hermetic-activity.js")).hermeticStigmerClientModule(),
);

import type { StigmerClient } from "../../../../client/stigmer-client.js";
import { ScriptedClock, createHermeticEnvironment, rowsGolden, rowsGoldenPath, statusGolden, type ExecutionRecord, type InvocationControls } from "../../../../__test-utils__/hermetic-activity.js";
import { savedAgentFixture } from "../../../../__test-utils__/execution-record-fixture.js";
import { ToolCallStatus } from "../../../../gen/turn/ai/stigmer/runner/turn/v1/enum_pb.js";
import { unattendedSkipMessage } from "../../../../shared/approval-policy.js";
import { anthropicText, anthropicToolUses, type WireConversation } from "../../__test-utils__/claude-wire.js";
import { FIXTURE, claudeExecutionRecord, claudeScenarioFile, sessionWorkspaceDir, type ClaudeScenarioFile } from "../../__test-utils__/hermetic-claude.js";
import { HttpMcpServer } from "../../../../__test-utils__/http-mcp-server.js";
import { ACME_CLIENT, HELPER_INSTRUCTIONS, LINT_BODY, useAcme } from "../../__test-utils__/hermetic-plugin.js";
import { SUBAGENT_APPROVAL_MESSAGE, helperOverrideMessage, unknownHelperMessage } from "../../gate.js";

const RUNNER_INSTRUCTIONS = "You run the project's tests and report what failed.";
const OBJECT = { type: "object" as const, properties: { target: { type: "string" } } };

const ci = new HttpMcpServer([{ name: "run", description: "Run the CI suite.", inputSchema: OBJECT }], async () => "CI green.");
const docs = new HttpMcpServer([{ name: "lookup", description: "Look a thing up.", inputSchema: OBJECT }], async () => "Found it.");

const CI_SKILL = create(SkillSchema, {
  metadata: { id: "skill-ci-checklist", org: FIXTURE.org, name: "ci-checklist", slug: "ci-checklist" },
  spec: { name: "ci-checklist", description: "What a green build needs.", skillMd: "---\nname: ci-checklist\n---\nEvery suite passes, nothing skipped.\n" },
  status: { versionHash: "hash-ci-checklist" },
});

function skillRef(slug: string): ApiResourceReference {
  return create(ApiResourceReferenceSchema, { org: FIXTURE.org, slug });
}

/** The saved helper: its own lists, its own skill, its own server. */
function runnerAgent() {
  return savedAgentFixture(
    "test-runner",
    {
      description: "Runs the tests.",
      instructions: RUNNER_INSTRUCTIONS,
      tools: ["Read", "Bash", "Skill", "mcp__ci"],
      skillRefs: [skillRef("ci-checklist")],
      mcpServers: [create(AgentMcpServerSchema, { name: "ci", url: `${ci.url}/mcp` })],
    },
    FIXTURE.org,
  );
}

/** The control plane's answers for the saved helper: its skill and its own values. */
function runnerClient(extra: Partial<StigmerClient> = {}): Partial<StigmerClient> {
  return {
    getSkillByReference: vi.fn(async (ref: ApiResourceReference): Promise<Skill> => {
      if (ref.slug === "ci-checklist") return CI_SKILL;
      throw new Error(`no skill ${ref.slug}`);
    }),
    fetchExecutionValues: vi.fn(async () => create(ExecutionValuesSchema, { agent: { MAIN_VALUE: "main-only" }, subagents: [{ name: "test-runner", values: { RUNNER_TOKEN: "runner-only" } }] })),
    ...extra,
  };
}

type Who = "root" | "runner" | "helper";

function whoAsks(c: WireConversation): Who {
  if (c.system.includes(RUNNER_INSTRUCTIONS)) return "runner";
  if (c.system.includes(HELPER_INSTRUCTIONS)) return "helper";
  return "root";
}

interface Step {
  readonly id: string;
  readonly name: string;
  readonly input: Record<string, unknown>;
}

/** A script per agent: each makes its calls once, in order, then answers its closing, every answer's usage tallied. */
function agentsScript(
  plans: Partial<Record<Who, { readonly steps: readonly Step[]; readonly closing: string; readonly usage?: { inputTokens: number; outputTokens: number } }>>,
  tally: { input: number; output: number },
  hold?: (who: Who, c: WireConversation) => RoutedResponse | undefined,
): (c: WireConversation) => AnthropicMessageBody | RoutedResponse {
  return (c) => {
    const who = whoAsks(c);
    const held = hold?.(who, c);
    if (held !== undefined) return held;
    const plan = plans[who];
    if (plan === undefined) throw new Error(`no plan for ${who}`);
    const usage = plan.usage ?? { inputTokens: 10, outputTokens: 5 };
    tally.input += usage.inputTokens;
    tally.output += usage.outputTokens;
    const next = plan.steps.find((step) => !c.issued.has(step.id));
    return next === undefined ? anthropicText(plan.closing, usage) : anthropicToolUses([{ toolCallId: next.id, toolName: next.name, toolInput: next.input }], usage);
  };
}

const DELEGATE: Step = { id: "toolu_delegate", name: "Agent", input: { description: "run the tests", prompt: "Run the tests and report.", subagent_type: "test-runner" } };

async function goldens(record: ExecutionRecord, name: string): Promise<void> {
  const final = record.lastFullStatus!;
  const json = statusGolden(final);
  expect(json, "no temp path reaches the status").not.toContain(env.workspaceRootDir);
  await expect(json).toMatchFileSnapshot(`./goldens/${name}.status.json`);
  await expect(rowsGolden(record.rowsOf(final))).toMatchFileSnapshot(rowsGoldenPath(`./goldens/${name}.status.json`));
  await expect(record.eventsGolden()).toMatchFileSnapshot(`./goldens/${name}.events.json`);
}

function phaseOf(invocation: { readonly outcome: unknown }): unknown {
  return (invocation.outcome as { value?: Record<string, unknown> }).value?.phase;
}

const env = createHermeticEnvironment();
const clock = new ScriptedClock();
let file: ClaudeScenarioFile;

describe("ExecuteClaude hermetic — sub-agents", () => {
  beforeAll(async () => {
    await ci.start();
    await docs.start();
    file = claudeScenarioFile(env, clock, {}, [ci.url, docs.url]);
    await file.start();
  });
  afterAll(async () => {
    await file.stop();
    await ci.stop();
    await docs.stop();
  });

  it("runs a saved sub-agent in the foreground on its own lists, skill, server and shell values, and counts its spend", async () => {
    const record = claudeExecutionRecord({
      message: "Get the tests run.",
      subagents: [runnerAgent()],
      autoApproveAll: true,
      mcpServers: [{ name: "docs", url: `${docs.url}/mcp` }],
    });
    const tally = { input: 0, output: 0 };
    const invocation = await file.run(
      record,
      agentsScript(
        {
          root: { steps: [DELEGATE], closing: "The tests pass.", usage: { inputTokens: 1_000, outputTokens: 20 } },
          runner: {
            steps: [
              { id: "toolu_runner_skill", name: "Skill", input: { skill: "agent:ci-checklist" } },
              { id: "toolu_runner_ci", name: "mcp__ci__run", input: { target: "all" } },
              { id: "toolu_runner_shell", name: "Bash", input: { command: 'echo "$RUNNER_TOKEN|${MAIN_VALUE:-none}"; echo $PPID > .runner-ppid' } },
              { id: "toolu_runner_docs", name: "mcp__docs__lookup", input: { target: "x" } },
            ],
            closing: "All suites pass.",
            usage: { inputTokens: 700, outputTokens: 30 },
          },
        },
        tally,
      ),
      { clientOverrides: runnerClient() },
    );

    expect(phaseOf(invocation)).toBe("RUN_COMPLETED");
    const conversations = file.wire().conversations;
    const runner = conversations.filter((c) => whoAsks(c) === "runner");
    const root = conversations.filter((c) => whoAsks(c) === "root");
    expect(runner.length).toBeGreaterThan(0);
    expect(runner[0]!.toolNames, "a sub-agent never hands work on").not.toContain("Agent");
    expect(root[0]!.system, "the main agent has no skill of its own, and is told so").toContain("You have no skills of your own.");
    expect(runner[0]!.system, "the helper's listing is exactly its own skill").not.toContain("## Skills");
    const last = runner.at(-1)!;
    expect(last.userTexts.some((text) => text.includes("Every suite passes, nothing skipped."))).toBe(true);
    expect(last.toolResults.get("toolu_runner_shell")?.text).toContain("runner-only|none");
    expect(Number(readFileSync(join(sessionWorkspaceDir(env), ".runner-ppid"), "utf8")), "the helper's shell is the host's child").toBe(process.pid);
    expect(ci.calls).toEqual([{ tool: "run", args: { target: "all" } }]);
    expect(last.toolResults.get("toolu_runner_docs")?.isError, "the main agent's server is not the saved helper's").toBe(true);
    expect(docs.calls).toEqual([]);
    expect(root.at(-1)!.toolResults.get("toolu_delegate")?.text).toContain("All suites pass.");

    const final = record.lastFullStatus!;
    expect([Number(final.streamingUsage?.inputTokens), Number(final.streamingUsage?.outputTokens)], "the turn counts every call the model served").toEqual([tally.input, tally.output]);
    const delegate = record.toolCalls().find((row) => row.id === "toolu_delegate")!;
    expect([delegate.name, delegate.status]).toEqual(["Agent", ToolCallStatus.TOOL_CALL_COMPLETED]);
    await goldens(record, "saved-subagent");
  });

  it("runs a plugin's agent on the main agent's servers, with its file's skill", async () => {
    const record = claudeExecutionRecord({ message: "Have the helper lint it.", mcpServers: [{ name: "docs", url: `${docs.url}/mcp` }] });
    useAcme(record);
    const tally = { input: 0, output: 0 };
    docs.calls.length = 0;
    const invocation = await file.run(
      record,
      agentsScript(
        {
          root: { steps: [{ id: "toolu_delegate_helper", name: "Agent", input: { description: "lint", prompt: "Lint the change.", subagent_type: "acme:helper" } }], closing: "Linted." },
          helper: {
            steps: [
              { id: "toolu_helper_skill", name: "Skill", input: { skill: "acme:lint" } },
              { id: "toolu_helper_docs", name: "mcp__docs__lookup", input: { target: "style guide" } },
            ],
            closing: "Lint is clean.",
          },
        },
        tally,
      ),
      { clientOverrides: ACME_CLIENT },
    );

    expect(phaseOf(invocation)).toBe("RUN_COMPLETED");
    const helper = file.wire().conversations.filter((c) => whoAsks(c) === "helper");
    expect(helper.at(-1)!.userTexts.some((text) => text.includes(LINT_BODY))).toBe(true);
    expect(docs.calls).toEqual([{ tool: "lookup", args: { target: "style guide" } }]);
    await goldens(record, "plugin-subagent");
  });

  it("refuses a delegation that overrides its definition or names no helper, and refuses a helper's call that would ask with the helper's sentence", async () => {
    const record = claudeExecutionRecord({ message: "Get the tests run.", subagents: [runnerAgent()] });
    const tally = { input: 0, output: 0 };
    const invocation = await file.run(
      record,
      agentsScript(
        {
          root: {
            steps: [
              { id: "toolu_model", name: "Agent", input: { ...DELEGATE.input, model: "opus" } },
              { id: "toolu_isolated", name: "Agent", input: { ...DELEGATE.input, isolation: "worktree" } },
              { id: "toolu_fork", name: "Agent", input: { ...DELEGATE.input, subagent_type: "fork" } },
              DELEGATE,
            ],
            closing: "The helper could not run them.",
          },
          runner: { steps: [{ id: "toolu_runner_asks", name: "Bash", input: { command: "touch .ran" } }], closing: "I could not run the tests." },
        },
        tally,
      ),
      { clientOverrides: runnerClient() },
    );

    expect(phaseOf(invocation)).toBe("RUN_COMPLETED");
    const root = file.wire().conversations.filter((c) => whoAsks(c) === "root").at(-1)!;
    expect(root.toolResults.get("toolu_model")?.text).toContain(helperOverrideMessage(["model"]));
    expect(root.toolResults.get("toolu_isolated")?.text).toContain(helperOverrideMessage(["isolation"]));
    expect(root.toolResults.get("toolu_fork")?.isError).toBe(true);
    const forkText = root.toolResults.get("toolu_fork")?.text ?? "";
    expect(forkText.includes(unknownHelperMessage("fork")) || forkText.includes("Agent type 'fork' not found"), forkText).toBe(true);
    const runner = file.wire().conversations.filter((c) => whoAsks(c) === "runner");
    expect(runner.at(-1)!.toolResults.get("toolu_runner_asks")?.text).toContain(SUBAGENT_APPROVAL_MESSAGE);
    expect(existsSync(join(sessionWorkspaceDir(env), ".ran")), "the refused call ran nothing").toBe(false);
    expect(record.waitingToolCalls(), "a helper never pauses for a person").toHaveLength(0);
    await goldens(record, "subagent-refusals");
  });

  it("skips a helper's call that would ask on an unattended lane, with the shared sentence", async () => {
    const record = claudeExecutionRecord({ message: "Get the tests run.", subagents: [runnerAgent()], approvalMode: ApprovalMode.UNATTENDED });
    const tally = { input: 0, output: 0 };
    const invocation = await file.run(
      record,
      agentsScript(
        {
          root: { steps: [DELEGATE], closing: "Done." },
          runner: { steps: [{ id: "toolu_runner_skip", name: "Bash", input: { command: "touch .ran" } }], closing: "Skipped." },
        },
        tally,
      ),
      { clientOverrides: runnerClient() },
    );

    expect(phaseOf(invocation)).toBe("RUN_COMPLETED");
    const runner = file.wire().conversations.filter((c) => whoAsks(c) === "runner").at(-1)!;
    expect(runner.toolResults.get("toolu_runner_skip")?.text).toContain(unattendedSkipMessage("Bash"));
    expect(existsSync(join(sessionWorkspaceDir(env), ".ran"))).toBe(false);
    await goldens(record, "subagent-unattended-skip");
  });

  it("hands a message sent while a sub-agent works to the main agent after it, never to the sub-agent", async () => {
    const record = claudeExecutionRecord({ message: "Get the tests run.", subagents: [runnerAgent()], autoApproveAll: true });
    const tally = { input: 0, output: 0 };
    const LATE = "Also check the linter.";
    let sent = false;
    const invocation = await file.run(
      record,
      agentsScript(
        {
          root: { steps: [DELEGATE], closing: "Tests and linter done." },
          runner: { steps: [{ id: "toolu_runner_read", name: "Glob", input: { pattern: "*" } }], closing: "Tests pass." },
        },
        tally,
        (who) => {
          if (who === "runner" && !sent) {
            sent = true;
            record.sendMessage(LATE);
          }
          return undefined;
        },
      ),
      { clientOverrides: runnerClient() },
    );

    expect(phaseOf(invocation)).toBe("RUN_COMPLETED");
    const conversations = file.wire().conversations;
    // A message read mid-turn rides the result of the call it was read with, or arrives as a user message.
    const read = (c: WireConversation): boolean => c.userTexts.some((text) => text.includes(LATE)) || [...c.toolResults.values()].some((result) => result.text.includes(LATE));
    for (const c of conversations.filter((c) => whoAsks(c) === "runner")) expect(read(c), "never the sub-agent").toBe(false);
    const afterDelegation = conversations.filter((c) => whoAsks(c) === "root" && c.toolResults.has("toolu_delegate"));
    expect(read(afterDelegation.at(-1)!), "the main agent read it after its helper").toBe(true);
  });

  it("continues from the store after a runner lost while a sub-agent works: its row settles and nothing it ran runs twice", async () => {
    const record = claudeExecutionRecord({ message: "Get the tests run.", subagents: [runnerAgent()], autoApproveAll: true });
    const ledger = join(sessionWorkspaceDir(env), ".runner-ledger");
    const tally = { input: 0, output: 0 };
    let controls: InvocationControls | undefined;
    let lost = false;
    const first = await file.run(
      record,
      agentsScript(
        {
          root: { steps: [DELEGATE], closing: "never" },
          runner: { steps: [{ id: "toolu_runner_once", name: "Bash", input: { command: "echo ran >> .runner-ledger" } }], closing: "never" },
        },
        tally,
        (who, c) => {
          // Once the helper's command has run, the runner is lost while the helper works.
          if (who !== "runner" || !c.toolResults.has("toolu_runner_once")) return undefined;
          if (!lost) {
            lost = true;
            setTimeout(() => controls!.cancelTimedOut(), 50);
          }
          return { body: anthropicText("never"), delayMs: 60_000 };
        },
      ),
      { clientOverrides: runnerClient(), onControls: (c) => (controls = c) },
    );
    expect(first.outcome.kind, "the lost invocation ends as Temporal ends it").toBe("threw");
    expect(readFileSync(ledger, "utf8")).toBe("ran\n");

    const second = await file.resume(
      record,
      agentsScript({ root: { steps: [], closing: "Picked up: the helper's run was cut short." }, runner: { steps: [], closing: "never" } }, tally),
      { clientOverrides: runnerClient(), turnSeq: 1 },
    );
    expect(phaseOf(second)).toBe("RUN_COMPLETED");
    expect(readFileSync(ledger, "utf8"), "the helper's command ran once").toBe("ran\n");
    const delegate = record.toolCalls().find((row) => row.id === "toolu_delegate");
    expect(delegate?.status, "the delegation's row settled").not.toBe(ToolCallStatus.TOOL_CALL_RUNNING);
    expect(record.toolCalls().filter((row) => row.status === ToolCallStatus.TOOL_CALL_RUNNING), "no row is left running").toEqual([]);
  });
});
