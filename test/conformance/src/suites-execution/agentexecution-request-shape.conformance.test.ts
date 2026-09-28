// Conformance suite for the shape of the request the native harness sends the
// model: for a BARE agent (one instruction sentence; no skills, workspace
// entries, attachments, channel, sub-agents or standing context), the bytes
// the provider receives on the first model call, photographed as file
// goldens, and the facts about them that the platform's later work moves
// deliberately.
// Domain: agentic / agentexecution — the runner's outbound contract with the
// model, read at the one place it is observable offline: the mock proxy's
// captured request bodies (harness/mock-llm.ts), which are "everything the
// model received over the wire".
//
// Why this facet exists: the native harness's latency and output quality are
// a function of what the model is sent — how many bytes of prompt precede
// the user's message, which tools it may call and what their descriptions
// nudge it to do, whether extended thinking is on, and whether the prompt is
// byte-stable from one turn to the next so the provider's prefix cache can
// hold. Each of those is scheduled to change on purpose. Without a pinned
// "before", a change to any of them is invisible in review and unmeasurable
// after; with one, it is a hunk in a readable golden that the PR explains.
//
// What is pinned, and where each fact comes from:
// - The system prompt as the PROVIDER receives it: an array of text blocks,
//   not the runner's one string. The deepagents engine wraps the runner's
//   prompt (execute-deep-agent/prompt-builder.ts) as the first block, with
//   the model profile's suffix joined to it; each prompt-bearing middleware
//   appends a block of its own (today only the to-do list's line,
//   execute-deep-agent/todo-list.ts); the LAST block carries the
//   prompt-cache breakpoint. The runner's
//   own golden (execute-deep-agent/__tests__/prompt-goldens.test.ts) pins the
//   first block alone; only the wire shows the rest, so this golden and that
//   one are two facts, not one fact twice.
// - The tool surface in wire order — name, description, input_schema. No
//   source file states it whole: deepagents binds its built-ins per backend
//   capability at call time and the runner's tool-intent middleware reshapes
//   the `execute` schema at the same hook. The golden is the only photograph.
//   The platform's memory-capture tool `remember` is NOT on a bare agent's
//   surface: recall is an organization preference that defaults off
//   (stigmer-server domain/agentexecution/create-steps.ts,
//   ComposeRecalledMemories), so the runner never synthesizes the attachment
//   for it. An org that turns memory on adds one stdio MCP tool served by the
//   `stigmer` command on PATH — a different photograph this facet does not
//   take.
// - The request posture a model's native registry row decides, asserted as
//   values, not a golden: no temperature (current Anthropic models refuse
//   one other than their default, stigmer/stigmer#1341); `max_tokens` at the
//   row's output ceiling, on a streamed request (stigmer/stigmer#1343); and
//   `thinking` in the form the row declares for the execution's mode — an
//   explicit `{type: "disabled"}` where the row says the model may turn it
//   off, the adaptive or budget form when the execution asks for thinking,
//   the enabled form always on a model that requires it — with the `think`
//   tool bound only on a graph that does not think, and structured output
//   through the provider's JSON output (no forced tool) when it does
//   (runner shared/thinking-mode.ts).
// - Byte-stability: a second turn in the same session sends `system` and
//   `tools` byte-identical to the first's when the standing facts have not
//   changed. The system prompt is a function of the session, never of the
//   turn: an agent with nine skills sends the same bytes on three turns whose
//   messages reach different skills, one of which carries an attachment and
//   another a referenced workspace file. What belongs to one turn (its input
//   files and the paths it references) rides that turn's user message, where
//   the arm finds it. A changed system byte re-writes the provider's cached
//   prompt and the whole conversation after it, so this is a cost and
//   latency contract, not a matter of taste.
//
// The goldens depend on two things the header names so a moved golden is
// diagnosed, not guessed at: (1) the model the runner resolves for a bare
// agent with no pin — the model registry's first featured standard native
// row (runner shared/model-registry.ts getDefaultModel) — because deepagents
// appends a per-model prompt suffix; a reorder of the registry's featured
// rows moves this golden; (2) the pinned deepagents version, whose
// built-in prompt blocks and tool descriptions are part of the photograph on
// purpose — a dependency bump moves the golden, and the hunk is the review of
// what upstream changed.
//
// Deliberately out of scope: the Cursor harness (its model calls never
// traverse the mock, so the surface it pays for is not observable here);
// the number of model rounds a task takes (the mock's script fixes it, so
// only a live run can measure it); the model id the provider received
// (agentexecution-messages' model-resolution arm); the `messages` array (the
// transcript facet's, read from status), except for the one fact status
// cannot show: which user message a turn's payload rides.
//
// A golden moves only under a ruling quoted in the PR that moves it, with
// every hunk explained; never a quiet `vitest -u`.
import { create } from "@bufbuild/protobuf";
import { ExecutionPhase, ThinkingMode } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { UploadAttachmentRequestSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/io_pb";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import { readAnthropicRequest, readLastUserText, type AnthropicMessageBody, type AnthropicRequestBody } from "../harness/llm-wire";
import { requireNativeRow, wireModelIdOf, type ModelRegistryDocument } from "../harness/model-registry";
import type { MockLlmProxy } from "../harness/mock-llm";
import { anthropicText } from "../harness/mock-llm";
import { BARE_AGENT_INSTRUCTIONS, makeAgent } from "../support/agents";
import { awaitTerminal, makeAgentExecution, requireLlmProxy } from "../support/agentexecutions";
import { uniqueName } from "../support/naming";
import { renderSystemPrompt, renderToolSurface } from "../support/request-shape";
import { makeSkillArtifact } from "../support/skills";
import { createTarget, type TargetProfile } from "../targets";

let target: TargetProfile;
let clients: ConformanceClients;
let mock: MockLlmProxy;
const fixtures = new FixtureTracker();

beforeAll(async () => {
  target = createTarget();
  await target.setup();
  clients = target.clients();
  mock = requireLlmProxy(target);
});

afterEach(async () => {
  await fixtures.cleanup();
  mock.reset();
});

afterAll(async () => {
  await target?.teardown();
});

// The bare agent's one instruction is support/agents.ts's
// BARE_AGENT_INSTRUCTIONS, shared with the live benchmark so the agent it
// measures is the one photographed here; the golden's first block is that
// sentence and nothing else of the suite's choosing.
const BARE_AGENT_MESSAGE = "Say hello.";

// One turn of an agent, scripted as a single text reply, on a fresh session
// (no sessionId) or an existing one. Returns the terminal execution, the
// request the agent loop sent — the scripted one, never the background
// titling call the mock answers out of band — and that request's raw body,
// for the one arm that reads its last user message.
async function runAgentTurn(
  org: string,
  agentId: string,
  sessionId?: string,
  turn: {
    message?: string;
    attachments?: Parameters<typeof makeAgentExecution>[0]["attachments"];
    workspaceFileRefs?: string[];
    executionConfig?: Parameters<typeof makeAgentExecution>[0]["executionConfig"];
    reply?: AnthropicMessageBody;
  } = {},
): Promise<{ final: AgentExecution; request: AnthropicRequestBody; body: unknown }> {
  const scriptedBefore = mock.scriptedRequests().length;
  mock.enqueue(turn.reply ?? anthropicText("Hello."));
  const execution = await clients.agentExecutionCommand.create(
    makeAgentExecution({
      org,
      name: uniqueName("aex-shape"),
      ...(sessionId === undefined ? { agentId } : { sessionId }),
      message: turn.message ?? BARE_AGENT_MESSAGE,
      autoApproveAll: true,
      ...(turn.attachments !== undefined ? { attachments: turn.attachments } : {}),
      ...(turn.workspaceFileRefs !== undefined ? { workspaceFileRefs: turn.workspaceFileRefs } : {}),
      ...(turn.executionConfig !== undefined ? { executionConfig: turn.executionConfig } : {}),
    }),
  );
  const executionId = execution.metadata!.id;
  fixtures.defer(() => clients.agentExecutionCommand.delete({ value: executionId }));

  const final = await awaitTerminal(clients, executionId);
  expect(
    final.status?.phase,
    `the bare turn should complete; ${executionId} reached ${ExecutionPhase[final.status?.phase ?? 0]} ` +
      `(status.error: ${JSON.stringify(final.status?.error ?? "")})`,
  ).toBe(ExecutionPhase.EXECUTION_COMPLETED);

  const scripted = mock.scriptedRequests();
  expect(scripted.length, "one scripted text turn is exactly one request from the agent loop").toBe(scriptedBefore + 1);
  const body = scripted[scriptedBefore]!.body;
  return { final, request: readAnthropicRequest(body), body };
}

async function createBareAgent(): Promise<{ org: string; agentId: string }> {
  const { org } = await target.provisionTenancy();
  const agent = await clients.agentCommand.create(
    makeAgent({ org, name: uniqueName("agent-shape"), instructions: BARE_AGENT_INSTRUCTIONS }),
  );
  fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }));
  return { org, agentId: agent.metadata!.id };
}

