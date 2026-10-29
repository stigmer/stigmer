/**
 * The eval's matrix: which cases run, on which (harness, model) targets,
 * in which arms and how many times, in one fixed order (case, target, arm,
 * try). Create counts it against the limits (sizeOfMatrix, which builds no
 * cell, so a huge suite is refused at the cost of its cases alone); the
 * eval's workflow walks it, one cell per try (planMatrix). Pure: the same suite, spec and catalog always plan the
 * same matrix, so a replayed workflow and a retried create agree.
 *
 * The rules, in the order they apply:
 *
 *   - a case is kept when its name (or its directory's last segment)
 *     matches `case_glob`, as Claude Code's `--case`, and it carries any of
 *     `case_tags`, as `--tag`; an empty filter keeps every case;
 *   - a case that needs a feature Stigmer does not run yet is planned with
 *     `not run: <feature>` and no cells, never run degraded; so is a case
 *     with a scaffold script when the eval skips scaffolds (`not run:
 *     scaffold skipped`, Claude Code's `--no-scaffold`);
 *   - the targets are the spec's; with none, an eval run about an agent's
 *     one target is the agent as it runs (`agentTarget`: its engine, its
 *     model as the label, and no model on the run, so its own tier and
 *     thinking apply), and an eval run about a plugin's is the case's own
 *     `model` on the native harness
 *     when the catalog knows it there, else the native harness's default.
 *     A `model` the catalog does not know is that target's `not run: model
 *     '<name>' is not in Stigmer's catalog`: no alias is guessed, since
 *     "sonnet" names nothing Stigmer runs;
 *   - a target on an engine that cannot run one of the case's features is
 *     that target's `not run on <engine>: <feature>`, and the case runs on
 *     the others: the Claude engine resumes no recorded conversation
 *     (`@stigmer/plugin-package` `evalCaseUnsupportedOn`);
 *   - tries per arm are the spec's `runs`, else the case's, else 3;
 *   - ablation `none` plans the with arm only, as does a spec with no
 *     ablation (an eval run that compares no plugin: matrixSpecOf).
 *
 * Every index is zero-based into the arrays this module returns: a cell's
 * `caseIndex` into `cases`, its `targetIndex` into that case's `targets`,
 * its `tryIndex` counting the arm's tries (a try's displayed number is
 * `tryIndex + 1`).
 *
 * Proven by __tests__/matrix.test.ts.
 */
import { evalCaseUnsupportedOn, type EvalCase, type EvalEngine, type EvalSuite } from "@stigmer/plugin-package";
import type { EvalRunSpec, EvalRunTarget } from "@stigmer/apis/ai/stigmer/agentic/evalrun/v1/spec_pb";
import { EvalRunAblation } from "@stigmer/apis/ai/stigmer/agentic/evalrun/v1/spec_pb";
import { Harness } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";

import type { ModelCatalogProvider } from "../../modelcatalog/model-catalog-provider.js";
import { harnessName } from "../../modelcatalog/pin-validation.js";
import { HARNESSES } from "../session/harness.js";
import { compileGlob } from "./glob.js";
import { subjectOf } from "./subject.js";

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
  /**
   * Set on an agent's default target: the try names no model, so the
   * agent's own model, tier and thinking apply; `target.modelName` is the
   * agent's model, for the label only.
   */
  runsAgentModel?: boolean;
}

/**
 * The spec fields the planner reads (matrixSpecOf): with no ablation, as
 * when no plugin is compared, it plans the with arm only.
 */
export type MatrixSpec = Pick<EvalRunSpec, "caseGlob" | "caseTags" | "runs" | "skipScaffold"> & {
  readonly targets: ReadonlyArray<Pick<EvalRunTarget, "harness" | "modelName">>;
  readonly ablation?: EvalRunSpec["ablation"];
};

/** An agent's default target: its engine, and its model as the label. */
export interface AgentTarget {
  readonly harness: Harness;
  readonly modelName: string;
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

/** The not-run copy for a case with a scaffold in an eval that skips scaffolds. */
export const SCAFFOLD_SKIPPED_REASON = "not run: scaffold skipped";

/** The not-run copy for a target whose harness cannot run one of the case's features. */
export function engineUnsupportedReason(engine: string, feature: string): string {
  return `not run on ${engine}: ${feature}`;
}

/** How large the matrix is, counted without building its cells. */
export interface EvalMatrixSize {
  cases: number;
  tries: number;
}

export function planMatrix(
  suite: EvalSuite,
  spec: MatrixSpec,
  catalog: EvalModelCatalog,
  agentTarget?: AgentTarget,
): EvalMatrix {
  const cells: EvalCell[] = [];
  const { cases } = walkMatrix(suite, spec, catalog, agentTarget, (cell) => cells.push(cell));
  return { cases, cells };
}

/** The matrix's cases and tries, as planMatrix would plan them, with no cell built. */
export function sizeOfMatrix(
  suite: EvalSuite,
  spec: MatrixSpec,
  catalog: EvalModelCatalog,
  agentTarget?: AgentTarget,
): EvalMatrixSize {
  const { cases, tries } = walkMatrix(suite, spec, catalog, agentTarget, undefined);
  return { cases: cases.length, tries };
}

/** The kept cases and the tries in all, handing each cell to `onCell` when one is given. */
function walkMatrix(
  suite: EvalSuite,
  spec: MatrixSpec,
  catalog: EvalModelCatalog,
  agentTarget: AgentTarget | undefined,
  onCell: ((cell: EvalCell) => void) | undefined,
): { cases: PlannedCase[]; tries: number } {
  const matchesGlob = caseGlobMatcher(spec.caseGlob);
  const wantedTags = new Set(spec.caseTags);
  const arms: ReadonlyArray<"with" | "without"> =
    spec.ablation === undefined || spec.ablation === EvalRunAblation.none ? ["with"] : ["with", "without"];

  const cases: PlannedCase[] = [];
  let tries = 0;
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
    if (spec.skipScaffold && evalCase.context.scaffoldScript !== undefined) {
      cases.push({ evalCase, notRunReason: SCAFFOLD_SKIPPED_REASON, targets: [] });
      continue;
    }
    const targets = targetsOf(evalCase, spec, catalog, runs, agentTarget);
    cases.push({ evalCase, targets });
    targets.forEach((planned, targetIndex) => {
      if (planned.notRunReason !== undefined) {
        return;
      }
      tries += arms.length * planned.runs;
      if (onCell === undefined) {
        return;
      }
      for (const arm of arms) {
        for (let tryIndex = 0; tryIndex < planned.runs; tryIndex++) {
          onCell({ caseIndex, targetIndex, arm, tryIndex });
        }
      }
    });
  }
  return { cases, tries };
}

