/**
 * Pins the variables the SDK resource docs bind an example's value to: a
 * kind's name as written, lower-camel in TypeScript and snake in Python,
 * except a name the language forbids as a binding or ships as a builtin,
 * which takes a suffix, so the Eval kind's examples parse in every module
 * and shadow nothing (`const evalResource`, `eval_resource`). A list is
 * `result` in both.
 */
import { describe, expect, it } from "vitest";

import { docPyVarName, docVarName } from "../sdk-docs.js";

describe("the SDK docs' example variables", () => {
  it.each([
    ["Agent", "agent", "agent"],
    ["EvalRun", "evalRun", "eval_run"],
    ["EvalArchive", "evalArchive", "eval_archive"],
    ["Eval", "evalResource", "eval_resource"],
    ["AgentList", "result", "result"],
  ])("binds a %s to %s and %s", (typeName, ts, py) => {
    expect(docVarName(typeName)).toBe(ts);
    expect(docPyVarName(typeName)).toBe(py);
  });
});
