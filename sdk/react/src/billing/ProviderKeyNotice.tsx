"use client";

import { cn } from "@stigmer/design-tokens";
import { getErrorReason, getUserMessage } from "@stigmer/client";

/**
 * The reason a server refuses a run that needs a provider nothing serves:
 * the organization holds no key for it, or this server's runners do not
 * reach it (`PlatformQueryController.getModelReadiness` reports the same).
 */
export const PROVIDER_KEY_REQUIRED = "PROVIDER_KEY_REQUIRED";

/** Models & providers, where the notice links by default: the top-level route every client serves. */
export const DEFAULT_MODELS_HUB_HREF = "/models";

/** What a `PROVIDER_KEY_REQUIRED` refusal names. */
export interface ProviderKeyRequired {
  /** The organization the run was refused in. */
  readonly org: string;
  /** The provider it has no key for: `anthropic` or `openai`. */
  readonly provider: string;
  /** The model the run would have used; empty when it names none. */
  readonly model: string;
}

/**
 * What a refusal names, when `error` is a `PROVIDER_KEY_REQUIRED` refusal;
 * `null` for any other error.
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
  /** Where Models & providers is, in the host's routing. Defaults to {@link DEFAULT_MODELS_HUB_HREF}. */
  readonly modelsHubHref?: string;
  /** Additional CSS class names. */
  readonly className?: string;
}

/**
 * Says a run was not started because nothing serves the provider it needs
 * (the server's own words: where an admin adds a key, or how a laptop's
 * runner gets one), and links Models & providers, in place of a bare
 * refusal.
 *
 * @example
 * ```tsx
 * if (providerKeyRequired(error) !== null) return <ProviderKeyNotice error={error} />;
 * ```
 */
export function ProviderKeyNotice({
  error,
  modelsHubHref = DEFAULT_MODELS_HUB_HREF,
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
        href={modelsHubHref}
        className="stg:mt-1 stg:inline-block stg:font-medium stg:text-primary stg:hover:underline"
      >
        Open Models &amp; providers
      </a>
    </div>
  );
}
