/**
 * Pins the eval's matrix (matrix.ts): the fixed cell order (case, target,
 * arm, try), the case filter by glob and tags, the runs ladder (spec, then
 * case, then 3), ablation `none`, an unsupported case planned with no
 * cells, a scaffolded case not run when the eval skips scaffolds, a Claude
 * target not run for a resumed conversation while native runs and a case's
 * `env` run on both, the target rules when the spec names none (the case's catalog
 * model, never an alias; the native default with no model), and a
 * case_glob that is not a glob keeping no case (the grammar itself is
 * glob.test.ts's); and sizeOfMatrix counting what planMatrix plans, with
 * no cell built, so a suite of millions of tries is counted at once.
 */
import { create } from "@bufbuild/protobuf";
import type { MessageInitShape } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import type { EvalCase, EvalSuite } from "@stigmer/plugin-package";
import {
  EvalRunAblation,
  EvalRunSpecSchema,
  EvalRunTargetSchema,
} from "@stigmer/apis/ai/stigmer/agentic/evalrun/v1/spec_pb";
import type { EvalRunSpec } from "@stigmer/apis/ai/stigmer/agentic/evalrun/v1/spec_pb";
import { Harness } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";

import { newModelCatalogProviderFromDocument } from "../../../modelcatalog/document-catalog.js";
import type { EvalModelCatalog } from "../matrix.js";
import {
  SCAFFOLD_SKIPPED_REASON,
  caseGlobError,
  engineUnsupportedReason,
  evalModelCatalogOf,
  modelNotInCatalogReason,
  planMatrix,
  sizeOfMatrix,
} from "../matrix.js";

function evalCase(name: string, overrides: Partial<EvalCase> = {}): EvalCase {
  return {
    name,
    dir: `evals/${name}`,
    tags: [],
    prompt: "do the thing",
    runs: 3,
    maxTurns: 10,
    timeoutSeconds: 300,
    allowedTools: [],
    env: {},
    plugins: [],
    context: { addDirs: [] },
    files: [`evals/${name}/prompt.md`],
    graders: [],
    mocks: [],
    replays: false,
    ...overrides,
  };
}

function suiteOf(...cases: EvalCase[]): EvalSuite {
  return { dir: "evals", cases, findings: [], servers: [] };
}

function specOf(
  fields: Omit<MessageInitShape<typeof EvalRunSpecSchema>, "$typeName"> = {},
): EvalRunSpec {
  return create(EvalRunSpecSchema, {
    subject: { case: "pluginId", value: "plg_1" },
    maxCostUsd: 5,
    ...fields,
  });
}

const catalog: EvalModelCatalog = {
  isCatalogModel: (harness, model) =>
    harness === Harness.STIGMER && model === "claude-sonnet-4.6",
  defaultModel: (harness) => (harness === Harness.CLAUDE ? "claude-default" : "native-default"),
};

