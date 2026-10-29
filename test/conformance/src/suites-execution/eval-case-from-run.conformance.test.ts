// Conformance suite for building an eval case from a run, on a target whose
// runner runs turns and tries.
// Domain: agentic / eval — a run's turn kept as a case.
//
// What is pinned here, on a scripted model:
//   - a conversation's second turn, which called a tool of a server the
//     agent writes itself, becomes a case: its request as the prompt, the
//     first turn as the history (`history.jsonl`, named by `case.yaml`), the
//     tool's recorded answer as a fixed mock under the server's own name,
//     the tool as the run offered it to the model (its description and
//     input schema, in the server's `_tools.json`), and a rubric to fill
//     in; nothing the case leaves out is noted;
//   - the case added to an eval is a new version holding the eval's case
//     and the new one, the version's message naming the case and the run; a
//     second add of the same name is ALREADY_EXISTS, naming both; an eval of
//     another organization than the run's is FAILED_PRECONDITION;
//   - an eval run of that eval on the agent runs the new case: the try
//     resumes the recorded conversation (the model is sent the first turn),
//     the mock stands in for the server (which is never connected) and
//     offers the model the tool as the run offered it, and the case is
//     graded on its rubric's votes.
//
// The refusals that need no finished run are Class A's
// (suites/eval-case-from-run.conformance.test.ts).
import { Code } from "@connectrpc/connect";
import { EvalRunAblation } from "@stigmer/apis/ai/stigmer/agentic/evalrun/v1/spec_pb";
import { EvalRunPhase, EvalRunTryState } from "@stigmer/apis/ai/stigmer/agentic/evalrun/v1/status_pb";
import type { Agent } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import type { Run } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import type { MockLlmProxy } from "@stigmer/test-support/mock-llm";
import { anthropicText, anthropicToolUse } from "@stigmer/test-support/mock-llm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { expectGrpcCode } from "../contract/errors";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import { ECHO_TOOL_NAME, type McpToolFixture, mcpToolName } from "../harness/mcp-server";
import { agentRefOf } from "../support/agents";
import {
  awaitEvalRunEnd,
  cancelAndDeleteEvalRun,
  createAgentWith,
  lastMessageGrader,
  makeEvalRun,
} from "../support/eval-runs";
import {
  EVAL_CASE_OTHER_ORGANIZATION,
  caseArchiveText,
  digestOf,
  evalCaseExistsMessage,
  evalCaseVersionMessage,
  evalFolderArchive,
} from "../support/evals";
import { uniqueName } from "../support/naming";
import { awaitTerminal, makeAgentExecution, requireLlmProxy, requireMcpFixture, sessionIdOf } from "../support/runs";
import { createTarget, type TargetProfile } from "../targets";
import type { TenancyContext } from "../targets/target";

/** The fixture's echo tool as its server lists it (harness/mcp-server.ts). */
const ECHO_DESCRIPTION = "Returns the input text unchanged. For deterministic conformance assertions.";
const ECHO_TEXT_DESCRIPTION = "the value to echo back";

/** A tool of a `_tools.json` (MCP's `tools/list` shape). */
interface OfferedTool {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema?: { readonly properties?: Record<string, unknown> };
}

/** A tool as an Anthropic request offers it to the model. */
interface OfferedToAnthropic {
  readonly name: string;
  readonly description?: string;
  readonly input_schema?: { readonly properties?: Record<string, unknown> };
}

// Read once at collection time to gate the engine-backed arms.
const runnerServesTries = createTarget().capabilities.runnerActsAsRunCreator;

let target: TargetProfile;
let clients: ConformanceClients;
let mock: MockLlmProxy;
let mcp: McpToolFixture;
let tenancy: TenancyContext;
const fixtures = new FixtureTracker();

beforeAll(async () => {
  target = createTarget();
  await target.setup();
  clients = target.clients();
  mock = requireLlmProxy(target);
  mcp = requireMcpFixture(target);
  tenancy = await target.provisionTenancy();
});

afterEach(async () => {
  // A turn that started after its arm's assertions would take the next arm's
  // script; wait, bounded, for every scripted turn to be claimed.
  const claimDeadline = Date.now() + 30_000;
  while (mock.remaining() > 0 && Date.now() < claimDeadline) {
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
  }
  mock.releaseHolds();
  await fixtures.cleanup();
  mock.reset();
  mcp.resetCaptured();
});

afterAll(async () => {
  if (tenancy !== undefined) {
    await target.cleanupTenancy(tenancy);
  }
  await target?.teardown();
});

const SERVER = "desk";
const FIRST_REQUEST = "My order never arrived.";
const FIRST_REPLY = "Sorry to hear that. Which order is it?";
const SECOND_REQUEST = "It is order 4821.";
const LOOKUP = "ORD-4821";
const DONE = "Order ORD-4821 is on its way.";
const CASE = "order-4821";

