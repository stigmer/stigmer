/**
 * Pins `readEvalSuite` against Claude Code's plugin-eval format: the
 * documentation's examples read from fixture plugins (fixtures/evals/NOTICE),
 * then one in-memory plugin per rule, each breaking exactly one thing.
 *
 * What is pinned: the suite directory (`evals/`, a usable
 * `experimental.evals`, the fallback and its finding); case discovery
 * (grouping, `results/` and `mocks/` skipped, everything under a case
 * belonging to it); every default the format documents; the precedence of
 * `prompt.md` over `case.yaml`; grader order; one refusal per rule with its
 * sentence; the `unsupported` order; and that the plugin read no longer
 * reports `evals/` as an ignored component.
 */

import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { readEvalSuite } from "../evals/read-eval-suite.js";
import type { EvalSuite, EvalSuiteFinding } from "../evals/types.js";
import { inMemoryPluginFiles } from "../files.js";
import { readPluginPackage } from "../read-plugin-package.js";
import { claudePlugin } from "../testing.js";
import { directoryPluginFiles } from "../__test-utils__/directory-files.js";
import { accepted } from "../__test-utils__/read.js";

// A case's `plugins` paths, built so no literal here reads like a path this
// package's tests load from outside it (scripts/turbo-inputs.test.mjs).
const PARENT = "..";
const TWO_UP = `${PARENT}/${PARENT}`;

const FIXTURES = fileURLToPath(new URL("./fixtures/evals/", import.meta.url));

function fixtureSuite(name: string): EvalSuite {
  return readEvalSuite(directoryPluginFiles(`${FIXTURES}${name}`));
}

/** A Claude plugin with these extra files, and its manifest's extra fields. */
function suiteOf(files: Readonly<Record<string, string>>, manifest?: Readonly<Record<string, unknown>>): EvalSuite {
  const plugin = claudePlugin(manifest === undefined ? {} : { manifest });
  for (const [path, content] of Object.entries(files)) plugin.set(path, content);
  return readEvalSuite(inMemoryPluginFiles(plugin));
}

const LLM_GRADER = "---\ntype: llm\n---\n\nPASS if the reply answers.\n";

/** One case `evals/c` with a working grader, plus `files`. */
function oneCase(files: Readonly<Record<string, string>>): EvalSuite {
  return suiteOf({ "evals/c/graders/judge.md": LLM_GRADER, ...files });
}

/** The only finding, failing with every finding when there is not exactly one. */
function onlyFinding(suite: EvalSuite): EvalSuiteFinding {
  expect(suite.findings, JSON.stringify(suite.findings, null, 2)).toHaveLength(1);
  return suite.findings[0] as EvalSuiteFinding;
}

describe("the documentation's examples", () => {
  const suite = fixtureSuite("commit-helper");

  it("finds every case, grouped ones included, and never results/", () => {
    expect(suite.dir).toBe("evals");
    expect(suite.findings).toEqual([]);
    expect(suite.cases.map((c) => c.dir)).toEqual([
      "evals/changelog-from-diff",
      "evals/first-case",
      "evals/negative/ignores-unrelated-request",
    ]);
  });

  it("reads the commit-message case with every default the format documents", () => {
    expect(suite.cases[1]).toEqual({
      name: "first-case",
      dir: "evals/first-case",
      tags: [],
      prompt: "\nWrite me a commit message for this change: I renamed getUser to fetchUser and updated the three call sites.\n",
      runs: 3,
      maxTurns: 10,
      timeoutSeconds: 300,
      allowedTools: ["Read", "Glob", "Grep", "Skill"],
      env: {},
      plugins: [],
      context: { addDirs: [] },
      files: ["evals/first-case/graders/criteria.md", "evals/first-case/graders/skill-fired.md", "evals/first-case/prompt.md"],
      graders: [
        {
          name: "criteria",
          path: "evals/first-case/graders/criteria.md",
          weight: 1,
          check: {
            type: "llm",
            criteria:
              "PASS if the message names the rename from getUser to fetchUser in an imperative subject line.\n" +
              "FAIL if the message is missing, is not imperative, or does not mention the rename.",
            focus: { kind: "last_message" },
          },
        },
        {
          name: "skill-fired",
          path: "evals/first-case/graders/skill-fired.md",
          weight: 1,
          check: { type: "tool_used", tool: "Skill", inputMatch: '"skill"\\s*:\\s*"(?:[\\w-]+:)?commit-message"', min: 1 },
        },
      ],
    });
  });

  it("keeps the skill-fired pattern as written, matching the bare and the namespaced skill", () => {
    const check = suite.cases[1]?.graders[1]?.check;
    if (check?.type !== "tool_used" || check.inputMatch === undefined) throw new Error("expected a tool_used grader with input_match");
    const pattern = new RegExp(check.inputMatch);
    expect(pattern.test(JSON.stringify({ skill: "commit-message" }))).toBe(true);
    expect(pattern.test(JSON.stringify({ skill: "commit-helper:commit-message" }))).toBe(true);
    expect(pattern.test(JSON.stringify({ skill: "other" }))).toBe(false);
  });

  it("reads the changelog-from-diff case.yaml beside its prompt.md and names what Stigmer does not run", () => {
    const changelog = suite.cases[0];
    expect(changelog).toMatchObject({
      name: "changelog-from-diff",
      tags: ["smoke"],
      prompt: "Write a changelog entry for the change in this repository's last commit.\n",
      context: { scaffoldScript: "fixture.sh", addDirs: ["resources"] },
      unsupported: "context.scaffold_script",
    });
    expect(changelog?.files).toContain("evals/changelog-from-diff/resources/style.md");
    expect(changelog?.graders[0]?.check).toEqual({
      type: "regex",
      pattern: "fetchUser",
      flags: "i",
      match: { kind: "contains" },
      target: { kind: "file", path: "CHANGELOG.md" },
    });
  });

  it("reads a grouped case and a must-not-fire grader scored in both arms", () => {
    const negative = suite.cases[2];
    expect(negative).toMatchObject({ name: "ignores-unrelated-request", tags: ["negative"], runs: 2 });
    expect(negative?.unsupported).toBeUndefined();
    expect(negative?.graders[0]).toMatchObject({ arm: "both", check: { type: "tool_used", tool: "Skill", min: 0, max: 0 } });
  });

  it("is no longer an ignored component of the install", () => {
    const plugin = accepted(readPluginPackage(directoryPluginFiles(`${FIXTURES}commit-helper`)));
    expect(plugin.ignored).toEqual([]);
  });
});

