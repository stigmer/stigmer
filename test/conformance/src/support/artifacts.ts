// Canonical valid Artifact create inputs for the conformance suite.
// Domain: conformance support.
//
// Artifact is the execution-output store: a metadata resource plus a
// content-addressed blob. Create is NOT a standard resource write — the
// input is spec + raw content bytes, and the org derives from the producing
// execution (falling back to empty when the execution id is unknown, the
// OSS single-user posture) — so the builder shapes CreateArtifactInput
// rather than a resource message.
import type { MessageInitShape } from "@bufbuild/protobuf";
import { CreateArtifactInputSchema } from "@stigmer/protos/ai/stigmer/agentic/artifact/v1/io_pb";

export interface ArtifactInputOptions {
  displayName?: string;
  contentType?: string;
  content?: Uint8Array;
  // Exactly one execution source is the create contract; agent-execution
  // sourced by default, workflow via this override.
  workflowExecutionId?: string;
  agentExecutionId?: string;
  // Retention TTL in days; -1 means permanent (expires_at stays empty).
  ttlDays?: number;
}

export const ARTIFACT_DEFAULT_CONTENT = new TextEncoder().encode(
  "conformance artifact content\n",
);

// A complete, valid CreateArtifactInput sourced from a (fabricated) agent
// execution id — accepted by construction: create derives org best-effort
// and never validates the execution's existence.
export function makeArtifactInput(
  options: ArtifactInputOptions = {},
): MessageInitShape<typeof CreateArtifactInputSchema> {
  const source =
    options.workflowExecutionId !== undefined
      ? { workflowExecutionId: options.workflowExecutionId }
      : { agentExecutionId: options.agentExecutionId ?? "aexec_01conformancefixture" };
  return {
    spec: {
      displayName: options.displayName ?? "conformance-artifact.txt",
      contentType: options.contentType ?? "text/plain",
      source,
      ...(options.ttlDays !== undefined ? { retention: { ttlDays: options.ttlDays } } : {}),
    },
    content: options.content ?? ARTIFACT_DEFAULT_CONTENT,
  };
}
