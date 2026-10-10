// Pins the plugin-eval suites' fixtures, copy and follower
// (support/plugin-evals.ts): the case layout the fixtures write reads back
// through the library's own suite reader (`readEvalSuite`, the reader the
// server's create and the eval's workflow call) with the prompt, the
// frontmatter fields and every grader as written, a `context.scaffold_script`
// case named unsupported; a fresh eval runs the current version once per
// arm within ten dollars; the follower reads past the phases it was not
// asked for and fails loudly, naming what it last read, once its budget is
// spent; `triesOf` walks the status in case, target and arm order. The
// clients are stubbed; nothing here starts a server.
import { create } from "@bufbuild/protobuf";
import { readEvalSuite } from "@stigmer/plugin-package";
import { inMemoryPluginFiles } from "@stigmer/plugin-package/testing";
import { PluginEvalSchema } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/api_pb";
import type { PluginEval } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/api_pb";
import { PluginEvalAblation } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/spec_pb";
import { PluginEvalPhase } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/status_pb";
import { describe, expect, it } from "vitest";
import type { ConformanceClients } from "../../harness/clients";
import {
  evalCaseFiles,
  followPluginEval,
  lastMessageGrader,
  makePluginEval,
  pluginEvalTooLargeMessage,
  skillFiredGrader,
  skillPluginWithEvals,
  triesOf,
} from "../plugin-evals";

describe("the suite layout", () => {
  const fixture = skillPluginWithEvals("notes", {
    skill: "release-notes",
    cases: [
      {
        name: "writes-notes",
        prompt: "Write release notes for: renamed getUser to fetchUser.",
        frontmatter: { runs: 2, allowed_tools: ["Read", "Skill"], timeout_seconds: 30 },
        graders: [skillFiredGrader("release-notes"), lastMessageGrader("says-done", "DONE")],
      },
      {
        name: "needs-scaffold",
        prompt: "Summarise the repository.",
        caseYaml: { schema_version: "1.1", name: "needs-scaffold", context: { scaffold_script: "fixture.sh" } },
        graders: [{ name: "criteria", frontmatter: { type: "llm" }, body: "PASS if it summarises." }],
        files: { "fixture.sh": "#!/bin/bash\ntouch README.md\n" },
      },
    ],
  });
  const suite = readEvalSuite(inMemoryPluginFiles(fixture));

  it("reads back through the library's suite reader with no finding", () => {
    expect(suite.findings).toEqual([]);
    expect(suite.dir).toBe("evals");
    expect(suite.cases.map((c) => c.name)).toEqual(["needs-scaffold", "writes-notes"]);
  });

  it("keeps the prompt, the frontmatter fields and every grader as written", () => {
    const writes = suite.cases.find((c) => c.name === "writes-notes");
    expect(writes?.prompt.trim()).toBe("Write release notes for: renamed getUser to fetchUser.");
    expect(writes?.runs).toBe(2);
    expect(writes?.timeoutSeconds).toBe(30);
    expect(writes?.allowedTools).toEqual(["Read", "Skill"]);
    expect(writes?.graders.map((g) => [g.name, g.check.type])).toEqual([
      ["says-done", "regex"],
      ["skill-fired", "tool_used"],
    ]);
    const fired = writes?.graders.find((g) => g.name === "skill-fired")?.check;
    expect(fired?.type === "tool_used" && new RegExp(fired.inputMatch ?? "").test('{"skill":"notes:release-notes"}')).toBe(
      true,
    );
    expect(writes?.unsupported).toBeUndefined();
  });

  it("names a case that needs a scaffold script unsupported", () => {
    expect(suite.cases.find((c) => c.name === "needs-scaffold")?.unsupported).toBe("context.scaffold_script");
  });

  it("writes each case under the directory it is given", () => {
    const files = evalCaseFiles({ name: "c", prompt: "p", graders: [lastMessageGrader("g", "x")] }, "quality/evals");
    expect([...files.keys()]).toEqual(["quality/evals/c/prompt.md", "quality/evals/c/graders/g.md"]);
  });
});

describe("the eval fixture", () => {
  it("runs the current version once per arm, within ten dollars, one try at a time", () => {
    expect(makePluginEval({ org: "org_1", pluginId: "plg_1" })).toMatchObject({
      metadata: { org: "org_1" },
      spec: {
        pluginId: "plg_1",
        pluginDigest: "",
        targets: [],
        runs: 1,
        ablation: PluginEvalAblation.with_without,
        maxCostUsd: 10,
        concurrency: 1,
        allowTools: [],
      },
    });
  });

  it("counts a suite past the limits as the server words it", () => {
    expect(pluginEvalTooLargeMessage(2, 1200)).toBe(
      "this eval would run 2 cases and 1200 tries; an eval runs at most 200 cases and 1000 tries: " +
        "narrow it with case_glob or case_tags, or lower runs or targets",
    );
  });
});

function evalAt(phase: PluginEvalPhase): PluginEval {
  return create(PluginEvalSchema, { metadata: { id: "pev_1" }, status: { phase, triesTotal: 2, triesFinished: 1 } });
}

function getting(pages: PluginEval[]): ConformanceClients {
  let calls = 0;
  return {
    pluginEvalQuery: {
      get: async () => {
        const page = pages[Math.min(calls, pages.length - 1)]!;
        calls += 1;
        return page;
      },
    },
  } as unknown as ConformanceClients;
}

describe("followPluginEval", () => {
  it("reads past the phases it was not asked for", async () => {
    const seen = await followPluginEval(
      getting([evalAt(PluginEvalPhase.pending), evalAt(PluginEvalPhase.running), evalAt(PluginEvalPhase.completed)]),
      "pev_1",
      (e) => e.status?.phase === PluginEvalPhase.completed,
      "completed",
      5_000,
    );
    expect(seen.status?.phase).toBe(PluginEvalPhase.completed);
  });

  it("fails loudly once its budget is spent, naming what it last read", async () => {
    await expect(
      followPluginEval(getting([evalAt(PluginEvalPhase.running)]), "pev_1", () => false, "an end", 0),
    ).rejects.toThrow("plugin eval pev_1 did not reach an end within 0 ms; last read: phase running, tries 1/2");
  });
});

describe("triesOf", () => {
  it("walks the status in case, target and arm order", () => {
    const pluginEval = create(PluginEvalSchema, {
      status: {
        cases: [
          {
            caseName: "a",
            targets: [
              {
                withPlugin: { tries: [{ index: 1 }, { index: 2 }] },
                withoutPlugin: { tries: [{ index: 1 }] },
              },
            ],
          },
          { caseName: "b", notRunReason: "not run: context.scaffold_script" },
        ],
      },
    });
    expect(triesOf(pluginEval).map((t) => `${t.caseName}/${t.targetIndex}/${t.arm}/${t.attempt.index}`)).toEqual([
      "a/0/with/1",
      "a/0/with/2",
      "a/0/without/1",
    ]);
  });
});