// One judge vote on the case's rubric (graders/criteria.md).
const vote = (result: "passed" | "failed") =>
  anthropicText(JSON.stringify({ criteria: { result, reason: `The judge's ${result} vote.` } }));

async function turn(input: Parameters<typeof makeAgentExecution>[0]): Promise<Run> {
  const created = await clients.agentExecutionCommand.create(makeAgentExecution({ ...input, autoApproveAll: true }));
  fixtures.defer(() => clients.agentExecutionCommand.delete({ value: created.metadata!.id }).then(() => undefined));
  const ended = await awaitTerminal(clients, created.metadata!.id);
  expect(ended.status?.phase, `turn "${input.message ?? ""}": ${ended.status?.error ?? ""}`).toBe(RunPhase.RUN_COMPLETED);
  return ended;
}

/** A conversation on `agent`: a plain first turn, then a second that calls the agent's own server. */
async function conversation(agent: Agent): Promise<Run> {
  mock.enqueue(anthropicText(FIRST_REPLY));
  const first = await turn({ org: tenancy.org, name: uniqueName("ecr-first"), agentRef: agentRefOf(agent), message: FIRST_REQUEST });
  mock.enqueue(anthropicToolUse("call_lookup", mcpToolName(SERVER, ECHO_TOOL_NAME), { text: LOOKUP }));
  mock.enqueue(anthropicText(DONE));
  return turn({ org: tenancy.org, name: uniqueName("ecr-second"), sessionId: sessionIdOf(first), message: SECOND_REQUEST });
}

async function pushedEval(org: string): Promise<string> {
  const slug = uniqueName("ecr-eval");
  const folder = evalFolderArchive([{ name: "says-hello", prompt: "Say hello.", graders: [lastMessageGrader("says-done", "^Hello")] }]);
  const pushed = await clients.evalCommand.push({ org, slug, artifact: folder });
  fixtures.defer(() => clients.evalCommand.delete({ value: pushed.metadata!.id }).then(() => undefined));
  return slug;
}

