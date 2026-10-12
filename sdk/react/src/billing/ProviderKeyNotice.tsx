"use client";

import { cn } from "@stigmer/theme";
import { getErrorReason, getUserMessage } from "@stigmer/sdk";

/**
 * The reason Stigmer Cloud refuses a run that needs a provider the
 * organization holds no key for: its model's, or Cursor for a run on the
 * Cursor harness (billing/providerkey/v1/api.proto).
 */
export const PROVIDER_KEY_REQUIRED = "PROVIDER_KEY_REQUIRED";

/** The provider keys page the notice links to by default: the settings route every client serves. */
export const DEFAULT_PROVIDER_KEYS_HREF = "/settings/provider-keys";

/** What a `PROVIDER_KEY_REQUIRED` refusal names. */
export interface ProviderKeyRequired {
  /** The organization the run was refused in. */
  readonly org: string;
  /** The provider it has no key for: `anthropic`, `openai` or `cursor`. */
  readonly provider: string;
  /** The model the run would have used; empty when it names none, as a Cursor run on Auto does. */
  readonly model: string;
}

/**
 * What a refusal names, when `error` is Stigmer Cloud's
 * `PROVIDER_KEY_REQUIRED`; `null` for any other error.
 */
export function providerKeyRequired(error: unknown): ProviderKeyRequired | null {
  const reason = getErrorReason(error);
  if (reason?.reason !== PROVIDER_KEY_REQUIRED) {
    return null;
  }
  return {
    org: reason.metadata.org ?? "",
    provider: reason.metadata.provider ?? "",
    model: reason.metadata.model ?? "",
  };
}

/** Props for {@link ProviderKeyNotice}. */
export interface ProviderKeyNoticeProps {
  /** The refusal: its message is the server's own copy, naming the provider, and the model when the run names one. */
  readonly error: Error;
  /** Where the provider keys page is, in the host's routing. Defaults to {@link DEFAULT_PROVIDER_KEYS_HREF}. */
  readonly providerKeysHref?: string;
  /** Additional CSS class names. */
  readonly className?: string;
}

/**
 * Says a run was not started because the organization has no key for the
 * provider it needs, and where an admin adds one, in place of a bare
 * refusal.
 *
 * @example
 * ```tsx
 * if (providerKeyRequired(error) !== null) return <ProviderKeyNotice error={error} />;
 * ```
 */
export function ProviderKeyNotice({
  error,
  providerKeysHref = DEFAULT_PROVIDER_KEYS_HREF,
  className,
}: ProviderKeyNoticeProps) {
  return (
    <div
      className={cn(
        "stg:rounded-md stg:border stg:border-border stg:bg-muted-subtle stg:px-3 stg:py-2 stg:text-xs",
        className,
      )}
      role="alert"
    >
      <p className="stg:text-foreground">{getUserMessage(error)}</p>
      <a
        href={providerKeysHref}
        className="stg:mt-1 stg:inline-block stg:font-medium stg:text-primary stg:hover:underline"
      >
        Open provider keys
      </a>
    </div>
  );
}
