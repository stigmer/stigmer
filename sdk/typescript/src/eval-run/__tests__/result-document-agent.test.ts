// Pins the result document of an eval run about an agent
// (result-document.ts): the agent and its version, the eval run's totals,
// and one block per plugin in Claude Code's document shape for that
// plugin's cases, one arm only when no plugin is compared (no `delta`, no
// `arms.without`); a plugin whose cases did not run keeps its reason and no
// cases; a block's cost is its own tries', both arms'; an Eval whose cases
// ran on the agent is a block of its own under `evals`, the Eval in place
// of the plugin, and a document with no Eval carries no `evals` key.

import { clone, create } from "@bufbuild/protobuf";
import { timestampFromMs } from "@bufbuild/protobuf/wkt";
import { describe, expect, it } from "vitest";

import { EvalRunSchema } from "@stigmer/apis/ai/stigmer/agentic/evalrun/v1/api_pb";
import { EvalRunSpecSchema, EvalRunTargetSchema } from "@stigmer/apis/ai/stigmer/agentic/evalrun/v1/spec_pb";
import {
  EvalRunAggregatesSchema,
  EvalRunArmSchema,
  EvalRunCaseSchema,
  EvalRunCaseTargetSchema,
  EvalRunPartialReason,
  EvalRunPhase,
  EvalRunEvalSchema,
  EvalRunPluginSchema,
  EvalRunStatusSchema,
  EvalRunTrySchema,
  EvalRunTryState,
} from "@stigmer/apis/ai/stigmer/agentic/evalrun/v1/status_pb";
import { Harness } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";
import { ApiResourceMetadataSchema } from "@stigmer/apis/ai/stigmer/commons/apiresource/metadata_pb";

import { toResultDocument } from "../result-document.js";

const target = create(EvalRunTargetSchema, { harness: Harness.STIGMER, modelName: "claude-sonnet-4-6" });

function graded(score: number, costUsd: number) {
  return create(EvalRunTrySchema, { index: 1, state: EvalRunTryState.graded, score, costUsd, runId: `run_${score}` });
}

function caseOf(name: string, tries: ReturnType<typeof graded>[], passed: boolean) {
  return create(EvalRunCaseSchema, {
    caseName: name,
    path: `evals/${name}`,
    targets: [
      create(EvalRunCaseTargetSchema, {
        target,
        withPlugin: create(EvalRunArmSchema, {
          score: tries.reduce((sum, t) => sum + t.score, 0) / tries.length,
          gradedTries: tries.length,
          tries,
        }),
        passed,
        passK: tries.every((t) => t.score === 1),
      }),
    ],
  });
}

const onAgent = create(EvalRunSchema, {
  metadata: create(ApiResourceMetadataSchema, { id: "evr_1", org: "acme" }),
  spec: create(EvalRunSpecSchema, { subject: { case: "agentId", value: "agt_1" }, agentVersion: "f".repeat(64) }),
  status: create(EvalRunStatusSchema, {
    phase: EvalRunPhase.partial,
    partialReason: EvalRunPartialReason.cost_ceiling,
    agentVersionHash: "a".repeat(64),
    startedAt: timestampFromMs(1_000),
    finishedAt: timestampFromMs(31_000),
    costUsd: 0.7,
    aggregates: create(EvalRunAggregatesSchema, { overallScore: 0.75, casesPassed: 1, casesTotal: 2 }),
    plugins: [
      create(EvalRunPluginSchema, {
        pluginId: "plg_refunds",
        pluginSlug: "refunds",
        pluginDigest: "b".repeat(64),
        attached: true,
        cases: [caseOf("refund-window", [graded(1, 0.2), graded(1, 0.1)], true)],
        aggregates: create(EvalRunAggregatesSchema, { overallScore: 1, casesPassed: 1, casesTotal: 1 }),
      }),
      create(EvalRunPluginSchema, {
        pluginId: "plg_tracker",
        pluginSlug: "tracker",
        pluginDigest: "c".repeat(64),
        cases: [caseOf("files-ticket", [graded(0.5, 0.4)], false)],
        aggregates: create(EvalRunAggregatesSchema, { overallScore: 0.5, casesPassed: 0, casesTotal: 1 }),
      }),
      create(EvalRunPluginSchema, {
        pluginId: "plg_style",
        pluginSlug: "style",
        pluginDigest: "d".repeat(64),
        notRunReason: "no eval cases at this version",
      }),
    ],
  }),
});

