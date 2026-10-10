/**
 * The eval's matrix: which cases run, on which (harness, model) targets,
 * in which arms and how many times, in one fixed order (case, target, arm,
 * try). Create counts it against the limits; the eval's workflow walks it,
 * one cell per try. Pure: the same suite, spec and catalog always plan the
 * same matrix, so a replayed workflow and a retried create agree.
 *
 * The rules, in the order they apply:
 *
 *   - a case is kept when its name (or its directory's last segment)
 *     matches `case_glob`, as Claude Code's `--case`, and it carries any of
 *     `case_tags`, as `--tag`; an empty filter keeps every case;
 *   - a case that needs a feature Stigmer does not run yet is planned with
 *     `not run: <feature>` and no cells, never run degraded;
 *   - the targets are the spec's; with none, the case's own `model` on the
 *     native harness when the catalog knows it there, else the native
 *     harness's default. A `model` the catalog does not know is that
 *     target's `not run: model '<name>' is not in Stigmer's catalog`: no
 *     alias is guessed, since "sonnet" names nothing Stigmer runs;
 *   - tries per arm are the spec's `runs`, else the case's, else 3;
 *   - ablation `none` plans the with-arm only.
 *
 * Every index is zero-based into the arrays this module returns: a cell's
 * `caseIndex` into `cases`, its `targetIndex` into that case's `targets`,
 * its `tryIndex` counting the arm's tries (a try's displayed number is
 * `tryIndex + 1`).
 *
 * Proven by __tests__/matrix.test.ts.
 */
import type { EvalCase, EvalSuite } from "@stigmer/plugin-package";
import type { PluginEvalSpec } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/spec_pb";
import { PluginEvalAblation } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/spec_pb";
import { Harness } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";

import type { ModelCatalogProvider } from "../../modelcatalog/model-catalog-provider.js";
import { harnessName } from "../../modelcatalog/pin-validation.js";

/** Tries per arm when neither the spec nor the case names a count. */
export const DEFAULT_EVAL_RUNS = 3;

/** One try: one run in a fresh conversation. */
export interface EvalCell {
  caseIndex: number;
  targetIndex: number;
  arm: "with" | "without";
  tryIndex: number;
}

/** One planned target of a case. */
export interface PlannedTarget {
  target: { harness: Harness; modelName: string };
  /** Set when the case does not run on this target; its arms plan no cells. */
  notRunReason?: string;
  /** Tries per arm. */
  runs: number;
}

/** One case the filter kept, with its targets. */
export interface PlannedCase {
  evalCase: EvalCase;
  /** Set when the case does not run at all; it then plans no cells. */
  notRunReason?: string;
  targets: PlannedTarget[];
}

/** What the planner asks of the model catalog. */
export interface EvalModelCatalog {
  /** Whether `model` is a catalog id runnable on `harness`. */
  isCatalogModel(harness: Harness, model: string): boolean;
  /** The model a target naming none runs on `harness`. */
  defaultModel(harness: Harness): string;
}

/**
 * The server's catalog as the planner reads it. A target naming no model
 * keeps the empty name, which a run reads as its engine's default, chosen
 * where every other run's is (the runner), so an eval's default is a chat's.
 */
export function evalModelCatalogOf(
  provider: ModelCatalogProvider,
): EvalModelCatalog {
  return {
    isCatalogModel: (harness, model) =>
      provider.isValidModel(harnessName(harness), model),
    defaultModel: () => "",
  };
}

/** The planned matrix: the kept cases and every cell, in order. */
export interface EvalMatrix {
  cases: PlannedCase[];
  cells: EvalCell[];
}

/** The not-run copy for a case model the catalog does not know. */
export function modelNotInCatalogReason(model: string): string {
  return `not run: model '${model}' is not in Stigmer's catalog`;
}

/** The not-run copy for a case using a feature Stigmer does not run yet. */
export function unsupportedFeatureReason(feature: string): string {
  return `not run: ${feature}`;
}

