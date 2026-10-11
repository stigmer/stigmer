// Pins toAgentEvalResultDocument (agent-eval/result-document.ts): the
// agent and its version, the eval's totals, and one block per plugin in the
// plugin eval's document shape for that plugin's cases, one arm only (no
// `delta`, no `arms.without`); a plugin whose cases did not run keeps its
// reason and no cases; a block's cost is its own tries'.

import { create } from "@bufbuild/protobuf";
import { timestampFromMs } from "@bufbuild/protobuf/wkt";
import { describe, expect, it } from "vitest";

import { AgentEvalSchema } from "@stigmer/protos/ai/stigmer/agentic/agenteval/v1/api_pb";
import { AgentEvalSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/agenteval/v1/spec_pb";
import {
  AgentEvalPluginSchema,
  AgentEvalStatusSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agenteval/v1/status_pb";
import { PluginEvalTargetSchema } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/spec_pb";
import {
  PluginEvalAggregatesSchema,
  PluginEvalArmSchema,
  PluginEvalCaseSchema,
  PluginEvalCaseTargetSchema,
  PluginEvalPartialReason,
  PluginEvalPhase,
  PluginEvalTrySchema,
  PluginEvalTryState,
} from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/status_pb";
import { Harness } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";

import { toAgentEvalResultDocument } from "../result-document.js";

const target = create(PluginEvalTargetSchema, { harness: Harness.NATIVE, modelName: "claude-sonnet-4-6" });

function graded(score: number, costUsd: number) {
  return create(PluginEvalTrySchema, { index: 1, state: PluginEvalTryState.graded, score, costUsd, runId: `run_${score}` });
}

function caseOf(name: string, tries: ReturnType<typeof graded>[], passed: boolean) {
  return create(PluginEvalCaseSchema, {
    caseName: name,
    path: `evals/${name}`,
    targets: [
      create(PluginEvalCaseTargetSchema, {
        target,
        withPlugin: create(PluginEvalArmSchema, {
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

const agentEval = create(AgentEvalSchema, {
  metadata: create(ApiResourceMetadataSchema, { id: "aev_1", org: "acme" }),
  spec: create(AgentEvalSpecSchema, { agentId: "agt_1", agentVersion: "f".repeat(64) }),
  status: create(AgentEvalStatusSchema, {
    phase: PluginEvalPhase.partial,
    partialReason: PluginEvalPartialReason.cost_ceiling,
    agentVersionHash: "a".repeat(64),
    startedAt: timestampFromMs(1_000),
    finishedAt: timestampFromMs(31_000),
    costUsd: 0.7,
    aggregates: create(PluginEvalAggregatesSchema, { overallScore: 0.75, casesPassed: 1, casesTotal: 2 }),
    plugins: [
      create(AgentEvalPluginSchema, {
        pluginId: "plg_refunds",
        pluginSlug: "refunds",
        pluginDigest: "b".repeat(64),
        cases: [caseOf("refund-window", [graded(1, 0.2), graded(1, 0.1)], true)],
        aggregates: create(PluginEvalAggregatesSchema, { overallScore: 1, casesPassed: 1, casesTotal: 1 }),
      }),
      create(AgentEvalPluginSchema, {
        pluginId: "plg_tracker",
        pluginSlug: "tracker",
        pluginDigest: "c".repeat(64),
        cases: [caseOf("files-ticket", [graded(0.5, 0.4)], false)],
        aggregates: create(PluginEvalAggregatesSchema, { overallScore: 0.5, casesPassed: 0, casesTotal: 1 }),
      }),
      create(AgentEvalPluginSchema, {
        pluginId: "plg_style",
        pluginSlug: "style",
        pluginDigest: "d".repeat(64),
        notRunReason: "no eval cases at this version",
      }),
    ],
  }),
});

describe("toAgentEvalResultDocument", () => {
  it("names the agent at its version, the totals and why the eval stopped", () => {
    const doc = toAgentEvalResultDocument(agentEval, { agentSlug: "support-desk" });
    expect(doc).toMatchObject({
      schemaVersion: 1,
      evalId: "aev_1",
      agent: { id: "agt_1", slug: "support-desk", versionHash: "a".repeat(64) },
      partial: true,
      partialReason: "cost_ceiling",
      aggregates: { overallScore: 0.75, casesPassed: 1, casesTotal: 2 },
      costUsd: 0.7,
      durationSeconds: 30,
    });
  });

  it("gives each plugin a block in the plugin document's shape, one arm only", () => {
    const [refunds, tracker] = toAgentEvalResultDocument(agentEval).plugins;
    expect(refunds).toMatchObject({
      plugin: { id: "plg_refunds", slug: "refunds", digest: "b".repeat(64) },
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
    expect(refunds?.targets.map((t) => t.label)).toEqual(["native/claude-sonnet-4-6"]);
    expect(tracker?.cases[0]).toMatchObject({ name: "files-ticket", passed: false, aggregates: { score: 0.5 } });
  });

  it("keeps a plugin whose cases did not run, with its reason and no cases", () => {
    const style = toAgentEvalResultDocument(agentEval).plugins[2];
    expect(style).toMatchObject({ notRunReason: "no eval cases at this version", cases: [], targets: [], costUsd: 0 });
  });

  it("reads an eval still running as not partial, and the spec's version before the status has one", () => {
    const running = create(AgentEvalSchema, {
      spec: create(AgentEvalSpecSchema, { agentId: "agt_1", agentVersion: "e".repeat(64) }),
      status: create(AgentEvalStatusSchema, { phase: PluginEvalPhase.running, startedAt: timestampFromMs(0) }),
    });
    const doc = toAgentEvalResultDocument(running, { nowMs: 5_000 });
    expect(doc).toMatchObject({ partial: false, partialReason: null, durationSeconds: 5, plugins: [] });
    expect(doc.agent.versionHash).toBe("e".repeat(64));
    expect(toAgentEvalResultDocument(create(AgentEvalSchema)).agent.versionHash).toBe("");
  });
});
