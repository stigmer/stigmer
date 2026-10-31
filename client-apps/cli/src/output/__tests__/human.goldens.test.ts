// Goldens of what the CLI prints for a person in each everyday situation:
// the `list` tables and `get` views of the kinds a person reads most (agent,
// skill, session, organization), every error the classifier knows in its
// plain and debug forms, the results of mutating commands, the plaintext run
// transcript and the exit summary over the scenario catalogue's runs, and the
// top-level help. Each is frozen as a file in `__goldens__`, so a change to
// the look is a diff a reviewer reads; `npx vitest run -u` rewrites them.
//
// Today's look is frozen as it is, known gaps included (one generic `get`
// view, tables that ignore the terminal's width, help with no groups); the
// changes that close those gaps update these files on purpose. Colour is off
// by construction (`colorize = false`, NO_COLOR set) and nothing reads the
// clock: the inputs are `@stigmer/react-sdk/test`'s samples and scenarios,
// stamped from one frozen instant. A debug error's stack is set by hand,
// since a real one names this machine's paths.
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { AgentSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import type { Run } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { SessionSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import { SkillSchema } from "@stigmer/apis/ai/stigmer/agentic/skill/v1/api_pb";
import { OrganizationSchema } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/api_pb";
import { ErrorInfoSchema } from "@stigmer/apis/google/rpc/error_details_pb";
import type { Stigmer } from "@stigmer/client";
import { samples, sampleInstant, scenarios, type ScenarioName } from "@stigmer/react-sdk/test";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { expectGolden } from "../../__test-utils__/golden.js";
import { classify } from "../../errors/classify.js";
import { CliExitError } from "../../errors/cli-exit-error.js";
import { ExitCode } from "@stigmer/client/exit-codes";
import { formatError } from "../../errors/handle.js";
import { UsageError } from "../../errors/usage-error.js";
import { buildProgram } from "../../program.js";
import { libraryTable, ORG_TABLE, SESSION_TABLE } from "../../resources/list.js";
import { renderCollection, renderResource } from "../../resources/render.js";
import { runEpilogue } from "../../resources/run/epilogue.js";
import { PlaintextRenderer } from "../../resources/stream/render-plaintext.js";
import { CommandResult, resultToHuman } from "../command-result.js";

let noColor: string | undefined;
beforeAll(() => {
  noColor = process.env.NO_COLOR;
  process.env.NO_COLOR = "1";
});
afterAll(() => {
  if (noColor === undefined) delete process.env.NO_COLOR;
  else process.env.NO_COLOR = noColor;
});

const ORG_LABELS = new Map([["demo", "demo"]]);

describe("the read views", () => {
  const agents = [
    samples.agent(),
    samples.agent({ id: "agt_00000000000000000000000002", name: "Release Notes", slug: "release-notes", description: "Drafts release notes from the merged pull requests of a milestone, grouped by area." }),
  ];
  const skills = [samples.skill(), samples.skill({ id: "skl_00000000000000000000000002", name: "Triage", slug: "triage", description: "Labels new issues." })];
  const sessions = [samples.session(), samples.session({ id: "ses_00000000000000000000000002", subject: "Fix invoice rounding", agentRef: null })];
  const organizations = [samples.organization(), samples.organization({ id: "org_00000000000000000000000002", name: "Acme Robotics", slug: "acme" })];

  it("lists agents, skills, sessions and organizations as tables", async () => {
    await expectGolden(renderCollection(AgentSchema, agents, "table", libraryTable("agents"), ORG_LABELS), "list-agents");
    await expectGolden(renderCollection(SkillSchema, skills, "table", libraryTable("skills"), ORG_LABELS), "list-skills");
    await expectGolden(renderCollection(SessionSchema, sessions, "table", SESSION_TABLE, ORG_LABELS), "list-sessions");
    await expectGolden(renderCollection(OrganizationSchema, organizations, "table", ORG_TABLE), "list-organizations");
    await expectGolden(renderCollection(AgentSchema, [], "table", libraryTable("agents")), "list-empty");
  });

  it("shows one agent, skill, session and organization in the get view", async () => {
    await expectGolden(renderResource(AgentSchema, agents[1]!, "table", { orgLabel: "demo" }), "get-agent");
    await expectGolden(renderResource(SkillSchema, skills[0]!, "table", { orgLabel: "demo" }), "get-skill");
    await expectGolden(renderResource(SessionSchema, sessions[1]!, "table", { orgLabel: "demo" }), "get-session");
    await expectGolden(renderResource(OrganizationSchema, organizations[1]!, "table", { hideOrg: true }), "get-organization");
  });
});

/** An error with a stack that names no machine's paths. */
function withStack<E extends Error>(error: E): E {
  error.stack = `${error.name}: ${error.message}\n    at command (src/commands/example.ts:1:1)`;
  return error;
}

function reasoned(message: string, code: Code, reason: string, metadata: Record<string, string> = {}): ConnectError {
  return withStack(new ConnectError(message, code, undefined, [{ desc: ErrorInfoSchema, value: create(ErrorInfoSchema, { reason, domain: "stigmer.ai", metadata }) }]));
}

const ERRORS: ReadonlyArray<readonly [string, Error]> = [
  ["unavailable", withStack(new ConnectError("connect ECONNREFUSED 127.0.0.1:7234", Code.Unavailable))],
  ["deadline-exceeded", withStack(new ConnectError("the call took longer than 30s", Code.DeadlineExceeded))],
  ["resource-exhausted", withStack(new ConnectError("100 requests per minute", Code.ResourceExhausted))],
  ["not-found", withStack(new ConnectError("agent 'demo/reviewer' not found", Code.NotFound))],
  ["invalid-argument", withStack(new ConnectError("spec.instructions: value is required", Code.InvalidArgument))],
  ["failed-precondition", withStack(new ConnectError("the session has a turn that waits for an answer", Code.FailedPrecondition))],
  ["already-exists", withStack(new ConnectError("agent 'demo/reviewer'", Code.AlreadyExists))],
  ["unauthenticated", withStack(new ConnectError("token expired", Code.Unauthenticated))],
  ["permission-denied", withStack(new ConnectError("you cannot edit agent 'demo/reviewer'", Code.PermissionDenied))],
  ["internal", withStack(new ConnectError("nil pointer", Code.Internal))],
  ["aborted", withStack(new ConnectError("the session changed while it was written", Code.Aborted))],
  ["canceled", withStack(new ConnectError("the server canceled the call", Code.Canceled))],
  ["unknown", withStack(new ConnectError("something odd", Code.Unknown))],
  ["reason-api-key-before-sign-in", reasoned("this API key was created before sign-in was turned on", Code.Unauthenticated, "API_KEY_CREATED_BEFORE_SIGN_IN")],
  ["reason-agent-hours-used-up", reasoned("demo has used the 40 agent hours of its Team plan; they reset on Aug 1", Code.FailedPrecondition, "AGENT_HOURS_USED_UP", { plan: "team" })],
  ["reason-agent-hours-used-up-child", reasoned("demo's parent organization has used its agent hours", Code.FailedPrecondition, "AGENT_HOURS_USED_UP")],
  ["usage-error", withStack(new UsageError("--json and --quiet cannot be used together"))],
  ["cli-exit-error", withStack(new CliExitError("not signed in to https://stigmer.example", ExitCode.Auth, ["Sign in:", "  stigmer auth login"]))],
  ["plain-error", withStack(new Error("ENOENT: no such file or directory, open 'agent.yaml'"))],
];

describe("CLI-04 every error says what happened, why, and what to do; stacks only in debug", () => {
  const classified = ERRORS.map(([name, error]) => [name, classify(error)] as const);

  it.each(classified)("prints %s in its plain and debug forms", async (name, error) => {
    expect(error).not.toBeNull();
    const cli = error!;
    await expectGolden(`exit ${cli.exitCode}\n\n${formatError(cli, false)}\n--- with --debug ---\n${formatError(cli, true)}`, `error-${name}`);
  });

  it("keeps the stack out of every plain form and puts it in every debug one", () => {
    for (const [name, error] of classified) {
      const cli = error!;
      expect(formatError(cli, false), name).not.toContain("    at ");
      expect(formatError(cli, true), name).toContain("    at command (src/commands/example.ts:1:1)");
    }
  });
});

describe("mutating results", () => {
  it("prints a success with its sections and hints, a warning, and an error", async () => {
    const created = CommandResult.success("Agent created");
    created.addSection().field("Name", "release-notes").field("Organization", "demo").field("Visibility", "private");
    created.addSection("Next").item("stigmer run release-notes \"Draft the notes\"");
    created.hint("Push a new version with: stigmer push agent ./agent");
    await expectGolden(resultToHuman(created, false), "result-success");

    const warned = CommandResult.warning("Plugin installed with 1 MCP server that needs sign-in");
    warned.addSection("Sign in").field("linear", "stigmer connect plugin acme/linear");
    await expectGolden(resultToHuman(warned, false), "result-warning");

    await expectGolden(resultToHuman(CommandResult.error("Validation failed: 2 problems"), false), "result-error");
  });
});

/** A buffer standing in for a stream. */
function sink(): { write(chunk: string): boolean; text(): string } {
  let text = "";
  return {
    write(chunk: string) {
      text += chunk;
      return true;
    },
    text: () => text,
  };
}

const RUNS: readonly ScenarioName[] = ["completed", "tools", "approval", "subagent-finished", "failed", "markdown"];

describe("the plaintext run transcript", () => {
  it.each(RUNS)("writes the %s run's answer to stdout and its status lines to stderr", async (name) => {
    const data = sink();
    const status = sink();
    new PlaintextRenderer({ data, status }).fold(scenarios[name].fold);
    await expectGolden(`--- stdout ---\n${data.text()}--- stderr ---\n${status.text()}`, `run-${name}`);
  });
});

/** The scenario's run as the server answers its final Get: started and, unless it works, ended 42 seconds later. */
function finalRun(name: ScenarioName): Run {
  const run = structuredClone(scenarios[name].runs[0]!);
  run.status!.startedAt = sampleInstant();
  run.status!.completedAt = sampleInstant(42_000);
  return run;
}

function epilogueClient(run: Run, totalTokens: bigint, llmCallCount: number): Stigmer {
  return {
    run: {
      get: async () => run,
      getRunUsageReport: async () => ({ aggregate: { totalTokens, llmCallCount } }),
    },
    session: { listEvents: async () => ({ events: [], nextPageToken: "" }) },
  } as unknown as Stigmer;
}

describe("the run's exit summary", () => {
  it.each([
    ["completed", 18_432n, 3],
    ["completed-estimated", 18_432n, 0],
    ["failed", 2_048n, 1],
  ] as const)("prints the %s summary and the line that resumes the session", async (label, tokens, calls) => {
    const name: ScenarioName = label === "failed" ? "failed" : "completed";
    const written = sink();
    const spy = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => written.write(String(chunk)));
    try {
      const run = finalRun(name);
      const turn = scenarios[name].fold.turns[0];
      await runEpilogue(epilogueClient(run, tokens, calls), scenarios[name].session!.metadata!.id, run.metadata!.id, { phase: turn?.status?.phase ?? "", error: "", turn });
    } finally {
      spy.mockRestore();
    }
    await expectGolden(written.text(), `epilogue-${label}`);
  });
});

describe("help", () => {
  it("prints the top-level help at 80 columns", async () => {
    const program = buildProgram();
    program.configureHelp({ ...program.configureHelp(), helpWidth: 80 });
    await expectGolden(program.helpInformation(), "help-root");
  });
});
