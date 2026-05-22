/**
 * Webhook notification provider — delivers notifications via HTTP POST.
 *
 * Each recipient is treated as a URL. The notification body is sent as
 * a JSON payload: { subject, body, metadata }. Delivery is best-effort:
 * HTTP errors or network failures produce a result with delivered=false
 * rather than throwing, matching Go's non-fatal delivery semantics.
 */

import type { NotificationProvider, NotificationRequest, NotificationResult } from "./provider.js";

const WEBHOOK_TIMEOUT_MS = 30_000;

export class WebhookProvider implements NotificationProvider {
  channel(): string {
    return "webhook";
  }

  async send(request: NotificationRequest): Promise<NotificationResult> {
    const payload = JSON.stringify({
      subject: request.subject,
      body: request.body,
      metadata: request.metadata,
    });

    for (const url of request.recipients) {
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: payload,
          signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
        });

        if (response.status >= 400) {
          return {
            channel: "webhook",
            recipients: [...request.recipients],
            delivered: false,
            error: `Webhook ${url} returned status ${response.status}`,
          };
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          channel: "webhook",
          recipients: [...request.recipients],
          delivered: false,
          error: `Webhook delivery to ${url} failed: ${message}`,
        };
      }
    }

    return {
      channel: "webhook",
      recipients: [...request.recipients],
      delivered: true,
      delivered_at: new Date().toISOString(),
    };
  }
}
