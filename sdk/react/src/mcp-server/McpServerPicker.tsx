"use client";

import {
  useState,
  useCallback,
  useEffect,
  useRef,
  useMemo,
  useId,
  type KeyboardEvent,
} from "react";
import { cn } from "@stigmer/theme";
import type { EnvVarInput, McpServerUsageInput, ResourceRef } from "@stigmer/sdk";
import type { SearchResult } from "@stigmer/protos/ai/stigmer/search/v1/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { EnvVarFormSubmitOptions } from "../environment/EnvVarForm";
import { useMcpServerSearch } from "./useMcpServerSearch";
import { useScrollShadows } from "../internal/useScrollShadows";
import { ScrollFade } from "../internal/ScrollFade";
import { McpServerConfigPanel } from "./McpServerConfigPanel";
import type { McpServerSetupEntry } from "./mcpServerSetupReducer";
import { useMcpServerOAuthConnect } from "./useMcpServerOAuthConnect";

// ---------------------------------------------------------------------------
// Setup integration props
// ---------------------------------------------------------------------------

/**
 * Props for the setup-integrated mode of {@link McpServerPicker}.
 *
 * When the `setup` prop is provided, the picker gains per-server status
 * indicators, credential collection via drill-in to
 * {@link McpServerConfigPanel}, and per-tool selection. Selection is
 * managed through `entries` and the setup callbacks instead of the
 * simple `value`/`onChange` pair.
 *
 * All callbacks are required when setup is enabled — this prevents
 * invalid partial states where entries exist but no handler can
 * respond to user actions.
 *
 * Matches the `credentials?` sub-object pattern established on
 * {@link McpServerConfigPanel} (DD-R13): the presence/absence of
 * the object cleanly communicates which mode the component operates in.
 */
export interface McpServerSetupIntegration {
  /**
   * Per-server setup state, keyed by `"org/slug"`.
   *
   * Typically sourced from `useMcpServerSetup().entries`. Each entry
   * tracks an individual server through the setup lifecycle:
   * `loading → needsSetup → submitting → ready`.
   */
  readonly entries: Readonly<Record<string, McpServerSetupEntry>>;
  /** Called when the user selects a server from search results. */
  readonly onServerAdded: (ref: ResourceRef) => void;
  /** Called when the user removes a server from the selected list. */
  readonly onServerRemoved: (ref: ResourceRef) => void;
  /** Called when the user submits credentials for a server. */
  readonly onSubmitEnvVars: (
    ref: ResourceRef,
    values: Record<string, EnvVarInput>,
    options: EnvVarFormSubmitOptions,
  ) => void;
  /** Called when the user changes the enabled tools for a server. */
  readonly onEnabledToolsChange: (ref: ResourceRef, tools: string[]) => void;
}

// ---------------------------------------------------------------------------
// Component props
// ---------------------------------------------------------------------------

