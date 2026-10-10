/**
 * Pins `summariseEvalSuite`, the suite as a plugin stores it: at most 200
 * cases and 50 findings, in the reader's order, while `caseCount` still
 * counts every case; the suite's tags drawn from the listed cases only,
 * at most 200 of them; every text the summary copies (a case's
 * name, directory and tags, a finding's path) cut to 200 characters and an
 * ellipsis, a finding's path also at the start of its message, and its
 * message to 1000; at most 32 tags per case, the suite's tags drawn from those;
 * short text left alone.
 */

import { describe, expect, it } from "vitest";

import { readEvalSuite } from "../evals/read-eval-suite.js";
import {
  EVAL_SUMMARY_MAX_CASE_TAGS,
  EVAL_SUMMARY_MAX_CASES,
  EVAL_SUMMARY_MAX_FINDINGS,
  EVAL_SUMMARY_MAX_MESSAGE,
  EVAL_SUMMARY_MAX_PATH,
  EVAL_SUMMARY_MAX_SUITE_TAGS,
  EVAL_SUMMARY_MAX_TEXT,
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
  it("lists the first 200 cases, counting every one and tagging the listed ones", () => {
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
    expect(summary.caseTags).toEqual(["tearly", "tlate"]);
  });

  it("lists at most 200 of the listed cases' tags, sorted", () => {
    const suite = suiteOf({ "evals/one/prompt.md": "Hi.", "evals/one/graders/judge.md": LLM_GRADER });
    const template = suite.cases[0]!;
    const cases = Array.from({ length: 10 }, (_, i) => ({
      ...template,
      name: `c${i}`,
      tags: Array.from({ length: 30 }, (_, j) => `t${String(i * 30 + j).padStart(3, "0")}`),
    }));
    const summary = summariseEvalSuite({ ...suite, cases });
    expect(EVAL_SUMMARY_MAX_SUITE_TAGS).toBe(200);
    expect(summary.caseTags).toHaveLength(EVAL_SUMMARY_MAX_SUITE_TAGS);
    expect(summary.caseTags[0]).toBe("t000");
    expect(summary.caseTags.at(-1)).toBe("t199");
  });

  it("keeps the first 50 findings and cuts a long path, in the field and the message", () => {
    const long = "d".repeat(300);
    const files: Record<string, string> = {};
    for (let i = 0; i < 60; i += 1) {
      const dir = `evals/${long}/${String(i).padStart(2, "0")}`;
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

  it("cuts an oversized case name, directory and tags, keeps 32 tags a case, and cuts a long finding message to 1000", () => {
    const read = suiteOf({ "evals/c/prompt.md": "Hi.", "evals/c/graders/judge.md": LLM_GRADER });
    const evalCase = read.cases[0]!;
    const huge = "n".repeat(1_000_000);
    const tags = Array.from({ length: 40 }, (_, i) => `${String(i).padStart(2, "0")}${"t".repeat(300)}`);
    const suite: EvalSuite = {
      ...read,
      cases: [{ ...evalCase, name: huge, dir: `evals/${huge}`, tags }],
      findings: [{ kind: "eval-case-invalid", path: "evals/c", message: `evals/c: ${"m".repeat(5000)}` }],
    };
    const summary = summariseEvalSuite(suite);
    const cut = (text: string): string => `${text.slice(0, EVAL_SUMMARY_MAX_TEXT)}…`;
    const kept = tags.slice(0, EVAL_SUMMARY_MAX_CASE_TAGS).map(cut);
    expect(summary.cases).toEqual([{ name: cut(huge), dir: cut(`evals/${huge}`), tags: kept }]);
    expect(summary.caseTags).toEqual(kept);
    expect(summary.findings).toEqual([
      { kind: "eval-case-invalid", path: "evals/c", message: `evals/c: ${"m".repeat(EVAL_SUMMARY_MAX_MESSAGE - "evals/c: ".length)}…` },
    ]);
    expect(JSON.stringify(summary).length).toBeLessThan(20_000);
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
