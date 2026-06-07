/**
 * Emit event action — constructs a CloudEvents 1.0 envelope and
 * optionally delivers it to external targets.
 *
 * Delivery targets are optional. When absent, the envelope is returned
 * as task output only (backward compatible). When present, the envelope
 * is delivered to each target. Delivery is non-fatal: failures are
 * collected in the result but do not fail the task.
 *
 * Supported delivery targets:
 * - webhook: HTTP POST with Content-Type: application/cloudevents+json
 * - signal:  Temporal signal to another running workflow's listen task
 *
 * CloudEvents spec: https://github.com/cloudevents/spec/blob/v1.0.2/cloudevents/spec.md
 */

import { randomUUID } from "node:crypto";
import { loadConfig } from "../config.js";
import { resolveRuntimePlaceholders } from "../workflow-engine/resolve.js";

export interface WebhookDeliveryTarget {
  readonly url: string;
  readonly headers?: Readonly<Record<string, string>>;
}

export interface SignalDeliveryTarget {
  readonly workflow_id: string;
  readonly signal_name: string;
}

export type DeliveryTarget =
  | { readonly webhook: WebhookDeliveryTarget }
  | { readonly signal: SignalDeliveryTarget };

export interface EmitEventConfig {
  readonly event: {
    readonly type: string;
    readonly source?: string;
    readonly subject?: string;
    readonly data?: Record<string, unknown>;
  };
  readonly delivery?: readonly DeliveryTarget[];
}

export interface DeliveryError {
  readonly target: string;
  readonly error: string;
}

export interface EmitEventResult {
  readonly envelope: Record<string, unknown>;
  readonly delivery_errors?: readonly DeliveryError[];
}

const WEBHOOK_TIMEOUT_MS = 30_000;

function buildEnvelope(
  config: EmitEventConfig,
  executionId: string,
): Record<string, unknown> {
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

async function deliverWebhook(
  envelope: Record<string, unknown>,
  target: WebhookDeliveryTarget,
  runtimeEnv: Record<string, unknown>,
): Promise<DeliveryError | null> {
  const resolvedHeaders: Record<string, string> = {
    "Content-Type": "application/cloudevents+json",
  };

  if (target.headers) {
    for (const [k, v] of Object.entries(target.headers)) {
      resolvedHeaders[k] = resolveRuntimePlaceholders(v, runtimeEnv);
    }
  }

  try {
    const response = await fetch(target.url, {
      method: "POST",
      headers: resolvedHeaders,
      body: JSON.stringify(envelope),
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
    });

    if (response.status >= 400) {
      return {
        target: `webhook:${target.url}`,
        error: `HTTP ${response.status}`,
      };
    }

    return null;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      target: `webhook:${target.url}`,
      error: message,
    };
  }
}

async function deliverSignal(
  envelope: Record<string, unknown>,
  target: SignalDeliveryTarget,
): Promise<DeliveryError | null> {
  try {
    const { Connection, Client } = await import("@temporalio/client");

    // Resolve Temporal coordinates through the central config layer rather than
    // reading env directly: signal delivery must dial the SAME cluster/namespace
    // the worker connected with. config.ts is the single source of truth for the
    // canonical TEMPORAL_SERVICE_ADDRESS / TEMPORAL_NAMESPACE resolution — reading
    // env here would diverge (and previously dialed localhost via a stale name).
    const config = loadConfig();
    const temporalAddress = config.temporalAddress;
    const temporalNamespace = config.temporalNamespace;

    const connection = await Connection.connect({ address: temporalAddress });
    const client = new Client({ connection, namespace: temporalNamespace });

    const handle = client.workflow.getHandle(target.workflow_id);
    await handle.signal(target.signal_name, envelope);

    return null;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      target: `signal:${target.workflow_id}/${target.signal_name}`,
      error: message,
    };
  }
}

export async function emitEventAction(
  config: EmitEventConfig,
  executionId: string,
  runtimeEnv?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (!config.event) {
    throw new Error("emit_event: 'event' field is required");
  }
  if (!config.event.type) {
    throw new Error("emit_event: 'event.type' field is required");
  }

  const envelope = buildEnvelope(config, executionId);

  if (!config.delivery || config.delivery.length === 0) {
    return envelope;
  }

  const errors: DeliveryError[] = [];
  const env = runtimeEnv ?? {};

  for (const target of config.delivery) {
    let err: DeliveryError | null = null;

    if ("webhook" in target) {
      err = await deliverWebhook(envelope, target.webhook, env);
    } else if ("signal" in target) {
      err = await deliverSignal(envelope, target.signal);
    }

    if (err) {
      errors.push(err);
    }
  }

  if (errors.length > 0) {
    return { ...envelope, delivery_errors: errors };
  }

  return envelope;
}