async function registry(): Promise<ModelRegistryDocument> {
  if (target.modelRegistryDocument === undefined) {
    throw new Error(`target ${target.name} exposes no model registry document; execution targets must`);
  }
  return target.modelRegistryDocument();
}

// The native row whose wire id the request carries (the bare agent's model
// is the registry's default, which arrives as its provider id).
function nativeRowOnTheWire(document: ModelRegistryDocument, wireModel: string) {
  const row = document.models.find((model) => model.harness === "native" && wireModelIdOf(model) === wireModel);
  if (row === undefined) {
    throw new Error(`no native registry row puts ${JSON.stringify(wireModel)} on the wire`);
  }
  return row;
}

function toolNames(request: AnthropicRequestBody): string[] {
  return (request.tools ?? []).map((tool) => tool.name);
}

// The registry rows the thinking arms pin, one per form a native row
// declares (the bundled registry the local execution server serves).
const ADAPTIVE_MODEL = "claude-sonnet-5";
const BUDGET_MODEL = "claude-haiku-4.5";
const THINKING_REQUIRED_MODEL = "claude-fable-5";

describe("AgentExecution request shape — what the native harness sends the model for a bare agent", () => {
  it("the system prompt blocks, as the provider receives them, match the golden", async () => {
    const { org, agentId } = await createBareAgent();
    const { request } = await runAgentTurn(org, agentId);

    expect(Array.isArray(request.system), "the engine sends the system prompt as an array of blocks, not one string").toBe(
      true,
    );
    await expect(renderSystemPrompt(request)).toMatchFileSnapshot(
      "./goldens/agentexecution-request-shape.native-bare-agent.system-prompt.md",
    );
  });

  it("the tool surface — names, descriptions and schemas in wire order — matches the golden", async () => {
    const { org, agentId } = await createBareAgent();
    const { request } = await runAgentTurn(org, agentId);

    expect(request.tools?.length ?? 0, "a bare native agent still binds the engine's built-in tools").toBeGreaterThan(0);
    await expect(renderToolSurface(request)).toMatchFileSnapshot(
      "./goldens/agentexecution-request-shape.native-bare-agent.tool-surface.md",
    );
  });

  it("an unpinned turn sends an explicit disabled, no temperature, and the row's ceiling on a streamed request", async () => {
    const { org, agentId } = await createBareAgent();
    const { request } = await runAgentTurn(org, agentId);
    const row = nativeRowOnTheWire(await registry(), request.model);

    expect(row.thinkingRequired, "the bare agent's default model may turn thinking off").toBe(false);
    expect(request.thinking, "the model's default cannot turn thinking on").toEqual({ type: "disabled" });
    expect(request.temperature, "the provider's default sampling applies; the runner sends no override").toBeUndefined();
    expect(request.max_tokens, "the output ceiling is the native row's, not the library's table").toBe(row.maxOutputTokens);
    expect(request.stream, "a request at the full ceiling streams").toBe(true);
  });

  it("a second turn in the same session sends byte-identical system blocks and tools", async () => {
    const { org, agentId } = await createBareAgent();
    const first = await runAgentTurn(org, agentId);
    const sessionId = first.final.spec?.sessionId;
    expect(sessionId, "the first turn's session is where the second turn runs").toBeTruthy();

    const second = await runAgentTurn(org, agentId, sessionId);

    expect(JSON.stringify(second.request.system), "the system prompt is rebuilt to the same bytes").toBe(
      JSON.stringify(first.request.system),
    );
    expect(JSON.stringify(second.request.tools), "the tool surface is rebuilt to the same bytes").toBe(
      JSON.stringify(first.request.tools),
    );
  });
});

