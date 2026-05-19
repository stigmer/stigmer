/**
 * Exponential-backoff retry wrapper for gRPC status persistence.
 *
 * Wraps the raw StigmerClient.updateStatus() call with retry logic
 * that classifies gRPC error codes as retryable vs terminal. A failed
 * status update must never crash the streaming loop — on permanent
 * failure, the signal falls back to UNSPECIFIED.
 *
 * Used by the ExecuteDeepAgent streaming loop. The simpler
 * fire-and-forget persistStatus in shared/status.ts is preserved
 * for ExecuteCursor and non-streaming callers.
 */

import { ConnectError, Code } from "@connectrpc/connect";
import { ExecutionControlSignal } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { AgentExecutionStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { StigmerClient } from "../client/stigmer-client.js";

export interface RetryOptions {
  /** Base delay before the first retry (ms). Default: 100. */
  readonly baseDelayMs?: number;
  /** Backoff multiplier between retries. Default: 2. */
  readonly backoffFactor?: number;
  /** Maximum number of retry attempts. Default: 3. */
  readonly maxRetries?: number;
  /** Injectable delay function for testing. */
  readonly delayFn?: (ms: number) => Promise<void>;
}

const RETRYABLE_CODES = new Set<Code>([
  Code.Unavailable,
  Code.DeadlineExceeded,
]);

const TERMINAL_CODES = new Set<Code>([
  Code.InvalidArgument,
  Code.NotFound,
  Code.PermissionDenied,
]);

export function isRetryableError(err: unknown): boolean {
  if (err instanceof ConnectError) {
    return RETRYABLE_CODES.has(err.code);
  }
  return false;
}

export function isTerminalError(err: unknown): boolean {
  if (err instanceof ConnectError) {
    return TERMINAL_CODES.has(err.code);
  }
  return false;
}

function defaultDelay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Persist execution status with exponential-backoff retry.
 *
 * Returns the ExecutionControlSignal from the server on success.
 * On permanent or exhausted-retry failure, logs the error and
 * returns UNSPECIFIED (never throws).
 */
export async function persistWithRetry(
  client: StigmerClient,
  executionId: string,
  status: AgentExecutionStatus,
  options?: RetryOptions,
): Promise<ExecutionControlSignal> {
  const baseDelay = options?.baseDelayMs ?? 100;
  const factor = options?.backoffFactor ?? 2;
  const maxRetries = options?.maxRetries ?? 3;
  const delay = options?.delayFn ?? defaultDelay;

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await client.updateStatus(executionId, status);
      return response.signal;
    } catch (err: unknown) {
      lastError = err;

      if (isTerminalError(err)) {
        const code = (err as ConnectError).code;
        console.error(
          `[grpc-retry] Terminal error persisting status for ${executionId}: ` +
          `code=${Code[code]} (attempt ${attempt + 1}/${maxRetries + 1})`,
        );
        return ExecutionControlSignal.UNSPECIFIED;
      }

      if (!isRetryableError(err) || attempt === maxRetries) {
        break;
      }

      const delayMs = baseDelay * Math.pow(factor, attempt);
      console.warn(
        `[grpc-retry] Retryable error for ${executionId}: ` +
        `code=${err instanceof ConnectError ? Code[err.code] : "unknown"} ` +
        `(attempt ${attempt + 1}/${maxRetries + 1}, retry in ${delayMs}ms)`,
      );
      await delay(delayMs);
    }
  }

  console.error(
    `[grpc-retry] All retries exhausted for ${executionId}: ${lastError}`,
  );
  return ExecutionControlSignal.UNSPECIFIED;
}
