/**
 * Tracks per-task execution status across a workflow run.
 *
 * SANDBOX-SAFE: This class runs inside the Temporal deterministic V8
 * isolate. No Node.js built-ins, no crypto, no non-deterministic ops.
 * All data is plain objects suitable for serialization across the
 * sandbox boundary via Temporal local-activity arguments.
 */

/** Maximum serialized size (bytes) for input/output payloads stored per task. */
const MAX_PAYLOAD_BYTES = 65_536;

export interface TaskStatusEntry {
  readonly taskName: string;
  readonly taskKind: string;
  readonly status: "started" | "completed" | "failed" | "skipped" | "waiting_approval";
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly error?: string;
  readonly durationMs?: number;
  readonly input?: unknown;
  readonly output?: unknown;
  readonly metadata?: Record<string, unknown>;
  readonly costMicros?: number;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
}

/**
 * Truncates a payload to fit within the configured size limit.
 *
 * SANDBOX-SAFE: uses only JSON.stringify (deterministic for plain objects)
 * and string slicing. No crypto, no Buffer, no Node.js APIs.
 *
 * Returns the value unchanged if it fits. Returns a summary object with
 * a truncation marker and preview if it exceeds the limit.
 */
export function truncatePayload(value: unknown, maxBytes = MAX_PAYLOAD_BYTES): unknown {
  if (value === undefined || value === null) return value;

  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    return { _truncated: true, _reason: "unserializable" };
  }

  if (serialized.length <= maxBytes) return value;

  const preview = serialized.slice(0, 2048);
  return {
    _truncated: true,
    _original_bytes: serialized.length,
    _preview: preview,
  };
}

export class TaskStatusAccumulator {
  private readonly entries = new Map<string, TaskStatusEntry>();

  taskStarted(name: string, kind: string): void {
    this.entries.set(name, {
      taskName: name,
      taskKind: kind,
      status: "started",
      startedAt: new Date().toISOString(),
    });
  }

  taskStartedWithInput(name: string, kind: string, input: unknown): void {
    this.entries.set(name, {
      taskName: name,
      taskKind: kind,
      status: "started",
      startedAt: new Date().toISOString(),
      input: truncatePayload(input),
    });
  }

  taskCompleted(name: string, durationMs: number): void {
    const existing = this.entries.get(name);
    this.entries.set(name, {
      ...existing,
      taskName: name,
      taskKind: existing?.taskKind ?? "",
      status: "completed",
      startedAt: existing?.startedAt,
      completedAt: new Date().toISOString(),
      durationMs,
    });
  }

  taskCompletedWithResult(
    name: string,
    durationMs: number,
    output: unknown,
    cost?: { costMicros: number; inputTokens: number; outputTokens: number },
  ): void {
    const existing = this.entries.get(name);
    this.entries.set(name, {
      ...existing,
      taskName: name,
      taskKind: existing?.taskKind ?? "",
      status: "completed",
      startedAt: existing?.startedAt,
      completedAt: new Date().toISOString(),
      durationMs,
      output: truncatePayload(output),
      costMicros: cost?.costMicros ?? existing?.costMicros,
      inputTokens: cost?.inputTokens ?? existing?.inputTokens,
      outputTokens: cost?.outputTokens ?? existing?.outputTokens,
    });
  }

  taskFailed(name: string, error: string, structuredError?: {
    category: string;
    detail: string;
    retryable: boolean;
  }): void {
    const existing = this.entries.get(name);
    const metadata = structuredError
      ? {
          ...existing?.metadata,
          error_category: structuredError.category,
          error_detail: structuredError.detail,
          error_retryable: structuredError.retryable,
        }
      : existing?.metadata;

    this.entries.set(name, {
      ...existing,
      taskName: name,
      taskKind: existing?.taskKind ?? "",
      status: "failed",
      startedAt: existing?.startedAt,
      completedAt: new Date().toISOString(),
      error,
      metadata,
    });
  }

  taskSkipped(name: string, reason: string): void {
    const existing = this.entries.get(name);
    this.entries.set(name, {
      taskName: name,
      taskKind: existing?.taskKind ?? "",
      status: "skipped",
      completedAt: new Date().toISOString(),
      error: reason,
    });
  }

  taskWaitingApproval(name: string): void {
    const existing = this.entries.get(name);
    this.entries.set(name, {
      ...existing,
      taskName: name,
      taskKind: existing?.taskKind ?? "",
      status: "waiting_approval",
      startedAt: existing?.startedAt,
    });
  }

  setTaskMetadata(name: string, metadata: Record<string, unknown>): void {
    const existing = this.entries.get(name);
    if (!existing) return;
    this.entries.set(name, {
      ...existing,
      metadata: { ...existing.metadata, ...metadata },
    });
  }

  toArray(): TaskStatusEntry[] {
    return Array.from(this.entries.values());
  }
}
