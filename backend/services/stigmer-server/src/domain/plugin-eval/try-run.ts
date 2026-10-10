/**
 * The requests a plugin eval's case workflow sends: each try's session
 * and run, and each vote's, as the format runs a case.
 *
 * A try is one ordinary run in a new session of its own, so a fresh, empty
 * workspace. The session is created first, in-process and server-composed,
 * so it may carry the reserved `stigmer.ai/plugin-eval` label (which keeps
 * it out of the conversation list and lets the eval's delete find it);
 * its subject is the case's name, so no titling call is made; its harness
 * is the target's; it runs the agent its arm names (arm.ts). The run:
 *
 *   - the target's model, and the eval's whole spending limit as its own
 *     cap, so no one try can spend past what the eval allows;
 *   - `auto_approve_all`: a try never stops to ask, as in the format;
 *   - `max_tool_rounds` from the case's `max_turns`, clamped to the run's
 *     10 to 1000 (a case note says so when clamped);
 *   - the tools, as the format grants them: the case's `allowed_tools`
 *     that are in the read-only set, plus the eval's `allow_tools`, as
 *     `tools`; `Skill` in `disallowed_tools` when the case does not list
 *     it, since an allow-list without `Skill` keeps skills in Stigmer; with
 *     nothing granted, every Claude tool disallowed, since an empty list
 *     means every tool; and, unless the eval runs real servers, each of the
 *     plugin's MCP servers disallowed (`mcp__<server>`), the format's
 *     default of not starting them. Names the read-only set holds that
 *     Stigmer runs nothing for (`AskUserQuestion`, `NotebookRead`, the task
 *     tools) are left out, and a case tool the eval does not grant is named
 *     in a note, as the format prints "not granted";
 *   - `append_system_prompt` from the case.
 *
 * A vote is a judge run in a session of its own, labelled
 * `stigmer.ai/grades-run = <try run id>` so the runner swaps in its
 * built-in judge, and `stigmer.ai/plugin-eval`, capped at the judge's
 * per-grade cost.
 *
 * Proven by __tests__/try-run.test.ts.
 */
import { create } from "@bufbuild/protobuf";
import type { JsonObject } from "@bufbuild/protobuf";

