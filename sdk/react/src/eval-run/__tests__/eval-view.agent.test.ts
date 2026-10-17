/**
 * Pins the Evals tab's pure rules on an eval run about an agent: the form
 * starts on the agent as it runs with every attached plugin's cases and no
 * plugin compared, refuses what the API refuses (the shared run limits, no
 * plugin whose cases run, a tool name outside the API's pattern, too many
 * tags, a tag over 64 characters), and becomes an unnamed create input
 * that names no case source when they are the default (every attached
 * plugin, or the compared plugin alone) and the picked ones otherwise,
 * with the compared plugin and the comparison's ablation when one is
 * compared; an Eval picked runs too, named after the plugins as an
 * `eval` source in the agent's organization, and an Eval alone is enough
 * to run; an eval run's label is the agent version it ran, short, the
 * plugin it compared, and when it started; its results are one section
 * per plugin with that plugin's rows, the compared one marked, then one
 * per Eval; and two eval runs compare plugin by plugin, then Eval by Eval,
 * case by case, marking a source whose digest differs and keeping one only
 * one of them had, an Eval never matched with a plugin of its slug.
 */
import { describe, expect, it } from "vitest";
import { Harness } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";
import { EvalRunAblation } from "@stigmer/apis/ai/stigmer/agentic/evalrun/v1/spec_pb";
import {
  compareEvalRuns,
  evalFormForAgent,
  evalFormProblem,
  evalRunInputOf,
  evalRunLabelOf,
  evalRunSectionsOf,
  parseCaseTags,
  shortDigest,
  shortVersion,
  type EvalFormSettings,
} from "../eval-view";
import { agentEvalRunWith, digestOf, evalStartOf } from "./eval-fixture.agent";

const AGENT = { kind: "agent", id: "agt_1", org: "org_acme" } as const;

function evalRunFormProblem(settings: EvalFormSettings): string | null {
  return evalFormProblem(settings, "agent");
}
const ATTACHED = ["thermos", "linter"];

describe("the Run evals form on an agent", () => {
  it("starts on the agent as it runs, each case's own tries, $5, one at a time, every plugin", () => {
    const form = evalFormForAgent(ATTACHED);
    expect(form).toMatchObject({
      caseModels: true,
      runs: 0,
      maxCostUsd: 5,
      concurrency: 1,
      caseSources: ATTACHED,
      comparedPluginId: "",
      caseGlob: "",
      caseTags: [],
      allowTools: [],
    });
    expect(evalRunFormProblem(form)).toBeNull();
  });

  it("refuses what the API refuses, in a sentence", () => {
    const form = evalFormForAgent(ATTACHED);
    expect(evalRunFormProblem({ ...form, runs: 51 })).toMatch(/1 to 50/);
    expect(evalRunFormProblem({ ...form, caseSources: [] })).toBe(
      "Pick at least one plugin or eval whose cases run.",
    );
    expect(
      evalRunFormProblem({ ...form, caseSources: [], evalSources: ["support-evals"] }),
    ).toBeNull();
    expect(evalRunFormProblem({ ...form, allowTools: ["skill"] })).toMatch(
      /'skill' is not a tool name/,
    );
    expect(
      evalRunFormProblem({
        ...form,
        caseTags: Array.from({ length: 33 }, (_, i) => `t${i}`),
      }),
    ).toMatch(/at most 32 tags/);
    expect(
      evalRunFormProblem({ ...form, caseGlob: "x".repeat(257) }),
    ).toMatch(/longer than 256/);
    expect(
      evalRunFormProblem({ ...form, caseTags: ["smoke", "t".repeat(65)] }),
    ).toBe("A tag is longer than 64 characters.");
    expect(
      evalRunFormProblem({ ...form, caseTags: ["t".repeat(64)] }),
    ).toBeNull();
  });

  it("names no case source when every attached plugin is picked, so the eval run runs every one the agent attaches", () => {
    const input = evalRunInputOf(
      AGENT,
      { ...evalFormForAgent(ATTACHED), allowTools: ["Skill", "Agent"] },
      ATTACHED,
    );
    expect(input).toEqual({
      name: "",
      org: "org_acme",
      agentId: "agt_1",
      cases: [],
      targets: [],
      runs: 0,
      maxCostUsd: 5,
      concurrency: 1,
      caseGlob: "",
      caseTags: [],
      allowTools: ["Skill", "Agent"],
    });
  });

  it("names the picked plugins in the agent's order, the models picked, and the case filters", () => {
    const input = evalRunInputOf(
      AGENT,
      {
        ...evalFormForAgent(ATTACHED),
        caseSources: ["linter"],
        caseModels: false,
        targets: [{ harness: "cursor", modelName: "gpt-5" }],
        caseGlob: " review-* ",
        caseTags: parseCaseTags("smoke, , fast"),
      },
      ATTACHED,
    );
    expect(input).toMatchObject({
      cases: [{ plugin: { org: "org_acme", slug: "linter" } }],
      targets: [{ harness: Harness.CURSOR, modelName: "gpt-5" }],
      caseGlob: "review-*",
      caseTags: ["smoke", "fast"],
    });
  });
});

