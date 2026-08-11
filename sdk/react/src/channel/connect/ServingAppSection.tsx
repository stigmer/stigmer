"use client";

import type { ReactNode } from "react";
import { cn } from "@stigmer/theme";
import type { ResourceRef } from "@stigmer/sdk";
import type { ChannelApp } from "@stigmer/protos/ai/stigmer/agentic/channelapp/v1/api_pb";

/**
 * "Connect as whom" for the channel connect dialogs (T04 item 2): the
 * provider's platform app (when the provider has one — Slack) or one of
 * the org's own channel apps (BYO — the bot carries that app's brand,
 * and each app is its own bot identity).
 *
 * Provider variance is prop-shaped, never branched:
 *
 * - `platformOption` present (Slack): "no selection" means the platform
 *   app, and with zero registered apps the section states that default
 *   plainly instead of a one-option radio group (which would be noise).
 * - `platformOption` absent (WhatsApp, BYO-only per DD-WA-2): an app
 *   selection is required, and with zero registered apps the section
 *   renders the caller's `emptyBody` — a blocking register-first state,
 *   because a channel without an app binding could never install.
 *
 * Both shapes carry the register affordance: a link when the host
 * provided `channelAppsHref`, plain guidance text otherwise.
 */
export function ServingAppSection({
  org,
  apps,
  value,
  onChange,
  disabled,
  channelAppsHref,
  idPrefix,
  platformOption,
  appHint,
  emptyBody,
}: {
  readonly org: string;
  /** The org's channel apps, already filtered to this provider. */
  readonly apps: readonly ChannelApp[];
  readonly value: ResourceRef | null;
  readonly onChange: (ref: ResourceRef | null) => void;
  readonly disabled: boolean;
  readonly channelAppsHref?: string;
  /** Option id prefix + radio-group name, unique per dialog (e.g. "stgm-slack-app"). */
  readonly idPrefix: string;
  /**
   * The provider's shared platform app as a selectable option
   * (`value === null`). Omit for BYO-only providers.
   */
  readonly platformOption?: { readonly label: string; readonly hint: string };
  /** Hint line under each of the org's own apps. */
  readonly appHint: string;
  /** Section body when the org has no apps for this provider. */
  readonly emptyBody: ReactNode;
}) {
  if (apps.length === 0) {
    return (
      <section aria-label="Connect as">
        <h3 className="stg:mb-1.5 stg:text-xs stg:font-medium stg:text-foreground">
          Connect as
        </h3>
        {emptyBody}
      </section>
    );
  }

  return (
    <fieldset>
      <legend className="stg:mb-1.5 stg:block stg:text-xs stg:font-medium stg:text-foreground">
        Connect as
      </legend>
      <div role="radiogroup" className="stg:space-y-1.5">
        {platformOption && (
          <ServingAppOption
            id={`${idPrefix}-platform`}
            name={idPrefix}
            label={platformOption.label}
            hint={platformOption.hint}
            checked={value === null}
            onSelect={() => onChange(null)}
            disabled={disabled}
          />
        )}
        {apps.map((app) => {
          const slug = app.metadata?.slug ?? "";
          const checked = value?.slug === slug;
          return (
            <ServingAppOption
              key={app.metadata?.id ?? slug}
              id={`${idPrefix}-${slug}`}
              name={idPrefix}
              label={app.metadata?.name ?? slug}
              hint={appHint}
              checked={checked}
              onSelect={() => onChange({ org, slug })}
              disabled={disabled}
            />
          );
        })}
      </div>
      <p className="stg:mt-1.5 stg:text-xs stg:text-muted-foreground">
        <RegisterChannelAppAffordance channelAppsHref={channelAppsHref}>
          Register a channel app
        </RegisterChannelAppAffordance>
        .
      </p>
    </fieldset>
  );
}

/**
 * The path from the connect flow to Channel App registration. A link
 * when the host told us where registration lives; otherwise the label
 * plus the console location, so embedded hosts without the route still
 * leave the user oriented. Children are the label ("Register a channel
 * app" / "register a channel app") so each call site reads as a sentence.
 */
export function RegisterChannelAppAffordance({
  channelAppsHref,
  children,
}: {
  readonly channelAppsHref?: string;
  readonly children: ReactNode;
}) {
  if (!channelAppsHref) {
    return <>{children} under Settings → Channel Apps</>;
  }
  return (
    <a
      href={channelAppsHref}
      className={cn(
        "stg:font-medium stg:underline stg:underline-offset-2",
        "stg:hover:no-underline",
        "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring stg:rounded",
      )}
    >
      {children}
    </a>
  );
}

function ServingAppOption({
  id,
  name,
  label,
  hint,
  checked,
  onSelect,
  disabled,
}: {
  readonly id: string;
  readonly name: string;
  readonly label: string;
  readonly hint: string;
  readonly checked: boolean;
  readonly onSelect: () => void;
  readonly disabled: boolean;
}) {
  return (
    <label
      htmlFor={id}
      className={cn(
        "stg:flex stg:cursor-pointer stg:items-start stg:gap-2 stg:rounded-md stg:border stg:px-2.5 stg:py-1.5",
        checked ? "stg:border-ring stg:bg-accent" : "stg:border-border stg:hover:bg-accent-hover",
        disabled && "stg:pointer-events-none stg:opacity-50",
      )}
    >
      <input
        id={id}
        type="radio"
        name={name}
        checked={checked}
        onChange={onSelect}
        disabled={disabled}
        className="stg:mt-0.5 stg:accent-current"
      />
      <span className="stg:min-w-0">
        <span className="stg:block stg:text-xs stg:font-medium stg:text-foreground">{label}</span>
        <span className="stg:block stg:text-[0.65rem] stg:text-muted-foreground">{hint}</span>
      </span>
    </label>
  );
}
