"use client";

import { useCallback, useId, useState } from "react";
import { cn } from "@stigmer/theme";
import { getUserMessage } from "@stigmer/sdk";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import type { ProviderKey } from "@stigmer/protos/ai/stigmer/billing/providerkey/v1/api_pb";
import { Button } from "../button/index.js";
import { ApiResourceKind, useDeploymentMode, useResourceAvailable } from "../deployment-mode.js";
import { useCheckPermission } from "../iam-policy/useCheckPermission.js";
import { CloudFeatureNotice } from "../internal/CloudFeatureNotice.js";
import { UNSTYLED_LIST } from "../internal/element-resets.js";
import { useOrg } from "../organization/OrgProvider.js";
import { useProviderKeyActions, useProviderKeys, type ProviderKeyProvider } from "./useProviderKeys.js";

/** One provider the section lists. */
interface ProviderEntry {
  readonly id: ProviderKeyProvider;
  readonly name: string;
  /** The key field's placeholder, in the shape of the provider's keys. */
  readonly placeholder: string;
  /**
   * An example own endpoint, as the provider's SDK takes it, for a provider
   * that can be served from an endpoint of the organization's; `null` for one
   * served only from its own hosts, which gets no base-URL field and is
   * always saved without one (the contract refuses a Cursor key with one).
   */
  readonly baseUrlExample: string | null;
  /** What key the provider takes, shown under the key field; `null` when the label says it all. */
  readonly keyHint: string | null;
}

/** The providers, in the order the section lists them. */
const PROVIDERS: readonly ProviderEntry[] = [
  {
    id: "anthropic",
    name: "Anthropic",
    placeholder: "sk-ant-…",
    baseUrlExample: "https://gateway.example.com",
    keyHint: null,
  },
  {
    id: "openai",
    name: "OpenAI",
    placeholder: "sk-…",
    baseUrlExample: "https://gateway.example.com/v1",
    keyHint: null,
  },
  {
    id: "cursor",
    name: "Cursor",
    placeholder: "key_…",
    baseUrlExample: null,
    keyHint:
      "A Cursor user API key (Cursor dashboard → API Keys) or a team service-account key. Cursor bills usage to that user's plan or that team.",
  },
];

/** Props for {@link ProviderKeysSection}. */
export interface ProviderKeysSectionProps {
  /** Additional CSS class names. */
  readonly className?: string;
}

/**
 * Settings section for an organization's own provider keys.
 *
 * On Stigmer Cloud every model call runs on a key the organization owns, on
 * every plan: an admin saves an Anthropic or OpenAI key, optionally against
 * the organization's own Anthropic- or OpenAI-compatible endpoint (a company
 * gateway, a model server it runs), and a Cursor key (a user API key or a
 * team service-account key, always on Cursor's own hosts) for the agents
 * that run on Cursor; its agents run on them. The provider bills the
 * organization directly. A run that needs a provider with no key is refused
 * until one is added. A saved key is never shown again,
 * only its last four characters. A child organization is served by its
 * parent's key for a provider it holds none of, shown read-only.
 *
 * Every member sees the list; admins (`can_manage_billing`) save, replace
 * and remove.
 *
 * Cloud-only: in local mode the runner already uses the developer's own
 * keys directly.
 *
 * @example
 * ```tsx
 * <ProviderKeysSection />
 * ```
 */
export function ProviderKeysSection({ className }: ProviderKeysSectionProps) {
  const headingId = useId();
  const { activeOrg } = useOrg();
  const mode = useDeploymentMode();
  const available = useResourceAvailable(ApiResourceKind.subscription);
  const org = activeOrg?.metadata?.id ?? "";

  return (
    <section aria-labelledby={headingId} className={className}>
      <h2 id={headingId} className="stg:text-foreground stg:mb-1 stg:text-sm stg:font-semibold">
        Provider keys
      </h2>
      <p className="stg:text-muted-foreground stg:mb-4 stg:text-xs">
        Your agents run on your organization&apos;s own Anthropic, OpenAI and Cursor keys: Anthropic and OpenAI on the
        provider&apos;s API or on your own compatible endpoint, Cursor on Cursor&apos;s. The provider bills you directly. A
        run that needs a provider with no key here is refused until an admin adds one.
      </p>
      {mode === "local" || !available ? (
        <CloudFeatureNotice>
          Provider keys are a Stigmer Cloud setting. Local mode already calls the providers with your own keys
          directly.
        </CloudFeatureNotice>
      ) : !org ? (
        <p className="stg:text-muted-foreground stg:py-4 stg:text-center stg:text-xs">
          Select an organization to manage its provider keys.
        </p>
      ) : (
        <ProviderKeysContent org={org} />
      )}
    </section>
  );
}

