// Pins the eval-run suites' fixtures, copy and follower
// (support/eval-runs.ts): the case layout the fixtures write reads back
// through the library's own suite reader (`readEvalSuite`, the reader the
// server's create and the eval run's workflow call) with the prompt, the
// frontmatter fields and every grader as written, a
// `context.scaffold_script` case's script read back from its case.yaml; a
// fresh eval run about a plugin runs its current version once per arm
// within ten dollars, and one about an agent its current version, the
// default cases, as the agent runs, carrying a compared plugin and case
// sources when given, the plugins' and then the Evals' at their versions; the agent fixture lists its plugins by slug and
// defers its delete; the follower reads past the phases it was not asked
// for and fails loudly, naming what it last read, once its budget is
// spent; `triesOf` walks the status in plugin, case, target and arm order;
// the copied refusal copy is the server's, byte for byte; install defers
// the plugin's delete and pushes at the visibility asked; cleanup cancels
// an eval run that may still run, waits for its end, then deletes it, and
// deletes a finished one at once. The clients are stubbed; nothing here
// starts a server.
import { create } from "@bufbuild/protobuf";
import { readEvalSuite } from "@stigmer/plugin-package";
import { inMemoryPluginFiles } from "@stigmer/plugin-package/testing";
import { EvalRunSchema } from "@stigmer/apis/ai/stigmer/agentic/evalrun/v1/api_pb";
import type { EvalRun } from "@stigmer/apis/ai/stigmer/agentic/evalrun/v1/api_pb";
import { EvalRunAblation } from "@stigmer/apis/ai/stigmer/agentic/evalrun/v1/spec_pb";
import { EvalRunPhase } from "@stigmer/apis/ai/stigmer/agentic/evalrun/v1/status_pb";
import { PluginSchema } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/api_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/apis/ai/stigmer/commons/apiresource/enum_pb";
import { describe, expect, it } from "vitest";
import type { ConformanceClients } from "../../harness/clients";
import { FixtureTracker } from "../../harness/fixtures";
import {
  EVAL_RUN_AGENT_DENIED_MESSAGE,
  EVAL_RUN_COMPARED_DENIED_MESSAGE,
  EVAL_RUN_NO_CASES_MESSAGE,
  EVAL_RUN_NO_CASE_SOURCES_MESSAGE,
  EVAL_RUN_NOT_STARTED_ERROR,
  EVAL_RUN_PLUGIN_DENIED_MESSAGE,
  PLUGIN_NOT_SELECTED_REASON,
  PLUGIN_NO_CASES_REASON,
  cancelAndDeleteEvalRun,
  casesOf,
  createAgentWith,
  evalCaseFiles,
  evalRunActiveDeleteMessage,
  evalRunActiveOnSubjectDeleteMessage,
  evalRunNoCasesMessage,
  evalRunNotCurrentVersionMessage,
  evalRunOrgMismatchMessage,
  evalRunOtherPluginToolMessage,
  evalRunTooLargeMessage,
  evalRunUnknownServerToolMessage,
  evalRunUnloadedCaseSourceMessage,
  evalRunUnreadableEvalMessage,
  followEvalRun,
  installPlugin,
  lastMessageGrader,
  makeEvalRun,
  skillFiredGrader,
  skillPluginWithEvals,
  timedOutError,
  triesOf,
  unsupportedFeatureReason,
  engineUnsupportedReason,
  NOT_STARTED_NO_MOCK,
} from "../eval-runs";

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

  it("reads a case's scaffold script from its case.yaml, and runs the case", () => {
    const scaffolded = suite.cases.find((c) => c.name === "needs-scaffold");
    expect(scaffolded?.context.scaffoldScript).toBe("fixture.sh");
    expect(scaffolded?.unsupported).toBeUndefined();
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

  it("writes each case at the root when the directory is empty, as a pushed Eval holds it", () => {
    const files = evalCaseFiles({ name: "c", prompt: "p", graders: [lastMessageGrader("g", "x")] }, "");
    expect([...files.keys()]).toEqual(["c/prompt.md", "c/graders/g.md"]);
  });
});

