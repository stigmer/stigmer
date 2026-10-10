/**
 * Pins `summariseEvalSuite`, the suite as a plugin stores it: at most 200
 * cases and 50 findings, in the reader's order, while `caseCount` and the
 * tags still cover every case; a finding's path cut to 200 characters and
 * an ellipsis in its `path` and at the start of its message; a short path
 * left alone.
 */

import { describe, expect, it } from "vitest";

import { readEvalSuite } from "../evals/read-eval-suite.js";
import {
  EVAL_SUMMARY_MAX_CASES,
  EVAL_SUMMARY_MAX_FINDINGS,
  EVAL_SUMMARY_MAX_PATH,
  summariseEvalSuite,
} from "../evals/summary.js";
import type { EvalSuite } from "../evals/types.js";
import { inMemoryPluginFiles } from "../files.js";
import { claudePlugin } from "../testing.js";

const LLM_GRADER = "---\ntype: llm\n---\n\nPASS if the reply answers.\n";

function suiteOf(files: Readonly<Record<string, string>>): EvalSuite {
  const plugin = claudePlugin();
  for (const [path, content] of Object.entries(files)) plugin.set(path, content);
  return readEvalSuite(inMemoryPluginFiles(plugin));
}

describe("summariseEvalSuite", () => {
  it("lists the first 200 cases, counting and tagging every one", () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 250; i += 1) {
      const name = `c${String(i).padStart(3, "0")}`;
      files[`evals/${name}/prompt.md`] = `---\ntags: [t${i % 3 === 0 ? "late" : "early"}${i >= 240 ? "-last" : ""}]\n---\nHi.`;
      files[`evals/${name}/graders/judge.md`] = LLM_GRADER;
    }
    const summary = summariseEvalSuite(suiteOf(files));
    expect(summary.caseCount).toBe(250);
    expect(summary.cases).toHaveLength(EVAL_SUMMARY_MAX_CASES);
    expect(summary.cases[0]).toEqual({ name: "c000", dir: "evals/c000", tags: ["tlate"] });
    expect(summary.cases.at(-1)?.name).toBe("c199");
    expect(summary.caseTags).toEqual(["tearly", "tearly-last", "tlate", "tlate-last"]);
  });

  it("keeps the first 50 findings and cuts a long path, in the field and the message", () => {
    const long = "d".repeat(300);
    const files: Record<string, string> = {};
    for (let i = 0; i < 60; i += 1) {
      const dir = `evals/${long}${String(i).padStart(2, "0")}`;
      files[`${dir}/prompt.md`] = "---\nruns: 0\n---\nHi.";
      files[`${dir}/graders/judge.md`] = LLM_GRADER;
    }
    const suite = suiteOf(files);
    expect(suite.findings).toHaveLength(60);
    const summary = summariseEvalSuite(suite);
    expect(summary.findings).toHaveLength(EVAL_SUMMARY_MAX_FINDINGS);
    const first = summary.findings[0]!;
    const cut = `evals/${long}`.slice(0, EVAL_SUMMARY_MAX_PATH);
    expect(first).toEqual({
      kind: "eval-case-invalid",
      path: `${cut}…`,
      message: `${cut}…: runs must be a whole number from 1 to 50`,
    });
  });

  it("leaves a short path and its message as the reader wrote them, and keeps a case's unsupported feature", () => {
    const suite = suiteOf({
      "evals/bad/prompt.md": "---\nruns: 0\n---\nHi.",
      "evals/bad/graders/judge.md": LLM_GRADER,
      "evals/env/prompt.md": "---\nenv:\n  EVAL_X: one\n---\nHi.",
      "evals/env/graders/judge.md": LLM_GRADER,
    });
    const summary = summariseEvalSuite(suite);
    expect(summary.findings).toEqual(suite.findings);
    expect(summary.cases).toEqual([{ name: "env", dir: "evals/env", tags: [], unsupported: "env" }]);
  });
});
