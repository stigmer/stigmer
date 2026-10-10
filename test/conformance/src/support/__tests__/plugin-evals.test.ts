// Pins the plugin-eval suites' fixtures, copy and follower
// (support/plugin-evals.ts): the case layout the fixtures write reads back
// through the library's own suite reader (`readEvalSuite`, the reader the
// server's create and the eval's workflow call) with the prompt, the
// frontmatter fields and every grader as written, a `context.scaffold_script`
// case named unsupported; a fresh eval runs the current version once per
// arm within ten dollars; the follower reads past the phases it was not
// asked for and fails loudly, naming what it last read, once its budget is
// spent; `triesOf` walks the status in case, target and arm order; the
// copied refusal copy is the server's, byte for byte; install defers the
// plugin's delete and pushes at the visibility asked; cleanup cancels an eval that may still run, waits for its
// end, then deletes it, and deletes a finished one at once. The
// clients are stubbed; nothing here starts a server.
import { create } from "@bufbuild/protobuf";
import { readEvalSuite } from "@stigmer/plugin-package";
import { inMemoryPluginFiles } from "@stigmer/plugin-package/testing";
import { PluginEvalSchema } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/api_pb";
import type { PluginEval } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/api_pb";
import { PluginEvalAblation } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/spec_pb";
import { PluginEvalPhase } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/status_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { describe, expect, it } from "vitest";
import type { ConformanceClients } from "../../harness/clients";
import { FixtureTracker } from "../../harness/fixtures";
import {
  cancelAndDeletePluginEval,
  evalCaseFiles,
  followPluginEval,
  installPlugin,
  lastMessageGrader,
  makePluginEval,
  pluginEvalActiveDeleteMessage,
  pluginEvalNoCasesMessage,
  pluginEvalNotStartedMessage,
  pluginEvalOrgMismatchMessage,
  pluginEvalOtherPluginToolMessage,
  pluginEvalTooLargeMessage,
  pluginEvalNotCurrentVersionMessage,
  skillFiredGrader,
  skillPluginWithEvals,
  timedOutError,
  triesOf,
  unsupportedFeatureReason,
} from "../plugin-evals";

describe("the suite layout", () => {
  const fixture = skillPluginWithEvals("notes", {
    skill: "release-notes",
    cases: [
      {
        name: "writes-notes",
        prompt: "Write release notes for: renamed getUser to fetchUser.",
        frontmatter: {
          runs: 2,
          allowed_tools: ["Read", "Skill"],
          timeout_seconds: 30,
        },
        graders: [
          skillFiredGrader("release-notes"),
          lastMessageGrader("says-done", "DONE"),
        ],
      },
      {
        name: "needs-scaffold",
        prompt: "Summarise the repository.",
        caseYaml: {
          schema_version: "1.1",
          name: "needs-scaffold",
          context: { scaffold_script: "fixture.sh" },
        },
        graders: [
          {
            name: "criteria",
            frontmatter: { type: "llm" },
            body: "PASS if it summarises.",
          },
        ],
        files: { "fixture.sh": "#!/bin/bash\ntouch README.md\n" },
      },
    ],
  });
  const suite = readEvalSuite(inMemoryPluginFiles(fixture));

  it("reads back through the library's suite reader with no finding", () => {
    expect(suite.findings).toEqual([]);
    expect(suite.dir).toBe("evals");
    expect(suite.cases.map((c) => c.name)).toEqual([
      "needs-scaffold",
      "writes-notes",
    ]);
  });

  it("keeps the prompt, the frontmatter fields and every grader as written", () => {
    const writes = suite.cases.find((c) => c.name === "writes-notes");
    expect(writes?.prompt.trim()).toBe(
      "Write release notes for: renamed getUser to fetchUser.",
    );
    expect(writes?.runs).toBe(2);
    expect(writes?.timeoutSeconds).toBe(30);
    expect(writes?.allowedTools).toEqual(["Read", "Skill"]);
    expect(writes?.graders.map((g) => [g.name, g.check.type])).toEqual([
      ["says-done", "regex"],
      ["skill-fired", "tool_used"],
    ]);
    const fired = writes?.graders.find((g) => g.name === "skill-fired")?.check;
    expect(
      fired?.type === "tool_used" &&
        new RegExp(fired.inputMatch ?? "").test(
          '{"skill":"notes:release-notes"}',
        ),
    ).toBe(true);
    expect(writes?.unsupported).toBeUndefined();
  });

  it("names a case that needs a scaffold script unsupported", () => {
    expect(
      suite.cases.find((c) => c.name === "needs-scaffold")?.unsupported,
    ).toBe("context.scaffold_script");
  });

  it("writes each case under the directory it is given", () => {
    const files = evalCaseFiles(
      { name: "c", prompt: "p", graders: [lastMessageGrader("g", "x")] },
      "quality/evals",
    );
    expect([...files.keys()]).toEqual([
      "quality/evals/c/prompt.md",
      "quality/evals/c/graders/g.md",
    ]);
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
  return create(PluginEvalSchema, {
    metadata: { id: "pev_1" },
    status: { phase, triesTotal: 2, triesFinished: 1 },
  });
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
      getting([
        evalAt(PluginEvalPhase.pending),
        evalAt(PluginEvalPhase.running),
        evalAt(PluginEvalPhase.completed),
      ]),
      "pev_1",
      (e) => e.status?.phase === PluginEvalPhase.completed,
      "completed",
      5_000,
    );
    expect(seen.status?.phase).toBe(PluginEvalPhase.completed);
  });

  it("fails loudly once its budget is spent, naming what it last read", async () => {
    await expect(
      followPluginEval(
        getting([evalAt(PluginEvalPhase.running)]),
        "pev_1",
        () => false,
        "an end",
        0,
      ),
    ).rejects.toThrow(
      "plugin eval pev_1 did not reach an end within 0 ms; last read: phase running, tries 1/2",
    );
  });

  it("names the eval's error in that message when it has one", async () => {
    const failed = evalAt(PluginEvalPhase.failed);
    failed.status!.error = "the eval could not start: no engine connection";
    await expect(
      followPluginEval(getting([failed]), "pev_1", () => false, "a try", 0),
    ).rejects.toThrow(
      'last read: phase failed, tries 1/2, error "the eval could not start: no engine connection"',
    );
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
    expect(
      triesOf(pluginEval).map(
        (t) => `${t.caseName}/${t.targetIndex}/${t.arm}/${t.attempt.index}`,
      ),
    ).toEqual(["a/0/with/1", "a/0/with/2", "a/0/without/1"]);
  });
});