// The cross-turn arm's skills: nine, one past the eight at which the native
// harness once chose which skills to describe by the turn's message. Each of
// the arm's three messages reaches a different skill by its words (forecast,
// invoices and on-call, glossary), so a system prompt that depended on the
// message would differ on every turn. Fixed names are legal because each arm
// provisions a fresh organization. A description is YAML frontmatter, so it
// carries no colon.
const CROSS_TURN_SKILLS: readonly { name: string; description: string }[] = [
  { name: "api-design", description: "Design REST endpoints - resource names, status codes and pagination." },
  { name: "billing", description: "Explain a customer's bill - plan, usage, credits and proration." },
  { name: "changelog", description: "Write changelog entries in the Keep a Changelog format." },
  { name: "deploys", description: "Roll a service out and back - canary, health checks, rollback." },
  { name: "forecast", description: "Project next quarter's revenue from the monthly run rate." },
  { name: "glossary", description: "Define the team's domain terms in one plain sentence each." },
  { name: "hiring", description: "Write a job description and an interview loop for a role." },
  { name: "invoices", description: "Reconcile invoices against payments and flag mismatches." },
  { name: "oncall", description: "Hand over an on-call shift - open incidents, alerts and follow-ups." },
];

const CROSS_TURN_MESSAGES = [
  "Draft the forecast for next quarter.",
  "Reconcile the open invoices.",
  "Define the glossary terms for the team.",
] as const;