export function planMatrix(
  suite: EvalSuite,
  spec: PluginEvalSpec,
  catalog: EvalModelCatalog,
): EvalMatrix {
  const matchesGlob = caseGlobMatcher(spec.caseGlob);
  const wantedTags = new Set(spec.caseTags);
  const arms: ReadonlyArray<"with" | "without"> =
    spec.ablation === PluginEvalAblation.none ? ["with"] : ["with", "without"];

  const cases: PlannedCase[] = [];
  const cells: EvalCell[] = [];
  for (const evalCase of suite.cases) {
    if (!matchesGlob(evalCase)) {
      continue;
    }
    if (
      wantedTags.size > 0 &&
      !evalCase.tags.some((tag) => wantedTags.has(tag))
    ) {
      continue;
    }
    const caseIndex = cases.length;
    const runs = spec.runs > 0 ? spec.runs : evalCase.runs > 0 ? evalCase.runs : DEFAULT_EVAL_RUNS;
    if (evalCase.unsupported !== undefined) {
      cases.push({
        evalCase,
        notRunReason: unsupportedFeatureReason(evalCase.unsupported),
        targets: [],
      });
      continue;
    }
    const targets = targetsOf(evalCase, spec, catalog, runs);
    cases.push({ evalCase, targets });
    targets.forEach((planned, targetIndex) => {
      if (planned.notRunReason !== undefined) {
        return;
      }
      for (const arm of arms) {
        for (let tryIndex = 0; tryIndex < planned.runs; tryIndex++) {
          cells.push({ caseIndex, targetIndex, arm, tryIndex });
        }
      }
    });
  }
  return { cases, cells };
}

function targetsOf(
  evalCase: EvalCase,
  spec: PluginEvalSpec,
  catalog: EvalModelCatalog,
  runs: number,
): PlannedTarget[] {
  if (spec.targets.length > 0) {
    return spec.targets.map((target) => ({
      target: {
        harness: target.harness,
        modelName:
          target.modelName !== ""
            ? target.modelName
            : catalog.defaultModel(target.harness),
      },
      runs,
    }));
  }
  const model = evalCase.model?.trim() ?? "";
  if (model === "") {
    return [
      {
        target: {
          harness: Harness.NATIVE,
          modelName: catalog.defaultModel(Harness.NATIVE),
        },
        runs,
      },
    ];
  }
  if (!catalog.isCatalogModel(Harness.NATIVE, model)) {
    return [
      {
        target: { harness: Harness.NATIVE, modelName: model },
        notRunReason: modelNotInCatalogReason(model),
        runs,
      },
    ];
  }
  return [{ target: { harness: Harness.NATIVE, modelName: model }, runs }];
}

/**
 * The case filter for `case_glob`: `*` any run of characters, `?` one,
 * `[...]` a class (`[!...]` negated), `{a,b}` alternatives; everything
 * else literal. Matched against the case's name and its directory's last
 * segment, which are the same unless case.yaml renames the case.
 */
function caseGlobMatcher(glob: string): (evalCase: EvalCase) => boolean {
  if (glob === "") {
    return () => true;
  }
  const pattern = globToRegExp(glob);
  return (evalCase) => {
    const segments = evalCase.dir.split("/");
    const dirName = segments[segments.length - 1] ?? "";
    return pattern.test(evalCase.name) || pattern.test(dirName);
  };
}

/** A glob as an anchored regular expression (caseGlobMatcher's grammar). */
export function globToRegExp(glob: string): RegExp {
  let source = "";
  let braceDepth = 0;
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i] ?? "";
    switch (char) {
      case "*":
        source += ".*";
        break;
      case "?":
        source += ".";
        break;
      case "[": {
        const close = glob.indexOf("]", i + 2);
        if (close === -1) {
          source += "\\[";
          break;
        }
        let body = glob.slice(i + 1, close);
        let negate = false;
        if (body.startsWith("!") || body.startsWith("^")) {
          negate = true;
          body = body.slice(1);
        }
        source += `[${negate ? "^" : ""}${body.replace(/[\\\]]/g, "\\$&")}]`;
        i = close;
        break;
      }
      case "{":
        braceDepth++;
        source += "(?:";
        break;
      case "}":
        if (braceDepth > 0) {
          braceDepth--;
          source += ")";
        } else {
          source += "\\}";
        }
        break;
      case ",":
        source += braceDepth > 0 ? "|" : ",";
        break;
      default:
        source += char.replace(/[.+^$()|\\/]/g, "\\$&");
    }
  }
  source += ")".repeat(braceDepth);
  return new RegExp(`^${source}$`);
}