function ProviderKeysContent({ org }: { readonly org: string }) {
  const listed = useProviderKeys(org);
  const manage = useCheckPermission({ kind: "organization", id: org }, "can_manage_billing");
  const canManage = !manage.isLoading && manage.allowed;
  const actions = useProviderKeyActions();
  const [editing, setEditing] = useState<ProviderKeyProvider | null>(null);

  const keys = listed.keys ?? [];
  const { refetch } = listed;
  const refresh = useCallback(() => refetch(), [refetch]);

  if (listed.error) {
    return <p className="stg:text-destructive stg:text-xs">{getUserMessage(listed.error)}</p>;
  }
  if (listed.keys === null) {
    return <p className="stg:text-muted-foreground stg:text-xs">Loading provider keys…</p>;
  }

  return (
    <div className="stg:space-y-3">
      <ul
        aria-label="Provider keys"
        className={cn(UNSTYLED_LIST, "stg:divide-y stg:divide-border stg:rounded-md stg:border stg:border-border")}
      >
        {PROVIDERS.map((provider) => (
          <ProviderRow
            key={provider.id}
            org={org}
            provider={provider}
            stored={keys.find((key) => key.provider === provider.id)}
            canManage={canManage}
            editing={editing === provider.id}
            onEdit={() => {
              actions.clearError();
              setEditing(provider.id);
            }}
            onDone={() => {
              setEditing(null);
              refresh();
            }}
            onCancel={() => setEditing(null)}
            actions={actions}
          />
        ))}
      </ul>
      {actions.error && (
        <p role="alert" className="stg:text-destructive stg:text-xs">
          {getUserMessage(actions.error)}
        </p>
      )}
      <p className="stg:text-muted-foreground stg:text-[0.65rem]">
        A failure on your key, such as a rejected key, an exhausted provider balance or a usage limit, is reported as
        your key&apos;s.
        Stigmer never serves a call on keys of its own.
      </p>
    </div>
  );
}

/** The text inputs' classes. */
const INPUT_CLASSES = cn(
  "stg:w-full stg:rounded-md stg:border stg:border-input stg:bg-background stg:px-2.5 stg:py-1.5 stg:text-xs stg:text-foreground",
  "stg:placeholder:text-muted-foreground",
  "stg:focus-visible:outline-none stg:focus-visible:ring-1 stg:focus-visible:ring-ring",
  "stg:disabled:pointer-events-none stg:disabled:opacity-50",
);