describe("the eval directory", () => {
  it("moves to the manifest's experimental.evals, and evals/ is then not read", () => {
    const suite = fixtureSuite("quality-dir");
    expect(suite.dir).toBe("quality/evals");
    expect(suite.findings).toEqual([]);
    expect(suite.cases.map((c) => c.dir)).toEqual(["quality/evals/greets-by-name"]);
    expect(suite.cases[0]?.graders[0]?.check).toMatchObject({ type: "regex", pattern: "\\bAda\\b" });
    const plugin = accepted(readPluginPackage(directoryPluginFiles(`${FIXTURES}quality-dir`)));
    expect(plugin.ignored).toEqual([]);
  });

  it.each([["/abs/evals"], ["../evals"], ["quality//evals"], ["quality/evals/"], ["./qa"], [""], [42]])(
    "refuses %j and falls back to evals/",
    (value) => {
      const suite = suiteOf({ "evals/c/prompt.md": "Hello.", "evals/c/graders/judge.md": LLM_GRADER }, { experimental: { evals: value } });
      expect(suite.dir).toBe("evals");
      expect(suite.cases.map((c) => c.name)).toEqual(["c"]);
      const finding = onlyFinding(suite);
      expect(finding.kind).toBe("eval-dir-invalid");
      expect(finding.path).toBe(".claude-plugin/plugin.json");
      expect(finding.message).toBe(
        `.claude-plugin/plugin.json: experimental.evals ${JSON.stringify(value)} is not a relative path of plain directory names ` +
          "(such as 'qa' or 'quality/evals'); using evals/",
      );
    },
  );

  it.each([
    ["skills", undefined],
    ["skills/alpha", undefined],
    ["skills/alpha/tests", undefined],
    ["extra", ["./extra/"]],
    ["extra/one", ["./extra"]],
    ["content", ["./content/skills"]],
  ])("refuses %j, which overlaps the plugin's skills, and falls back to evals/", (value, skills) => {
    const suite = suiteOf(
      { "evals/c/prompt.md": "Hello.", "evals/c/graders/judge.md": LLM_GRADER },
      { experimental: { evals: value }, ...(skills !== undefined && { skills }) },
    );
    expect(suite.dir).toBe("evals");
    expect(suite.cases.map((c) => c.name)).toEqual(["c"]);
    expect(onlyFinding(suite)).toEqual({
      kind: "eval-dir-invalid",
      path: ".claude-plugin/plugin.json",
      message: `.claude-plugin/plugin.json: experimental.evals ${JSON.stringify(value)} overlaps the plugin's skills; using evals/`,
    });
  });

  it("moves beside the skills, and inside a plugin declared as one root skill", () => {
    expect(suiteOf({ "skills-tests/c/prompt.md": "Hello." }, { experimental: { evals: "skills-tests" } }).dir).toBe("skills-tests");
    const rootSkill = suiteOf({ "qa/c/prompt.md": "Hello.", "qa/c/graders/judge.md": LLM_GRADER }, { experimental: { evals: "qa" }, skills: "./" });
    expect(rootSkill.findings).toEqual([]);
    expect(rootSkill.dir).toBe("qa");
  });

  it("is an empty suite when the plugin has no eval directory", () => {
    expect(suiteOf({})).toEqual({ dir: "evals", cases: [], findings: [] });
  });

  it("is read without a manifest, at evals/", () => {
    const suite = readEvalSuite(inMemoryPluginFiles(new Map([["evals/c/prompt.md", "Hi."], ["evals/c/graders/judge.md", LLM_GRADER]])));
    expect(suite.cases.map((c) => c.name)).toEqual(["c"]);
  });
});