describe("planMatrix", () => {
  it("orders cells by case, target, arm, then try", () => {
    const matrix = planMatrix(
      suiteOf(evalCase("a", { runs: 2 }), evalCase("b", { runs: 1 })),
      specOf({
        targets: [
          create(EvalRunTargetSchema, { harness: Harness.STIGMER, modelName: "m1" }),
          create(EvalRunTargetSchema, { harness: Harness.CLAUDE }),
        ],
      }),
      catalog,
    );
    expect(matrix.cases.map((c) => c.evalCase.name)).toEqual(["a", "b"]);
    expect(matrix.cases[0]?.targets.map((t) => t.target)).toEqual([
      { harness: Harness.STIGMER, modelName: "m1" },
      { harness: Harness.CLAUDE, modelName: "claude-default" },
    ]);
    expect(
      matrix.cells.map((c) => `${c.caseIndex}/${c.targetIndex}/${c.arm}/${c.tryIndex}`),
    ).toEqual([
      "0/0/with/0",
      "0/0/with/1",
      "0/0/without/0",
      "0/0/without/1",
      "0/1/with/0",
      "0/1/with/1",
      "0/1/without/0",
      "0/1/without/1",
      "1/0/with/0",
      "1/0/without/0",
      "1/1/with/0",
      "1/1/without/0",
    ]);
  });

  it("takes runs from the spec, then the case, then 3", () => {
    const suite = suiteOf(evalCase("a", { runs: 5 }), evalCase("b", { runs: 0 }));
    const fromCase = planMatrix(suite, specOf(), catalog);
    expect(fromCase.cases.map((c) => c.targets[0]?.runs)).toEqual([5, 3]);
    expect(fromCase.cells).toHaveLength(2 * 5 + 2 * 3);
    const fromSpec = planMatrix(suite, specOf({ runs: 2 }), catalog);
    expect(fromSpec.cases.map((c) => c.targets[0]?.runs)).toEqual([2, 2]);
    expect(fromSpec.cells).toHaveLength(8);
  });

  it("plans the with-arm only under ablation none", () => {
    const matrix = planMatrix(
      suiteOf(evalCase("a", { runs: 2 })),
      specOf({ ablation: EvalRunAblation.none }),
      catalog,
    );
    expect(matrix.cells.map((c) => c.arm)).toEqual(["with", "with"]);
    const both = planMatrix(
      suiteOf(evalCase("a", { runs: 1 })),
      specOf({ ablation: EvalRunAblation.with_without }),
      catalog,
    );
    expect(both.cells.map((c) => c.arm)).toEqual(["with", "without"]);
  });

  it("filters by glob on the case name or its directory, and by any tag", () => {
    const suite = suiteOf(
      evalCase("review-fires", { tags: ["smoke"] }),
      evalCase("review-quiet", { tags: ["slow"] }),
      evalCase("renamed", { dir: "evals/review-renamed", tags: [] }),
      evalCase("other", { tags: ["smoke", "slow"] }),
    );
    const byGlob = planMatrix(suite, specOf({ caseGlob: "review-*" }), catalog);
    expect(byGlob.cases.map((c) => c.evalCase.name)).toEqual([
      "review-fires",
      "review-quiet",
      "renamed",
    ]);
    const byTag = planMatrix(suite, specOf({ caseTags: ["smoke"] }), catalog);
    expect(byTag.cases.map((c) => c.evalCase.name)).toEqual([
      "review-fires",
      "other",
    ]);
    const both = planMatrix(
      suite,
      specOf({ caseGlob: "review-*", caseTags: ["slow", "absent"] }),
      catalog,
    );
    expect(both.cases.map((c) => c.evalCase.name)).toEqual(["review-quiet"]);
    expect(both.cells.every((c) => c.caseIndex === 0)).toBe(true);
  });

  it("plans an unsupported case with its feature named and no cells", () => {
    const matrix = planMatrix(
      suiteOf(
        evalCase("scaffolded", { unsupported: "plugins" }),
        evalCase("plain", { runs: 1 }),
      ),
      specOf(),
      catalog,
    );
    expect(matrix.cases[0]).toMatchObject({
      notRunReason: "not run: plugins",
      targets: [],
    });
    expect(matrix.cells).toEqual([
      { caseIndex: 1, targetIndex: 0, arm: "with", tryIndex: 0 },
      { caseIndex: 1, targetIndex: 0, arm: "without", tryIndex: 0 },
    ]);
  });

  it("skips a scaffolded case when the eval skips scaffolds, and runs it otherwise", () => {
    const scaffolded = evalCase("scaffolded", { runs: 1, context: { addDirs: [], scaffoldScript: "setup.sh" } });
    const skipped = planMatrix(suiteOf(scaffolded), specOf({ skipScaffold: true }), catalog);
    expect(skipped.cases[0]).toMatchObject({ notRunReason: SCAFFOLD_SKIPPED_REASON, targets: [] });
    expect(skipped.cells).toEqual([]);
    expect(planMatrix(suiteOf(scaffolded), specOf(), catalog).cells).toHaveLength(2);
  });

  it("lists a resumed conversation as not run on a Claude target, and runs a case's env there", () => {
    const targets = [create(EvalRunTargetSchema, { harness: Harness.STIGMER }), create(EvalRunTargetSchema, { harness: Harness.CLAUDE })];
    const matrix = planMatrix(
      suiteOf(
        evalCase("resumed", { runs: 1, context: { addDirs: [], historyFile: "h.jsonl" } }),
        evalCase("vars", { runs: 1, env: { EVAL_X: "1" } }),
      ),
      specOf({ targets }),
      catalog,
    );
    expect(matrix.cases.map((c) => c.targets.map((t) => t.notRunReason))).toEqual([
      [undefined, engineUnsupportedReason("Claude Agent", "resumed conversations")],
      [undefined, undefined],
    ]);
    expect(engineUnsupportedReason("Claude Agent", "resumed conversations")).toBe("not run on Claude Agent: resumed conversations");
    expect(matrix.cells.map((c) => [c.caseIndex, c.targetIndex])).toEqual([
      [0, 0],
      [0, 0],
      [1, 0],
      [1, 0],
      [1, 1],
      [1, 1],
    ]);
  });

  it("runs a case's catalog model on the native harness when the spec names no target", () => {
    const matrix = planMatrix(
      suiteOf(
        evalCase("pinned", { model: "claude-sonnet-4.6", runs: 1 }),
        evalCase("alias", { model: "sonnet", runs: 1 }),
        evalCase("unpinned", { runs: 1 }),
      ),
      specOf(),
      catalog,
    );
    expect(matrix.cases.map((c) => c.targets)).toEqual([
      [{ target: { harness: Harness.STIGMER, modelName: "claude-sonnet-4.6" }, runs: 1 }],
      [
        {
          target: { harness: Harness.STIGMER, modelName: "sonnet" },
          notRunReason: "not run: model 'sonnet' is not in Stigmer's catalog",
          runs: 1,
        },
      ],
      [{ target: { harness: Harness.STIGMER, modelName: "native-default" }, runs: 1 }],
    ]);
    expect(matrix.cells.map((c) => c.caseIndex)).toEqual([0, 0, 2, 2]);
    expect(modelNotInCatalogReason("sonnet")).toBe(
      "not run: model 'sonnet' is not in Stigmer's catalog",
    );
  });

  it("ignores a case's model when the spec names targets", () => {
    const matrix = planMatrix(
      suiteOf(evalCase("alias", { model: "sonnet", runs: 1 })),
      specOf({
        targets: [create(EvalRunTargetSchema, { modelName: "claude-sonnet-4.6" })],
      }),
      catalog,
    );
    expect(matrix.cases[0]?.targets[0]?.notRunReason).toBeUndefined();
    expect(matrix.cells).toHaveLength(2);
  });
});