describe.skipIf(!runnerServesTries)("an eval case built from a run", () => {
  it("[rpc:EvalQueryController.buildCaseFromRun] [rpc:EvalCommandController.addCaseFromRun] [rpc:EvalQueryController.listVersions] a conversation's second turn becomes a case with its history and its tool answer, added to an eval as a new version, and the eval's run of it replays the turn", async () => {
    const agent = await createAgentWith(clients, fixtures, tenancy.org, [], {
      name: uniqueName("ecr-agent"),
      instructions: "Answer as the support desk.",
      mcpServers: [{ name: SERVER, url: mcp.url([ECHO_TOOL_NAME]) }],
    });
    const second = await conversation(agent);
    const runId = second.metadata!.id;

    // The case, built.
    const built = await clients.evalQuery.buildCaseFromRun({ runId, caseName: CASE });
    expect([built.caseName, built.digest]).toEqual([CASE, digestOf(built.artifact)]);
    const files = caseArchiveText(built.artifact);
    expect(Object.keys(files).sort()).toEqual([
      `${CASE}/case.yaml`,
      `${CASE}/graders/criteria.md`,
      `${CASE}/history.jsonl`,
      `${CASE}/mocks/${SERVER}/_tools.json`,
      `${CASE}/mocks/${SERVER}/${ECHO_TOOL_NAME}.md`,
      `${CASE}/prompt.md`,
    ]);
    // An empty frontmatter block first, so a request that opens with "---" stays the prompt.
    expect(files[`${CASE}/prompt.md`]).toBe(`---\n---\n${SECOND_REQUEST}\n`);
    const history = files[`${CASE}/history.jsonl`] ?? "";
    expect([history.includes(FIRST_REQUEST), history.includes(FIRST_REPLY), history.includes(SECOND_REQUEST)]).toEqual([true, true, false]);
    expect(files[`${CASE}/case.yaml`]).toContain("history_file: history.jsonl");
    const lookupMock = files[`${CASE}/mocks/${SERVER}/${ECHO_TOOL_NAME}.md`] ?? "";
    expect([lookupMock.startsWith("---\ntype: fixed\n"), lookupMock.includes(LOOKUP)]).toEqual([true, true]);
    const [listed] = (JSON.parse(files[`${CASE}/mocks/${SERVER}/_tools.json`] ?? "{}") as { tools?: OfferedTool[] }).tools ?? [];
    expect([listed?.name, listed?.description], "the tool as the run offered it").toEqual([ECHO_TOOL_NAME, ECHO_DESCRIPTION]);
    expect(listed?.inputSchema?.properties?.["text"], "with its input schema").toMatchObject({ type: "string", description: ECHO_TEXT_DESCRIPTION });
    expect(files[`${CASE}/graders/criteria.md`]).toContain("type: llm");
    expect(built.notes).toEqual([]);

    // The case, added as a new version; a second add of its name refused.
    const slug = await pushedEval(tenancy.org);
    const added = await clients.evalCommand.addCaseFromRun({ runId, eval: { org: tenancy.org, slug }, caseName: CASE });
    expect(added.status?.cases.map((c) => c.caseName).sort()).toEqual([CASE, "says-hello"]);
    const versions = await clients.evalQuery.listVersions({ org: tenancy.org, slug });
    expect(versions.entries.map((entry) => entry.message)).toContain(evalCaseVersionMessage(CASE, runId));
    const again = await expectGrpcCode(
      () => clients.evalCommand.addCaseFromRun({ runId, eval: { org: tenancy.org, slug }, caseName: CASE }),
      Code.AlreadyExists,
      "a second add of the same case name",
    );
    expect(again.rawMessage).toBe(evalCaseExistsMessage(CASE, slug));

    // The eval's run of the new case replays the turn on the agent.
    mcp.resetCaptured();
    mock.reset();
    mock.enqueue(anthropicToolUse("call_try", mcpToolName(SERVER, ECHO_TOOL_NAME), { text: LOOKUP }));
    mock.enqueue(anthropicText(DONE));
    mock.enqueue(vote("passed"));
    mock.enqueue(vote("passed"));
    mock.enqueue(vote("passed"));
    const evalRun = await clients.evalRunCommand.create(
      makeEvalRun({
        org: tenancy.org,
        agentId: agent.metadata!.id,
        evals: [{ org: tenancy.org, slug }],
        caseGlob: CASE,
        ablation: EvalRunAblation.none,
      }),
    );
    fixtures.defer(() => cancelAndDeleteEvalRun(clients, evalRun.metadata!.id));
    const ended = await awaitEvalRunEnd(clients, evalRun.metadata!.id, 300_000);
    const [block] = ended.status?.evals ?? [];
    const attempt = block?.cases[0]?.targets[0]?.withPlugin?.tries[0];
    const why = `state ${EvalRunTryState[attempt?.state ?? 0]} error "${attempt?.error ?? ""}" reason "${attempt?.notGradedReason ?? ""}"`;
    expect(ended.status?.phase, why).toBe(EvalRunPhase.completed);
    expect(block?.cases.map((c) => [c.caseName, c.mockedServers.map((m) => [m.name, m.tools, m.notStartedReason])])).toEqual([
      [CASE, [[SERVER, [ECHO_TOOL_NAME], ""]]],
    ]);
    expect([attempt?.state, attempt?.score], why).toEqual([EvalRunTryState.graded, 1]);
    const resumed = mock.scriptedRequests().some((request) => JSON.stringify(request.body).includes(FIRST_REQUEST));
    expect(resumed, "the try's model is sent the recorded first turn").toBe(true);
    expect(mcp.capturedRequests().map((r) => r.method), "the mocked server is never connected").toEqual([]);
    const offered = mock
      .scriptedRequests()
      .flatMap((request) => ((request.body as { tools?: OfferedToAnthropic[] }).tools ?? []).filter((tool) => tool.name === mcpToolName(SERVER, ECHO_TOOL_NAME)));
    expect(offered.length, "the try's model is offered the tool").toBeGreaterThan(0);
    for (const tool of offered) {
      expect(tool.description, "as the run offered it, never the stand-in's generic one").toBe(ECHO_DESCRIPTION);
      expect(tool.input_schema?.properties?.["text"]).toMatchObject({ type: "string", description: ECHO_TEXT_DESCRIPTION });
    }
  }, 480_000);

  it("[rpc:EvalCommandController.addCaseFromRun] refuses an eval of another organization than the run's", async () => {
    const agent = await createAgentWith(clients, fixtures, tenancy.org, [], {
      name: uniqueName("ecr-agent"),
      instructions: "Answer as the support desk.",
      mcpServers: [{ name: SERVER, url: mcp.url([ECHO_TOOL_NAME]) }],
    });
    const second = await conversation(agent);
    const other = await target.provisionTenancy();
    fixtures.defer(() => target.cleanupTenancy(other));
    const slug = await pushedEval(other.org);
    const refused = await expectGrpcCode(
      () => clients.evalCommand.addCaseFromRun({ runId: second.metadata!.id, eval: { org: other.org, slug }, caseName: CASE }),
      Code.FailedPrecondition,
      "an eval of another organization",
    );
    expect(refused.rawMessage).toBe(EVAL_CASE_OTHER_ORGANIZATION);
  }, 300_000);
});