/** Props for {@link McpServerPicker}. */
export interface McpServerPickerProps {
  /** Organization slug used as the default search scope. */
  readonly org: string;
  /**
   * Controls search scope.
   *
   * - `"org"` — search only within the provided organization.
   * - `"all"` — search all organizations the caller can access,
   *   including public/platform MCP servers from other orgs.
   *
   * @default "org"
   */
  readonly scope?: "org" | "all";
  /**
   * Currently selected MCP server usages.
   *
   * Required in simple mode (when `setup` is not provided). In setup
   * mode, selection is derived from `setup.entries` and this prop is
   * not needed.
   */
  readonly value?: McpServerUsageInput[];
  /**
   * Called when the selection changes in simple mode.
   *
   * Required when `setup` is not provided. Not called when `setup`
   * is provided — selection goes through `setup.onServerAdded` and
   * `setup.onServerRemoved` instead.
   */
  readonly onChange?: (usages: McpServerUsageInput[]) => void;
  /** Called with the display name when an item is added (for chip rendering). */
  readonly onDisplayNameResolved?: (key: string, name: string) => void;
  /** Disables all interaction. */
  readonly disabled?: boolean;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
  /**
   * When provided, enables setup-integrated mode: per-server status
   * indicators, credential collection, tool selection, and drill-in
   * to {@link McpServerConfigPanel}.
   *
   * In this mode, `value` and `onChange` are not needed — selection
   * is managed through `setup.entries` and the setup callbacks.
   *
   * When omitted, the picker operates in simple mode (current
   * behavior): toggle servers on/off with `value`/`onChange`.
   *
   * @see {@link McpServerSetupIntegration}
   *
   * @example
   * ```tsx
   * const mcpSetup = useMcpServerSetup("acme");
   *
   * <McpServerPicker
   *   org="acme"
   *   setup={{
   *     entries: mcpSetup.entries,
   *     onServerAdded: (ref) => mcpSetup.addServer(ref),
   *     onServerRemoved: (ref) => mcpSetup.removeServer(ref),
   *     onSubmitEnvVars: (ref, v, o) => mcpSetup.submitEnvVars(ref, v, o),
   *     onEnabledToolsChange: (ref, t) => mcpSetup.setEnabledTools(ref, t),
   *   }}
   * />
   * ```
   */
  readonly setup?: McpServerSetupIntegration;
  /**
   * When provided, the picker opens directly to the configure view for
   * the given server key (`"org/slug"`) instead of showing the list.
   *
   * Intended for flows where the caller already knows which server
   * needs configuration (e.g. a warning banner for a single
   * unconfigured server, or a chip click on a specific server).
   *
   * Only used as the initial view — subsequent navigation within the
   * picker is unaffected. Ignored if the key does not match any entry
   * in `setup.entries`.
   */
  readonly initialServerKey?: string;
  /**
   * Lookup function for pre-filling credential fields from the session
   * env pool. Passed through to {@link McpServerConfigPanel}'s
   * credentials form. When a field's key returns a value, the field is
   * pre-populated.
   */
  readonly poolValues?: (key: string) => EnvVarInput | undefined;
  /**
   * The authenticated user's active organization slug.
   * Used for OAuth token storage — tokens are stored in the user's personal
   * environment within this org, not the MCP server's org.
   * When omitted, falls back to the `org` prop.
   */
  readonly activeOrg?: string;
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

type PickerView =
  | { readonly type: "list" }
  | { readonly type: "configure"; readonly serverKey: string };

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function refKey(ref: ResourceRef): string {
  return `${ref.org}/${ref.slug}`;
}

function usageKey(usage: McpServerUsageInput): string {
  return refKey(usage.mcpServerRef);
}

function refFromServerKey(key: string): ResourceRef {
  const idx = key.indexOf("/");
  return {
    org: key.slice(0, idx),
    slug: key.slice(idx + 1),
    kind: ApiResourceKind.mcp_server,
  };
}

function slugFromServerKey(key: string): string {
  const idx = key.indexOf("/");
  return key.slice(idx + 1);
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

/**
 * Searchable picker for selecting MCP servers from the platform.
 *
 * Renders a search input and scrollable list of available MCP servers.
 * Designed to be placed inside a popover container — this component
 * renders the picker content, not the popover shell.
 *
 * Operates in two modes:
 *
 * **Simple mode** (default) — toggle servers on/off. Selected servers
 * produce `McpServerUsageInput[]` via `value`/`onChange`. No setup
 * flow, no per-tool selection.
 *
 * **Setup mode** (when `setup` is provided) — each selected server
 * shows its setup status (loading, needs credentials, ready). Users
 * can drill into a per-server configuration panel to provide
 * credentials and customize which tools to enable. Selection is
 * managed through `setup.entries` and the setup callbacks.
 *
 * All visual properties flow through `--stgm-*` tokens.
 *
 * @example
 * ```tsx
 * // Simple mode:
 * <McpServerPicker
 *   org="acme"
 *   value={mcpUsages}
 *   onChange={setMcpUsages}
 * />
 *
 * // Setup mode:
 * const mcpSetup = useMcpServerSetup("acme");
 * <McpServerPicker
 *   org="acme"
 *   setup={{
 *     entries: mcpSetup.entries,
 *     onServerAdded: (ref) => mcpSetup.addServer(ref),
 *     onServerRemoved: (ref) => mcpSetup.removeServer(ref),
 *     onSubmitEnvVars: (ref, v, o) => mcpSetup.submitEnvVars(ref, v, o),
 *     onEnabledToolsChange: (ref, t) => mcpSetup.setEnabledTools(ref, t),
 *   }}
 * />
 * ```
 */
export function McpServerPicker({
  org,
  scope,
  value,
  onChange,
  onDisplayNameResolved,
  disabled,
  className,
  setup,
  initialServerKey,
  poolValues,
  activeOrg,
}: McpServerPickerProps) {
  const instanceId = useId();
  const listId = `${instanceId}-list`;

  const { results, isLoading, error, query, setQuery } =
    useMcpServerSearch(org, { scope });
  const oauth = useMcpServerOAuthConnect();

  const [focusIndex, setFocusIndex] = useState(-1);
  const [view, setView] = useState<PickerView>(() =>
    initialServerKey
      ? { type: "configure", serverKey: initialServerKey }
      : { type: "list" },
  );
  const [manualOverrideKeys, setManualOverrideKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const searchRef = useRef<HTMLInputElement>(null);
  const results_ = useScrollShadows();
  const selected_ = useScrollShadows();

  // -----------------------------------------------------------------------
  // Derive selected keys from setup entries or value
  // -----------------------------------------------------------------------

  const selectedKeys = useMemo(() => {
    if (setup) return new Set(Object.keys(setup.entries));
    return new Set((value ?? []).map(usageKey));
  }, [setup, value]);

  const selectedCount = selectedKeys.size;

  const availableResults = useMemo(
    () => results.filter((r) => !selectedKeys.has(`${r.org}/${r.slug}`)),
    [results, selectedKeys],
  );

  // -----------------------------------------------------------------------
  // Reset drill-in view when the configured entry disappears
  // -----------------------------------------------------------------------

  useEffect(() => {
    if (
      view.type === "configure" &&
      (!setup || !(view.serverKey in setup.entries))
    ) {
      setView({ type: "list" });
    }
  }, [view, setup]);

  useEffect(() => {
    setFocusIndex(-1);
  }, [query]);

  useEffect(() => {
    if (focusIndex >= 0) {
      results_.scrollRef.current
        ?.querySelector(`[data-idx="${focusIndex}"]`)
        ?.scrollIntoView({ block: "nearest" });
    }
  }, [focusIndex, results_.scrollRef]);

  // -----------------------------------------------------------------------
  // Selection handlers — branch on setup presence
  // -----------------------------------------------------------------------

  const handleSelect = useCallback(
    (result: SearchResult) => {
      const ref: ResourceRef = {
        org: result.org,
        slug: result.slug,
        kind: ApiResourceKind.mcp_server,
      };

      if (setup) {
        setup.onServerAdded(ref);
      } else {
        onChange?.([...(value ?? []), { mcpServerRef: ref }]);
      }

      onDisplayNameResolved?.(`${result.org}/${result.slug}`, result.name);
    },
    [setup, value, onChange, onDisplayNameResolved],
  );

  const handleRemove = useCallback(
    (key: string) => {
      if (view.type === "configure" && view.serverKey === key) {
        setView({ type: "list" });
      }

      if (setup) {
        setup.onServerRemoved(refFromServerKey(key));
      } else {
        onChange?.((value ?? []).filter((u) => usageKey(u) !== key));
      }
    },
    [setup, value, onChange, view],
  );

  const handleSearchKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setFocusIndex((prev) =>
          prev < availableResults.length - 1 ? prev + 1 : prev,
        );
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setFocusIndex((prev) => (prev > 0 ? prev - 1 : -1));
      } else if (
        e.key === "Enter" &&
        focusIndex >= 0 &&
        focusIndex < availableResults.length
      ) {
        e.preventDefault();
        handleSelect(availableResults[focusIndex]);
      } else if (e.key === "Enter") {
        e.preventDefault();
      }
    },
    [availableResults, focusIndex, handleSelect],
  );