describe("the eval run fixture about a plugin", () => {
  it("runs the current version once per arm, within ten dollars, one try at a time", () => {
    expect(makeEvalRun({ org: "org_1", pluginId: "plg_1" })).toMatchObject({
      metadata: { org: "org_1" },
      spec: {
        subject: { case: "pluginId", value: "plg_1" },
        pluginDigest: "",
        targets: [],
        runs: 1,
        ablation: EvalRunAblation.with_without,
        maxCostUsd: 10,
        concurrency: 1,
        allowTools: [],
      },
    });
  });

  it("counts a suite past the limits as the server words it", () => {
    expect(evalRunTooLargeMessage(2, 1200)).toBe(
      "this eval run would run 2 cases and 1200 tries; an eval run runs at most 200 cases and 1000 tries: " +
        "narrow it with case_glob or case_tags, or lower runs or targets",
    );
  });
});

describe("the eval run fixture about an agent", () => {
  it("runs the agent's current version on the default cases, as the agent runs, comparing nothing, once per case, one try at a time, within ten dollars", () => {
    expect(makeEvalRun({ org: "org_1", agentId: "agt_1" })).toEqual({
      apiVersion: "agentic.stigmer.ai/v1",
      kind: "EvalRun",
      metadata: { org: "org_1" },
      spec: {
        subject: { case: "agentId", value: "agt_1" },
        agentVersion: "",
        comparedPluginId: "",
        cases: [],
        targets: [],
        runs: 1,
        ablation: EvalRunAblation.with_without,
        caseGlob: "",
        maxCostUsd: 10,
        concurrency: 1,
        allowTools: [],
        skipScaffold: false,
        judgeModel: "",
      },
    });
  });

  it("carries every option it is given", () => {
    const made = makeEvalRun({
      org: "org_1",
      agentId: "agt_1",
      agentVersion: "stable",
      comparedPluginId: "plg_notes",
      cases: [{ org: "org_1", slug: "notes" }],
      evals: [{ org: "org_1", slug: "support", version: "stable" }, { org: "org_1", slug: "smoke" }],
      runs: 3,
      caseGlob: "first",
      maxCostUsd: 0.01,
      concurrency: 2,
      allowTools: ["Skill"],
      name: "nightly",
    });
    expect(made.metadata).toEqual({ org: "org_1", name: "nightly" });
    expect(made.spec).toMatchObject({
      agentVersion: "stable",
      comparedPluginId: "plg_notes",
      cases: [
        { source: { case: "plugin", value: { org: "org_1", slug: "notes" } } },
        { source: { case: "eval", value: { kind: ApiResourceKind.eval, org: "org_1", slug: "support", version: "stable" } } },
        { source: { case: "eval", value: { kind: ApiResourceKind.eval, org: "org_1", slug: "smoke", version: "" } } },
      ],
      runs: 3,
      caseGlob: "first",
      maxCostUsd: 0.01,
      concurrency: 2,
      allowTools: ["Skill"],
    });
  });
});

describe("createAgentWith", () => {
  function agentClients(calls: string[], seen: unknown[]): ConformanceClients {
    return {
      agentCommand: {
        create: async (input: unknown) => {
          seen.push(input);
          calls.push("create");
          return { metadata: { id: "agt_1" } };
        },
        delete: async ({ value }: { value: string }) => {
          calls.push(`delete ${value}`);
          return {};
        },
      },
    } as unknown as ConformanceClients;
  }

  const plugins = [
    create(PluginSchema, { metadata: { slug: "notes" } }),
    create(PluginSchema, { metadata: { slug: "tracker" } }),
  ];

  it("lists the plugins by slug, in order, and defers the agent's delete", async () => {
    const calls: string[] = [];
    const seen: unknown[] = [];
    const fixtures = new FixtureTracker();
    const agent = await createAgentWith(agentClients(calls, seen), fixtures, "acme", plugins, {
      name: "desk",
      instructions: "Answer as the release desk.",
    });
    expect(agent.metadata?.id).toBe("agt_1");
    expect(seen[0]).toMatchObject({
      metadata: { org: "acme", name: "desk" },
      spec: {
        instructions: "Answer as the release desk.",
        plugins: [
          { slug: "notes", kind: ApiResourceKind.plugin },
          { slug: "tracker", kind: ApiResourceKind.plugin },
        ],
      },
    });
    expect((seen[0] as { metadata: Record<string, unknown> }).metadata).not.toHaveProperty("visibility");
    await fixtures.cleanup();
    expect(calls).toEqual(["create", "delete agt_1"]);
  });

  it("saves at the visibility it is given", async () => {
    const seen: unknown[] = [];
    await createAgentWith(agentClients([], seen), new FixtureTracker(), "acme", plugins, {
      name: "desk",
      visibility: ApiResourceVisibility.visibility_private,
    });
    expect(seen[0]).toMatchObject({ metadata: { visibility: ApiResourceVisibility.visibility_private } });
  });
});