describe("case discovery", () => {
  it("skips mocks/ at the suite root, keeps a case's own mocks/ as its files, and does not nest a case in a case", () => {
    const suite = oneCase({
      "evals/c/prompt.md": "Hello.",
      "evals/c/mocks/tracker/create_issue.md": "Created.",
      "evals/c/inner/prompt.md": "A fixture, not a case.",
      "evals/mocks/tracker/create_issue.md": "Created.",
    });
    expect(suite.cases.map((c) => c.dir)).toEqual(["evals/c"]);
    expect(suite.cases[0]?.files).toEqual([
      "evals/c/graders/judge.md",
      "evals/c/inner/prompt.md",
      "evals/c/mocks/tracker/create_issue.md",
      "evals/c/prompt.md",
    ]);
  });

  it("orders cases by path, not by visit order", () => {
    const suite = suiteOf({
      "evals/a/b/prompt.md": "One.",
      "evals/a/b/graders/judge.md": LLM_GRADER,
      "evals/a-c/prompt.md": "Two.",
      "evals/a-c/graders/judge.md": LLM_GRADER,
    });
    expect(suite.cases.map((c) => c.dir)).toEqual(["evals/a-c", "evals/a/b"]);
  });

  it("loads the other cases when one cannot", () => {
    const suite = suiteOf({
      "evals/bad/prompt.md": "No graders.",
      "evals/good/prompt.md": "Fine.",
      "evals/good/graders/judge.md": LLM_GRADER,
    });
    expect(suite.cases.map((c) => c.name)).toEqual(["good"]);
    expect(onlyFinding(suite).path).toBe("evals/bad");
  });

  it("refuses a second case of the same name", () => {
    const suite = suiteOf({
      "evals/a/prompt.md": "---\nname: same\n---\nOne.",
      "evals/a/graders/judge.md": LLM_GRADER,
      "evals/b/prompt.md": "---\nname: same\n---\nTwo.",
      "evals/b/graders/judge.md": LLM_GRADER,
    });
    expect(suite.cases.map((c) => c.dir)).toEqual(["evals/a"]);
    expect(onlyFinding(suite)).toEqual({
      kind: "eval-case-invalid",
      path: "evals/b",
      message: "evals/b: case name 'same' is already used by 'evals/a'",
    });
  });
});

