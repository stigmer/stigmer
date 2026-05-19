/**
 * Post-stream processing for deep agent execution.
 *
 * Orchestrates cleanup tasks after the LangGraph stream completes:
 *  1. Drain pending inline publish promises (fire-and-forget completions).
 *  2. Auto-publish safety net (scan tool calls for missed files).
 *  3. Writeback finalize (commit remaining uncommitted changes).
 *
 * Each step is independently try/caught. A failure in one step does not
 * block subsequent steps — the execution still completes.
 */

import type { AgentExecutionStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { InlinePublisher } from "./inline-publisher.js";
import type { WriteBackCoordinator } from "./writeback-coordinator.js";
import { autoPublishWrittenFiles } from "./auto-publish.js";

export interface PostStreamOptions {
  readonly status: AgentExecutionStatus;
  readonly inlinePublisher: InlinePublisher;
  readonly writebackCoordinator: WriteBackCoordinator | null;
  readonly pendingPublishPromises: readonly Promise<void>[];
  readonly pendingWritebackPromises: readonly Promise<void>[];
  readonly executionId: string;
}

export async function processPostStream(opts: PostStreamOptions): Promise<void> {
  const {
    status,
    inlinePublisher,
    writebackCoordinator,
    pendingPublishPromises,
    pendingWritebackPromises,
    executionId,
  } = opts;

  if (status.phase === ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL) {
    console.log(
      `[postStream] execution=${executionId} — skipping post-stream ` +
      `(phase is WAITING_FOR_APPROVAL)`,
    );
    return;
  }

  // Step 1: Drain pending inline publish promises
  if (pendingPublishPromises.length > 0) {
    try {
      await Promise.allSettled(pendingPublishPromises);
      console.log(
        `[postStream] execution=${executionId} — ` +
        `drained ${pendingPublishPromises.length} pending publish task(s)`,
      );
    } catch (err) {
      console.warn(
        `[postStream] execution=${executionId} — ` +
        `error draining publish tasks: ${err}`,
      );
    }
  }

  // Step 2: Drain pending writeback promises
  if (pendingWritebackPromises.length > 0) {
    try {
      await Promise.allSettled(pendingWritebackPromises);
      console.log(
        `[postStream] execution=${executionId} — ` +
        `drained ${pendingWritebackPromises.length} pending writeback task(s)`,
      );
    } catch (err) {
      console.warn(
        `[postStream] execution=${executionId} — ` +
        `error draining writeback tasks: ${err}`,
      );
    }
  }

  // Step 3: Auto-publish safety net
  try {
    await autoPublishWrittenFiles(status, inlinePublisher);
  } catch (err) {
    console.warn(
      `[postStream] execution=${executionId} — ` +
      `auto-publish safety net error: ${err}`,
    );
  }

  // Step 4: Writeback finalize
  if (writebackCoordinator) {
    try {
      await writebackCoordinator.finalize();
      console.log(
        `[postStream] execution=${executionId} — writeback finalize complete`,
      );
    } catch (err) {
      console.warn(
        `[postStream] execution=${executionId} — ` +
        `writeback finalize error: ${err}`,
      );
    }
  }
}