function evalAt(phase: EvalRunPhase): EvalRun {
  return create(EvalRunSchema, {
    metadata: { id: "evr_1" },
    status: { phase, triesTotal: 2, triesFinished: 1 },
  });
}

function getting(pages: EvalRun[]): ConformanceClients {
  let calls = 0;
  return {
    evalRunQuery: {
      get: async () => {
        const page = pages[Math.min(calls, pages.length - 1)]!;
        calls += 1;
        return page;
      },
    },
  } as unknown as ConformanceClients;
}

describe("followEvalRun", () => {
  it("reads past the phases it was not asked for", async () => {
    const seen = await followEvalRun(
      getting([
        evalAt(EvalRunPhase.pending),
        evalAt(EvalRunPhase.running),
        evalAt(EvalRunPhase.completed),
      ]),
      "evr_1",
      (e) => e.status?.phase === EvalRunPhase.completed,
      "completed",
      5_000,
    );
    expect(seen.status?.phase).toBe(EvalRunPhase.completed);
  });

  it("fails loudly once its budget is spent, naming what it last read", async () => {
    await expect(
      followEvalRun(
        getting([evalAt(EvalRunPhase.running)]),
        "evr_1",
        () => false,
        "an end",
        0,
      ),
    ).rejects.toThrow(
      "eval run evr_1 did not reach an end within 0 ms; last read: phase running, tries 1/2",
    );
  });

  it("names the eval run's error in that message when it has one", async () => {
    const failed = evalAt(EvalRunPhase.failed);
    failed.status!.error = "the eval run's workflow could not be started";
    await expect(
      followEvalRun(getting([failed]), "evr_1", () => false, "a try", 0),
    ).rejects.toThrow(
      'last read: phase failed, tries 1/2, error "the eval run\'s workflow could not be started"',
    );
  });
});

describe("triesOf", () => {
  it("walks the status in plugin, case, target and arm order, past a plugin whose cases did not run", () => {
    const evalRun = create(EvalRunSchema, {
      status: {
        plugins: [
          {
            pluginSlug: "notes",
            cases: [
              {
                caseName: "a",
                targets: [
                  { withPlugin: { tries: [{ index: 1 }, { index: 2 }] }, withoutPlugin: { tries: [{ index: 1 }] } },
                  { withPlugin: { tries: [{ index: 1 }] } },
                ],
              },
              { caseName: "b", notRunReason: "not run: plugins" },
            ],
          },
          { pluginSlug: "style", notRunReason: PLUGIN_NOT_SELECTED_REASON },
          { pluginSlug: "tracker", cases: [{ caseName: "c", targets: [{ withPlugin: { tries: [{ index: 1 }] } }] }] },
        ],
      },
    });
    expect(
      triesOf(evalRun).map((t) => `${t.pluginSlug}/${t.caseName}/${t.targetIndex}/${t.arm}/${t.attempt.index}`),
    ).toEqual(["notes/a/0/with/1", "notes/a/0/with/2", "notes/a/0/without/1", "notes/a/1/with/1", "tracker/c/0/with/1"]);
  });
});

describe("casesOf", () => {
  it("reads the cases of an eval run's one plugin, and none before its status lists one", () => {
    const evalRun = create(EvalRunSchema, {
      status: { plugins: [{ pluginSlug: "notes", cases: [{ caseName: "a" }, { caseName: "b" }] }] },
    });
    expect(casesOf(evalRun).map((c) => c.caseName)).toEqual(["a", "b"]);
    expect(casesOf(create(EvalRunSchema, {}))).toEqual([]);
  });
});