describe("toResultDocument", () => {
  it("names the agent at its version, the totals and why the eval stopped", () => {
    const doc = toResultDocument(onAgent, { subjectSlug: "support-desk" });
    expect(doc).toMatchObject({
      schemaVersion: 1,
      evalRunId: "evr_1",
      subject: { kind: "agent", id: "agt_1", slug: "support-desk", versionHash: "a".repeat(64) },
      partial: true,
      partialReason: "cost_ceiling",
      aggregates: { overallScore: 0.75, casesPassed: 1, casesTotal: 2 },
      costUsd: 0.7,
      durationSeconds: 30,
    });
  });

  it("gives each plugin a block in the plugin document's shape, one arm only", () => {
    const [refunds, tracker] = toResultDocument(onAgent).plugins;
    expect(refunds).toMatchObject({
      plugin: { id: "plg_refunds", slug: "refunds", digest: "b".repeat(64), attached: true, compared: false },
      notRunReason: null,
      schemaVersion: 1,
      partialReason: "cost_ceiling",
      aggregates: { overallScore: 1, casesPassed: 1, casesTotal: 1 },
      durationSeconds: 30,
    });
    expect(refunds?.aggregates).not.toHaveProperty("meanDelta");
    expect(refunds?.costUsd).toBeCloseTo(0.3);
    expect(refunds?.cases).toEqual([
      {
        name: "refund-window",
        aggregates: { score: 1 },
        passed: true,
        passK: true,
        arms: {
          with: [
            { error: null, score: 1, notGradedReason: null, runId: "run_1" },
            { error: null, score: 1, notGradedReason: null, runId: "run_1" },
          ],
        },
      },
    ]);
    expect(refunds?.targets.map((t) => t.label)).toEqual(["stigmer/claude-sonnet-4-6"]);
    expect(tracker?.cases[0]).toMatchObject({ name: "files-ticket", passed: false, aggregates: { score: 0.5 } });
  });

  it("keeps a plugin whose cases did not run, with its reason and no cases", () => {
    const style = toResultDocument(onAgent).plugins[2];
    expect(style).toMatchObject({ notRunReason: "no eval cases at this version", cases: [], targets: [], costUsd: 0 });
  });

  it("gives each Eval a block of its own after the plugins, and carries no evals key without one", () => {
    expect(toResultDocument(onAgent)).not.toHaveProperty("evals");
    const withEval = clone(EvalRunSchema, onAgent);
    withEval.status!.evals = [
      create(EvalRunEvalSchema, {
        evalId: "evs_support",
        evalSlug: "support-evals",
        evalDigest: "9".repeat(64),
        cases: [caseOf("asks-for-order", [graded(1, 0.05)], true)],
        aggregates: create(EvalRunAggregatesSchema, { overallScore: 1, casesPassed: 1, casesTotal: 1 }),
      }),
      create(EvalRunEvalSchema, { evalId: "evs_empty", evalSlug: "empty", notRunReason: "no eval cases at this version" }),
    ];
    const doc = toResultDocument(withEval);
    expect(doc.plugins).toHaveLength(3);
    expect(doc.evals?.map((block) => [block.eval, block.notRunReason, block.cases.map((c) => c.name)])).toEqual([
      [{ id: "evs_support", slug: "support-evals", digest: "9".repeat(64) }, null, ["asks-for-order"]],
      [{ id: "evs_empty", slug: "empty", digest: "" }, "no eval cases at this version", []],
    ]);
    expect(doc.evals?.[0]).toMatchObject({ schemaVersion: 1, partialReason: "cost_ceiling", durationSeconds: 30 });
    expect(doc.evals?.[0]?.costUsd).toBeCloseTo(0.05);
  });

  it("reads an eval still running as not partial, and the spec's version before the status has one", () => {
    const running = create(EvalRunSchema, {
      spec: create(EvalRunSpecSchema, { subject: { case: "agentId", value: "agt_1" }, agentVersion: "e".repeat(64) }),
      status: create(EvalRunStatusSchema, { phase: EvalRunPhase.running, startedAt: timestampFromMs(0) }),
    });
    const doc = toResultDocument(running, { nowMs: 5_000 });
    expect(doc).toMatchObject({ partial: false, partialReason: null, durationSeconds: 5, plugins: [] });
    expect(doc.subject).toMatchObject({ kind: "agent", versionHash: "e".repeat(64) });
    expect(toResultDocument(create(EvalRunSchema)).subject).toMatchObject({ kind: "agent", id: "", versionHash: "" });
  });
});
