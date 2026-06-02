/**
 * Shared terminal state handlers for both v2 and v3 streaming loops.
 *
 * Extracted so pause, stop, and recursion-limit handling is identical
 * between both paths — no silent semantic divergence.
 */

import { create } from "@bufbuild/protobuf";
import { AgentMessageSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { ExecutionPhase, MessageType } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { ExecutionStatusWriter } from "./execution-status-writer.js";
import type { StreamResult } from "./streaming.js";
import { slimStatus, utcTimestamp } from "../../shared/status.js";

export function handlePause(
  writer: ExecutionStatusWriter,
  eventsProcessed: number,
  pendingPublishPromises: readonly Promise<void>[],
  pendingWritebackPromises: readonly Promise<void>[],
): StreamResult {
  const status = writer.currentStatus;
  status.phase = ExecutionPhase.EXECUTION_PAUSED;
  status.messages.push(create(AgentMessageSchema, {
    type: MessageType.MESSAGE_SYSTEM,
    content: "Execution paused by user. Use resume to continue from this checkpoint.",
    timestamp: utcTimestamp(),
  }));

  return {
    eventsProcessed,
    terminalStatus: slimStatus(status),
    pendingPublishPromises,
    pendingWritebackPromises,
  };
}

export function handleStop(
  writer: ExecutionStatusWriter,
  eventsProcessed: number,
  pendingPublishPromises: readonly Promise<void>[],
  pendingWritebackPromises: readonly Promise<void>[],
): StreamResult {
  const status = writer.currentStatus;
  status.phase = ExecutionPhase.EXECUTION_COMPLETED;
  status.completedAt = utcTimestamp();
  status.messages.push(create(AgentMessageSchema, {
    type: MessageType.MESSAGE_SYSTEM,
    content: "Execution stopped by the platform.",
    timestamp: utcTimestamp(),
  }));

  return {
    eventsProcessed,
    terminalStatus: slimStatus(status),
    pendingPublishPromises,
    pendingWritebackPromises,
  };
}

export function handleRecursionLimit(
  writer: ExecutionStatusWriter,
  eventsProcessed: number,
  pendingPublishPromises: readonly Promise<void>[],
  pendingWritebackPromises: readonly Promise<void>[],
): StreamResult {
  const status = writer.currentStatus;
  status.phase = ExecutionPhase.EXECUTION_TERMINATED;
  status.completedAt = utcTimestamp();
  status.error =
    `Agent reached the tool-call limit after processing ${eventsProcessed} events. ` +
    `Send another message to continue.`;
  status.messages.push(create(AgentMessageSchema, {
    type: MessageType.MESSAGE_SYSTEM,
    content:
      "The agent reached the tool-call limit for this message. " +
      "Work completed so far has been saved. " +
      "Send another message to continue where the agent left off.",
    timestamp: utcTimestamp(),
  }));

  return {
    eventsProcessed,
    terminalStatus: slimStatus(status),
    pendingPublishPromises,
    pendingWritebackPromises,
  };
}

export function isGraphRecursionError(err: unknown): boolean {
  if (err instanceof Error) {
    return err.constructor.name === "GraphRecursionError" ||
      err.message.includes("GraphRecursionError") ||
      err.message.includes("Recursion limit");
  }
  return false;
}