function ProviderRow({
  org,
  provider,
  stored,
  canManage,
  editing,
  onEdit,
  onDone,
  onCancel,
  actions,
}: {
  readonly org: string;
  readonly provider: ProviderEntry;
  readonly stored: ProviderKey | undefined;
  readonly canManage: boolean;
  readonly editing: boolean;
  readonly onEdit: () => void;
  readonly onDone: () => void;
  readonly onCancel: () => void;
  readonly actions: ReturnType<typeof useProviderKeyActions>;
}) {
  const inputId = useId();
  const keyHintId = useId();
  const baseUrlId = useId();
  const baseUrlHintId = useId();
  const [value, setValue] = useState("");
  const [confirming, setConfirming] = useState(false);
  const inherited = stored !== undefined && stored.inheritedFromOrg !== "";
  const own = stored !== undefined && !inherited;
  const [baseUrl, setBaseUrl] = useState(own ? (stored?.baseUrl ?? "") : "");

  const save = async () => {
    try {
      await actions.setKey(org, provider.id, value.trim(), provider.baseUrlExample === null ? "" : baseUrl.trim());
      setValue("");
      onDone();
    } catch {
      // The hook holds the error; the section renders it.
    }
  };
  const remove = async () => {
    try {
      await actions.removeKey(org, provider.id);
      setConfirming(false);
      onDone();
    } catch {
      // The hook holds the error; the section renders it.
    }
  };

  return (
    <li className="stg:space-y-2 stg:px-3 stg:py-2.5">
      <div className="stg:flex stg:items-start stg:justify-between stg:gap-3">
        <div className="stg:min-w-0">
          <p className="stg:text-foreground stg:text-xs stg:font-medium">{provider.name}</p>
          <p className="stg:text-muted-foreground stg:text-[0.7rem]">{describe(stored, provider.name)}</p>
        </div>
        {!editing && !confirming && (
          <div className="stg:flex stg:shrink-0 stg:gap-2">
            {canManage && !inherited && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setBaseUrl(own ? (stored?.baseUrl ?? "") : "");
                  onEdit();
                }}
                disabled={actions.isSubmitting}
              >
                {own ? "Replace" : "Add key"}
              </Button>
            )}
            {canManage && own && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  actions.clearError();
                  setConfirming(true);
                }}
                disabled={actions.isSubmitting}
              >
                Remove
              </Button>
            )}
          </div>
        )}
      </div>
      {confirming && (
        <div className="stg:flex stg:flex-wrap stg:items-center stg:justify-between stg:gap-2 stg:rounded-md stg:border stg:border-destructive/30 stg:bg-destructive-subtle stg:px-2.5 stg:py-2">
          <p className="stg:text-foreground stg:min-w-0 stg:flex-1 stg:text-xs">
            {`Remove your ${provider.name} key? Runs that need ${provider.name} are refused until a key serves this organization again.`}
          </p>
          <div className="stg:flex stg:shrink-0 stg:gap-2">
            <Button size="sm" variant="destructive" onClick={() => void remove()} disabled={actions.isSubmitting}>
              {actions.isSubmitting ? "Removing…" : "Remove key"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)} disabled={actions.isSubmitting}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      {editing && (
        <form
          className="stg:flex stg:flex-wrap stg:items-end stg:gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <div className="stg:min-w-48 stg:flex-1 stg:space-y-1">
            <label htmlFor={inputId} className="stg:text-foreground stg:text-xs stg:font-medium">
              {provider.name} API key
            </label>
            <input
              id={inputId}
              type="password"
              autoComplete="off"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder={provider.placeholder}
              aria-describedby={provider.keyHint === null ? undefined : keyHintId}
              disabled={actions.isSubmitting}
              className={INPUT_CLASSES}
            />
          </div>
          {provider.baseUrlExample !== null && (
            <div className="stg:min-w-48 stg:flex-1 stg:space-y-1">
              <label htmlFor={baseUrlId} className="stg:text-foreground stg:text-xs stg:font-medium">
                Base URL (optional)
              </label>
              <input
                id={baseUrlId}
                type="url"
                inputMode="url"
                autoComplete="off"
                value={baseUrl}
                onChange={(event) => setBaseUrl(event.target.value)}
                placeholder={provider.baseUrlExample}
                aria-describedby={baseUrlHintId}
                disabled={actions.isSubmitting}
                className={INPUT_CLASSES}
              />
            </div>
          )}
          {provider.keyHint !== null && (
            <p id={keyHintId} className="stg:text-muted-foreground stg:w-full stg:text-[0.65rem]">
              {provider.keyHint}
            </p>
          )}
          {provider.baseUrlExample !== null && (
            <p id={baseUrlHintId} className="stg:text-muted-foreground stg:w-full stg:text-[0.65rem]">
              Empty uses {provider.name}&apos;s own API. For your own {provider.name}-compatible endpoint, give an
              https URL as {provider.name}&apos;s SDK takes it, such as {provider.baseUrlExample}.
            </p>
          )}
          <Button size="sm" type="submit" disabled={actions.isSubmitting || value.trim() === ""}>
            {actions.isSubmitting ? "Saving…" : "Save key"}
          </Button>
          <Button size="sm" variant="ghost" type="button" onClick={onCancel} disabled={actions.isSubmitting}>
            Cancel
          </Button>
        </form>
      )}
    </li>
  );
}

/** One line about a provider's key: none, own (with its endpoint), or inherited. */
function describe(key: ProviderKey | undefined, providerName: string): string {
  if (key === undefined) {
    return `Not set: runs that need ${providerName} are refused until a key is added.`;
  }
  const parts = [`Key ending in ${key.keyHint}`];
  if (key.baseUrl !== "") {
    parts.push(`on ${endpointHost(key.baseUrl)}`);
  }
  if (key.inheritedFromOrg !== "") {
    parts.push(`provided by ${key.inheritedFromOrg}`);
  } else if (key.updatedAt !== undefined) {
    parts.push(`saved ${formatDay(timestampDate(key.updatedAt))}`);
  }
  parts.push(key.lastUsedAt === undefined ? "not used yet" : `last used ${formatDay(timestampDate(key.lastUsedAt))}`);
  return parts.join(" · ");
}

/** The host a base URL names, or the URL itself when it does not parse. */
function endpointHost(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}

function formatDay(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}
