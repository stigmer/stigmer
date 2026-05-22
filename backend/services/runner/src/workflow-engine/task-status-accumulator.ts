/**
 * Tracks per-task execution status across a workflow run.
 *
 * SANDBOX-SAFE: This class runs inside the Temporal deterministic V8
 * isolate. No Node.js built-ins, no crypto, no non-deterministic ops.
 * All data is plain objects suitable for serialization across the
 * sandbox boundary via Temporal local-activity arguments.
 */

export interface TaskStatusEntry {
  readonly taskName: string;
  readonly taskKind: string;
  readonly status: "started" | "completed" | "failed" | "skipped" | "waiting_approval";
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly error?: string;
  readonly durationMs?: number;
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

  taskCompleted(name: string, durationMs: number): void {
    const existing = this.entries.get(name);
    this.entries.set(name, {
      taskName: name,
      taskKind: existing?.taskKind ?? "",
      status: "completed",
      startedAt: existing?.startedAt,
      completedAt: new Date().toISOString(),
      durationMs,
    });
  }

  taskFailed(name: string, error: string): void {
    const existing = this.entries.get(name);
    this.entries.set(name, {
      taskName: name,
      taskKind: existing?.taskKind ?? "",
      status: "failed",
      startedAt: existing?.startedAt,
      completedAt: new Date().toISOString(),
      error,
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
      taskName: name,
      taskKind: existing?.taskKind ?? "",
      status: "waiting_approval",
      startedAt: existing?.startedAt,
    });
  }

  toArray(): TaskStatusEntry[] {
    return Array.from(this.entries.values());
  }
}
