/**
 * Notification provider registry.
 *
 * Channels are string identifiers (not an enum) for extensibility —
 * new channels can be added without code changes beyond implementing
 * the Provider interface and calling registerProvider().
 */

export interface NotificationRequest {
  readonly channel: string;
  readonly recipients: readonly string[];
  readonly subject: string;
  readonly body: string;
  readonly template?: string;
  readonly metadata: Readonly<Record<string, string>>;
}

export interface NotificationResult {
  readonly channel: string;
  readonly recipients: readonly string[];
  readonly delivered: boolean;
  readonly delivered_at?: string;
  readonly error?: string;
}

export interface NotificationProvider {
  channel(): string;
  send(request: NotificationRequest): Promise<NotificationResult>;
}

const providers = new Map<string, NotificationProvider>();

export function registerProvider(provider: NotificationProvider): void {
  providers.set(provider.channel(), provider);
}

export function getProvider(channel: string): NotificationProvider {
  const provider = providers.get(channel);
  if (!provider) {
    const available = providers.size > 0
      ? Array.from(providers.keys()).join(", ")
      : "(none)";
    throw new Error(
      `Notification channel '${channel}' is not implemented; available channels: ${available}`,
    );
  }
  return provider;
}

export function resetProviders(): void {
  providers.clear();
}
