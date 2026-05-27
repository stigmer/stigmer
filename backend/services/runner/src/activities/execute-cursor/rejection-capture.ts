/**
 * Captures ConnectError details from process-level unhandledRejection events
 * and correlates them to the active Cursor execution via AsyncLocalStorage.
 *
 * Background: The Cursor SDK has a confirmed bug where ConnectRPC stream
 * errors escape as process-level unhandledRejection instead of surfacing
 * through run.stream() or run.wait(). The actual error (e.g.,
 * [unauthenticated], [unavailable]) carries diagnostic detail that
 * run.wait() strips to a bare { status: "error" }.
 *
 * This module installs a process-level handler that extracts ConnectError
 * fields and stores them in a Map keyed by executionId. The execute-cursor
 * activity reads from this Map after run.wait() resolves to enrich the
 * error message.
 *
 * Forum reference:
 * https://forum.cursor.com/t/agent-send-wait-returns-bare-status-error-while-connectrpc-unauthenticated-leaks-as-unhandledrejection/161203
 */

import { AsyncLocalStorage } from "node:async_hooks";

export interface CapturedRejection {
  code: string;
  message: string;
  timestamp: number;
}

const capturedRejections = new Map<string, CapturedRejection>();

const REJECTION_TTL_MS = 5 * 60 * 1000;

let executionContextRef: AsyncLocalStorage<{ executionId: string }> | null = null;

export function setExecutionContextRef(
  ctx: AsyncLocalStorage<{ executionId: string }>,
): void {
  executionContextRef = ctx;
}

export function getCapturedRejection(executionId: string): CapturedRejection | undefined {
  return capturedRejections.get(executionId);
}

export function clearCapturedRejection(executionId: string): void {
  capturedRejections.delete(executionId);
}

function isConnectError(err: unknown): err is Error & { code?: string } {
  if (!(err instanceof Error)) return false;
  const name = err.constructor?.name ?? "";
  return name === "ConnectError"
    || err.name === "ConnectError"
    || (typeof (err as unknown as Record<string, unknown>).code === "string"
      && err.message?.includes("[")
      && (err.stack?.includes("connectrpc") ?? false));
}

function extractConnectCode(err: Error & { code?: string }): string {
  if (typeof err.code === "string") return err.code;
  const bracketMatch = err.message.match(/\[([a-z_]+)\]/);
  if (bracketMatch) return bracketMatch[1];
  return "unknown";
}

export function handleUnhandledRejection(reason: unknown): void {
  if (isConnectError(reason)) {
    const code = extractConnectCode(reason);
    const executionId = executionContextRef?.getStore()?.executionId;

    if (executionId) {
      capturedRejections.set(executionId, {
        code,
        message: reason.message,
        timestamp: Date.now(),
      });
      console.error(
        `[rejection-capture] ConnectError correlated to execution=${executionId}, ` +
        `code=${code}, message=${reason.message}`,
      );
    } else {
      console.error(
        `[rejection-capture] ConnectError without execution context: ` +
        `code=${code}, message=${reason.message}`,
      );
    }
  } else {
    console.error("Unhandled rejection in runner:", reason);
  }

  evictStaleEntries();
}

function evictStaleEntries(): void {
  const now = Date.now();
  for (const [id, entry] of capturedRejections) {
    if (now - entry.timestamp > REJECTION_TTL_MS) {
      capturedRejections.delete(id);
    }
  }
}