function targetsOf(
  evalCase: EvalCase,
  spec: MatrixSpec,
  catalog: EvalModelCatalog,
  runs: number,
  agentTarget: AgentTarget | undefined,
): PlannedTarget[] {
  return candidateTargets(evalCase, spec, catalog, runs, agentTarget).map((planned) => {
    if (planned.notRunReason !== undefined) {
      return planned;
    }
    const engine = EVAL_ENGINES[planned.target.harness];
    const feature = evalCaseUnsupportedOn(engine.word, evalCase);
    return feature === undefined ? planned : { ...planned, notRunReason: engineUnsupportedReason(engine.label, feature) };
  });
}

/**
 * Each harness as an eval case's limits name it (unspecified is stigmer),
 * with the label its not-run copy reads (domain/session/harness.ts).
 */
export const EVAL_ENGINES: Readonly<Record<Harness, { readonly word: EvalEngine; readonly label: string }>> = {
  [Harness.UNSPECIFIED]: { word: "stigmer", label: HARNESSES[Harness.STIGMER].label },
  [Harness.STIGMER]: { word: "stigmer", label: HARNESSES[Harness.STIGMER].label },
  [Harness.CLAUDE]: { word: "claude", label: HARNESSES[Harness.CLAUDE].label },
};

function candidateTargets(
  evalCase: EvalCase,
  spec: MatrixSpec,
  catalog: EvalModelCatalog,
  runs: number,
  agentTarget: AgentTarget | undefined,
): PlannedTarget[] {
  if (spec.targets.length === 0 && agentTarget !== undefined) {
    return [{ target: { harness: agentTarget.harness, modelName: agentTarget.modelName }, runs, runsAgentModel: true }];
  }
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
          harness: Harness.STIGMER,
          modelName: catalog.defaultModel(Harness.STIGMER),
        },
        runs,
      },
    ];
  }
  if (!catalog.isCatalogModel(Harness.STIGMER, model)) {
    return [
      {
        target: { harness: Harness.STIGMER, modelName: model },
        notRunReason: modelNotInCatalogReason(model),
        runs,
      },
    ];
  }
  return [{ target: { harness: Harness.STIGMER, modelName: model }, runs }];
}

/**
 * The case filter for `case_glob`, in the evals' one glob grammar
 * (glob.ts, name mode: `*` any run of characters). Matched against the
 * case's name and its directory's last segment, which are the same unless
 * case.yaml renames the case. Create refuses a malformed glob; should one
 * be stored anyway, it keeps no case.
 */
function caseGlobMatcher(glob: string): (evalCase: EvalCase) => boolean {
  if (glob === "") {
    return () => true;
  }
  const pattern = compileGlob(glob, "name");
  if (!pattern.ok) {
    return () => false;
  }
  return (evalCase) => {
    const segments = evalCase.dir.split("/");
    const dirName = segments[segments.length - 1] ?? "";
    return (
      pattern.matches(evalCase.name) ||
      (dirName !== evalCase.name && pattern.matches(dirName))
    );
  };
}

/** Why `case_glob` is not a glob, or `undefined` when it is one (or empty). */
export function caseGlobError(glob: string): string | undefined {
  const compiled = compileGlob(glob, "name");
  return compiled.ok ? undefined : compiled.error;
}

/** Whether a plugin is compared, so the matrix plans the without arm too: always on an eval run of a plugin, on an agent when it names one. */
export function isComparing(spec: Pick<EvalRunSpec, "subject" | "comparedPluginId">): boolean {
  return subjectOf(spec)?.kind === "plugin" || spec.comparedPluginId !== "";
}

/** The planner's view of a spec: the ablation only when a plugin is compared, so an agent's own cases run one arm. */
export function matrixSpecOf(spec: EvalRunSpec): MatrixSpec {
  return {
    caseGlob: spec.caseGlob,
    caseTags: spec.caseTags,
    runs: spec.runs,
    skipScaffold: spec.skipScaffold,
    targets: spec.targets,
    ...(isComparing(spec) ? { ablation: spec.ablation } : {}),
  };
}