import type { EvalCase } from "@stigmer/plugin-package";
import { CLAUDE_TOOLS, READ_ONLY_EVAL_TOOLS, isClaudeTool } from "@stigmer/tool-vocabulary";
import type { PluginEvalSpec } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/spec_pb";
import { RunSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { RunConfigSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/invocation_pb";
import { RunSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/spec_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import type { Session } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { Harness } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import { SessionSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/spec_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";

import {
  GRADES_RUN_LABEL,
  JUDGE_SESSION_SUBJECT,
  PER_GRADE_CAP_USD,
} from "../score/judge/judge-run.js";
import type { ArmAttachment, EvalArm } from "./arm.js";
import { PLUGIN_EVAL_LABEL } from "./constants.js";

/** The run's own bounds on `max_tool_rounds` (run/v1/invocation.proto). */
export const MIN_TOOL_ROUNDS = 10;
export const MAX_TOOL_ROUNDS = 1000;

/** The run's turn budget from the case's `max_turns`, and the note when clamped. */
export function toolRoundsOf(maxTurns: number): { readonly rounds: number; readonly note?: string } {
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

/** A try's two lists and the notes they leave on the case (the module header). */
export interface TryTools {
  readonly tools: ReadonlyArray<string>;
  readonly disallowedTools: ReadonlyArray<string>;
  readonly notes: ReadonlyArray<string>;
}

export function tryToolsOf(
  evalCase: Pick<EvalCase, "allowedTools">,
  spec: Pick<PluginEvalSpec, "allowTools" | "realMcpServers">,
  pluginServerSlugs: ReadonlyArray<string>,
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
      notes.push(`${entry} not granted: the eval's allow_tools does not grant it`);
    }
  }
  for (const entry of spec.allowTools) {
    add(entry);
  }
  const grantedNames = new Set(granted.map(baseName));
  const disallowed: string[] =
    granted.length === 0
      ? [...CLAUDE_TOOLS]
      : grantedNames.has("Skill")
        ? []
        : ["Skill"];
  if (!spec.realMcpServers) {
    for (const slug of pluginServerSlugs) {
      disallowed.push(`mcp__${slug}`);
    }
  }
  return { tools: granted, disallowedTools: disallowed, notes };
}

/** Every note a case carries before it runs: the turn clamp and the tool grants. */
export function caseNotesOf(
  evalCase: Pick<EvalCase, "allowedTools" | "maxTurns">,
  spec: Pick<PluginEvalSpec, "allowTools" | "realMcpServers">,
): string[] {
  const rounds = toolRoundsOf(evalCase.maxTurns);
  return [
    ...(rounds.note === undefined ? [] : [rounds.note]),
    ...tryToolsOf(evalCase, spec, []).notes,
  ];
}

/** A slug-shaped fragment of an id: lowercased, underscores made hyphens. */
function slugOf(id: string): string {
  return id.toLowerCase().replaceAll("_", "-");
}

/** Where one try sits in its eval. */
export interface TryCell {
  readonly caseIndex: number;
  readonly targetIndex: number;
  readonly arm: EvalArm;
  readonly tryIndex: number;
}

/** A try's run name: the eval and the cell, so the row says what it is. */
export function tryRunName(evalId: string, cell: TryCell): string {
  return `try-${slugOf(evalId)}-${cell.caseIndex}-${cell.targetIndex}-${cell.arm}-${cell.tryIndex + 1}`;
}

/** The session a try runs in (the module header). */
export function trySessionRequest(input: {
  readonly org: string;
  readonly evalId: string;
  readonly caseName: string;
  readonly harness: Harness;
  readonly attachment: ArmAttachment;
}): Session {
  return create(SessionSchema, {
    apiVersion: "agentic.stigmer.ai/v1",
    kind: "Session",
    metadata: create(ApiResourceMetadataSchema, {
      org: input.org,
      labels: { [PLUGIN_EVAL_LABEL]: input.evalId },
    }),
    spec: create(SessionSpecSchema, {
      subject: input.caseName,
      harness: input.harness === Harness.UNSPECIFIED ? Harness.NATIVE : input.harness,
      ...(input.attachment.agentRef === undefined ? {} : { agentRef: input.attachment.agentRef }),
      mcpServerUsages: [...input.attachment.mcpServerUsages],
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
  readonly spec: PluginEvalSpec;
  readonly modelName: string;
  readonly pluginServerSlugs: ReadonlyArray<string>;
}): Run {
  const tools = tryToolsOf(input.evalCase, input.spec, input.pluginServerSlugs);
  return create(RunSchema, {
    apiVersion: "agentic.stigmer.ai/v1",
    kind: "Run",
    metadata: create(ApiResourceMetadataSchema, {
      name: tryRunName(input.evalId, input.cell),
      org: input.org,
      labels: { [PLUGIN_EVAL_LABEL]: input.evalId },
    }),
    spec: create(RunSpecSchema, {
      target: { case: "sessionId", value: input.sessionId },
      message: input.evalCase.prompt,
      runConfig: create(RunConfigSchema, {
        modelName: input.modelName,
        maxToolRounds: toolRoundsOf(input.evalCase.maxTurns).rounds,
        maxCostUsd: input.spec.maxCostUsd,
      }),
      autoApproveAll: true,
      tools: [...tools.tools],
      disallowedTools: [...tools.disallowedTools],
      appendSystemPrompt: input.evalCase.appendSystemPrompt ?? "",
    }),
  });
}

/** The session a vote runs in: the judge's subject, the native engine. */
export function voteSessionRequest(input: { readonly org: string; readonly evalId: string }): Session {
  return create(SessionSchema, {
    apiVersion: "agentic.stigmer.ai/v1",
    kind: "Session",
    metadata: create(ApiResourceMetadataSchema, {
      org: input.org,
      labels: { [PLUGIN_EVAL_LABEL]: input.evalId },
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
      name: `vote-${slugOf(input.tryRunId)}-${input.graderIndex + 1}-${input.voteIndex + 1}`,
      org: input.org,
      labels: {
        [GRADES_RUN_LABEL]: input.tryRunId,
        [PLUGIN_EVAL_LABEL]: input.evalId,
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
