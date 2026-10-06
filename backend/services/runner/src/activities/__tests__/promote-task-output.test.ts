/**
 * Pins the PromoteTaskOutput activity: an output under the 256 KB threshold
 * passes through untouched, and one at or over it becomes an Artifact whose
 * source names the workflow run (`workflow_run_id`) and task, with the inline
 * output replaced by a reference and one artifact_created event. The client
 * is replaced at its module seam, so the artifact request the activity
 * composes is observed without a server.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

import type { CreateArtifactInput } from "@stigmer/protos/ai/stigmer/agentic/artifact/v1/io_pb";

const createArtifact =
  vi.fn<
    (input: CreateArtifactInput) => Promise<{ metadata?: { id: string } }>
  >();

vi.mock("../../client/stigmer-client.js", () => ({
  StigmerClient: vi.fn().mockImplementation(() => ({ createArtifact })),
}));

import { testConfig } from "../../__test-utils__/config-fixture.js";
import { createPromoteTaskOutputActivities } from "../promote-task-output.js";

const THRESHOLD = 256 * 1024;

beforeEach(() => {
  createArtifact.mockReset();
});

describe("PromoteTaskOutput", () => {
  it("passes an output under the threshold through without an artifact", async () => {
    const { PromoteTaskOutput } =
      createPromoteTaskOutputActivities(testConfig());
    const output = { ok: true };

    const result = await PromoteTaskOutput(output, "wex_1", "fetch");

    expect(result).toEqual({
      output,
      artifactIds: [],
      artifactCreatedEvents: [],
    });
    expect(createArtifact).not.toHaveBeenCalled();
  });

  it("promotes an oversized output to an artifact sourced to the workflow run and task", async () => {
    createArtifact.mockResolvedValue({ metadata: { id: "art_1" } });
    const { PromoteTaskOutput } =
      createPromoteTaskOutputActivities(testConfig());
    const output = { body: "x".repeat(THRESHOLD) };
    const sizeBytes = Buffer.byteLength(JSON.stringify(output), "utf-8");

    const result = await PromoteTaskOutput(output, "wex_1", "fetch");

    expect(createArtifact).toHaveBeenCalledTimes(1);
    const input = createArtifact.mock.calls[0]![0];
    expect(input.spec?.source?.workflowRunId).toBe("wex_1");
    expect(input.spec?.source?.taskName).toBe("fetch");
    expect(input.spec?.displayName).toBe("fetch — output.json");
    expect(input.spec?.contentType).toBe("application/json");
    expect(input.content.byteLength).toBe(sizeBytes);

    expect(result.output).toEqual({
      _artifact_ref: "art_1",
      display_name: "fetch — output.json",
      content_type: "application/json",
      size_bytes: sizeBytes,
    });
    expect(result.artifactIds).toEqual(["art_1"]);
    expect(result.artifactCreatedEvents).toHaveLength(1);
    expect(result.artifactCreatedEvents[0]).toMatchObject({
      type: "artifact_created",
      artifactId: "art_1",
      displayName: "fetch — output.json",
      sizeBytes,
    });
  });

  it("names the artifact by the caller's display name when one is given", async () => {
    createArtifact.mockResolvedValue({ metadata: { id: "art_2" } });
    const { PromoteTaskOutput } =
      createPromoteTaskOutputActivities(testConfig());

    await PromoteTaskOutput(
      { body: "y".repeat(THRESHOLD) },
      "wex_2",
      "review",
      "review — payload.json",
    );

    expect(createArtifact.mock.calls[0]![0].spec?.displayName).toBe(
      "review — payload.json",
    );
  });
});
