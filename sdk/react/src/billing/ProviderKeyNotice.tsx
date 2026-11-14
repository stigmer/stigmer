"use client";

import { getErrorReason, getUserMessage } from "@stigmer/client";
import { ALERT_ICON, Notice } from "../internal/surface/Notice.js";
import { presentationOf } from "../models/provider-presentation.js";

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
 * Says a run was not started because nothing serves the provider it needs,
 * as the console's notice: the organization has no key for the provider
 * (or, where the refusal names no organization, the server's own words,
 * such as how a laptop's runner gets one), that the message stays in the
 * box, and Open Models & providers, in place of a bare refusal.
 *
 * @example
 * ```tsx
 * function RunError({ error }: { error: Error }) {
 *   if (providerKeyRequired(error) !== null) return <ProviderKeyNotice error={error} />;
 *   return <ErrorMessage error={error} />;
 * }
 * ```
 */
export function ProviderKeyNotice({
  error,
  modelsHubHref = DEFAULT_MODELS_HUB_HREF,
  className,
}: ProviderKeyNoticeProps) {
  const required = providerKeyRequired(error);
  const provider = required !== null && required.provider !== "" ? presentationOf(required.provider).name : "";
  const ofOrganization = required !== null && required.org !== "";
  return (
    <Notice
      tone="paused"
      role="alert"
      icon={ALERT_ICON}
      headline={ofOrganization ? `This organization has no ${provider === "" ? "model" : provider} key yet.` : getUserMessage(error)}
      act={{ label: "Open Models & providers", href: modelsHubHref }}
      actSize="xs"
      className={className}
    >
      <p className="stg:m-0">{ofOrganization ? "Add one on Models & providers, then send. Your message stays in the box." : "Your message stays in the box."}</p>
    </Notice>
  );
}
