/**
 * Emit event action — constructs a CloudEvents 1.0 envelope.
 *
 * Builds a structured CloudEvents envelope from the task configuration
 * and returns it as the task output. This enables event-sourcing patterns
 * where downstream tasks can read the emitted event envelope.
 *
 * Delivery to external consumers is deferred to Phase 6 (Supporting
 * Infrastructure). In this phase, the envelope is returned as data only.
 *
 * CloudEvents spec: https://github.com/cloudevents/spec/blob/v1.0.2/cloudevents/spec.md
 */

import { randomUUID } from "node:crypto";

export interface EmitEventConfig {
  readonly event: {
    readonly type: string;
    readonly source?: string;
    readonly subject?: string;
    readonly data?: Record<string, unknown>;
  };
}

export function emitEventAction(
  config: EmitEventConfig,
  executionId: string,
): Record<string, unknown> {
  if (!config.event) {
    throw new Error("emit_event: 'event' field is required");
  }
  if (!config.event.type) {
    throw new Error("emit_event: 'event.type' field is required");
  }

  const source = config.event.source || `/workflows/executions/${executionId}`;

  const envelope: Record<string, unknown> = {
    id: randomUUID(),
    specversion: "1.0",
    type: config.event.type,
    source,
    time: new Date().toISOString(),
    datacontenttype: "application/json",
  };

  if (config.event.subject) {
    envelope.subject = config.event.subject;
  }

  if (config.event.data && Object.keys(config.event.data).length > 0) {
    envelope.data = config.event.data;
  }

  return envelope;
}
