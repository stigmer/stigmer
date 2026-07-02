/**
 * Plan-mode artifact publishing.
 *
 * When an execution runs in Plan mode (InteractionMode.PLAN), the agent's final
 * message IS the plan. We publish that text as a first-class `plan.md`
 * ExecutionArtifact so the UI can render a reviewable Plan card with
 * copy/download, and a follow-up "Implement" execution can reference it
 * deterministically.
 *
 * This is deliberately a single, harness-agnostic helper:
 * - The native (deepagents) harness already auto-publishes files an agent
 *   writes (InlinePublisher), but Plan mode is read-only, so there is no file to
 *   publish — the plan lives only in the final message.
 * - The Cursor harness has no artifact pipeline at all.
 *
 * Publishing the final message here, at finalization, gives both harnesses an
 * identical, durable plan artifact derived from the single source of truth (the
 * final AI message). It mirrors the InlinePublisher "publish a derived artifact"
 * pattern: one immutable artifact, published once, never a parallel copy that
 * can drift.
 *
 * The plan content is NOT duplicated as a separate stored blob beyond this
 * artifact — the chat message remains the live/streamed view; the artifact is
 * the durable/exportable view, detected by convention (a FILE artifact named
 * `plan.md`).
 */

import { createHash } from "node:crypto";
import { create } from "@bufbuild/protobuf";
import type { AgentExecutionStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ExecutionArtifactSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/artifact_pb";
import {
  ExecutionArtifactKind,
  MessageType,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { ArtifactStorage } from "./artifact-storage.js";
import { utcTimestamp } from "./status.js";

/** Canonical filename for a plan artifact. UI detection keys on this name. */
export const PLAN_ARTIFACT_NAME = "plan.md";

/**
 * Sandbox path recorded on the artifact. Routes under `.stigmer/` (the
 * session platform dir), so it never pollutes the user's workspace, and a
 * follow-up execution can reference it via workspace file refs if desired.
 */
export const PLAN_ARTIFACT_SANDBOX_PATH = ".stigmer/plans/plan.md";

/**
 * Returns the text of the last AI message in a completed status, trimmed.
 * Returns `undefined` when there is no AI message with content — the plan was
 * empty and nothing should be published.
 */
export function extractFinalPlanText(status: AgentExecutionStatus): string | undefined {
  for (let i = status.messages.length - 1; i >= 0; i--) {
    const msg = status.messages[i];
    if (msg.type === MessageType.MESSAGE_AI && msg.content.trim().length > 0) {
      return msg.content;
    }
  }
  return undefined;
}

/**
 * Publishes `planText` as a `plan.md` ExecutionArtifact and registers it on
 * `status.artifacts`. Idempotent: re-publishing replaces any existing `plan.md`
 * rather than appending a duplicate, preserving a single source of truth.
 *
 * Fire-and-forget by contract: a plan that fails to upload must never fail the
 * execution. Errors are logged and swallowed.
 */
export async function publishPlanArtifact(opts: {
  readonly status: AgentExecutionStatus;
  readonly executionId: string;
  readonly planText: string;
  readonly artifactStorage: ArtifactStorage;
}): Promise<void> {
  const { status, executionId, planText, artifactStorage } = opts;

  if (planText.trim().length === 0) {
    return;
  }

  try {
    const content = Buffer.from(planText, "utf-8");
    const contentHash = createHash("sha256").update(content).digest("hex");
    const storageKey = `artifacts/${executionId}/${PLAN_ARTIFACT_NAME}`;

    await artifactStorage.upload(storageKey, content, "text/markdown");

    const artifact = create(ExecutionArtifactSchema, {
      name: PLAN_ARTIFACT_NAME,
      sandboxPath: PLAN_ARTIFACT_SANDBOX_PATH,
      kind: ExecutionArtifactKind.FILE,
      sizeBytes: BigInt(content.length),
      storageKey,
      createdAt: utcTimestamp(),
      contentHash,
    });

    const existingIdx = status.artifacts.findIndex((a) => a.name === PLAN_ARTIFACT_NAME);
    if (existingIdx >= 0) {
      status.artifacts[existingIdx] = artifact;
    } else {
      status.artifacts.push(artifact);
    }

    console.log(
      `[plan-artifact] execution=${executionId} — published ${PLAN_ARTIFACT_NAME} ` +
      `(${content.length} bytes, hash=${contentHash.slice(0, 12)})`,
    );
  } catch (err) {
    console.warn(
      `[plan-artifact] execution=${executionId} — ` +
      `failed to publish plan (non-fatal): ${err}`,
    );
  }
}
