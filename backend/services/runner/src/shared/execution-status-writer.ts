/**
 * Shared interface for proto mutation consumed by side-effect classes
 * (InlinePublisher, WriteBackCoordinator) and streaming loops.
 *
 * The deep-agent harness implements it on its v2 StatusBuilder and
 * V3StatusBuilder; the Cursor harness — which mutates a bare status proto
 * with no builder — uses {@link statusProtoWriter}. Side-effect classes
 * depend only on this interface, never on a specific implementation.
 */

import type { AgentExecutionStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { ExecutionArtifact } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/artifact_pb";
import type { WorkspaceWriteBack } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/writeback_pb";

export interface ExecutionStatusWriter {
  readonly currentStatus: AgentExecutionStatus;
  readonly forceNextUpdate: boolean;
  clearForceFlag(): void;
  addArtifact(artifact: ExecutionArtifact): void;
  addWriteBack(wb: WorkspaceWriteBack): void;
}

/**
 * An {@link ExecutionStatusWriter} over a bare status proto, for harnesses
 * that mutate the status directly instead of through a builder (the Cursor
 * harness). Mutations apply synchronously to the given proto; the caller's
 * own persist points pick them up — the force flag is a streaming-loop
 * concern the direct-mutation style has no use for, so it stays `false`.
 *
 * Write-backs upsert by `workspaceEntryName` — the same contract as the
 * deep-agent `StatusBuilder.addWriteBack`: each git-backed workspace entry
 * carries at most one record, progressing through phases.
 */
export function statusProtoWriter(status: AgentExecutionStatus): ExecutionStatusWriter {
  return {
    get currentStatus() {
      return status;
    },
    forceNextUpdate: false,
    clearForceFlag() {},
    addArtifact(artifact: ExecutionArtifact) {
      status.artifacts.push(artifact);
    },
    addWriteBack(wb: WorkspaceWriteBack) {
      const backs = status.workspaceWriteBacks;
      const idx = backs.findIndex(
        (b) => b.workspaceEntryName === wb.workspaceEntryName,
      );
      if (idx >= 0) {
        backs[idx] = wb;
      } else {
        backs.push(wb);
      }
    },
  };
}