describe("precedence", () => {
  const caseYaml = [
    'schema_version: "1.1"',
    "name: from-yaml",
    "description: From the YAML.",
    "tags: [yaml]",
    "runs: 5",
    "execution:",
    "  model: yaml-model",
    "  max_turns: 20",
    "  timeout_seconds: 60",
    "  allowed_tools: [Read]",
    "  append_system_prompt: Be brief.",
    "  prompt: The YAML prompt.",
    "graders:",
    "  - name: from-yaml",
    "    type: regex",
    "    pattern: hello",
    "",
  ].join("\n");

  it("takes prompt.md frontmatter over the matching case.yaml field, whole fields, and the body as the prompt", () => {
    const suite = oneCase({
      "evals/c/case.yaml": caseYaml,
      "evals/c/prompt.md": "---\nname: from-prompt\ntags: [prompt]\nmax_turns: 7\nallowed_tools: [Grep, Glob]\n---\nThe prompt.md prompt.",
    });
    expect(suite.findings).toEqual([]);
    expect(suite.cases[0]).toMatchObject({
      name: "from-prompt",
      description: "From the YAML.",
      tags: ["prompt"],
      runs: 5,
      model: "yaml-model",
      maxTurns: 7,
      timeoutSeconds: 60,
      allowedTools: ["Grep", "Glob"],
      appendSystemPrompt: "Be brief.",
      prompt: "The prompt.md prompt.",
    });
  });

  it("lists case.yaml's graders first, then graders/*.md in path order", () => {
    const suite = suiteOf({
      "evals/c/case.yaml": caseYaml,
      "evals/c/graders/b.md": LLM_GRADER,
      "evals/c/graders/a.md": LLM_GRADER,
      "evals/c/graders/notes.txt": "not a grader",
    });
    expect(suite.cases[0]?.graders.map((g) => [g.name, g.path])).toEqual([
      ["from-yaml", "evals/c/case.yaml"],
      ["a", "evals/c/graders/a.md"],
      ["b", "evals/c/graders/b.md"],
    ]);
  });

  it("takes execution.prompt when there is no prompt.md, or its body is blank", () => {
    expect(suiteOf({ "evals/c/case.yaml": caseYaml }).cases[0]?.prompt).toBe("The YAML prompt.");
    expect(suiteOf({ "evals/c/case.yaml": caseYaml, "evals/c/prompt.md": "---\nruns: 1\n---\n\n" }).cases[0]).toMatchObject({
      prompt: "The YAML prompt.",
      runs: 1,
    });
  });

  it("names the case after its directory when neither file names it, and reads a prompt.md with no frontmatter as all body", () => {
    expect(oneCase({ "evals/c/prompt.md": "Just the prompt.\n" }).cases[0]).toMatchObject({ name: "c", prompt: "Just the prompt.\n" });
  });

  it("reads schema_version written as a number", () => {
    expect(oneCase({ "evals/c/prompt.md": "---\nschema_version: 1.1\n---\nHi." }).findings).toEqual([]);
  });

  it("refuses a case with no prompt anywhere", () => {
    expect(onlyFinding(oneCase({ "evals/c/prompt.md": "---\nruns: 1\n---\n  \n" }))).toEqual({
      kind: "eval-case-invalid",
      path: "evals/c/prompt.md",
      message: "evals/c/prompt.md: the prompt is required: write it as prompt.md's body or as case.yaml's execution.prompt",
    });
  });
});

describe("grader defaults and options", () => {
  function graderOf(frontmatter: string, body = "") {
    const suite = oneCase({ "evals/c/prompt.md": "Hi.", "evals/c/graders/x.md": `---\n${frontmatter}\n---\n${body}` });
    expect(suite.findings).toEqual([]);
    return suite.cases[0]?.graders.find((g) => g.name === "x");
  }

  it("regex: flags empty, match contains, target last_message by default; not_contains and count:N", () => {
    expect(graderOf("type: regex\npattern: a+")?.check).toEqual({
      type: "regex",
      pattern: "a+",
      flags: "",
      match: { kind: "contains" },
      target: { kind: "last_message" },
    });
    expect(graderOf("type: regex\npattern: a\nmatch: not_contains")?.check).toMatchObject({ match: { kind: "not_contains" } });
    expect(graderOf('type: regex\npattern: a\nmatch: "count:3"\ntarget: trace')?.check).toMatchObject({
      match: { kind: "count", count: 3 },
      target: { kind: "trace" },
    });
  });

  it("a pattern key wins over the body", () => {
    expect(graderOf("type: regex\npattern: key", "body\n")?.check).toMatchObject({ pattern: "key" });
  });

  it("tool_used: min 1 and no max by default", () => {
    expect(graderOf("type: tool_used\ntool: Read")?.check).toEqual({ type: "tool_used", tool: "Read", min: 1 });
  });

  it("tool_order: a name or { tool, input_match } on each side", () => {
    expect(graderOf("type: tool_order\nbefore: Read\nafter: { tool: Bash, input_match: 'npm test' }")?.check).toEqual({
      type: "tool_order",
      before: { tool: "Read" },
      after: { tool: "Bash", inputMatch: "npm test" },
    });
  });

  it("file_exists: exists true by default", () => {
    expect(graderOf("type: file_exists\npath: '**/*.md'")?.check).toEqual({ type: "file_exists", path: "**/*.md", exists: true });
    expect(graderOf("type: file_exists\npath: out.txt\nexists: false")?.check).toMatchObject({ exists: false });
  });

  it("llm: the criteria key wins over the body; focus files and mock_calls", () => {
    expect(graderOf("type: llm\ncriteria: From the key.\nfocus: files", "From the body.")?.check).toEqual({
      type: "llm",
      criteria: "From the key.",
      focus: { kind: "files" },
    });
  });

  it("baseline: a .jsonl in the case directory and criteria", () => {
    const suite = oneCase({
      "evals/c/prompt.md": "Hi.",
      "evals/c/reference.jsonl": "{}\n",
      "evals/c/graders/x.md": "---\ntype: baseline\nbaseline_file: reference.jsonl\n---\nAt least as good.",
    });
    expect(suite.cases[0]?.graders[1]?.check).toEqual({ type: "baseline", baselineFile: "reference.jsonl", criteria: "At least as good." });
  });

  it("weight and arm as written", () => {
    expect(graderOf("type: tool_used\ntool: Skill\nweight: 2.5\narm: with-only")).toMatchObject({ weight: 2.5, arm: "with-only" });
  });

  it("a case.yaml entry takes the same keys, criteria for llm", () => {
    const suite = suiteOf({
      "evals/c/case.yaml": [
        'schema_version: "1.1"',
        "name: c",
        "execution:",
        "  prompt: Hi.",
        "graders:",
        "  - name: judge",
        "    type: llm",
        "    criteria: PASS if it answers.",
        "    focus: { source: file, path: answer.md }",
        "    weight: 3",
      ].join("\n"),
    });
    expect(suite.cases[0]?.graders).toEqual([
      {
        name: "judge",
        path: "evals/c/case.yaml",
        weight: 3,
        check: { type: "llm", criteria: "PASS if it answers.", focus: { kind: "file", path: "answer.md" } },
      },
    ]);
  });
});