describe("the copy the suites assert", () => {
  it("is the server's refusal and status copy, byte for byte", () => {
    expect(pluginEvalOrgMismatchMessage("acme")).toBe(
      "metadata.org must be the plugin's organization (acme)",
    );
    expect(pluginEvalNotCurrentVersionMessage("abc")).toBe(
      "an eval runs the plugin's current version (abc); evaluating an earlier version is not supported yet",
    );
    expect(pluginEvalNoCasesMessage("evals")).toBe(
      "this plugin version has no eval cases: add a case directory under evals/ holding a prompt.md or a case.yaml",
    );
    expect(pluginEvalActiveDeleteMessage("pev_1")).toBe(
      "plugin eval pev_1 is still running: cancel it first, then delete it",
    );
    expect(
      pluginEvalOtherPluginToolMessage("mcp__plugin_x_a__*", "x", "notes"),
    ).toBe(
      "allow_tools entry 'mcp__plugin_x_a__*' names plugin 'x', but this eval runs 'notes'; a try attaches no other plugin",
    );
    expect(pluginEvalNotStartedMessage("no engine connection")).toBe(
      "the eval could not start: no engine connection",
    );
    expect(unsupportedFeatureReason("context.scaffold_script")).toBe(
      "not run: context.scaffold_script",
    );
    expect(timedOutError(30)).toBe("timed out after 30s");
  });
});

describe("installPlugin", () => {
  it("pushes the fixture's archive into the organization and defers the plugin's delete", async () => {
    const calls: string[] = [];
    const clients = {
      pluginCommand: {
        push: async ({ org }: { org: string }) => {
          calls.push(`push ${org}`);
          return { metadata: { id: "plg_1" } };
        },
        delete: async ({ value }: { value: string }) => {
          calls.push(`delete ${value}`);
          return {};
        },
      },
    } as unknown as ConformanceClients;
    const fixtures = new FixtureTracker();
    const plugin = await installPlugin(
      clients,
      fixtures,
      "acme",
      skillPluginWithEvals("notes", { skill: "s", cases: [] }),
    );
    expect(plugin.metadata?.id).toBe("plg_1");
    expect(calls).toEqual(["push acme"]);
    await fixtures.cleanup();
    expect(calls).toEqual(["push acme", "delete plg_1"]);
  });

  it("pushes at the visibility it is given", async () => {
    const calls: string[] = [];
    const clients = {
      pluginCommand: {
        push: async ({
          org,
          visibility,
        }: {
          org: string;
          visibility?: ApiResourceVisibility;
        }) => {
          calls.push(`push ${org} at ${visibility}`);
          return { metadata: { id: "plg_2" } };
        },
        delete: async () => ({}),
      },
    } as unknown as ConformanceClients;
    await installPlugin(
      clients,
      new FixtureTracker(),
      "acme",
      skillPluginWithEvals("notes", { skill: "s", cases: [] }),
      ApiResourceVisibility.visibility_private,
    );
    expect(calls).toEqual([
      `push acme at ${ApiResourceVisibility.visibility_private}`,
    ]);
  });
});

describe("cancelAndDeletePluginEval", () => {
  function cleanupClients(pages: PluginEval[]): {
    clients: ConformanceClients;
    calls: string[];
  } {
    const calls: string[] = [];
    let reads = 0;
    const clients = {
      pluginEvalQuery: {
        get: async () => {
          const page = pages[Math.min(reads, pages.length - 1)]!;
          reads += 1;
          return page;
        },
      },
      pluginEvalCommand: {
        cancel: async () => {
          calls.push("cancel");
          return {};
        },
        delete: async () => {
          calls.push("delete");
          return {};
        },
      },
    } as unknown as ConformanceClients;
    return { clients, calls };
  }

  it("cancels an eval that may still run, waits for its end, then deletes it", async () => {
    const { clients, calls } = cleanupClients([
      evalAt(PluginEvalPhase.running),
      evalAt(PluginEvalPhase.partial),
    ]);
    await cancelAndDeletePluginEval(clients, "pev_1");
    expect(calls).toEqual(["cancel", "delete"]);
  });

  it("deletes a finished eval at once", async () => {
    const { clients, calls } = cleanupClients([
      evalAt(PluginEvalPhase.completed),
    ]);
    await cancelAndDeletePluginEval(clients, "pev_1");
    expect(calls).toEqual(["delete"]);
  });
});