describe("an Eval's cases on an agent", () => {
  it("names every plugin picked, then each Eval picked, once an Eval is picked", () => {
    const input = evalRunInputOf(
      AGENT,
      { ...evalFormForAgent(ATTACHED), evalSources: ["support-evals", "refunds"] },
      ATTACHED,
    );
    expect(input.cases).toEqual([
      { plugin: { org: "org_acme", slug: "thermos" } },
      { plugin: { org: "org_acme", slug: "linter" } },
      { eval: { org: "org_acme", slug: "support-evals" } },
      { eval: { org: "org_acme", slug: "refunds" } },
    ]);
  });

  it("runs an Eval alone when no plugin is picked", () => {
    const input = evalRunInputOf(
      AGENT,
      { ...evalFormForAgent([]), evalSources: ["support-evals"] },
      [],
    );
    expect(input.cases).toEqual([{ eval: { org: "org_acme", slug: "support-evals" } }]);
  });
});

describe("comparing a plugin on an agent", () => {
  it("sends the compared plugin, the comparison as the ablation, and no case source when the compared plugin's cases run", () => {
    const form: EvalFormSettings = {
      ...evalFormForAgent(["refund-policy"]),
      comparedPluginId: "plg_refund",
      compare: false,
    };
    const input = evalRunInputOf(AGENT, form, ["refund-policy"]);
    expect(input).toMatchObject({
      agentId: "agt_1",
      comparedPluginId: "plg_refund",
      ablation: EvalRunAblation.none,
      cases: [],
    });
    expect(evalRunInputOf(AGENT, evalFormForAgent(ATTACHED), ATTACHED)).not.toHaveProperty("comparedPluginId");
  });

  it("labels the eval run with the plugin compared, and marks it in its section", () => {
    const evalRun = agentEvalRunWith(
      [
        { slug: "thermos", cases: [{ name: "a", score: 1 }] },
        { slug: "refund-policy", attached: false, cases: [{ name: "b", score: 1 }] },
      ],
      { id: "evr_4", version: "abcdef0123456789", compared: "refund-policy" },
    );
    expect(evalRunLabelOf(evalRun, "", (at) => at.toISOString())).toBe(
      `Version abcdef01 with and without refund-policy · started ${evalStartOf("evr_4").toISOString()}`,
    );
    expect(evalRunSectionsOf(evalRun).map((section) => [section.slug, section.compared, section.attached])).toEqual([
      ["thermos", false, true],
      ["refund-policy", true, false],
    ]);
  });
});

describe("an eval run about an agent: its label and sections", () => {
  it("is the agent version it ran, short, and when it started", () => {
    const evalRun = agentEvalRunWith([], { id: "evr_3", version: "abcdef0123456789" });
    expect(evalRunLabelOf(evalRun)).toBe(
      `Version abcdef01 · started ${evalStartOf("evr_3").toLocaleString()}`,
    );
    expect(shortVersion("")).toBe("current");
    expect(shortDigest(digestOf("9f"))).toBe("9f0000000000");
    expect(shortDigest("")).toBe("—");
  });

  it("reads one section per plugin with its one-arm rows, and a plugin not run with its reason", () => {
    const sections = evalRunSectionsOf(
      agentEvalRunWith([
        { slug: "thermos", cases: [{ name: "review-fires", score: 1 }] },
        { slug: "linter", notRun: "no eval cases at this version" },
      ]),
    );
    expect(sections.map((section) => [section.slug, section.notRun])).toEqual([
      ["thermos", ""],
      ["linter", "no eval cases at this version"],
    ]);
    const [thermos] = sections;
    expect(thermos!.labels).toEqual(["native/claude-sonnet-4-6"]);
    expect(thermos!.rows[0]!.cells[0]).toMatchObject({
      withScore: 1,
      withoutScore: undefined,
      delta: undefined,
    });
    expect(thermos!.rows[0]!.cells[0]!.tries.map((t) => t.summary)).toEqual([
      "1.00",
      "not graded: platform busy",
    ]);
    expect(sections[1]!.rows).toEqual([]);
  });
});