  // -----------------------------------------------------------------------
  // Configure view — map entry to McpServerConfigPanel props
  // -----------------------------------------------------------------------

  if (view.type === "configure" && setup) {
    const entry = setup.entries[view.serverKey];
    if (!entry || entry.status === "loading") {
      setView({ type: "list" });
      return null;
    }

    const ref = refFromServerKey(view.serverKey);
    const needsCredentials =
      entry.status === "needsSetup" || entry.status === "submitting";

    const auth = entry.mcpServer.spec?.auth;
    const oauthTargetEnvVar = auth?.targetEnvVar || null;
    const hasOAuth = !!auth;
    const isManualOverride = manualOverrideKeys.has(view.serverKey);

    const entryMissingVars =
      entry.status === "needsSetup" ? entry.missingVariables : [];

    const filteredMissingVars =
      oauthTargetEnvVar && !isManualOverride
        ? entryMissingVars.filter((v) => v.key !== oauthTargetEnvVar)
        : entryMissingVars;

    const hasManualVars = filteredMissingVars.length > 0;

    const oauthTokenMissing = oauthTargetEnvVar
      ? entryMissingVars.some((v) => v.key === oauthTargetEnvVar)
      : false;

    const oauthStatus = entry.mcpServer.status?.oauthStatus;
    const isVendorApprovalPending =
      hasOAuth && oauthStatus?.vendorApprovalStatus === 1; // VendorApprovalStatus.PENDING

    const oauthSignInProps =
      hasOAuth && !isManualOverride
        ? {
            onSignIn: async () => {
              if (!entry.mcpServer.metadata?.id) return;
              try {
                await oauth.startOAuth(
                  entry.mcpServer.metadata.id,
                  activeOrg ?? org,
                );
                setup.onServerAdded(ref);
              } catch {
                // error state managed by oauth hook
              }
            },
            phase: oauth.phase,
            isConnected: !oauthTokenMissing,
            error: oauth.error,
            onClearError: oauth.clearError,
            isVendorApprovalPending,
            vendorApprovalDocsUrl: oauthStatus?.vendorApprovalDocsUrl || null,
          }
        : undefined;

    const handleSwitchToManual = hasOAuth
      ? () => {
          setManualOverrideKeys((prev) => {
            const next = new Set(prev);
            next.add(view.serverKey);
            return next;
          });
        }
      : undefined;

    const handleSwitchToOAuth =
      hasOAuth && isManualOverride
        ? () => {
            setManualOverrideKeys((prev) => {
              const next = new Set(prev);
              next.delete(view.serverKey);
              return next;
            });
          }
        : undefined;

    return (
      <div className={cn("w-72", className)}>
        <McpServerConfigPanel
          mcpServer={entry.mcpServer}
          oauthSignIn={oauthSignInProps}
          credentials={
            needsCredentials && hasManualVars
              ? {
                  variables: filteredMissingVars,
                  onSubmit: (values, opts) =>
                    setup.onSubmitEnvVars(ref, values, opts),
                  isSubmitting: entry.status === "submitting",
                  poolValues,
                }
              : undefined
          }
          onSwitchToManual={handleSwitchToManual}
          onSwitchToOAuth={handleSwitchToOAuth}
          discoveredTools={entry.discoveredTools}
          toolApprovals={entry.toolApprovals}
          enabledTools={
            entry.status === "ready"
              ? entry.enabledTools
              : entry.discoveredTools.map((t) => t.name)
          }
          onEnabledToolsChange={(tools) =>
            setup.onEnabledToolsChange(ref, tools)
          }
          onBack={() => setView({ type: "list" })}
          error={entry.error}
          disabled={disabled}
        />
      </div>
    );
  }