describe("refusals", () => {
  it.each([
    [
      "an unknown prompt.md frontmatter key",
      { "evals/c/prompt.md": "---\nfoo: 1\n---\nHi." },
      { kind: "eval-field-unknown", path: "evals/c/prompt.md", message: "evals/c/prompt.md: unknown frontmatter key 'foo'" },
    ],
    [
      "an unknown case.yaml key",
      { "evals/c/case.yaml": 'schema_version: "1.1"\nname: c\nsetup: x\nexecution:\n  prompt: Hi.' },
      { kind: "eval-field-unknown", path: "evals/c/case.yaml", message: "evals/c/case.yaml: unknown key 'setup'" },
    ],
    [
      "an unknown execution key",
      { "evals/c/case.yaml": 'schema_version: "1.1"\nname: c\nexecution:\n  prompt: Hi.\n  temperature: 0' },
      { kind: "eval-field-unknown", path: "evals/c/case.yaml", message: "evals/c/case.yaml: unknown key 'execution.temperature'" },
    ],
    [
      "an unknown context key",
      { "evals/c/case.yaml": 'schema_version: "1.1"\nname: c\ncontext:\n  seed: x\nexecution:\n  prompt: Hi.' },
      { kind: "eval-field-unknown", path: "evals/c/case.yaml", message: "evals/c/case.yaml: unknown key 'context.seed'" },
    ],
    [
      "an unsupported schema_version",
      { "evals/c/case.yaml": 'schema_version: "2.0"\nname: c\nexecution:\n  prompt: Hi.' },
      {
        kind: "eval-schema-version-unsupported",
        path: "evals/c/case.yaml",
        message: 'evals/c/case.yaml: schema_version "2.0" is not supported; this reader reads "1.1"',
      },
    ],
    [
      "a case.yaml without schema_version",
      { "evals/c/case.yaml": "name: c\nexecution:\n  prompt: Hi." },
      { kind: "eval-case-invalid", path: "evals/c/case.yaml", message: 'evals/c/case.yaml: schema_version is required ("1.1")' },
    ],
    [
      "a case.yaml without name",
      { "evals/c/case.yaml": 'schema_version: "1.1"\nexecution:\n  prompt: Hi.' },
      { kind: "eval-case-invalid", path: "evals/c/case.yaml", message: "evals/c/case.yaml: name is required" },
    ],
    [
      "runs below 1",
      { "evals/c/prompt.md": "---\nruns: 0\n---\nHi." },
      { kind: "eval-case-invalid", path: "evals/c/prompt.md", message: "evals/c/prompt.md: runs must be a whole number from 1 to 50" },
    ],
    [
      "runs above 50",
      { "evals/c/prompt.md": "---\nruns: 51\n---\nHi." },
      { kind: "eval-case-invalid", path: "evals/c/prompt.md", message: "evals/c/prompt.md: runs must be a whole number from 1 to 50" },
    ],
    [
      "max_turns above 200",
      { "evals/c/case.yaml": 'schema_version: "1.1"\nname: c\nexecution:\n  prompt: Hi.\n  max_turns: 201' },
      {
        kind: "eval-case-invalid",
        path: "evals/c/case.yaml",
        message: "evals/c/case.yaml: execution.max_turns must be a whole number from 1 to 200",
      },
    ],
    [
      "timeout_seconds above 3600",
      { "evals/c/prompt.md": "---\ntimeout_seconds: 3601\n---\nHi." },
      {
        kind: "eval-case-invalid",
        path: "evals/c/prompt.md",
        message: "evals/c/prompt.md: timeout_seconds must be a whole number from 1 to 3600",
      },
    ],
    [
      "an env key outside EVAL_*",
      { "evals/c/prompt.md": "---\nenv:\n  HOME: /tmp\n---\nHi." },
      { kind: "eval-case-invalid", path: "evals/c/prompt.md", message: "evals/c/prompt.md: env key 'HOME' must match EVAL_[A-Z0-9_]*" },
    ],
    [
      "tags that are not a list of strings",
      { "evals/c/prompt.md": "---\ntags: smoke\n---\nHi." },
      { kind: "eval-case-invalid", path: "evals/c/prompt.md", message: "evals/c/prompt.md: tags must be a list of strings" },
    ],
    [
      "unclosed frontmatter",
      { "evals/c/prompt.md": "---\nruns: 1\nHi." },
      {
        kind: "eval-case-invalid",
        path: "evals/c/prompt.md",
        message: "evals/c/prompt.md: the frontmatter is not closed (missing the closing '---')",
      },
    ],
  ])("%s", (_name, files, finding) => {
    const suite = oneCase(files);
    expect(suite.cases).toEqual([]);
    expect(onlyFinding(suite)).toEqual(finding);
  });

  it.each([
    ["execution that is not a mapping", "execution: Hi.", "eval-case-invalid", "evals/c/case.yaml: execution must be a mapping"],
    ["context that is not a mapping", "context: [a]\nexecution:\n  prompt: Hi.", "eval-case-invalid", "evals/c/case.yaml: context must be a mapping"],
    ["graders that are not a list", "execution:\n  prompt: Hi.\ngraders: judge", "eval-grader-invalid", "evals/c/case.yaml: graders must be a list"],
    [
      "an env value that is not a scalar",
      "execution:\n  prompt: Hi.\n  env:\n    EVAL_X: [1]",
      "eval-case-invalid",
      "evals/c/case.yaml: execution.env.EVAL_X must be a string, number or boolean",
    ],
  ])("case.yaml with %s", (_name, extra, kind, message) => {
    const suite = oneCase({ "evals/c/case.yaml": `schema_version: "1.1"\nname: c\n${extra}` });
    expect(suite.cases).toEqual([]);
    expect(suite.findings.map((f) => [f.kind, f.message])).toContainEqual([kind, message]);
  });

  it("a case.yaml over the eval cap, and a grader file over it", () => {
    const big = "x".repeat(1024 * 1024 + 1);
    const suite = suiteOf({ "evals/c/case.yaml": big, "evals/c/graders/x.md": big });
    expect(suite.findings.map((f) => [f.kind, f.path])).toEqual([
      ["eval-case-invalid", "evals/c/case.yaml"],
      ["eval-grader-invalid", "evals/c/graders/x.md"],
    ]);
  });

  it("a case without graders, naming graders", () => {
    const suite = suiteOf({ "evals/c/prompt.md": "Hi." });
    expect(suite.cases).toEqual([]);
    expect(onlyFinding(suite)).toEqual({
      kind: "eval-case-invalid",
      path: "evals/c",
      message: "evals/c: graders is required: add a graders/<name>.md file or a 'graders' entry in case.yaml",
    });
  });

  it("case.yaml that is not valid YAML", () => {
    const finding = onlyFinding(oneCase({ "evals/c/case.yaml": "name: [unclosed" }));
    expect(finding.kind).toBe("eval-case-invalid");
    expect(finding.message).toMatch(/^evals\/c\/case\.yaml: the file is not valid YAML: /);
  });

  it("a document over the eval cap", () => {
    const finding = onlyFinding(oneCase({ "evals/c/prompt.md": "x".repeat(1024 * 1024 + 1) }));
    expect(finding).toEqual({
      kind: "eval-case-invalid",
      path: "evals/c/prompt.md",
      message: "evals/c/prompt.md: the file is 1048577 bytes, over the 1048576-byte limit",
    });
  });

  function graderRefusal(frontmatter: string, body = ""): EvalSuiteFinding {
    const suite = suiteOf({ "evals/c/prompt.md": "Hi.", "evals/c/graders/x.md": `---\n${frontmatter}\n---\n${body}` });
    expect(suite.cases).toEqual([]);
    return onlyFinding(suite);
  }

  it.each([
    ["an unknown grader key", "type: regex\npattern: a\nfoo: 1", "unknown frontmatter key 'foo'"],
    ["a key of another type", "type: regex\npattern: a\ncriteria: x", "unknown frontmatter key 'criteria'"],
    ["a missing type", "weight: 1", "type is required (one of regex, tool_used, tool_order, file_exists, llm, baseline)"],
    ["an unknown type", "type: script", "type must be one of regex, tool_used, tool_order, file_exists, llm, baseline"],
    ["a pattern that does not compile", "type: regex\npattern: 'a('", "pattern must be a JavaScript regular expression"],
    ["inline (?i)", "type: regex\npattern: '(?i)abc'", "pattern must be a JavaScript regular expression"],
    ["bad flags", "type: regex\npattern: a\nflags: q", "flags must be JavaScript regular expression flags, such as 'i'"],
    ["an input_match that does not compile", "type: tool_used\ntool: Bash\ninput_match: '['", "input_match must be a JavaScript regular expression"],
    ["a tool_order input_match that does not compile", "type: tool_order\nbefore: { tool: Read, input_match: '(' }\nafter: Bash", "before.input_match must be a JavaScript regular expression"],
    ["a missing pattern", "type: regex", "pattern is required"],
    ["a missing tool", "type: tool_used", "tool is required"],
    ["a blank tool", "type: tool_used\ntool: ' '", "tool must be a non-empty string"],
    ["a missing tool_order side", "type: tool_order\nbefore: Read", "after is required"],
    ["a tool_order side that is a list", "type: tool_order\nbefore: [Read]\nafter: Bash", "before must be a tool name or { tool, input_match }"],
    ["a tool_order side with an unknown key", "type: tool_order\nbefore: Read\nafter: { tool: Bash, when: last }", "after must be a tool name or { tool, input_match }"],
    ["a weight of 0", "type: tool_used\ntool: Read\nweight: 0", "weight must be a positive number"],
    ["an unknown arm", "type: tool_used\ntool: Read\narm: without", "arm must be 'with-only' or 'both'"],
    ["min above max", "type: tool_used\ntool: Read\nmin: 2\nmax: 1", "min must be at most max (1)"],
    ["a negative min", "type: tool_used\ntool: Read\nmin: -1", "min must be a whole number, 0 or more"],
    ["an unknown match", "type: regex\npattern: a\nmatch: some", "match must be 'contains', 'not_contains' or \"count:N\""],
    ["an unknown target", "type: regex\npattern: a\ntarget: stdout", "target must be last_message, trace, files, mock_calls, or { source: file, path: <path> }"],
    ["a file target without a path", "type: regex\npattern: a\ntarget: { source: file }", "target must be last_message"],
    ["an llm grader with no criteria", "type: llm", "criteria is required (the file's body, or a criteria key)"],
    ["a baseline_file outside the case", "type: baseline\nbaseline_file: ../other.jsonl\ncriteria: x", "baseline_file must be a file in the case directory"],
    ["a baseline grader with no baseline_file", "type: baseline\ncriteria: x", "baseline_file is required"],
    ["exists that is not a boolean", "type: file_exists\npath: a\nexists: 'no'", "exists must be true or false"],
    ["a file_exists path with a reversed range", "type: file_exists\npath: '[z-a].txt'", "path must be a glob (range 'z-a' is reversed)"],
    ["a file_exists path with an unclosed brace", "type: file_exists\npath: '{a,b.txt'", "path must be a glob ('{' at 0 is never closed)"],
  ])("%s", (_name, frontmatter, problem) => {
    const finding = graderRefusal(frontmatter);
    expect(finding.kind).toBe("eval-grader-invalid");
    expect(finding.path).toBe("evals/c/graders/x.md");
    expect(finding.message.startsWith(`evals/c/graders/x.md: ${problem}`), finding.message).toBe(true);
  });

  it("a baseline grader whose file is in the case but that has no criteria", () => {
    const suite = suiteOf({
      "evals/c/prompt.md": "Hi.",
      "evals/c/reference.jsonl": "{}\n",
      "evals/c/graders/x.md": "---\ntype: baseline\nbaseline_file: reference.jsonl\n---\n",
    });
    expect(suite.cases).toEqual([]);
    expect(onlyFinding(suite)).toEqual({
      kind: "eval-grader-invalid",
      path: "evals/c/graders/x.md",
      message: "evals/c/graders/x.md: criteria is required (the file's body, or a criteria key)",
    });
  });

  it("a grader file with no frontmatter, as a missing type", () => {
    const suite = suiteOf({ "evals/c/prompt.md": "Hi.", "evals/c/graders/x.md": "PASS if it answers." });
    expect(onlyFinding(suite).message).toBe(
      "evals/c/graders/x.md: type is required (one of regex, tool_used, tool_order, file_exists, llm, baseline)",
    );
  });

  it("an unknown key, a missing name and a bad entry in case.yaml graders", () => {
    const suite = suiteOf({
      "evals/c/case.yaml": [
        'schema_version: "1.1"',
        "name: c",
        "execution:",
        "  prompt: Hi.",
        "graders:",
        "  - name: a",
        "    type: tool_used",
        "    tool: Read",
        "    extra: 1",
        "  - type: llm",
        "    criteria: x",
        "  - just a string",
      ].join("\n"),
    });
    expect(suite.cases).toEqual([]);
    expect(suite.findings.map((f) => [f.kind, f.message])).toEqual([
      ["eval-grader-invalid", "evals/c/case.yaml: unknown key 'graders[0].extra'"],
      ["eval-grader-invalid", "evals/c/case.yaml: graders[1].name is required"],
      ["eval-grader-invalid", "evals/c/case.yaml: graders[2] must be a mapping"],
    ]);
  });

  it("two graders of one name", () => {
    const suite = suiteOf({
      "evals/c/case.yaml": 'schema_version: "1.1"\nname: c\nexecution:\n  prompt: Hi.\ngraders:\n  - name: judge\n    type: llm\n    criteria: x',
      "evals/c/graders/judge.md": LLM_GRADER,
    });
    expect(onlyFinding(suite)).toEqual({
      kind: "eval-grader-invalid",
      path: "evals/c/graders/judge.md",
      message: "evals/c/graders/judge.md: grader name 'judge' is used by another grader of this case",
    });
  });

  it("names every problem of a file in one read", () => {
    const suite = oneCase({ "evals/c/prompt.md": "---\nfoo: 1\nruns: 0\nmax_turns: 0\n---\nHi." });
    expect(suite.findings.map((f) => f.kind)).toEqual(["eval-field-unknown", "eval-case-invalid", "eval-case-invalid"]);
  });
});

