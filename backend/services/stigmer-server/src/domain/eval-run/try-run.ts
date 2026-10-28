/**
 * The requests an eval run's case workflow sends: each try's session and
 * run, and each vote's, as the format runs a case.
 *
 * A try is one ordinary run in a new session of its own, so a fresh, empty
 * workspace. The session is created first, in-process and server-composed,
 * so it may carry the reserved `stigmer.ai/eval-run` label (which keeps
 * it out of the conversation list and lets the eval run's delete find it);
 * it is named after its run (a session create refuses one with no name,
 * and its slug must be free in the organization, so a retried start, which
 * may meet the session an earlier attempt left, names its own); its
 * subject is the case's name, so no titling call is made; its harness is
 * the target's; it runs the eval run's agent at its stamped version, or the
 * built-in assistant on an eval run of a plugin, with every plugin a try
 * loads listed, the same in both arms (arm.ts). The run:
 *
 *   - `excluded_plugin_ids`: the compared plugin in the without arm, so the
 *     turn runs without it wherever it comes from (arm.ts);
 *   - the target's model (none on an agent's default target, so the
 *     agent's own model, tier and thinking apply), and as its own cap the
 *     budget the suite workflow
 *     hands the try when it starts (tryBudgetUsd): an equal share of what
 *     the eval has left for the tries that may run at once, within what
 *     the caps of the tries still running leave;
 *   - `auto_approve_all`: a try never stops to ask, as in the format;
 *   - `max_tool_rounds` from the case's `max_turns`, clamped to the run's
 *     10 to 1000 (a case note says so when clamped);
 *   - the tools, as the format grants them: the case's `allowed_tools`
 *     that are in the read-only set, plus the eval run's `allow_tools`, as
 *     `tools`; `Skill` in `disallowed_tools` when the case does not list
 *     it, since an allow-list without `Skill` keeps skills in Stigmer; and,
 *     unless the eval run runs real servers, each of the case's plugin's
 *     MCP servers disallowed, and every server of the other plugins a try
 *     loads and the agent's own, which the case cannot mock
 *     (`mcp__plugin_<plugin>_<server>`, as a turn names it), the format's
 *     default of not starting them. A server the case mocks is not
 *     disallowed: while the case's plugin is loaded in the try's arm (every
 *     arm but the without arm of the compared plugin's own cases) each
 *     mocked tool is granted
 *     (`mcp__plugin_<plugin>_<server>__<tool>`), as the format allows a
 *     mocked tool without an `--allow-tools` grant, and the runner answers
 *     it from its mock. With `allow_real_servers` a server the case does
 *     not mock is not disallowed either, so the runner starts it, its tools
 *     granted only by `allow_tools`. With nothing granted the try still gets an allow-list, so an
 *     engine's own extras and every MCP
 *     server are out of scope exactly as for a read-only case: the runner
 *     reads an empty `tools` as every tool and refuses one in which nothing
 *     resolves, so it names `TodoWrite`, the one tool on every engine's
 *     main loop that acts on nothing outside the run (the format grants no
 *     tool there; this is the least the runner can run). Names the
 *     read-only set holds that Stigmer runs nothing for (`AskUserQuestion`,
 *     `NotebookRead`, the task tools) are left out, and a case tool the
 *     eval does not grant is named in a note, as the format prints "not
 *     granted";
 *   - `append_system_prompt` from the case;
 *   - `eval_case` (tryCaseContextOf), when the case has a scaffold,
 *     reference folders, a recorded conversation, variables or, while its
 *     plugin is loaded, mocks: the paths in the plugin's archive the runner
 *     reads at the eval run's digest, and each mocked server under the name
 *     the run gives it. Mocks ride only while the case's plugin is loaded:
 *     without the plugin its servers do not exist, nor do their stand-ins.
 *     A case of a plugin the agent attaches keeps its mocks in both arms of
 *     another plugin's comparison. An Eval's case (`caseServers` then
 *     carries every server of the agent the arm runs: its own and its
 *     plugins', each under its name in the turn) mocks any of them, its
 *     mock directory named as the turn names the server, and the
 *     stand-in records where the real server lives (`home`), so a hook
 *     reads the same origin either way.
 *
 * A vote is a judge run in a session of its own, labelled
 * `stigmer.ai/grades-run = <try run id>` so the runner swaps in its
 * built-in judge, and `stigmer.ai/eval-run`, capped at the judge's
 * per-grade cost.
 *
 * Proven by __tests__/try-run.test.ts.
 */
