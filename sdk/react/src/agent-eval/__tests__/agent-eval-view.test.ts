/**
 * Pins the agent Evals tab's pure rules: the form starts on the agent as
 * it runs with every plugin, refuses what the API refuses (the shared run
 * limits, no plugin picked, a tool name outside the API's pattern, too
 * many tags, a tag over 64 characters), and becomes an unnamed create input that names no plugin
 * when every one is picked and the picked ones in the agent's order
 * otherwise; an eval's label is the agent version it ran, short, and when
 * it started; its results are one section per plugin with that plugin's
 * one-arm rows; and two evals compare plugin by plugin, case by case,
 * marking a plugin whose digest differs and keeping a plugin only one of
 * them had.
 */
import { describe, expect, it } from "vitest";
import { Harness } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import {
  agentEvalFormProblem,
  agentEvalInputOf,
  agentEvalLabelOf,
  agentEvalSectionsOf,
  compareAgentEvals,
  defaultAgentEvalForm,
  parseCaseTags,
  shortDigest,
  shortVersion,
} from "../agent-eval-view";
import { agentEvalWith, digestOf, evalStartOf } from "./agent-eval-fixture";

const AGENT = { id: "agt_1", org: "org_acme" };
const ATTACHED = ["thermos", "linter"];

describe("the agent's Run evals form", () => {
  it("starts on the agent as it runs, each case's own tries, $5, one at a time, every plugin", () => {
    const form = defaultAgentEvalForm(ATTACHED);
    expect(form).toMatchObject({
      caseModels: true,
      runs: 0,
      maxCostUsd: 5,
      concurrency: 1,
      plugins: ATTACHED,
      caseGlob: "",
      caseTags: [],
      allowTools: [],
    });
    expect(agentEvalFormProblem(form)).toBeNull();
  });

  it("refuses what the API refuses, in a sentence", () => {
    const form = defaultAgentEvalForm(ATTACHED);
    expect(agentEvalFormProblem({ ...form, runs: 51 })).toMatch(/1 to 50/);
    expect(agentEvalFormProblem({ ...form, plugins: [] })).toMatch(
      /at least one plugin/,
    );
    expect(agentEvalFormProblem({ ...form, allowTools: ["skill"] })).toMatch(
      /'skill' is not a tool name/,
    );
    expect(
      agentEvalFormProblem({
        ...form,
        caseTags: Array.from({ length: 33 }, (_, i) => `t${i}`),
      }),
    ).toMatch(/at most 32 tags/);
    expect(
      agentEvalFormProblem({ ...form, caseGlob: "x".repeat(257) }),
    ).toMatch(/longer than 256/);
    expect(
      agentEvalFormProblem({ ...form, caseTags: ["smoke", "t".repeat(65)] }),
    ).toBe("A tag is longer than 64 characters.");
    expect(
      agentEvalFormProblem({ ...form, caseTags: ["t".repeat(64)] }),
    ).toBeNull();
  });

  it("names no plugin when every one is picked, so the eval runs every plugin the agent attaches", () => {
    const input = agentEvalInputOf(
      AGENT,
      { ...defaultAgentEvalForm(ATTACHED), allowTools: ["Skill", "Agent"] },
      ATTACHED,
    );
    expect(input).toEqual({
      name: "",
      org: "org_acme",
      agentId: "agt_1",
      plugins: [],
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
    const input = agentEvalInputOf(
      AGENT,
      {
        ...defaultAgentEvalForm(ATTACHED),
        plugins: ["linter"],
        caseModels: false,
        targets: [{ harness: "cursor", modelName: "gpt-5" }],
        caseGlob: " review-* ",
        caseTags: parseCaseTags("smoke, , fast"),
      },
      ATTACHED,
    );
    expect(input).toMatchObject({
      plugins: ["linter"],
      targets: [{ harness: Harness.CURSOR, modelName: "gpt-5" }],
      caseGlob: "review-*",
      caseTags: ["smoke", "fast"],
    });
  });
});

describe("an agent eval's label and sections", () => {
  it("is the agent version it ran, short, and when it started", () => {
    const agentEval = agentEvalWith([], { id: "aev_3", version: "abcdef0123456789" });
    expect(agentEvalLabelOf(agentEval)).toBe(
      `Version abcdef01 · started ${evalStartOf("aev_3").toLocaleString()}`,
    );
    expect(shortVersion("")).toBe("current");
    expect(shortDigest(digestOf("9f"))).toBe("9f0000000000");
    expect(shortDigest("")).toBe("—");
  });

  it("reads one section per plugin with its one-arm rows, and a plugin not run with its reason", () => {
    const sections = agentEvalSectionsOf(
      agentEvalWith([
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

describe("compareAgentEvals", () => {
  it("lines two evals up plugin by plugin and case by case, marking a plugin whose version changed", () => {
    const before = agentEvalWith(
      [
        { slug: "thermos", digest: digestOf("aa"), cases: [{ name: "a", score: 1 }, { name: "b", score: 1 }] },
        { slug: "linter", digest: digestOf("cc"), cases: [{ name: "c", score: 0.5 }] },
        { slug: "retired", cases: [{ name: "r", score: 1 }] },
      ],
      { id: "aev_1", version: "11111111aaaa" },
    );
    const after = agentEvalWith(
      [
        { slug: "thermos", digest: digestOf("bb"), cases: [{ name: "a", score: 0 }, { name: "b", score: 1 }] },
        { slug: "linter", digest: digestOf("cc"), cases: [{ name: "c", score: 0.5 }] },
      ],
      { id: "aev_2", version: "22222222bbbb" },
    );
    const sections = compareAgentEvals(before, after);
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
    const sections = compareAgentEvals(
      agentEvalWith([{ slug: "thermos", notRun: "not selected" }], { id: "aev_1" }),
      agentEvalWith([{ slug: "thermos", cases: [{ name: "a", score: 1 }] }], { id: "aev_2" }),
    );
    expect(sections[0]).toMatchObject({
      beforeNotRun: "not selected",
      afterNotRun: "",
      digestChanged: false,
    });
  });
});