describe("an eval run with Evals about an agent", () => {
  it("reads a section per Eval after the plugins, marked as an Eval and never compared", () => {
    const sections = evalRunSectionsOf(
      agentEvalRunWith([{ slug: "thermos", cases: [{ name: "a", score: 1 }] }], {
        evals: [
          { slug: "support-evals", digest: digestOf("5e"), cases: [{ name: "refund-window", score: 0 }] },
          { slug: "retired-evals", notRun: "the Eval was deleted" },
        ],
      }),
    );
    expect(
      sections.map((section) => [section.kind, section.pluginId, section.slug, section.notRun]),
    ).toEqual([
      ["plugin", "plg_1", "thermos", ""],
      ["eval", "evs_1", "support-evals", ""],
      ["eval", "evs_2", "retired-evals", "the Eval was deleted"],
    ]);
    expect(sections[1]).toMatchObject({
      digest: digestOf("5e"),
      attached: false,
      compared: false,
      casesPassed: 0,
      casesTotal: 1,
      labels: ["native/claude-sonnet-4-6"],
    });
    expect(sections[1]!.rows.map((row) => row.name)).toEqual(["refund-window"]);
  });

  it("compares Evals after the plugins, never matching an Eval with a plugin of its slug", () => {
    const before = agentEvalRunWith([{ slug: "support", cases: [{ name: "a", score: 1 }] }], {
      id: "evr_1",
      evals: [
        { slug: "support", digest: digestOf("aa"), cases: [{ name: "e", score: 1 }] },
        { slug: "gone", cases: [{ name: "g", score: 1 }] },
      ],
    });
    const after = agentEvalRunWith([{ slug: "support", cases: [{ name: "a", score: 1 }] }], {
      id: "evr_2",
      evals: [{ slug: "support", digest: digestOf("bb"), cases: [{ name: "e", score: 0 }] }],
    });
    const sections = compareEvalRuns(before, after);
    expect(
      sections.map((section) => [section.kind, section.slug, section.digestChanged]),
    ).toEqual([
      ["plugin", "support", false],
      ["eval", "support", true],
      ["eval", "gone", false],
    ]);
    expect(sections[1]!.rows.map((row) => [row.name, row.changed])).toEqual([["e", true]]);
    expect(sections[2]).toMatchObject({ afterDigest: null, beforeNotRun: "", afterNotRun: "" });
  });
});

describe("compareEvalRuns on an agent", () => {
  it("lines two eval runs up plugin by plugin and case by case, marking a plugin whose version changed", () => {
    const before = agentEvalRunWith(
      [
        { slug: "thermos", digest: digestOf("aa"), cases: [{ name: "a", score: 1 }, { name: "b", score: 1 }] },
        { slug: "linter", digest: digestOf("cc"), cases: [{ name: "c", score: 0.5 }] },
        { slug: "retired", cases: [{ name: "r", score: 1 }] },
      ],
      { id: "evr_1", version: "11111111aaaa" },
    );
    const after = agentEvalRunWith(
      [
        { slug: "thermos", digest: digestOf("bb"), cases: [{ name: "a", score: 0 }, { name: "b", score: 1 }] },
        { slug: "linter", digest: digestOf("cc"), cases: [{ name: "c", score: 0.5 }] },
      ],
      { id: "evr_2", version: "22222222bbbb" },
    );
    const sections = compareEvalRuns(before, after);
    expect(
      sections.map((section) => [section.slug, section.digestChanged]),
    ).toEqual([
      ["thermos", true],
      ["linter", false],
      ["retired", false],
    ]);
    expect(
      sections[0]!.rows.map((row) => [row.name, row.changed]),
    ).toEqual([
      ["a", true],
      ["b", false],
    ]);
    expect(sections[2]).toMatchObject({ afterDigest: null });
    expect(sections[2]!.rows[0]).toMatchObject({ name: "r", after: null, changed: true });
  });

  it("keeps a plugin's not-run reason on each side", () => {
    const sections = compareEvalRuns(
      agentEvalRunWith([{ slug: "thermos", notRun: "not selected" }], { id: "evr_1" }),
      agentEvalRunWith([{ slug: "thermos", cases: [{ name: "a", score: 1 }] }], { id: "evr_2" }),
    );
    expect(sections[0]).toMatchObject({
      beforeNotRun: "not selected",
      afterNotRun: "",
      digestChanged: false,
    });
  });
});
