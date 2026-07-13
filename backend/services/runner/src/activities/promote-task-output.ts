/**
 * Activity: Promote large task outputs to the Artifact store (T07).
 *
 * When a task's serialized output exceeds the promotion threshold (256KB),
 * this activity calls ArtifactCommandController.create() to persist the
 * content as a first-class Artifact resource, then replaces the inline
 * output with an artifact reference.
 *
 * This runs as a Temporal LOCAL activity (short-lived, in-process I/O)
 * because the gRPC call to the Stigmer server is fast and the data is
 * already in memory.
 *
 * Called from the workflow sandbox via proxyLocalActivities.
 */

import { StigmerClient } from "../client/stigmer-client.js";
import { loadConfig } from "../config.js";
import { create } from "@bufbuild/protobuf";
import {
  CreateArtifactInputSchema,
} from "@stigmer/protos/ai/stigmer/agentic/artifact/v1/io_pb";
import {
  ArtifactSpecSchema,
  ArtifactSourceSchema,
} from "@stigmer/protos/ai/stigmer/agentic/artifact/v1/spec_pb";

const PROMOTION_THRESHOLD_BYTES = 256 * 1024; // 256 KB

export interface PromoteTaskOutputResult {
  /** The output to use (original if small, artifact reference if promoted). */
  output: unknown;
  /** Artifact IDs created during promotion (empty if no promotion). */
  artifactIds: string[];
  /** Event descriptors for artifact_created events (empty if no promotion). */
  artifactCreatedEvents: ArtifactCreatedEventDescriptor[];
}

export interface ArtifactCreatedEventDescriptor {
  type: "artifact_created";
  artifactId: string;
  displayName: string;
  contentType: string;
  sizeBytes: number;
  occurredAt: string;
}

let cachedClient: StigmerClient | null = null;

function getClient(): StigmerClient {
  if (!cachedClient) {
    const config = loadConfig();
    cachedClient = new StigmerClient({
      endpoint: config.stigmerBackendEndpoint,
      token: config.stigmerToken,
    });
  }
  return cachedClient;
}

export function createPromoteTaskOutputActivities() {
  return {
    /**
     * Check if a task output should be promoted to an artifact. If the
     * serialized JSON exceeds the threshold, create an artifact via gRPC
     * and return a reference.
     *
     * @param displayName - Optional artifact display name. Defaults to
     *   "<taskName> — output.json"; callers promoting something other
     *   than a task output (e.g. a human_input review payload) pass a
     *   name that describes what the artifact actually holds.
     */
    async PromoteTaskOutput(
      taskOutput: unknown,
      workflowExecutionId: string,
      taskName: string,
      displayName?: string,
    ): Promise<PromoteTaskOutputResult> {
      if (taskOutput === undefined || taskOutput === null) {
        return { output: taskOutput, artifactIds: [], artifactCreatedEvents: [] };
      }

      let serialized: string;
      try {
        serialized = JSON.stringify(taskOutput);
      } catch {
        return { output: taskOutput, artifactIds: [], artifactCreatedEvents: [] };
      }

      const byteLength = Buffer.byteLength(serialized, "utf-8");
      if (byteLength < PROMOTION_THRESHOLD_BYTES) {
        return { output: taskOutput, artifactIds: [], artifactCreatedEvents: [] };
      }

      const effectiveDisplayName = displayName ?? `${taskName} — output.json`;
      const contentType = "application/json";
      const contentBytes = Buffer.from(serialized, "utf-8");

      const input = create(CreateArtifactInputSchema, {
        spec: create(ArtifactSpecSchema, {
          contentType,
          displayName: effectiveDisplayName,
          source: create(ArtifactSourceSchema, {
            workflowExecutionId,
            taskName,
          }),
        }),
        content: new Uint8Array(contentBytes),
      });

      const artifact = await getClient().createArtifact(input);
      const artifactId = artifact.metadata?.id ?? "";

      return {
        output: {
          _artifact_ref: artifactId,
          display_name: effectiveDisplayName,
          content_type: contentType,
          size_bytes: byteLength,
        },
        artifactIds: [artifactId],
        artifactCreatedEvents: [{
          type: "artifact_created" as const,
          artifactId,
          displayName: effectiveDisplayName,
          contentType,
          sizeBytes: byteLength,
          occurredAt: new Date().toISOString(),
        }],
      };
    },
  };
}
