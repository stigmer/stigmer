/**
 * Pins the eval suite's summary on the install plan: read from the same
 * files the install reads, it rides the plan as `evals` (never a warning,
 * never a refusal), is absent when the plugin has no eval directory, and
 * maps field for field onto `PluginEvalSuite` with its tags sorted and
 * unique, each case's unsupported feature, and each finding as a
 * `PluginWarning`, at most 200 cases and 50 findings stored while the case
 * count counts every case (the library pins the path cut). `evals/` is no longer a `component-ignored` warning.
 */
import { describe, expect, it } from "vitest";

import {
  inMemoryPluginFiles,
  readPluginPackage,
} from "@stigmer/plugin-package";
import { claudePlugin } from "@stigmer/plugin-package/testing";
import type { PluginFixture } from "@stigmer/plugin-package/testing";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";

import { evalSuiteOf, planEvals } from "../materialize/evals.js";
import type { PluginIdentity } from "../materialize/identity.js";
import { planMaterialization } from "../materialize/plan.js";

const IDENTITY: PluginIdentity = {
  org: "acme",
  id: "plg_1",
  slug: "greeter",
  name: "greeter",
  digest: "d".repeat(64),
  visibility: ApiResourceVisibility.visibility_org,
};

const JUDGE = "---\ntype: llm\n---\nPASS if it greets.\n";

function plan(fixture: PluginFixture) {
  const outcome = readPluginPackage(inMemoryPluginFiles(fixture));
  if (!outcome.ok) {
    throw new Error(outcome.errors.map((e) => e.message).join("\n"));
  }
  return planMaterialization(
    outcome.plugin,
    inMemoryPluginFiles(fixture),
    { mcpServers: [] },
    IDENTITY,
    "",
  );
}

const greeter = (
  files: Readonly<Record<string, string>>,
  manifest?: Readonly<Record<string, unknown>>,
) =>
  claudePlugin({
    name: "greeter",
    skills: [{ name: "greet", description: "Greets", body: "# Greet" }],
    files,
    ...(manifest !== undefined && { manifest }),
  });

describe("the eval suite on the install plan", () => {
  it("summarises the suite and no longer warns that evals/ is not installed", () => {
    const planned = plan(
      greeter({
        "evals/b-case/prompt.md": "---\ntags: [smoke, greet]\n---\nSay hi.",
        "evals/b-case/graders/judge.md": JUDGE,
        "evals/a-case/case.yaml":
          'schema_version: "1.1"\nname: first\ntags: [smoke]\ncontext:\n  scaffold_script: s.sh\nexecution:\n  prompt: Hi.\n',
        "evals/a-case/graders/judge.md": JUDGE,
        "evals/broken/prompt.md": "---\nfoo: 1\n---\nHi.",
        "evals/broken/graders/judge.md": JUDGE,
      }),
    );
    expect(planned.warnings.map((w) => w.kind)).not.toContain(
      "component-ignored",
    );
    expect(planned.members).toEqual(plan(greeter({})).members);

    const suite = evalSuiteOf(planned.evals!);
    expect(suite.dir).toBe("evals");
    expect(suite.caseCount).toBe(2);
    expect(suite.caseTags).toEqual(["greet", "smoke"]);
    expect(
      suite.cases.map((c) => ({
        caseName: c.caseName,
        path: c.path,
        caseTags: c.caseTags,
        unsupported: c.unsupported,
      })),
    ).toEqual([
      {
        caseName: "first",
        path: "evals/a-case",
        caseTags: ["smoke"],
        unsupported: "context.scaffold_script",
      },
      {
        caseName: "b-case",
        path: "evals/b-case",
        caseTags: ["smoke", "greet"],
        unsupported: "",
      },
    ]);
    expect(
      suite.findings.map((f) => ({
        kind: f.kind,
        path: f.path,
        message: f.message,
      })),
    ).toEqual([
      {
        kind: "eval-field-unknown",
        path: "evals/broken/prompt.md",
        message: "evals/broken/prompt.md: unknown frontmatter key 'foo'",
      },
    ]);
  });

  it("is absent when the plugin has no eval directory", () => {
    expect(plan(greeter({})).evals).toBeUndefined();
  });

  it("follows experimental.evals, and records an unusable one without refusing", () => {
    const moved = plan(
      greeter(
        {
          "quality/evals/hi/prompt.md": "Hi.",
          "quality/evals/hi/graders/judge.md": JUDGE,
        },
        { experimental: { evals: "quality/evals" } },
      ),
    );
    expect(evalSuiteOf(moved.evals!)).toMatchObject({
      dir: "quality/evals",
      caseCount: 1,
    });
    expect(moved.warnings.map((w) => w.path)).not.toContain(
      ".claude-plugin/plugin.json#experimental.evals",
    );

    const unusable = plan(greeter({}, { experimental: { evals: "../up" } }));
    const suite = evalSuiteOf(unusable.evals!);
    expect(suite.dir).toBe("evals");
    expect(suite.caseCount).toBe(0);
    expect(suite.findings.map((f) => [f.kind, f.path])).toEqual([
      ["eval-dir-invalid", ".claude-plugin/plugin.json"],
    ]);
  });

  it("stores at most 200 cases and 50 findings, counting every case", () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 210; i += 1) {
      files[`evals/c${String(i).padStart(3, "0")}/prompt.md`] = "Hi.";
      files[`evals/c${String(i).padStart(3, "0")}/graders/judge.md`] = JUDGE;
    }
    for (let i = 0; i < 55; i += 1) {
      files[`evals/x${String(i).padStart(2, "0")}/prompt.md`] = "---\nfoo: 1\n---\nHi.";
      files[`evals/x${String(i).padStart(2, "0")}/graders/judge.md`] = JUDGE;
    }
    const suite = evalSuiteOf(plan(greeter(files)).evals!);
    expect(suite.caseCount).toBe(210);
    expect(suite.cases).toHaveLength(200);
    expect(suite.findings).toHaveLength(50);
  });

  it("is read from the files alone", () => {
    const files = inMemoryPluginFiles(
      greeter({
        "evals/hi/prompt.md": "Hi.",
        "evals/hi/graders/judge.md": JUDGE,
      }),
    );
    expect(planEvals(files)?.cases.map((c) => c.name)).toEqual(["hi"]);
  });
});