describe("the copy the suites assert", () => {
  it("is the server's refusal and status copy, byte for byte", () => {
    expect(EVAL_RUN_AGENT_DENIED_MESSAGE).toBe("unauthorized to run evals of agent");
    expect(EVAL_RUN_PLUGIN_DENIED_MESSAGE).toBe("unauthorized to run evals of plugin");
    expect(EVAL_RUN_COMPARED_DENIED_MESSAGE).toBe("unauthorized to compare a plugin you cannot view");
    expect(evalRunOrgMismatchMessage("plugin", "acme")).toBe("metadata.org must be the plugin's organization (acme)");
    expect(evalRunOrgMismatchMessage("agent", "acme")).toBe("metadata.org must be the agent's organization (acme)");
    expect(evalRunNotCurrentVersionMessage("abc")).toBe(
      "an eval run evaluates the plugin's current version (abc); evaluating an earlier version is not supported yet",
    );
    expect(evalRunNoCasesMessage("evals")).toBe(
      "this plugin version has no eval cases: add a case directory under evals/ holding a prompt.md or a case.yaml",
    );
    expect(EVAL_RUN_NO_CASE_SOURCES_MESSAGE).toBe(
      "this agent version attaches no plugin, and the eval run compares none and names no eval: run an eval with --eval, attach a plugin with eval cases, or compare one with --plugin",
    );
    expect(EVAL_RUN_NO_CASES_MESSAGE).toBe(
      "none of the plugins whose cases this eval run runs has eval cases at the version it runs",
    );
    expect(evalRunUnloadedCaseSourceMessage("notes")).toBe(
      "spec.cases names plugin 'notes', which this agent version does not attach and the eval run does not compare: a case runs with the plugin it was written for",
    );
    expect(evalRunUnreadableEvalMessage("support")).toBe(
      "spec.cases names eval 'support', which is not an eval of the agent's organization you can view",
    );
    expect(evalRunActiveDeleteMessage("evr_1")).toBe("eval run evr_1 is still running: cancel it first, then delete it");
    expect(evalRunActiveOnSubjectDeleteMessage("agent", "evr_1")).toBe(
      "this agent has a running eval run (evr_1): cancel it first, then delete the agent",
    );
    expect(evalRunOtherPluginToolMessage("mcp__plugin_x_a__*", "plugin_x_a")).toBe(
      "allow_tools entry 'mcp__plugin_x_a__*' names MCP server 'plugin_x_a', which is none of the plugins a try loads",
    );
    expect(evalRunUnknownServerToolMessage("mcp__x__*", "x")).toBe(
      "allow_tools entry 'mcp__x__*' names MCP server 'x', which is none of the servers the agent or its subagents write",
    );
    expect(EVAL_RUN_NOT_STARTED_ERROR).toBe("the eval run's workflow could not be started");
    expect(PLUGIN_NOT_SELECTED_REASON).toBe("not selected");
    expect(PLUGIN_NO_CASES_REASON).toBe("no eval cases at this version");
    expect(unsupportedFeatureReason("plugins")).toBe("not run: plugins");
    expect(engineUnsupportedReason("Cursor", "env")).toBe("not run on Cursor: env");
    expect(NOT_STARTED_NO_MOCK).toBe("not started: no mock");
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

describe("cancelAndDeleteEvalRun", () => {
  function cleanupClients(pages: EvalRun[]): {
    clients: ConformanceClients;
    calls: string[];
  } {
    const calls: string[] = [];
    let reads = 0;
    const clients = {
      evalRunQuery: {
        get: async () => {
          const page = pages[Math.min(reads, pages.length - 1)]!;
          reads += 1;
          return page;
        },
      },
      evalRunCommand: {
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

  it("cancels an eval run that may still run, waits for its end, then deletes it", async () => {
    const { clients, calls } = cleanupClients([
      evalAt(EvalRunPhase.running),
      evalAt(EvalRunPhase.partial),
    ]);
    await cancelAndDeleteEvalRun(clients, "evr_1");
    expect(calls).toEqual(["cancel", "delete"]);
  });

  it("deletes a finished eval run at once", async () => {
    const { clients, calls } = cleanupClients([
      evalAt(EvalRunPhase.completed),
    ]);
    await cancelAndDeleteEvalRun(clients, "evr_1");
    expect(calls).toEqual(["delete"]);
  });
});
