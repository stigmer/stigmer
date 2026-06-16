/**
 * Shared interface for proto mutation consumed by side-effect classes
 * (InlinePublisher, WriteBackCoordinator) and streaming loops.
 *
 * Both v2 StatusBuilder and V3StatusBuilder implement this interface,
 * decoupling side-effect classes from the specific builder version.
 */

import type { AgentExecutionStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { ExecutionArtifact } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/artifact_pb";
import type { FileChange } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import type { WorkspaceWriteBack } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/writeback_pb";

export interface ExecutionStatusWriter {
  readonly currentStatus: AgentExecutionStatus;
  readonly forceNextUpdate: boolean;
  clearForceFlag(): void;
  addArtifact(artifact: ExecutionArtifact): void;
  addWriteBack(wb: WorkspaceWriteBack): void;
  /**
   * Attach the file changes captured for a tool call to that call's proto.
   *
   * `toolCallId` is matched against `ToolCall.id`, which equals the id available
   * at the streaming dispatch site in both harnesses (v3 `callId`, v2 `run_id`).
   * Implementations search the shared status proto, so this works regardless of
   * which builder instance holds the writer. A no-op when the call is not found.
   */
  attachFileChanges(toolCallId: string, changes: FileChange[]): void;
}
