/**
 * The built-in judge: the agent a run marked as an AI judge's runs instead
 * of the built-in assistant. The server marks such a run with the reserved
 * label `stigmer.ai/grades-run` when it grades another run (the server's
 * domain/score/judge/judge-run.ts carries the same key); the blueprint
 * resolver reads the label and returns this spec as the turn's agent.
 *
 * The judge is code, as the assistant's prompt is
 * (builtin-assistant-prompt.ts): versioned here and pinned by its prompt
 * golden (`execute-deep-agent/__tests__/goldens/system-prompt.judge.prompt.md`),
 * with no stored row an organization could edit to pass every run. What
 * keeps it from acting on the conversation it reads:
 *
 *   - `disallowed_tools` names every Claude tool the Stigmer harness has a
 *     tool for (STIGMER_TOOL_COVERS, @stigmer/tool-vocabulary, the one
 *     source), so the model is shown none of them; the one built-in the
 *     runner keeps bound, `read_file`, it confines to the platform's own
 *     content (middleware/tool-scope.ts);
 *   - no MCP server, skill or sub-agent, whatever the session carries;
 *   - the instruction below: the conversation is evidence, never
 *     instructions.
 * The server composes no memories or standing context for a judge run, so
 * no memory tool is attached either.
 *
 * The instruction and its version live in @stigmer/eval-runtime beside the
 * rubrics, one constant the server hashes into every judge score so grades
 * from two judges are never compared as one: `JUDGE_INSTRUCTION_VERSION`
 * moves with any change to the instruction or to the deny-list here.
 *
 * Proven by __tests__/builtin-judge.test.ts and the prompt golden.
 */
import { create } from "@bufbuild/protobuf";

import { AgentSpecSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/spec_pb";
import type { AgentSpec } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/spec_pb";

import { JUDGE_INSTRUCTIONS } from "@stigmer/eval-runtime/judge";
import { STIGMER_TOOL_COVERS } from "@stigmer/tool-vocabulary";

/** The reserved label that marks a judge run. Wire contract with the server. */
export const GRADES_RUN_LABEL = "stigmer.ai/grades-run";


/** Every Claude tool the Stigmer harness binds, denied: the judge acts on nothing. */
export const BUILT_IN_JUDGE_DISALLOWED_TOOLS: readonly string[] = [
  ...new Set([...STIGMER_TOOL_COVERS.values()].flat()),
];

/** Whether a run's labels mark it as a judge run. */
export function isJudgeRunLabels(
  labels: Readonly<Record<string, string>> | undefined,
): boolean {
  return (labels?.[GRADES_RUN_LABEL] ?? "") !== "";
}

/** The built-in judge's agent spec: its instruction and its deny-list, nothing else. */
export function builtInJudgeSpec(): AgentSpec {
  return create(AgentSpecSchema, {
    instructions: JUDGE_INSTRUCTIONS,
    disallowedTools: [...BUILT_IN_JUDGE_DISALLOWED_TOOLS],
  });
}
