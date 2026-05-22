/**
 * Notification Temporal activity — sends fire-and-forget notifications
 * through channel providers (webhook, etc.).
 *
 * Resolves JIT placeholders in body, subject, recipients, and metadata
 * values before dispatching to the provider. Delivery is non-fatal:
 * errors produce a result with delivered=false rather than failing
 * the activity.
 */

import { getProvider, type NotificationResult } from "../notification/index.js";
import { resolveObjectPlaceholders } from "../workflow-engine/resolve.js";

export interface NotificationConfig {
  readonly channel: string;
  readonly recipients: readonly string[];
  readonly subject?: string;
  readonly body: string;
  readonly template?: string;
  readonly metadata?: Readonly<Record<string, string>>;
}

function resolveStringPlaceholder(
  value: string,
  env: Record<string, unknown>,
): string {
  const resolved = resolveObjectPlaceholders({ __v: value }, env) as Record<string, unknown>;
  return String(resolved.__v ?? value);
}

export async function notificationAction(
  config: NotificationConfig,
  runtimeEnv: Record<string, unknown>,
): Promise<NotificationResult> {
  if (!config.channel) {
    throw new Error("notification: 'channel' field is required");
  }
  if (!config.body) {
    throw new Error("notification: 'body' field is required");
  }
  if (!config.recipients || config.recipients.length === 0) {
    throw new Error("notification: at least one recipient is required");
  }

  const resolvedBody = resolveStringPlaceholder(config.body, runtimeEnv);
  const resolvedSubject = config.subject
    ? resolveStringPlaceholder(config.subject, runtimeEnv)
    : "";

  const resolvedRecipients = config.recipients.map(
    r => resolveStringPlaceholder(r, runtimeEnv),
  );

  const resolvedMetadata: Record<string, string> = {};
  if (config.metadata) {
    for (const [k, v] of Object.entries(config.metadata)) {
      resolvedMetadata[k] = resolveStringPlaceholder(v, runtimeEnv);
    }
  }

  const provider = getProvider(config.channel);

  return provider.send({
    channel: config.channel,
    recipients: resolvedRecipients,
    subject: resolvedSubject,
    body: resolvedBody,
    template: config.template,
    metadata: resolvedMetadata,
  });
}