import { create } from "@bufbuild/protobuf";
import type { JsonObject } from "@bufbuild/protobuf";

import type { EvalCase, EvalMockServer as CaseMockServer } from "@stigmer/plugin-package";
import { toolServerSegment } from "@stigmer/plugin-package";
import type { Plugin } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/api_pb";
import {
  EvalRunMockedServerSchema,
  type EvalRunMockedServer,
} from "@stigmer/apis/ai/stigmer/agentic/evalrun/v1/status_pb";
import {
  EvalCaseContextSchema,
  EvalMockKind,
  EvalMockAgentHomeSchema,
  EvalMockPluginHomeSchema,
  EvalMockServerSchema,
  EvalMockToolSchema,
  type EvalCaseContext,
  type EvalMockServer,
} from "@stigmer/apis/ai/stigmer/agentic/run/v1/eval_case_pb";
import { READ_ONLY_EVAL_TOOLS, isClaudeTool } from "@stigmer/tool-vocabulary";
import type { EvalRunSpec } from "@stigmer/apis/ai/stigmer/agentic/evalrun/v1/spec_pb";
import { RunSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import type { Run } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { RunConfigSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/invocation_pb";
import { RunSpecSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/spec_pb";
import { SessionSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import type { Session } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import { Harness } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";
import { SessionSpecSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/spec_pb";
import { ApiResourceMetadataSchema } from "@stigmer/apis/ai/stigmer/commons/apiresource/metadata_pb";

import {
  GRADES_RUN_LABEL,
  JUDGE_SESSION_SUBJECT,
  PER_GRADE_CAP_USD,
} from "../score/judge/judge-run.js";
import type { ArmAttachment, EvalArm } from "./arm.js";
import { EVAL_RUN_LABEL } from "./constants.js";
import { wantedFilesOf } from "./graders/verdict.js";

/** The run's own bounds on `max_tool_rounds` (run/v1/invocation.proto). */
export const MIN_TOOL_ROUNDS = 10;
export const MAX_TOOL_ROUNDS = 1000;

/** The run's turn budget from the case's `max_turns`, and the note when clamped. */
export function toolRoundsOf(maxTurns: number): {
  readonly rounds: number;
  readonly note?: string;
} {
  if (maxTurns < MIN_TOOL_ROUNDS) {
    return {
      rounds: MIN_TOOL_ROUNDS,
      note: `max_turns ${maxTurns} raised to the run's minimum of ${MIN_TOOL_ROUNDS} tool rounds`,
    };
  }
  if (maxTurns > MAX_TOOL_ROUNDS) {
    return {
      rounds: MAX_TOOL_ROUNDS,
      note: `max_turns ${maxTurns} lowered to the run's maximum of ${MAX_TOOL_ROUNDS} tool rounds`,
    };
  }
  return { rounds: maxTurns };
}

/** A tool-list entry's tool: the name before any specifier. */
function baseName(entry: string): string {
  const open = entry.indexOf("(");
  return (open === -1 ? entry : entry.slice(0, open)).trim();
}

/** Whether Stigmer's lists can name `entry` (a Claude tool or an MCP entry). */
function runnable(entry: string): boolean {
  const name = baseName(entry);
  return isClaudeTool(name) || name === "Task" || name.startsWith("mcp__");
}

/**
 * The allow-list of a try granted nothing (the module header): an empty
 * list would be every tool, so it names the one tool that grants nothing
 * beyond the run's own to-do list.
 */
const NOTHING_GRANTED_TOOLS: ReadonlyArray<string> = ["TodoWrite"];

/** A try's two lists and the notes they leave on the case (the module header). */
export interface TryTools {
  readonly tools: ReadonlyArray<string>;
  readonly disallowedTools: ReadonlyArray<string>;
  readonly notes: ReadonlyArray<string>;
}

/** Where a server a case may mock lives in the turn; absent, the case's own plugin. */
export type ServerHome =
  | { readonly kind: "plugin"; readonly pluginId: string; readonly pluginName: string; readonly server: string }
  | { readonly kind: "agent"; readonly agentId: string; readonly server: string };

/**
 * An MCP server as a try names it: its name in the run (`slug`, as in
 * `plugin_<plugin>_<server>` or an agent's own `billing`), the key a case's
 * mock directory names it by (`key`: the plugin's server key for a
 * plugin's case, the slug itself for an Eval's), and where it lives.
 */
export interface PluginServer {
  readonly slug: string;
  readonly key: string;
  readonly home?: ServerHome;
}

/** The plugin's MCP servers as its tries name them, from the row the eval loaded at its digest. */
export function pluginServersOf(plugin: Plugin): PluginServer[] {
  const name = plugin.metadata?.name ?? "";
  return (plugin.status?.mcpServers ?? []).map((server) => ({ slug: toolServerSegment(name, server.name), key: server.name }));
}

/** The case's mocks of `key` that answer at least one tool, or `undefined`. */
function mocksOf(evalCase: Pick<EvalCase, "mocks">, key: string): CaseMockServer | undefined {
  const server = evalCase.mocks.find((mock) => mock.server === key);
  return server !== undefined && server.tools.length > 0 ? server : undefined;
}

export function tryToolsOf(
  evalCase: Pick<EvalCase, "allowedTools" | "mocks">,
  spec: Pick<EvalRunSpec, "allowTools" | "realMcpServers" | "allowRealServers">,
  pluginServers: ReadonlyArray<PluginServer>,
  caseLoaded = true,
  otherServers: ReadonlyArray<PluginServer> = [],
): TryTools {
  const readOnly = new Set(READ_ONLY_EVAL_TOOLS);
  const granted: string[] = [];
  const notes: string[] = [];
  const add = (entry: string): void => {
    if (runnable(entry) && !granted.includes(entry)) {
      granted.push(entry);
    }
  };
  const allowedByEval = new Set(spec.allowTools.map(baseName));
  for (const entry of evalCase.allowedTools) {
    const name = baseName(entry);
    if (readOnly.has(name)) {
      add(entry);
    } else if (!allowedByEval.has(name)) {
      notes.push(
        `${entry} not granted: the eval run's allow_tools does not grant it`,
      );
    }
  }
  for (const entry of spec.allowTools) {
    add(entry);
  }
  const offServers: string[] = [];
  if (!spec.realMcpServers) {
    for (const server of pluginServers) {
      const mocks = mocksOf(evalCase, server.key);
      if (mocks === undefined) {
        if (!spec.allowRealServers) offServers.push(`mcp__${server.slug}`);
      } else if (caseLoaded) {
        for (const tool of mocks.tools) add(`mcp__${server.slug}__${tool.tool}`);
      }
    }
    if (!spec.allowRealServers) {
      for (const server of otherServers) offServers.push(`mcp__${server.slug}`);
    }
  }
  const grantedNames = new Set(granted.map(baseName));
  const disallowed: string[] = grantedNames.has("Skill") ? [] : ["Skill"];
  disallowed.push(...offServers);
  return {
    tools: granted.length === 0 ? [...NOTHING_GRANTED_TOOLS] : granted,
    disallowedTools: disallowed,
    notes,
  };
}

/** Every note a case carries before it runs: the turn clamp and the tool grants. */
export function caseNotesOf(
  evalCase: Pick<EvalCase, "allowedTools" | "maxTurns" | "mocks" | "replays" | "context">,
  spec: Pick<EvalRunSpec, "allowTools" | "realMcpServers" | "allowRealServers">,
): string[] {
  const rounds = toolRoundsOf(evalCase.maxTurns);
  const history = evalCase.context.historyFile;
  return [
    ...(rounds.note === undefined ? [] : [rounds.note]),
    ...tryToolsOf(evalCase, spec, []).notes,
    ...(history === undefined ? [] : [`resumed from ${history}`]),
    ...(evalCase.replays && !spec.realMcpServers ? [REPLAYS_NOT_READ_NOTE] : []),
  ];
}

/** The note on a case whose mocks hold adopted replays. */
export const REPLAYS_NOT_READ_NOTE = "adopted replays are not read; agent mocks answer live";

/** Why a plugin server a case leaves unmocked is not started, as the format's mocked: line prints it. */
export const NOT_STARTED_NO_MOCK = "not started: no mock";

/** Why an Eval case's mock answers nothing: the agent the eval run runs has no server of that name. */
export const NO_SUCH_SERVER_ON_AGENT = "no such server on the agent";

/**
 * The servers a case may mock as its with-plugin tries see them, named as
 * Claude Code's mocked: line names them (`plugin_<plugin>_<server>`, or an
 * agent's own server's name): each mocked server with its tools, and each
 * other server "not started: no mock". With `unmatched`, an Eval's case
 * also lists each mock directory that names no server of the agent, which
 * answers nothing. Nothing when the eval runs the real servers; a server
 * the eval starts for real (`allow_real_servers`) is not listed.
 */
export function mockedServersOf(
  evalCase: Pick<EvalCase, "mocks">,
  spec: Pick<EvalRunSpec, "realMcpServers" | "allowRealServers">,
  servers: ReadonlyArray<PluginServer>,
  unmatched = false,
): EvalRunMockedServer[] {
  if (spec.realMcpServers) return [];
  const listed = servers.flatMap((server) => {
    const mocks = mocksOf(evalCase, server.key);
    if (mocks !== undefined) {
      return [create(EvalRunMockedServerSchema, { name: server.slug, tools: mocks.tools.map((tool) => tool.tool) })];
    }
    return spec.allowRealServers ? [] : [create(EvalRunMockedServerSchema, { name: server.slug, notStartedReason: NOT_STARTED_NO_MOCK })];
  });
  if (!unmatched) return listed;
  const keys = new Set(servers.map((server) => server.key));
  const strays = evalCase.mocks
    .filter((mock) => !keys.has(mock.server))
    .map((mock) => create(EvalRunMockedServerSchema, { name: mock.server, notStartedReason: NO_SUCH_SERVER_ON_AGENT }));
  return [...listed, ...strays];
}

/** A plugin's servers as its own suite's mocks key them (the suite's declared keys), under their names in the run. */
export function pluginSuiteServersOf(pluginName: string, serverKeys: ReadonlyArray<string>): PluginServer[] {
  return serverKeys.map((key) => ({ slug: toolServerSegment(pluginName, key), key }));
}

/** The most agent-mock calls a try may make, the format's four per turn, bounded as the run's context is. */
export const MAX_AGENT_MOCK_CALLS = 800;

/** What locates the case in its source's archive: a plugin's, or an Eval's. */
export type CaseSource =
  | {
      readonly kind: "plugin";
      readonly pluginId: string;
      /** The plugin's name, as its servers' segments carry it. */
      readonly pluginName: string;
      /** The archive digest the eval run stamped. */
      readonly digest: string;
      /** The suite's directory, as in "evals". */
      readonly suiteDir: string;
    }
  | {
      readonly kind: "eval";
      readonly evalId: string;
      /** The archive digest the eval run stamped; the suite is the archive's root. */
      readonly digest: string;
    };

/** Whether the case's own source is in the try's arm: an Eval always is, a plugin unless the arm leaves it out. */
export function caseLoadedIn(source: CaseSource, attachment: Pick<ArmAttachment, "excludedPluginIds">): boolean {
  return source.kind === "eval" || !attachment.excludedPluginIds.includes(source.pluginId);
}

/**
 * A try's `eval_case` (the module header), or `undefined` when the
 * case gives its try nothing beyond its message.
 */
export function tryCaseContextOf(input: {
  readonly evalCase: EvalCase;
  readonly spec: Pick<EvalRunSpec, "realMcpServers" | "judgeModel">;
  /** Whether the case's plugin is loaded in the try's arm (arm.ts loadedIn). */
  readonly caseLoaded: boolean;
  readonly source: CaseSource;
  /** The servers the case may mock (tryRunRequest's `caseServers`). */
  readonly pluginServers: ReadonlyArray<PluginServer>;
}): EvalCaseContext | undefined {
  const { evalCase, spec, source } = input;
  const mocks =
    input.caseLoaded && !spec.realMcpServers
      ? input.pluginServers.flatMap((server) => {
          const mocked = mocksOf(evalCase, server.key);
          return mocked === undefined ? [] : [mockServerOf(mocked, server)];
        })
      : [];
  const { context } = evalCase;
  const env = Object.keys(evalCase.env).length > 0;
  if (context.scaffoldScript === undefined && context.historyFile === undefined && context.addDirs.length === 0 && !env && mocks.length === 0) {
    return undefined;
  }
  return create(EvalCaseContextSchema, {
    ...(source.kind === "plugin"
      ? { pluginId: source.pluginId, pluginName: source.pluginName, pluginDigest: source.digest, suiteDir: source.suiteDir }
      : { evalId: source.evalId, evalDigest: source.digest }),
    caseDir: evalCase.dir,
    scaffoldScript: context.scaffoldScript ?? "",
    addDirs: [...context.addDirs],
    historyFile: context.historyFile ?? "",
    env: { ...evalCase.env },
    mocks,
    agentMockModel: mocks.some((server) => server.tools.some((tool) => tool.kind === EvalMockKind.agent)) ? spec.judgeModel : "",
    agentMockCallBudget: Math.min(4 * evalCase.maxTurns, MAX_AGENT_MOCK_CALLS),
    // A scaffold's files are no change of the try's, so the file record
    // cannot show them: the runner returns what the graders read.
    readFiles: wantedFilesOf(evalCase.graders),
  });
}

function mockServerOf(mocked: CaseMockServer, server: PluginServer): EvalMockServer {
  return create(EvalMockServerSchema, {
    server: mocked.server,
    segment: server.slug,
    home: homeOf(server.home),
    toolsFile: mocked.toolsFile ?? "",
    tools: mocked.tools.map((tool) =>
      create(EvalMockToolSchema, {
        tool: tool.tool,
        file: tool.file,
        kind: tool.kind === "agent" ? EvalMockKind.agent : EvalMockKind.fixed,
        error: tool.error,
        expectJson: tool.expect === undefined ? "" : JSON.stringify(tool.expect),
        abortWhen: tool.abortWhen ?? "",
      }),
    ),
  });
}

/** A server's home on the wire; none for the case's own plugin. */
function homeOf(home: ServerHome | undefined): EvalMockServer["home"] {
  if (home === undefined) return { case: undefined };
  return home.kind === "plugin"
    ? {
        case: "plugin",
        value: create(EvalMockPluginHomeSchema, { pluginId: home.pluginId, pluginName: home.pluginName, server: home.server }),
      }
    : { case: "agent", value: create(EvalMockAgentHomeSchema, { agentId: home.agentId, server: home.server }) };
}

/** A slug-shaped fragment of an id: lowercased, underscores made hyphens. */
function slugOf(id: string): string {
  return id.toLowerCase().replaceAll("_", "-");
}

/** Where one try sits in its eval run. */
export interface TryCell {
  readonly caseIndex: number;
  readonly targetIndex: number;
  readonly arm: EvalArm;
  readonly tryIndex: number;
}

/** A try's run name: the eval run and the cell, so the row says what it is. */
export function tryRunName(evalId: string, cell: TryCell): string {
  return `try-${slugOf(evalId)}-${cell.caseIndex}-${cell.targetIndex}-${cell.arm}-${cell.tryIndex + 1}`;
}

/**
 * A session's name: its run's, and on a retried start (attempt 2 on) the
 * attempt's too, so it never meets a session an earlier attempt left.
 */
export function sessionNameOf(runName: string, attempt: number): string {
  return attempt > 1 ? `${runName}-attempt-${attempt}` : runName;
}

/** The spec fields a try's requests read. */
export type TrySpec = Pick<EvalRunSpec, "allowTools" | "realMcpServers" | "allowRealServers" | "judgeModel">;

/** The session a try runs in (the module header). */
export function trySessionRequest(input: {
  readonly org: string;
  readonly evalId: string;
  readonly cell: TryCell;
  /** The start activity's attempt, from 1. */
  readonly attempt: number;
  readonly caseName: string;
  readonly harness: Harness;
  readonly attachment: ArmAttachment;
}): Session {
  return create(SessionSchema, {
    apiVersion: "agentic.stigmer.ai/v1",
    kind: "Session",
    metadata: create(ApiResourceMetadataSchema, {
      name: sessionNameOf(tryRunName(input.evalId, input.cell), input.attempt),
      org: input.org,
      labels: { [EVAL_RUN_LABEL]: input.evalId },
    }),
    spec: create(SessionSpecSchema, {
      subject: input.caseName,
      harness:
        input.harness === Harness.UNSPECIFIED ? Harness.NATIVE : input.harness,
      ...(input.attachment.agentRef === undefined ? {} : { agentRef: input.attachment.agentRef }),
      plugins: [...input.attachment.plugins],
    }),
  });
}

/** The run of a try, in its session (the module header). */
export function tryRunRequest(input: {
  readonly org: string;
  readonly evalId: string;
  readonly cell: TryCell;
  readonly sessionId: string;
  readonly evalCase: EvalCase;
  readonly spec: TrySpec;
  readonly modelName: string;
  /** The run's spending cap: the try's share of what the eval run has left (temporal/evals/names.ts CaseInput). */
  readonly budgetUsd: number;
  /** The servers the case may mock: its plugin's, or for an Eval's case every server of the agent the arm runs. */
  readonly pluginServers: ReadonlyArray<PluginServer>;
  /** The servers of every other plugin a try loads and the agent's own, every one off (the module header). */
  readonly otherServers?: ReadonlyArray<PluginServer>;
  /** What the try's session lists and its run leaves out (arm.ts tryAttachment). */
  readonly attachment: ArmAttachment;
  readonly source: CaseSource;
}): Run {
  const caseLoaded = caseLoadedIn(input.source, input.attachment);
  const tools = tryToolsOf(input.evalCase, input.spec, input.pluginServers, caseLoaded, input.otherServers);
  const caseContext = tryCaseContextOf({
    evalCase: input.evalCase,
    spec: input.spec,
    caseLoaded,
    source: input.source,
    pluginServers: input.pluginServers,
  });
  return create(RunSchema, {
    apiVersion: "agentic.stigmer.ai/v1",
    kind: "Run",
    metadata: create(ApiResourceMetadataSchema, {
      name: tryRunName(input.evalId, input.cell),
      org: input.org,
      labels: { [EVAL_RUN_LABEL]: input.evalId },
    }),
    spec: create(RunSpecSchema, {
      target: { case: "sessionId", value: input.sessionId },
      message: input.evalCase.prompt,
      runConfig: create(RunConfigSchema, {
        modelName: input.modelName,
        maxToolRounds: toolRoundsOf(input.evalCase.maxTurns).rounds,
        maxCostUsd: input.budgetUsd,
      }),
      autoApproveAll: true,
      tools: [...tools.tools],
      disallowedTools: [...tools.disallowedTools],
      appendSystemPrompt: input.evalCase.appendSystemPrompt ?? "",
      ...(caseContext === undefined ? {} : { evalCase: caseContext }),
      excludedPluginIds: [...input.attachment.excludedPluginIds],
    }),
  });
}

/** A vote's run name: the try's run, the grader and the vote, from 1. */
export function voteRunName(
  tryRunId: string,
  graderIndex: number,
  voteIndex: number,
): string {
  return `vote-${slugOf(tryRunId)}-${graderIndex + 1}-${voteIndex + 1}`;
}

/** The session a vote runs in: named after its run, the judge's subject, the native engine. */
export function voteSessionRequest(input: {
  readonly org: string;
  readonly evalId: string;
  readonly tryRunId: string;
  readonly graderIndex: number;
  readonly voteIndex: number;
  /** The start activity's attempt, from 1. */
  readonly attempt: number;
}): Session {
  return create(SessionSchema, {
    apiVersion: "agentic.stigmer.ai/v1",
    kind: "Session",
    metadata: create(ApiResourceMetadataSchema, {
      name: sessionNameOf(
        voteRunName(input.tryRunId, input.graderIndex, input.voteIndex),
        input.attempt,
      ),
      org: input.org,
      labels: { [EVAL_RUN_LABEL]: input.evalId },
    }),
    spec: create(SessionSpecSchema, {
      subject: JUDGE_SESSION_SUBJECT,
      harness: Harness.NATIVE,
    }),
  });
}

/** One vote's run (the module header). */
export function voteRunRequest(input: {
  readonly org: string;
  readonly evalId: string;
  readonly tryRunId: string;
  readonly sessionId: string;
  readonly graderIndex: number;
  readonly voteIndex: number;
  readonly judgeModel: string;
  readonly message: string;
  readonly schema: JsonObject;
}): Run {
  return create(RunSchema, {
    apiVersion: "agentic.stigmer.ai/v1",
    kind: "Run",
    metadata: create(ApiResourceMetadataSchema, {
      name: voteRunName(input.tryRunId, input.graderIndex, input.voteIndex),
      org: input.org,
      labels: {
        [GRADES_RUN_LABEL]: input.tryRunId,
        [EVAL_RUN_LABEL]: input.evalId,
      },
    }),
    spec: create(RunSpecSchema, {
      target: { case: "sessionId", value: input.sessionId },
      message: input.message,
      runConfig: create(RunConfigSchema, {
        modelName: input.judgeModel,
        maxCostUsd: PER_GRADE_CAP_USD,
      }),
      structuredOutputSchema: input.schema,
    }),
  });
}
