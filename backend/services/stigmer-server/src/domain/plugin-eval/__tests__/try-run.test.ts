/**
 * Pins the requests a try and a vote send (try-run.ts). The session: the
 * plugins its arm lists (the with-arm's plugin reference at the eval's
 * digest, none on the without-arm), no agent of its own, the reserved
 * label, the case name as the subject, the target's engine, and a name
 * per run and per retried start. The run: the case's
 * read-only tools plus the eval's grants, Skill disallowed unless listed,
 * only the to-do list allowed when none is granted, each of the plugin's
 * servers disallowed by its turn segment (`mcp__plugin_<plugin>_<server>`)
 * unless real servers run, names Stigmer runs nothing for left out, a
 * not-granted tool noted; max_turns clamped to the run's 10..1000 with a
 * note; auto-approve. The vote: the judge label and cap.
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
import { armAttachment } from "../arm.js";
import { PLUGIN_EVAL_LABEL } from "../constants.js";
import {
  caseNotesOf,
  toolRoundsOf,
  tryRunRequest,
  trySessionRequest,
  tryToolsOf,
  voteRunRequest,
  voteSessionRequest,
} from "../try-run.js";

const spec = (init: { allowTools?: string[]; realMcpServers?: boolean } = {}) =>
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
  ...overrides,
});

const SEGMENT = "plugin_thermos_github";

const facts = { org: "acme", slug: "thermos", digest: "sha256:0123abcd" };

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
    const none = tryToolsOf(evalCase(), spec(), [SEGMENT, "plugin_thermos_jira"]);
    expect(none.tools).toEqual(["TodoWrite"]);
    expect(none.disallowedTools).toEqual([
      "Skill",
      `mcp__${SEGMENT}`,
      "mcp__plugin_thermos_jira",
    ]);
    const read = tryToolsOf(evalCase({ allowedTools: ["Read"] }), spec(), [
      SEGMENT,
      "plugin_thermos_jira",
    ]);
    expect(read.disallowedTools).toEqual(none.disallowedTools);
    const real = tryToolsOf(
      evalCase({ allowedTools: ["Skill"] }),
      spec({ realMcpServers: true, allowTools: [`mcp__${SEGMENT}__*`] }),
      [SEGMENT],
    );
    expect(real.tools).toEqual(["Skill", `mcp__${SEGMENT}__*`]);
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
  it("labels the session, names it after the case, runs the target's engine and lists the with-arm's plugin", () => {
    const session = trySessionRequest({
      org: "acme",
      evalId: "pev_1",
      cell: { caseIndex: 0, targetIndex: 1, arm: "with", tryIndex: 2 },
      attempt: 1,
      caseName: "first-case",
      harness: Harness.UNSPECIFIED,
      attachment: armAttachment("with", facts),
    });
    expect(session.metadata?.labels).toEqual({ [PLUGIN_EVAL_LABEL]: "pev_1" });
    expect(session.spec?.subject).toBe("first-case");
    expect(session.spec?.harness).toBe(Harness.NATIVE);
    expect(session.spec?.plugins).toHaveLength(1);
    expect(session.spec?.plugins[0]).toMatchObject({
      org: "acme",
      kind: ApiResourceKind.plugin,
      slug: "thermos",
      version: "sha256:0123abcd",
    });
    expect(session.spec?.agentRef).toBeUndefined();
  });

  it("lists no plugin on the without-arm's session", () => {
    const session = trySessionRequest({
      org: "acme",
      evalId: "pev_1",
      cell: { caseIndex: 0, targetIndex: 0, arm: "without", tryIndex: 0 },
      attempt: 1,
      caseName: "first-case",
      harness: Harness.CURSOR,
      attachment: armAttachment("without", facts),
    });
    expect(session.spec?.plugins).toEqual([]);
    expect(session.spec?.agentRef).toBeUndefined();
    expect(session.spec?.harness).toBe(Harness.CURSOR);
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
    const attachment = armAttachment("without", facts);
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
      pluginServerSegments: [SEGMENT],
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
    expect(run.spec?.disallowedTools).toEqual(["Skill", `mcp__${SEGMENT}`]);
    expect(run.spec?.appendSystemPrompt).toBe("Be brief.");
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
      pluginServerSegments: [SEGMENT],
    });
    expect(run.spec?.tools).toEqual(["TodoWrite"]);
    expect(run.spec?.disallowedTools).toEqual(["Skill", `mcp__${SEGMENT}`]);
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