async function createAgentWithSkills(): Promise<{ org: string; agentId: string }> {
  const { org } = await target.provisionTenancy();
  const skillRefs: string[] = [];
  for (const skill of CROSS_TURN_SKILLS) {
    const pushed = await clients.skillCommand.push({ org, artifact: makeSkillArtifact(skill) });
    fixtures.defer(() => clients.skillCommand.delete({ value: pushed.metadata!.id }));
    skillRefs.push(pushed.metadata!.slug);
  }
  const agent = await clients.agentCommand.create(
    makeAgent({ org, name: uniqueName("agent-shape-skills"), instructions: BARE_AGENT_INSTRUCTIONS, skillRefs }),
  );
  fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }));
  return { org, agentId: agent.metadata!.id };
}

describe("AgentExecution request shape — the system prompt is the session's, the payload the turn's", () => {
  it("nine skills, three turns with different messages, an attachment and a referenced file: system and tools stay byte-identical", async () => {
    const { org, agentId } = await createAgentWithSkills();
    const filename = "cross-turn-notes.txt";
    const uploaded = await clients.agentExecutionCommand.uploadAttachment(
      create(UploadAttachmentRequestSchema, { filename, content: Buffer.from("cross-turn attachment"), contentType: "text/plain" }),
    );
    const referenced = "docs/glossary.md";

    const first = await runAgentTurn(org, agentId, undefined, { message: CROSS_TURN_MESSAGES[0] });
    const sessionId = first.final.spec?.sessionId;
    expect(sessionId, "the first turn's session is where the later turns run").toBeTruthy();
    const second = await runAgentTurn(org, agentId, sessionId, {
      message: CROSS_TURN_MESSAGES[1],
      attachments: [{ filename, storageKey: uploaded.storageKey }],
    });
    const third = await runAgentTurn(org, agentId, sessionId, { message: CROSS_TURN_MESSAGES[2], workspaceFileRefs: [referenced] });

    for (const [turn, later] of [[2, second], [3, third]] as const) {
      expect(JSON.stringify(later.request.system), `turn ${turn} rebuilds the system prompt to turn 1's bytes`).toBe(
        JSON.stringify(first.request.system),
      );
      expect(JSON.stringify(later.request.tools), `turn ${turn} binds turn 1's tool surface`).toBe(
        JSON.stringify(first.request.tools),
      );
    }
    const system = renderSystemPrompt(first.request);
    for (const skill of CROSS_TURN_SKILLS) {
      expect(system, `every mounted skill is described on every turn: ${skill.name}`).toContain(skill.description);
    }
    expect(readLastUserText(second.body), "the attachment is named in the message of the turn that carries it").toContain(filename);
    expect(readLastUserText(third.body), "the referenced path is named in the message of the turn that references it").toContain(
      referenced,
    );
  });
});

