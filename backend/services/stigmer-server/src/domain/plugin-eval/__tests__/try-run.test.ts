/**
 * Pins what a try runs on and with (arm.ts, try-run.ts): the with-arm on
 * the plugin's composed agent, or the assistant with the plugin's servers
 * when it composed none; the without-arm on the bare assistant; the delta
 * marked provisional. The run: the case's read-only tools plus the eval's
 * grants, Skill disallowed unless listed, only the to-do list allowed when
 * none is granted, the plugin's servers disallowed unless real servers run,
 * names Stigmer runs nothing for left out, a not-granted tool noted;
 * max_turns clamped to the run's 10..1000 with a note; the reserved label
 * on the session and run; the case name as the subject; auto-approve; the
 * vote's judge label and cap. A case's mocks: each mocked tool granted in
 * the with-arm and its server left off the deny-list, a server neither
 * mocked nor run real still denied, `allow_real_servers` starting the
 * unmocked ones; the case context the run carries (paths, variables, the
 * with-arm's mocks under the run's server names, the agent mocks' model and
 * budget), absent when the case gives its try nothing; the mocked-servers
 * line and the case's notes.
 */
import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import type { EvalCase } from "@stigmer/plugin-package";
import { PluginEvalSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/spec_pb";
import { Harness } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import {
  GRADES_RUN_LABEL,
  PER_GRADE_CAP_USD,
} from "../../score/judge/judge-run.js";
import { PROVISIONAL_DELTA, armAttachment } from "../arm.js";
import { PLUGIN_EVAL_LABEL } from "../constants.js";
import {
  MAX_AGENT_MOCK_CALLS,
  NOT_STARTED_NO_MOCK,
  REPLAYS_NOT_READ_NOTE,
  caseNotesOf,
  mockedServersOf,
  tryCaseContextOf,
  toolRoundsOf,
  tryRunRequest,
  trySessionRequest,
  tryToolsOf,
  voteRunRequest,
  voteSessionRequest,
} from "../try-run.js";

const spec = (
  init: { allowTools?: string[]; realMcpServers?: boolean; allowRealServers?: boolean; judgeModel?: string } = {},
) =>
  create(PluginEvalSpecSchema, { pluginId: "plg_1", maxCostUsd: 5, ...init });

const evalCase = (overrides: Partial<EvalCase> = {}): EvalCase => ({
  name: "first-case",
  dir: "evals/first-case",
  tags: [],
  prompt: "Write me a commit message.",
  runs: 3,
  maxTurns: 10,
  timeoutSeconds: 300,
  allowedTools: [],
  env: {},
  plugins: [],
  context: { addDirs: [] },
  files: [],
  graders: [],
  mocks: [],
  replays: false,
  ...overrides,
});

const GITHUB = { slug: "github", key: "github" };
const SOURCE = { pluginId: "plg_1", digest: "d".repeat(64), suiteDir: "evals" };

describe("which agent a try runs on", () => {
  const facts = {
    org: "acme",
    agentSlug: "thermos",
    mcpServerSlugs: ["github"],
  };

  it("runs the with-arm on the composed agent and the without-arm on the bare assistant", () => {
    expect(armAttachment("with", facts).agentRef).toMatchObject({
      org: "acme",
      kind: ApiResourceKind.agent,
      slug: "thermos",
    });
    expect(armAttachment("with", facts).mcpServerUsages).toEqual([]);
    expect(armAttachment("without", facts)).toEqual({ mcpServerUsages: [] });
    expect(PROVISIONAL_DELTA).toBe(true);
  });

  it("attaches an agentless plugin's servers to the assistant", () => {
    const attached = armAttachment("with", {
      org: "acme",
      mcpServerSlugs: ["github", "jira"],
    });
    expect(attached.agentRef).toBeUndefined();
    expect(
      attached.mcpServerUsages.map((usage) => usage.mcpServerRef?.slug),
    ).toEqual(["github", "jira"]);
  });
});

describe("a try's tools", () => {
  it("grants the case's read-only tools and the eval's, and withholds Skill unless listed", () => {
    const tools = tryToolsOf(
      evalCase({ allowedTools: ["Read", "Grep", "Bash"] }),
      spec({ allowTools: ["Write"] }),
      [],
    );
    expect(tools.tools).toEqual(["Read", "Grep", "Write"]);
    expect(tools.disallowedTools).toEqual(["Skill"]);
    expect(tools.notes).toEqual([
      "Bash not granted: the eval's allow_tools does not grant it",
    ]);
  });

  it("keeps Skill when the case lists it, and leaves out names Stigmer runs nothing for", () => {
    const tools = tryToolsOf(
      evalCase({
        allowedTools: ["Read", "Skill", "AskUserQuestion", "NotebookRead"],
      }),
      spec(),
      [],
    );
    expect(tools.tools).toEqual(["Read", "Skill"]);
    expect(tools.disallowedTools).toEqual([]);
  });

  it("grants only the to-do list when nothing is granted, as an allow-list, and the plugin's servers unless real ones run", () => {
    // An empty allow-list is every tool, so the try's list names the one
    // tool every engine's main loop has that acts on nothing outside the
    // run: the engines' extras and any other MCP server are out of scope,
    // as for a read-only case.
    const none = tryToolsOf(evalCase(), spec(), [GITHUB]);
    expect(none.tools).toEqual(["TodoWrite"]);
    expect(none.disallowedTools).toEqual(["Skill", "mcp__github"]);
    const read = tryToolsOf(evalCase({ allowedTools: ["Read"] }), spec(), [GITHUB]);
    expect(read.disallowedTools).toEqual(none.disallowedTools);
    const real = tryToolsOf(
      evalCase({ allowedTools: ["Skill"] }),
      spec({ realMcpServers: true, allowTools: ["mcp__github__*"] }),
      [GITHUB],
    );
    expect(real.tools).toEqual(["Skill", "mcp__github__*"]);
    expect(real.disallowedTools).toEqual([]);
  });

  it("clamps max_turns to the run's tool rounds, with a note", () => {
    expect(toolRoundsOf(4)).toEqual({
      rounds: 10,
      note: "max_turns 4 raised to the run's minimum of 10 tool rounds",
    });
    expect(toolRoundsOf(200)).toEqual({ rounds: 200 });
    expect(toolRoundsOf(5000).rounds).toBe(1000);
    expect(
      caseNotesOf(evalCase({ maxTurns: 3, allowedTools: ["Edit"] }), spec()),
    ).toHaveLength(2);
  });
});

describe("a try's session and run", () => {
  it("labels the session, names it after the case and runs the target's engine", () => {
    const session = trySessionRequest({
      org: "acme",
      evalId: "pev_1",
      cell: { caseIndex: 0, targetIndex: 1, arm: "with", tryIndex: 2 },
      attempt: 1,
      caseName: "first-case",
      harness: Harness.UNSPECIFIED,
      attachment: armAttachment("with", {
        org: "acme",
        agentSlug: "thermos",
        mcpServerSlugs: [],
      }),
    });
    expect(session.metadata?.labels).toEqual({ [PLUGIN_EVAL_LABEL]: "pev_1" });
    expect(session.spec?.subject).toBe("first-case");
    expect(session.spec?.harness).toBe(Harness.NATIVE);
    expect(session.spec?.agentRef?.slug).toBe("thermos");
  });

  // A session create refuses a session with no name (ResolveSlug), and its
  // slug must be free in the organization: each try's and each vote's
  // session is named after its run, and a retried start, which may meet the
  // session an earlier attempt left, names its own.
  it("names each session after its run, and a retried start's apart from the first", () => {
    const cell = {
      caseIndex: 0,
      targetIndex: 1,
      arm: "with",
      tryIndex: 2,
    } as const;
    const attachment = armAttachment("without", {
      org: "acme",
      mcpServerSlugs: [],
    });
    const tryNames = [1, 2].map(
      (attempt) =>
        trySessionRequest({
          org: "acme",
          evalId: "pev_1",
          cell,
          attempt,
          caseName: "first-case",
          harness: Harness.NATIVE,
          attachment,
        }).metadata?.name,
    );
    expect(tryNames).toEqual([
      "try-pev-1-0-1-with-3",
      "try-pev-1-0-1-with-3-attempt-2",
    ]);
    const voteNames = [1, 3].map(
      (attempt) =>
        voteSessionRequest({
          org: "acme",
          evalId: "pev_1",
          tryRunId: "run_TRY",
          graderIndex: 1,
          voteIndex: 0,
          attempt,
        }).metadata?.name,
    );
    expect(voteNames).toEqual([
      "vote-run-try-2-1",
      "vote-run-try-2-1-attempt-3",
    ]);
  });

  it("runs the case's prompt with the target's model, unattended, within what is left of the eval's limit", () => {
    const run = tryRunRequest({
      org: "acme",
      evalId: "pev_1",
      cell: { caseIndex: 0, targetIndex: 1, arm: "without", tryIndex: 2 },
      sessionId: "ses_1",
      evalCase: evalCase({
        maxTurns: 4,
        appendSystemPrompt: "Be brief.",
        allowedTools: ["Read"],
      }),
      spec: spec(),
      modelName: "claude-sonnet-4-6",
      budgetUsd: 3.5,
      pluginServers: [GITHUB],
      arm: "without",
      source: SOURCE,
    });
    expect(run.metadata?.name).toBe("try-pev-1-0-1-without-3");
    expect(run.metadata?.labels).toEqual({ [PLUGIN_EVAL_LABEL]: "pev_1" });
    expect(run.spec?.target).toEqual({ case: "sessionId", value: "ses_1" });
    expect(run.spec?.message).toBe("Write me a commit message.");
    expect(run.spec?.autoApproveAll).toBe(true);
    expect(run.spec?.runConfig).toMatchObject({
      modelName: "claude-sonnet-4-6",
      maxToolRounds: 10,
      maxCostUsd: 3.5,
    });
    expect(run.spec?.tools).toEqual(["Read"]);
    expect(run.spec?.disallowedTools).toEqual(["Skill", "mcp__github"]);
    expect(run.spec?.appendSystemPrompt).toBe("Be brief.");
    expect(run.spec?.pluginEvalCase).toBeUndefined();
  });

  it("sends a case that grants nothing an allow-list too, so nothing beyond the to-do list is in scope", () => {
    const run = tryRunRequest({
      org: "acme",
      evalId: "pev_1",
      cell: { caseIndex: 0, targetIndex: 0, arm: "with", tryIndex: 0 },
      sessionId: "ses_1",
      evalCase: evalCase(),
      spec: spec(),
      modelName: "claude-sonnet-4-6",
      budgetUsd: 1,
      pluginServers: [GITHUB],
      arm: "with",
      source: SOURCE,
    });
    expect(run.spec?.tools).toEqual(["TodoWrite"]);
    expect(run.spec?.disallowedTools).toEqual(["Skill", "mcp__github"]);
  });

  it("makes a vote a judge run of the try, in a labelled session, at the judge's cap", () => {
    const session = voteSessionRequest({
      org: "acme",
      evalId: "pev_1",
      tryRunId: "run_TRY",
      graderIndex: 0,
      voteIndex: 2,
      attempt: 1,
    });
    expect(session.metadata?.labels).toEqual({ [PLUGIN_EVAL_LABEL]: "pev_1" });
    expect(session.metadata?.name).toBe("vote-run-try-1-3");
    const vote = voteRunRequest({
      org: "acme",
      evalId: "pev_1",
      tryRunId: "run_TRY",
      sessionId: "ses_v",
      graderIndex: 0,
      voteIndex: 2,
      judgeModel: "",
      message: "grade",
      schema: { type: "object" },
    });
    expect(vote.metadata?.labels).toEqual({
      [GRADES_RUN_LABEL]: "run_TRY",
      [PLUGIN_EVAL_LABEL]: "pev_1",
    });
    expect(vote.metadata?.name).toBe("vote-run-try-1-3");
    expect(vote.spec?.runConfig?.maxCostUsd).toBe(PER_GRADE_CAP_USD);
    expect(vote.spec?.structuredOutputSchema).toEqual({ type: "object" });
  });
});

describe("a case's mocks and context", () => {
  const TRACKER = { slug: "tracker-acme", key: "tracker" };
  const mocked = evalCase({
    mocks: [
      {
        server: "tracker",
        tools: [
          { tool: "close_issue", file: "evals/mocks/tracker/close_issue.md", kind: "fixed", error: true },
          {
            tool: "create_issue",
            file: "evals/mocks/tracker/create_issue.md",
            kind: "agent",
            error: false,
            expect: { title: "string" },
            abortWhen: "the title is empty",
          },
        ],
        toolsFile: "evals/mocks/tracker/_tools.json",
      },
    ],
  });

  it("grants each mocked tool in the with-arm and leaves its server off the deny-list", () => {
    const withArm = tryToolsOf(mocked, spec(), [TRACKER, GITHUB], "with");
    expect(withArm.tools).toEqual(["mcp__tracker-acme__close_issue", "mcp__tracker-acme__create_issue"]);
    expect(withArm.disallowedTools).toEqual(["Skill", "mcp__github"]);
    const without = tryToolsOf(mocked, spec(), [TRACKER, GITHUB], "without");
    expect(without.tools).toEqual(["TodoWrite"]);
    expect(without.disallowedTools).toEqual(["Skill", "mcp__github"]);
  });

  it("starts the unmocked servers with allow_real_servers, their tools granted only by allow_tools", () => {
    const tools = tryToolsOf(mocked, spec({ allowRealServers: true }), [TRACKER, GITHUB], "with");
    expect(tools.disallowedTools).toEqual(["Skill"]);
    expect(tools.tools).not.toContain("mcp__github");
  });

  it("carries the case's context and the files its graders read, with the mocks in the with-arm only, under the run's server names", () => {
    const withCase = evalCase({
      ...mocked,
      maxTurns: 300,
      env: { EVAL_X: "1" },
      context: { scaffoldScript: "setup.sh", historyFile: "h.jsonl", addDirs: ["resources"] },
      graders: [
        {
          name: "bumped",
          path: "evals/first-case/graders/bumped.md",
          weight: 1,
          check: { type: "regex", pattern: "version = 2", flags: "", match: { kind: "contains" }, target: { kind: "file", path: "app.txt" } },
        },
      ],
    });
    const context = tryCaseContextOf({
      evalCase: withCase,
      spec: spec({ judgeModel: "claude-haiku-4.5" }),
      arm: "with",
      source: SOURCE,
      pluginServers: [TRACKER, GITHUB],
    });
    expect(context).toMatchObject({
      pluginId: "plg_1",
      pluginDigest: "d".repeat(64),
      suiteDir: "evals",
      caseDir: "evals/first-case",
      scaffoldScript: "setup.sh",
      historyFile: "h.jsonl",
      addDirs: ["resources"],
      env: { EVAL_X: "1" },
      agentMockModel: "claude-haiku-4.5",
      agentMockCallBudget: MAX_AGENT_MOCK_CALLS,
      readFiles: ["app.txt"],
    });
    expect(context?.mocks.map((m) => [m.server, m.segment, m.toolsFile, m.tools.map((t) => [t.tool, t.error, t.expectJson, t.abortWhen])])).toEqual([
      [
        "tracker",
        "tracker-acme",
        "evals/mocks/tracker/_tools.json",
        [
          ["close_issue", true, "", ""],
          ["create_issue", false, '{"title":"string"}', "the title is empty"],
        ],
      ],
    ]);
    const without = tryCaseContextOf({ evalCase: withCase, spec: spec(), arm: "without", source: SOURCE, pluginServers: [TRACKER] });
    expect(without?.mocks).toEqual([]);
    expect(without?.scaffoldScript).toBe("setup.sh");
    expect(without?.readFiles, "both arms' graders read the same files").toEqual(["app.txt"]);
    expect(tryCaseContextOf({ evalCase: mocked, spec: spec(), arm: "without", source: SOURCE, pluginServers: [TRACKER] })).toBeUndefined();
    expect(tryCaseContextOf({ evalCase: mocked, spec: spec({ realMcpServers: true }), arm: "with", source: SOURCE, pluginServers: [TRACKER] })).toBeUndefined();
  });

  it("lists the plugin's servers as the format's mocked: line names them", () => {
    expect(mockedServersOf(mocked, spec(), "acme-kit", ["github", "tracker"]).map((m) => [m.name, m.tools, m.notStartedReason])).toEqual([
      ["plugin_acme-kit_github", [], NOT_STARTED_NO_MOCK],
      ["plugin_acme-kit_tracker", ["close_issue", "create_issue"], ""],
    ]);
    expect(mockedServersOf(mocked, spec({ allowRealServers: true }), "acme-kit", ["github", "tracker"]).map((m) => m.name)).toEqual([
      "plugin_acme-kit_tracker",
    ]);
    expect(mockedServersOf(mocked, spec({ realMcpServers: true }), "acme-kit", ["github"])).toEqual([]);
  });

  it("notes a resumed conversation and adopted replays", () => {
    expect(caseNotesOf(evalCase({ context: { addDirs: [], historyFile: "h.jsonl" }, replays: true }), spec())).toEqual([
      "resumed from h.jsonl",
      REPLAYS_NOT_READ_NOTE,
    ]);
  });
});
