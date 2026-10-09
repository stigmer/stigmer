/**
 * `shared/builtin-judge.ts`: the built-in judge a judge-labelled run runs.
 *
 * What these pin:
 *   - the judge's deny-list leaves the native engine no built-in tool: every
 *     tool NATIVE_TOOL_COVERS names is out of scope under the judge's lists,
 *     from that one source and not a copy;
 *   - the spec carries the instruction and the deny-list, and no MCP usage,
 *     skill ref, sub-agent, hook or env;
 *   - the label is read as a judge only when it names a run;
 *   - the version the server's judge scores carry with it is pinned here, so
 *     an instruction change moves both on purpose.
 */
import { describe, expect, it } from "vitest";

import {
  BUILT_IN_JUDGE_DISALLOWED_TOOLS,
  BUILT_IN_JUDGE_INSTRUCTIONS,
  BUILT_IN_JUDGE_VERSION,
  GRADES_RUN_LABEL,
  builtInJudgeSpec,
  isJudgeRunLabels,
} from "../builtin-judge.js";
import { NATIVE_TOOL_COVERS, ToolScope } from "../tool-lists.js";

describe("the built-in judge", () => {
  it("leaves the native engine no built-in tool", () => {
    const spec = builtInJudgeSpec();
    const scope = ToolScope.of("The judge", {
      tools: spec.tools,
      disallowedTools: spec.disallowedTools,
    });
    for (const name of NATIVE_TOOL_COVERS.keys()) {
      expect(scope.allowsEngineTool(name, NATIVE_TOOL_COVERS), name).toBe(false);
    }
  });

  it("carries its instruction and deny-list and nothing else", () => {
    const spec = builtInJudgeSpec();
    expect(spec.instructions).toBe(BUILT_IN_JUDGE_INSTRUCTIONS);
    expect(spec.disallowedTools).toEqual([...BUILT_IN_JUDGE_DISALLOWED_TOOLS]);
    expect(spec.tools).toEqual([]);
    expect(spec.mcpServerUsages).toEqual([]);
    expect(spec.skillRefs).toEqual([]);
    expect(spec.subAgents).toEqual([]);
    expect(spec.hooks).toEqual([]);
    expect(spec.env).toEqual({});
  });

  it("is chosen by the judge label alone", () => {
    expect(isJudgeRunLabels({ [GRADES_RUN_LABEL]: "run_1" })).toBe(true);
    expect(isJudgeRunLabels({ [GRADES_RUN_LABEL]: "" })).toBe(false);
    expect(isJudgeRunLabels({})).toBe(false);
    expect(isJudgeRunLabels(undefined)).toBe(false);
  });

  it("pins its version, which the server's judge scores carry", () => {
    expect(BUILT_IN_JUDGE_VERSION).toBe("1");
  });
});