describe("unsupported", () => {
  const yamlCase = (extra: string): Record<string, string> => ({
    "evals/c/case.yaml": `schema_version: "1.1"\nname: c\nexecution:\n  prompt: Hi.\n${extra}`,
  });

  it.each([
    ["plugins", yamlCase(`plugins: ["${TWO_UP}", ${PARENT}/other]\ncontext:\n  scaffold_script: s.sh\n`)],
    ["context.scaffold_script", yamlCase(`plugins: ["${TWO_UP}"]\ncontext:\n  scaffold_script: s.sh\n  add_dirs: [r]\n  history_file: h.jsonl\n`)],
    ["context.add_dirs", yamlCase("context:\n  add_dirs: [r]\n  history_file: h.jsonl\n")],
    ["context.history_file", yamlCase("context:\n  history_file: h.jsonl\n")],
    ["env", { "evals/c/prompt.md": "---\nenv:\n  EVAL_LEVEL: 2\n---\nHi.", "evals/c/mocks/s/t.md": "x" }],
    [
      "mock_calls",
      { "evals/c/prompt.md": "Hi.", "evals/c/graders/m.md": "---\ntype: regex\npattern: x\ntarget: mock_calls\n---\n", "evals/c/mocks/s/t.md": "x" },
    ],
    ["mocks", { "evals/c/prompt.md": "Hi.", "evals/c/mocks/tracker/create_issue.md": "Created." }],
    ["mocks", { "evals/c/prompt.md": "Hi.", "evals/mocks/tracker/create_issue.md": "Created." }],
  ])("%s, the first feature in order", (feature, files) => {
    const suite = oneCase(files);
    expect(suite.findings).toEqual([]);
    expect(suite.cases[0]?.unsupported).toBe(feature);
  });

  it("runs a case whose plugins names only the plugin under test, and keeps the list as written", () => {
    const suite = oneCase({ "evals/c/prompt.md": `---\nplugins: ["${TWO_UP}"]\n---\nHi.` });
    expect(suite.findings).toEqual([]);
    expect(suite.cases[0]?.unsupported).toBeUndefined();
    expect(suite.cases[0]?.plugins).toEqual([TWO_UP]);
  });

  it("does not run a case whose plugins lists a second plugin", () => {
    const suite = oneCase({ "evals/c/prompt.md": `---\nplugins: ["${TWO_UP}", ${TWO_UP}/${PARENT}/helper]\n---\nHi.` });
    expect(suite.findings).toEqual([]);
    expect(suite.cases[0]?.unsupported).toBe("plugins");
  });

  it("keeps env values as text", () => {
    expect(oneCase({ "evals/c/prompt.md": "---\nenv:\n  EVAL_LEVEL: 2\n  EVAL_ON: true\n---\nHi." }).cases[0]?.env).toEqual({
      EVAL_LEVEL: "2",
      EVAL_ON: "true",
    });
  });

  it("more than 32 graders; 32 still runs", () => {
    const graders = (n: number): Record<string, string> =>
      Object.fromEntries(Array.from({ length: n }, (_, i) => [`evals/c/graders/g${String(i).padStart(2, "0")}.md`, LLM_GRADER]));
    expect(suiteOf({ "evals/c/prompt.md": "Hi.", ...graders(32) }).cases[0]?.unsupported).toBeUndefined();
    expect(suiteOf({ "evals/c/prompt.md": "Hi.", ...graders(33) }).cases[0]?.unsupported).toBe("more than 32 graders");
  });
});
