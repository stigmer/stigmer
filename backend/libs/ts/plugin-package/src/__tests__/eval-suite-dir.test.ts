/**
 * `evalSuiteDir`: the suite reader's directory alone, so a reader that
 * hides the suite hides the same directory the reader grades from.
 */
import { describe, expect, it } from "vitest";

import { evalSuiteDir, readEvalSuite } from "../evals/read-eval-suite.js";
import { inMemoryPluginFiles } from "../files.js";

const manifest = (extra: Record<string, unknown>): string => JSON.stringify({ name: "p", ...extra });

describe("evalSuiteDir", () => {
  it("is evals/ for a package with no manifest", () => {
    expect(evalSuiteDir(inMemoryPluginFiles(new Map([["README.md", "x"]])))).toBe("evals");
  });

  it("is the manifest's experimental.evals when usable, as the suite reader's", () => {
    const files = inMemoryPluginFiles(new Map([[".claude-plugin/plugin.json", manifest({ experimental: { evals: "./qa" } })]]));
    expect(evalSuiteDir(files)).toBe("qa");
    expect(evalSuiteDir(files)).toBe(readEvalSuite(files).dir);
  });

  it("falls back to evals/ when the manifest's directory overlaps the skills", () => {
    const files = inMemoryPluginFiles(new Map([[".claude-plugin/plugin.json", manifest({ experimental: { evals: "skills/x" } })]]));
    expect(evalSuiteDir(files)).toBe("evals");
  });
});