  // -----------------------------------------------------------------------
  // List view
  // -----------------------------------------------------------------------

  return (
    <div className={cn("space-y-2 w-72", className)}>
      {/* Selected items */}
      {selectedCount > 0 && (
        <div className="space-y-1">
          <div className="text-[0.65rem] font-medium text-muted-foreground">
            Selected
          </div>
          <div className="relative">
            {selected_.canScrollUp && <ScrollFade position="top" />}

            <div
              ref={selected_.scrollRef}
              className="max-h-28 space-y-1 overflow-y-auto"
            >
              {setup
                ? Object.entries(setup.entries).map(([key, entry]) => (
                    <SetupServerRow
                      key={key}
                      serverKey={key}
                      entry={entry}
                      onConfigure={() =>
                        setView({ type: "configure", serverKey: key })
                      }
                      onRetry={() =>
                        setup.onServerAdded(refFromServerKey(key))
                      }
                      onRemove={() => handleRemove(key)}
                      disabled={disabled}
                    />
                  ))
                : (value ?? []).map((usage) => {
                    const key = usageKey(usage);
                    return (
                      <SimpleServerRow
                        key={key}
                        slug={usage.mcpServerRef.slug}
                        onRemove={() => handleRemove(key)}
                        disabled={disabled}
                      />
                    );
                  })}
            </div>

            {selected_.canScrollDown && <ScrollFade position="bottom" />}
          </div>
        </div>
      )}

      {/* Search input */}
      <input
        ref={searchRef}
        type="text"
        role="combobox"
        aria-expanded={true}
        aria-controls={listId}
        aria-activedescendant={
          focusIndex >= 0 ? `${instanceId}-opt-${focusIndex}` : undefined
        }
        placeholder="Search MCP servers..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleSearchKeyDown}
        disabled={disabled}
        className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
        autoFocus
      />

      {error && <p className="text-xs text-destructive">{error}</p>}

      {/* Scrollable results list */}
      <div className="relative">
        {results_.canScrollUp && <ScrollFade position="top" />}

        <div
          ref={results_.scrollRef}
          id={listId}
          role="listbox"
          aria-label="MCP Servers"
          className="max-h-52 overflow-y-auto"
        >
          {isLoading ? (
            <LoadingSkeleton />
          ) : availableResults.length === 0 ? (
            <div className="py-4 text-center text-xs text-muted-foreground">
              {query
                ? "No MCP servers match your search"
                : selectedCount > 0
                  ? "All available servers selected"
                  : "No MCP servers found"}
            </div>
          ) : (
            availableResults.map((result, idx) => (
              <button
                key={result.id}
                id={`${instanceId}-opt-${idx}`}
                type="button"
                data-idx={idx}
                onClick={() => handleSelect(result)}
                disabled={disabled}
                className={cn(
                  "group flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left text-xs transition-colors",
                  "disabled:pointer-events-none disabled:opacity-50",
                  idx === focusIndex
                    ? "bg-accent text-foreground"
                    : "text-foreground hover:bg-accent/50",
                )}
                role="option"
                aria-selected={idx === focusIndex}
              >
                <span className="flex items-center gap-1.5">
                  <McpServerIcon />
                  <span className="truncate font-medium">
                    <HighlightMatch text={result.name} query={query} />
                  </span>
                  <span className="ml-auto shrink-0 text-[0.6rem] text-muted-foreground">
                    {result.org}
                  </span>
                </span>
                {result.description && (
                  <span
                    className={cn(
                      "pl-5 text-[0.65rem] text-muted-foreground",
                      idx !== focusIndex &&
                        "line-clamp-2 group-hover:line-clamp-none",
                    )}
                  >
                    {result.description}
                  </span>
                )}
              </button>
            ))
          )}
        </div>

        {results_.canScrollDown && <ScrollFade position="bottom" />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Simple mode row (backward-compatible rendering)
// ---------------------------------------------------------------------------

function SimpleServerRow({
  slug,
  onRemove,
  disabled,
}: {
  readonly slug: string;
  readonly onRemove: () => void;
  readonly disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-2 rounded-md bg-muted/30 px-2 py-1 text-xs">
      <McpServerIcon />
      <span className="min-w-0 flex-1 truncate text-foreground">{slug}</span>
      <button
        type="button"
        onClick={onRemove}
        disabled={disabled}
        className="shrink-0 text-muted-foreground hover:text-destructive disabled:pointer-events-none"
        aria-label={`Remove ${slug}`}
      >
        <XIcon />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Setup mode row — per-server status indicators
// ---------------------------------------------------------------------------

function SetupServerRow({
  serverKey,
  entry,
  onConfigure,
  onRetry,
  onRemove,
  disabled,
}: {
  readonly serverKey: string;
  readonly entry: McpServerSetupEntry;
  readonly onConfigure: () => void;
  readonly onRetry: () => void;
  readonly onRemove: () => void;
  readonly disabled?: boolean;
}) {
  const slug = slugFromServerKey(serverKey);
  const isSubmitting = entry.status === "submitting";
  const hasError = entry.error != null;

  return (
    <div className="space-y-1">
      <div
        className={cn(
          "flex items-center gap-2 rounded-md px-2 py-1 text-xs",
          hasError ? "bg-destructive/10" : "bg-muted/30",
        )}
      >
        <StatusIndicator status={entry.status} hasError={hasError} />
        <span className="min-w-0 flex-1 truncate text-foreground">{slug}</span>

        {/* Action area — status-dependent */}
        {entry.status === "loading" && !hasError && (
          <span className="shrink-0 text-[0.6rem] text-muted-foreground">
            Loading…
          </span>
        )}

        {entry.status === "loading" && hasError && (
          <button
            type="button"
            onClick={onRetry}
            disabled={disabled}
            className={cn(
              "shrink-0 rounded px-1.5 py-0.5 text-[0.6rem] font-medium",
              "text-destructive hover:bg-destructive/10",
              "disabled:pointer-events-none disabled:opacity-50",
            )}
          >
            Retry
          </button>
        )}

        {entry.status === "needsSetup" && (
          <button
            type="button"
            onClick={onConfigure}
            disabled={disabled}
            className={cn(
              "shrink-0 rounded px-1.5 py-0.5 text-[0.6rem] font-medium",
              "text-warning hover:bg-warning/10",
              "disabled:pointer-events-none disabled:opacity-50",
            )}
          >
            Configure
          </button>
        )}

        {isSubmitting && (
          <span className="shrink-0 text-[0.6rem] text-muted-foreground">
            Saving…
          </span>
        )}

        {entry.status === "ready" && (
          <button
            type="button"
            onClick={onConfigure}
            disabled={disabled}
            className={cn(
              "shrink-0 flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[0.6rem] font-medium",
              "text-muted-foreground hover:text-foreground hover:bg-accent/50",
              "disabled:pointer-events-none disabled:opacity-50",
            )}
          >
            {entry.discoveredTools.length > 0 && (
              <span>
                {entry.enabledTools.length}/{entry.discoveredTools.length} tools
              </span>
            )}
            <ChevronRightIcon />
          </button>
        )}

        {/* Remove button — always present, disabled during submit */}
        <button
          type="button"
          onClick={onRemove}
          disabled={disabled || isSubmitting}
          className="shrink-0 text-muted-foreground hover:text-destructive disabled:pointer-events-none disabled:opacity-50"
          aria-label={`Remove ${slug}`}
        >
          <XIcon />
        </button>
      </div>

      {/* Inline error for loading failures */}
      {hasError && entry.status === "loading" && (
        <p className="px-2 text-[0.6rem] leading-relaxed text-destructive line-clamp-2">
          {entry.error!.message}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Status indicator dot/spinner
// ---------------------------------------------------------------------------

function StatusIndicator({
  status,
  hasError,
}: {
  readonly status: McpServerSetupEntry["status"];
  readonly hasError: boolean;
}) {
  if (hasError) {
    return (
      <span
        className="inline-block size-2 shrink-0 rounded-full bg-destructive"
        aria-label="Error"
      />
    );
  }

  switch (status) {
    case "loading":
    case "submitting":
      return <SmallSpinner />;
    case "needsSetup":
      return (
        <span
          className="inline-block size-2 shrink-0 rounded-full bg-warning"
          aria-label="Needs setup"
        />
      );
    case "ready":
      return (
        <span
          className="inline-block size-2 shrink-0 rounded-full bg-emerald-500"
          aria-label="Ready"
        />
      );
  }
}

// ---------------------------------------------------------------------------
// Internal components
// ---------------------------------------------------------------------------

function HighlightMatch({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <span className="font-semibold">
        {text.slice(idx, idx + query.length)}
      </span>
      {text.slice(idx + query.length)}
    </>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-1 py-1">
      {[60, 75, 50, 68].map((w, i) => (
        <div key={i} className="flex flex-col gap-1 px-2 py-1.5">
          <div
            className="h-3 rounded bg-muted animate-pulse"
            style={{ width: `${w}%` }}
          />
          <div
            className="h-2 rounded bg-muted/60 animate-pulse"
            style={{ width: `${Math.min(w + 15, 90)}%` }}
          />
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

function McpServerIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0 text-muted-foreground"
      aria-hidden="true"
    >
      <rect x="2" y="2" width="12" height="4" rx="1" />
      <rect x="2" y="10" width="12" height="4" rx="1" />
      <circle cx="5" cy="4" r="0.75" fill="currentColor" stroke="none" />
      <circle cx="5" cy="12" r="0.75" fill="currentColor" stroke="none" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 4L10 10M10 4L4 10" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 4l4 4-4 4" />
    </svg>
  );
}

function SmallSpinner() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      className="shrink-0 animate-spin text-muted-foreground"
      aria-hidden="true"
    >
      <path d="M8 2a6 6 0 1 0 6 6" />
    </svg>
  );
}