describe("AgentExecution request shape — thinking, per the model's native registry row", () => {
  it("ENABLED on an adaptive row sends adaptive thinking with summarized display, and drops the think tool", async () => {
    const row = requireNativeRow(await registry(), ADAPTIVE_MODEL);
    expect(row.thinkingForm, `${ADAPTIVE_MODEL} is the adaptive row this arm pins`).toBe("adaptive");
    const { org, agentId } = await createBareAgent();

    const { request } = await runAgentTurn(org, agentId, undefined, {
      executionConfig: { modelName: ADAPTIVE_MODEL, thinkingMode: ThinkingMode.ENABLED },
    });

    expect(request.thinking).toEqual({ type: "adaptive", display: "summarized" });
    expect(request.max_tokens).toBe(row.maxOutputTokens);
    expect(toolNames(request), "a graph that thinks has no use for the think tool").not.toContain("think");
  });

  it("ENABLED on a budget row sends the fixed budget below the row's ceiling", async () => {
    const row = requireNativeRow(await registry(), BUDGET_MODEL);
    expect(row.thinkingForm, `${BUDGET_MODEL} is the budget row this arm pins`).toBe("budget");
    const { org, agentId } = await createBareAgent();

    const { request } = await runAgentTurn(org, agentId, undefined, {
      executionConfig: { modelName: BUDGET_MODEL, thinkingMode: ThinkingMode.ENABLED },
    });

    expect(request.thinking).toEqual({ type: "enabled", budget_tokens: 16000 });
    expect(request.max_tokens).toBe(row.maxOutputTokens);
    expect(toolNames(request)).not.toContain("think");
  });

  it("DISABLED binds the think tool: a graph that does not think keeps its reasoning aid", async () => {
    const { org, agentId } = await createBareAgent();

    const { request } = await runAgentTurn(org, agentId, undefined, {
      executionConfig: { modelName: ADAPTIVE_MODEL, thinkingMode: ThinkingMode.DISABLED },
    });

    expect(request.thinking).toEqual({ type: "disabled" });
    expect(toolNames(request)).toContain("think");
  });

  it("a model that requires thinking gets its thinking form when the execution names no mode", async () => {
    const row = requireNativeRow(await registry(), THINKING_REQUIRED_MODEL);
    expect(row.thinkingRequired, `${THINKING_REQUIRED_MODEL} is the row that requires thinking`).toBe(true);
    const { org, agentId } = await createBareAgent();

    const { request } = await runAgentTurn(org, agentId, undefined, {
      executionConfig: { modelName: THINKING_REQUIRED_MODEL },
    });

    expect(request.thinking, "never disabled: the model refuses it").toEqual({ type: "adaptive", display: "summarized" });
    expect(toolNames(request)).not.toContain("think");
  });

  it("structured output under thinking rides the provider's JSON output with closed objects, forcing no tool", async () => {
    const { org, agentId } = await createBareAgent();
    const answer = { summary: "hello", score: 1 };

    const { final, request } = await runAgentTurn(org, agentId, undefined, {
      executionConfig: {
        modelName: ADAPTIVE_MODEL,
        thinkingMode: ThinkingMode.ENABLED,
        structuredOutputSchema: {
          type: "object",
          properties: { summary: { type: "string" }, score: { type: "number" } },
          required: ["summary", "score"],
        },
      },
      reply: anthropicText(JSON.stringify(answer)),
    });

    const format = (request.output_config as { format?: { type?: string; schema?: { additionalProperties?: unknown } } } | undefined)?.format;
    expect(format?.type).toBe("json_schema");
    expect(format?.schema?.additionalProperties, "Anthropic accepts only closed objects").toBe(false);
    expect(request.tool_choice, "no tool is forced while the model thinks").toBeUndefined();
    expect(final.status?.structuredOutput, "the JSON answer is the execution's structured output").toEqual(answer);
  });
});
