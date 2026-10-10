/**
 * Pins the eval's matrix (matrix.ts): the fixed cell order (case, target,
 * arm, try), the case filter by glob and tags, the runs ladder (spec, then
 * case, then 3), ablation `none`, an unsupported case planned with no
 * cells, the target rules when the spec names none (the case's catalog
 * model, never an alias; the native default with no model), and the
 * glob grammar.
 */
import { create } from "@bufbuild/protobuf";
import type { MessageInitShape } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import type { EvalCase, EvalSuite } from "@stigmer/plugin-package";
import {
  PluginEvalAblation,
  PluginEvalSpecSchema,
  PluginEvalTargetSchema,
} from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/spec_pb";
import type { PluginEvalSpec } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/spec_pb";
import { Harness } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";

import { newModelCatalogProviderFromDocument } from "../../../modelcatalog/document-catalog.js";
import type { EvalModelCatalog } from "../matrix.js";
import {
  evalModelCatalogOf,
  globToRegExp,
  modelNotInCatalogReason,
  planMatrix,
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
    ...overrides,
  };
}

function suiteOf(...cases: EvalCase[]): EvalSuite {
  return { dir: "evals", cases, findings: [] };
}

function specOf(
  fields: Omit<MessageInitShape<typeof PluginEvalSpecSchema>, "$typeName"> = {},
): PluginEvalSpec {
  return create(PluginEvalSpecSchema, {
    pluginId: "plg_1",
    maxCostUsd: 5,
    ...fields,
  });
}

const catalog: EvalModelCatalog = {
  isCatalogModel: (harness, model) =>
    harness === Harness.NATIVE && model === "claude-sonnet-4.6",
  defaultModel: (harness) => (harness === Harness.CURSOR ? "auto" : "native-default"),
};

describe("planMatrix", () => {
  it("orders cells by case, target, arm, then try", () => {
    const matrix = planMatrix(
      suiteOf(evalCase("a", { runs: 2 }), evalCase("b", { runs: 1 })),
      specOf({
        targets: [
          create(PluginEvalTargetSchema, { harness: Harness.NATIVE, modelName: "m1" }),
          create(PluginEvalTargetSchema, { harness: Harness.CURSOR }),
        ],
      }),
      catalog,
    );
    expect(matrix.cases.map((c) => c.evalCase.name)).toEqual(["a", "b"]);
    expect(matrix.cases[0]?.targets.map((t) => t.target)).toEqual([
      { harness: Harness.NATIVE, modelName: "m1" },
      { harness: Harness.CURSOR, modelName: "auto" },
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
      specOf({ ablation: PluginEvalAblation.none }),
      catalog,
    );
    expect(matrix.cells.map((c) => c.arm)).toEqual(["with", "with"]);
    const both = planMatrix(
      suiteOf(evalCase("a", { runs: 1 })),
      specOf({ ablation: PluginEvalAblation.with_without }),
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
        evalCase("scaffolded", { unsupported: "context.scaffold_script" }),
        evalCase("plain", { runs: 1 }),
      ),
      specOf(),
      catalog,
    );
    expect(matrix.cases[0]).toMatchObject({
      notRunReason: "not run: context.scaffold_script",
      targets: [],
    });
    expect(matrix.cells).toEqual([
      { caseIndex: 1, targetIndex: 0, arm: "with", tryIndex: 0 },
      { caseIndex: 1, targetIndex: 0, arm: "without", tryIndex: 0 },
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
      [{ target: { harness: Harness.NATIVE, modelName: "claude-sonnet-4.6" }, runs: 1 }],
      [
        {
          target: { harness: Harness.NATIVE, modelName: "sonnet" },
          notRunReason: "not run: model 'sonnet' is not in Stigmer's catalog",
          runs: 1,
        },
      ],
      [{ target: { harness: Harness.NATIVE, modelName: "native-default" }, runs: 1 }],
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
        targets: [create(PluginEvalTargetSchema, { modelName: "claude-sonnet-4.6" })],
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
          { id: "native-model", harness: "native" },
          { id: "cursor-model", harness: "cursor" },
        ],
      }),
    );
    const evalCatalog = evalModelCatalogOf(provider);
    expect(evalCatalog.isCatalogModel(Harness.NATIVE, "native-model")).toBe(true);
    expect(evalCatalog.isCatalogModel(Harness.UNSPECIFIED, "native-model")).toBe(true);
    expect(evalCatalog.isCatalogModel(Harness.NATIVE, "cursor-model")).toBe(false);
    expect(evalCatalog.isCatalogModel(Harness.CURSOR, "cursor-model")).toBe(true);
    expect(evalCatalog.defaultModel(Harness.NATIVE)).toBe("");
  });
});

describe("globToRegExp", () => {
  it.each([
    ["review-*", "review-fires", true],
    ["review-*", "a-review-fires", false],
    ["case-?", "case-1", true],
    ["case-?", "case-12", false],
    ["case-[0-9]", "case-7", true],
    ["case-[!0-9]", "case-7", false],
    ["{alpha,beta}-*", "beta-one", true],
    ["{alpha,beta}-*", "gamma-one", false],
    ["a.b", "a.b", true],
    ["a.b", "axb", false],
    ["(x)", "(x)", true],
  ])("%s against %s is %s", (glob, name, expected) => {
    expect(globToRegExp(glob).test(name)).toBe(expected);
  });
});
