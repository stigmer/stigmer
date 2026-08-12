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
 * - signal:  signal to another workflow execution's listen task, routed
 *            through the server's SendSignal lane
 *
 * Signal delivery is deliberately server-mediated (oss#517): a direct
 * Temporal client here would bypass the authorization boundary (any
 * workflow could signal any workflow id in the namespace) and is
 * structurally incompatible with payload encryption — emit→listen is
 * the platform's only runner-to-runner channel, and under per-identity
 * runner keys a sender-encrypted signal fails closed at a receiver
 * holding a different key. The server re-produces the payload, so each
 * side's codec passes it through.
 *
 * CloudEvents spec: https://github.com/cloudevents/spec/blob/v1.0.2/cloudevents/spec.md
 */

import { randomUUID } from "node:crypto";
import type { JsonObject } from "@bufbuild/protobuf";
import { StigmerClient } from "../client/stigmer-client.js";
import { loadConfig } from "../config.js";
import { resolveRuntimePlaceholders } from "../workflow-engine/resolve.js";

export interface WebhookDeliveryTarget {
  readonly url: string;
  readonly headers?: Readonly<Record<string, string>>;
}

export interface SignalDeliveryTarget {
  /** Target workflow execution id ("wfx_..."), as returned by run/create. */
  readonly execution_id: string;
  /** Signal name matching the target's listen task event id (verbatim). */
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

// Delivery is best-effort by contract, so no single target may consume the
// CallFunction activity's whole 5m startToClose budget. Same bound as the
// webhook arm.
const SIGNAL_TIMEOUT_MS = 30_000;

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

function buildClient(): StigmerClient {
  const config = loadConfig();
  return new StigmerClient({
    endpoint: config.stigmerBackendEndpoint,
    token: config.stigmerToken,
  });
}

async function deliverSignal(
  envelope: Record<string, unknown>,
  target: SignalDeliveryTarget,
  client: StigmerClient,
): Promise<DeliveryError | null> {
  // Refuse the pre-oss#517 field by name: direct-addressing raw Temporal
  // workflow ids is exactly the capability server mediation removes.
  const legacyWorkflowId = (target as { workflow_id?: unknown }).workflow_id;
  if (!target.execution_id) {
    const reason = legacyWorkflowId
      ? "signal delivery addresses workflow executions by 'execution_id' (\"wfx_...\"); 'workflow_id' is not supported"
      : "signal delivery requires 'execution_id'";
    return {
      target: `signal:${String(legacyWorkflowId ?? "")}/${target.signal_name ?? ""}`,
      error: reason,
    };
  }
  if (!target.signal_name) {
    return {
      target: `signal:${target.execution_id}/`,
      error: "signal delivery requires 'signal_name'",
    };
  }

  try {
    await client.sendWorkflowSignal(
      target.execution_id,
      target.signal_name,
      envelope as JsonObject,
      { timeoutMs: SIGNAL_TIMEOUT_MS },
    );
    return null;
  } catch (err) {
    // Server refusals arrive as ConnectErrors whose messages carry the code
    // (e.g. [not_found], [failed_precondition] for terminal executions) —
    // surfaced verbatim in delivery_errors, same contract as the webhook arm.
    const message = err instanceof Error ? err.message : String(err);
    return {
      target: `signal:${target.execution_id}/${target.signal_name}`,
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

  // One client serves all signal targets of this emit; constructed lazily so
  // webhook-only emits never pay for a gRPC transport.
  let client: StigmerClient | undefined;

  for (const target of config.delivery) {
    let err: DeliveryError | null = null;

    if ("webhook" in target) {
      err = await deliverWebhook(envelope, target.webhook, env);
    } else if ("signal" in target) {
      client ??= buildClient();
      err = await deliverSignal(envelope, target.signal, client);
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
