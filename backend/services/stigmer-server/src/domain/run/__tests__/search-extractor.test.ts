/**
 * Pins the agent-run search extractor's two projections: a result is filed
 * under the `agent_run` kind with the run's identity and an empty
 * description (Go pins Description "" even though the summary is the run's
 * name), and the summary itself answers the run's name for any caller that
 * asks. A run without metadata projects to nothing.
 */
import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { RunSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { agentExecutionSearchExtractor } from "../search-extractor.js";

const run = create(RunSchema, {
  metadata: {
    id: "aex_search",
    name: "nightly-triage",
    slug: "nightly-triage",
    org: "acme",
    tags: ["ops"],
  },
});

describe("agentExecutionSearchExtractor", () => {
  it("serves the agent_run kind", () => {
    expect(agentExecutionSearchExtractor.kind).toBe(ApiResourceKind.run);
  });

  it("answers the run's name as its summary, and empty without metadata", () => {
    expect(agentExecutionSearchExtractor.getSearchSummary(run)).toBe(
      "nightly-triage",
    );
    expect(
      agentExecutionSearchExtractor.getSearchSummary(create(RunSchema)),
    ).toBe("");
  });

  it("projects a result under agent_run with the run's identity and no description", () => {
    const result = agentExecutionSearchExtractor.toSearchResult(run, 0.5);

    expect(result?.kind).toBe(ApiResourceKind.run);
    expect(result?.id).toBe("aex_search");
    expect(result?.qualifiedSlug).toBe("acme/nightly-triage");
    expect(result?.description).toBe("");
    expect(result?.score).toBe(0.5);
  });

  it("projects nothing for a run without metadata", () => {
    expect(
      agentExecutionSearchExtractor.toSearchResult(create(RunSchema), 1),
    ).toBeUndefined();
  });
});
