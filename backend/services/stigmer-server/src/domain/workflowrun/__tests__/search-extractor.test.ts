/**
 * Pins the workflow-run search extractor's result projection: a result is
 * filed under the `workflow_run` kind with the run's identity and an empty
 * description (workflow runs carry no description, and Go's summary is
 * always ""). A run without metadata projects to nothing.
 */
import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { WorkflowRunSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowrun/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { workflowExecutionSearchExtractor } from "../search-extractor.js";

describe("workflowExecutionSearchExtractor", () => {
  it("projects a result under workflow_run with the run's identity and no description", () => {
    const run = create(WorkflowRunSchema, {
      metadata: {
        id: "wex_search",
        name: "release-train",
        slug: "release-train",
        org: "acme",
      },
    });

    const result = workflowExecutionSearchExtractor.toSearchResult(run, 2);

    expect(workflowExecutionSearchExtractor.kind).toBe(
      ApiResourceKind.workflow_run,
    );
    expect(result?.kind).toBe(ApiResourceKind.workflow_run);
    expect(result?.id).toBe("wex_search");
    expect(result?.qualifiedSlug).toBe("acme/release-train");
    expect(result?.description).toBe("");
    expect(result?.score).toBe(2);
    expect(workflowExecutionSearchExtractor.getSearchSummary(run)).toBe("");
  });

  it("projects nothing for a run without metadata", () => {
    expect(
      workflowExecutionSearchExtractor.toSearchResult(
        create(WorkflowRunSchema),
        1,
      ),
    ).toBeUndefined();
  });
});