describe("evalModelCatalogOf", () => {
  it("asks the catalog by harness section and leaves the default to the engine", () => {
    const provider = newModelCatalogProviderFromDocument(
      JSON.stringify({
        models: [
          { id: "native-model", harness: "stigmer" },
          { id: "claude-model", harness: "claude" },
        ],
      }),
    );
    const evalCatalog = evalModelCatalogOf(provider);
    expect(evalCatalog.isCatalogModel(Harness.STIGMER, "native-model")).toBe(true);
    expect(evalCatalog.isCatalogModel(Harness.UNSPECIFIED, "native-model")).toBe(true);
    expect(evalCatalog.isCatalogModel(Harness.STIGMER, "claude-model")).toBe(false);
    expect(evalCatalog.isCatalogModel(Harness.CLAUDE, "claude-model")).toBe(true);
    expect(evalCatalog.defaultModel(Harness.STIGMER)).toBe("");
  });
});

describe("a case_glob that is not a glob", () => {
  it("is named by caseGlobError and keeps no case", () => {
    expect(caseGlobError("")).toBeUndefined();
    expect(caseGlobError("review-*")).toBeUndefined();
    expect(caseGlobError("review-[z-a]")).toBe("range 'z-a' is reversed");
    const matrix = planMatrix(
      suiteOf(evalCase("review-fires")),
      specOf({ caseGlob: "review-[" }),
      catalog,
    );
    expect(matrix.cases).toEqual([]);
    expect(matrix.cells).toEqual([]);
  });
});

describe("sizeOfMatrix", () => {
  it("counts the cases and tries planMatrix plans", () => {
    const suite = suiteOf(
      evalCase("a", { runs: 2 }),
      evalCase("b", { unsupported: "mcp mocks" }),
      evalCase("c", { model: "not-a-model" }),
      evalCase("d", { runs: 0 }),
    );
    for (const spec of [
      specOf(),
      specOf({ ablation: EvalRunAblation.none }),
      specOf({ runs: 4, targets: [create(EvalRunTargetSchema, { harness: Harness.CLAUDE })] }),
      specOf({ caseGlob: "a" }),
    ]) {
      const planned = planMatrix(suite, spec, catalog);
      expect(sizeOfMatrix(suite, spec, catalog)).toEqual({
        cases: planned.cases.length,
        tries: planned.cells.length,
      });
    }
  });

  it("counts 6,000,000 tries of 10,000 cases without building them", () => {
    const suite = suiteOf(...Array.from({ length: 10_000 }, (_, index) => evalCase(`case-${index}`)));
    const targets = Array.from({ length: 6 }, () => create(EvalRunTargetSchema, { harness: Harness.STIGMER }));
    const started = performance.now();
    expect(sizeOfMatrix(suite, specOf({ runs: 50, targets }), catalog)).toEqual({ cases: 10_000, tries: 6_000_000 });
    expect(performance.now() - started).toBeLessThan(500);
  });
});
