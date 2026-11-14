"use client";

import { getUserMessage } from "@stigmer/client";
import { DEFAULT_MODELS_HUB_HREF, providerKeyRequired } from "./refusals.js";
import { ALERT_ICON, Notice } from "../internal/surface/Notice.js";
import { providerName } from "../models/provider-name.js";

export {
  DEFAULT_MODELS_HUB_HREF,
  PROVIDER_KEY_REQUIRED,
  providerKeyRequired,
  type ProviderKeyRequired,
} from "./refusals.js";

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
  const provider = required !== null && required.provider !== "" ? providerName(required.provider) : "";
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
