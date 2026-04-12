"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@stigmer/theme";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import type {
  DiscoveredTool,
  DiscoveredResourceTemplate,
} from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/status_pb";
import type { ToolApprovalPolicy, McpServerSpec } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/spec_pb";
import { ValidationState } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/status_pb";
import type { EnvVarDeclaration } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/spec_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { useMcpServer } from "./useMcpServer";
import { useMcpServerConnect } from "./useMcpServerConnect";
import { useMcpServerCredentials } from "./useMcpServerCredentials";
import { useMcpServerOAuthConnect } from "./useMcpServerOAuthConnect";
import type { OAuthConnectPhase } from "./useMcpServerOAuthConnect";
import { ErrorMessage } from "../error/ErrorMessage";
import { EnvVarForm } from "../environment/EnvVarForm";
import type { EnvVarFormVariable } from "../environment/EnvVarForm";
import { VisibilityToggle } from "../library/VisibilityToggle";
import { Tabs, type TabItem } from "../internal/Tabs";

/** Tab identifier for the MCP server capability panel. */
export type CapabilityTab = "tools" | "policies" | "resources";

/** Props for {@link McpServerDetailView}. */
export interface McpServerDetailViewProps {
  /** Organization slug that owns the MCP server. */
  readonly org: string;
  /** MCP server slug (URL-friendly identifier unique within the org). */
  readonly slug: string;
  /**
   * Called once when the MCP server resource has been fetched successfully.
   * Provides the resource display name for use cases like breadcrumbs,
   * document titles, or analytics — without requiring the consumer to
   * also call {@link useMcpServer}.
   *
   * Not called on error or not-found states.
   */
  readonly onResourceLoad?: (meta: { name: string; id: string }) => void;
  /**
   * Called when the user toggles visibility via the inline control.
   * When provided, the header renders an interactive
   * {@link VisibilityToggle} instead of a read-only badge.
   * When omitted, visibility is displayed as a static "Public" pill.
   */
  readonly onVisibilityChange?: (v: ApiResourceVisibility) => void;
  /** `true` while a visibility update RPC is in flight. */
  readonly isVisibilityPending?: boolean;
  /**
   * Initial active capability tab. Defaults to `"tools"`.
   * Useful for deep-linking or demo scenarios that need to start on
   * a specific tab.
   */
  readonly defaultCapabilityTab?: CapabilityTab;
  /**
   * When `true`, the credential form opens immediately on mount
   * (instead of waiting for a Connect click). Useful for guided tours
   * and demo scenarios that need to show the credential entry step
   * without user interaction.
   * @default false
   */
  readonly defaultShowCredentialForm?: boolean;
  /**
   * Pre-fill function for credential form inputs. When provided, the
   * {@link EnvVarForm} receives these as `poolValues`, populating
   * fields on mount. Useful for demo scenarios that simulate a user
   * having already entered credentials.
   */
  readonly credentialPoolValues?: (
    key: string,
  ) => import("@stigmer/sdk").EnvVarInput | undefined;
  /**
   * The authenticated user's active organization slug.
   * Used for OAuth token storage — tokens are stored in the user's personal
   * environment within this org, not the MCP server's org.
   * When omitted, falls back to the `org` prop (MCP server's org).
   */
  readonly activeOrg?: string;
  /** Additional CSS classes for the root container. */
  readonly className?: string;
}

/**
 * Detail view for an MCP Server integration.
 *
 * Fetches the server via {@link useMcpServer} internally and renders
 * its full configuration: validation banner (if invalid), header,
 * a **Connect bar** with a single Connect/Reconnect action, and a
 * **tabbed capabilities panel** (Tools, Policies, and optionally
 * Resources) showing read-only discovered data.
 *
 * The Connect bar above the tabs is the single entry point for
 * capability discovery and tool approval classification. It handles
 * credential gating inline — when credentials are missing, the form
 * slides in below the bar.
 *
 * Handles loading, error, and not-found states automatically.
 * Zero Console dependencies — safe for platform builder embedding.
 * All visual properties flow through `--stgm-*` design tokens.
 *
 * @example
 * ```tsx
 * // Minimal — self-contained, fetches its own data
 * <McpServerDetailView org="acme" slug="github" />
 * ```
 */
export function McpServerDetailView({
  org,
  slug,
  onResourceLoad,
  onVisibilityChange,
  isVisibilityPending,
  defaultCapabilityTab = "tools",
  defaultShowCredentialForm = false,
  credentialPoolValues,
  activeOrg,
  className,
}: McpServerDetailViewProps) {
  const { mcpServer, isLoading, error, refetch } = useMcpServer(org, slug);
  const credentials = useMcpServerCredentials(org, mcpServer ?? null);
  const connection = useMcpServerConnect();
  const oauth = useMcpServerOAuthConnect();

  const [showCredentialForm, setShowCredentialForm] = useState(defaultShowCredentialForm);
  const [capabilityTab, setCapabilityTab] = useState<CapabilityTab>(defaultCapabilityTab);

  const onResourceLoadRef = useRef(onResourceLoad);
  onResourceLoadRef.current = onResourceLoad;

  useEffect(() => {
    if (mcpServer?.metadata?.name) {
      onResourceLoadRef.current?.({ name: mcpServer.metadata.name, id: mcpServer.metadata.id });
    }
  }, [mcpServer]);

  const handleOAuthSignIn = useCallback(async () => {
    if (!mcpServer?.metadata?.id) return;

    const envKeys = Object.keys(mcpServer.spec?.env ?? {});
    try {
      await oauth.startOAuth(mcpServer.metadata.id, activeOrg ?? org, envKeys);
      credentials.refetch();
      refetch();
    } catch {
      // error state is managed by the oauth hook
    }
  }, [mcpServer, oauth, credentials, refetch]);

  const handleConnectClick = useCallback(async () => {
    if (!mcpServer?.metadata?.id) return;

    if (
      credentials.authMode === "oauth" &&
      !credentials.isOAuthConnected &&
      !credentials.manualOverride
    ) {
      handleOAuthSignIn();
      return;
    }

    if (!credentials.isReady) {
      setShowCredentialForm(true);
      return;
    }

    const envKeys = Object.keys(mcpServer.spec?.env ?? {});
    try {
      await connection.connect(mcpServer.metadata.id, activeOrg ?? org, undefined, envKeys);
      refetch();
    } catch {
      // error state is managed by the hook
    }
  }, [mcpServer, credentials.authMode, credentials.isOAuthConnected, credentials.manualOverride, credentials.isReady, connection, refetch, handleOAuthSignIn]);

  const handleCredentialSubmit = useCallback(
    async (
      values: Record<string, import("@stigmer/sdk").EnvVarInput>,
      options: { saveForFuture: boolean },
    ) => {
      try {
        if (options.saveForFuture) {
          await credentials.saveCredentials(values);
          credentials.refetch();
        }

        setShowCredentialForm(false);

        if (mcpServer?.metadata?.id) {
          const envKeys = Object.keys(mcpServer.spec?.env ?? {});
          const connectOrg = activeOrg ?? org;
          if (options.saveForFuture) {
            await connection.connect(mcpServer.metadata.id, connectOrg, undefined, envKeys);
          } else {
            await connection.connect(mcpServer.metadata.id, connectOrg, values, envKeys);
          }
          refetch();
        }
      } catch {
        // error state is managed by the hooks
      }
    },
    [credentials, mcpServer, connection, refetch],
  );

  const spec = mcpServer?.spec;
  const status = mcpServer?.status;
  const hasSource = spec && (spec.repositoryUrl || spec.githubStars > 0);
  const specAudit = status?.audit?.specAudit;
  const capabilities = status?.discoveredCapabilities;
  const pinnedPolicies = spec?.pinnedToolApprovals ?? [];
  const classifiedPolicies = status?.toolApprovals ?? [];
  const totalPolicyCount = pinnedPolicies.length + classifiedPolicies.length;
  const tools = capabilities?.tools ?? [];
  const resourceTemplates = capabilities?.resourceTemplates ?? [];
  const hasDiscoveredTools = tools.length > 0;

  const capabilityTabs: TabItem[] = useMemo(() => {
    const items: TabItem[] = [
      { id: "tools", label: "Tools", badge: tools.length },
      { id: "policies", label: "Policies", badge: totalPolicyCount },
    ];
    if (resourceTemplates.length > 0) {
      items.push({
        id: "resources",
        label: "Resources",
        badge: resourceTemplates.length,
      });
    }
    return items;
  }, [tools.length, totalPolicyCount, resourceTemplates.length]);

  const combinedError = connection.error ?? oauth.error;
  const combinedClearError = useCallback(() => {
    connection.clearError();
    oauth.clearError();
  }, [connection, oauth]);

  if (isLoading) return <LoadingSkeleton className={className} />;
  if (error)
    return <ErrorMessage error={error} retry={refetch} className={className} />;
  if (!mcpServer) return <NotFoundState className={className} />;

  return (
    <div className={cn("flex flex-col gap-6", className)}>
      {status?.validationState === ValidationState.invalid &&
        status.validationMessage && (
          <ValidationBanner message={status.validationMessage} />
        )}

      <Header
        server={mcpServer}
        createdAt={
          specAudit?.createdAt ? timestampDate(specAudit.createdAt) : null
        }
        updatedAt={
          specAudit?.updatedAt ? timestampDate(specAudit.updatedAt) : null
        }
        lastDiscoveredAt={
          capabilities?.lastDiscoveredAt
            ? timestampDate(capabilities.lastDiscoveredAt)
            : null
        }
        onVisibilityChange={onVisibilityChange}
        isVisibilityPending={isVisibilityPending}
      />

      {hasSource && <SourceSection spec={spec} />}

      {spec?.serverType.case && (
        <ServerConfigSection serverType={spec.serverType} />
      )}

      {spec?.env && Object.keys(spec.env).length > 0 && (
        <EnvSection
          data={spec.env}
          oauthTargetEnvVar={credentials.oauthTargetEnvVar}
        />
      )}

      <Section title="Connection">
        <ConnectBar
          isConnecting={connection.isConnecting || oauth.isInProgress}
          connectionError={combinedError}
          onConnect={handleConnectClick}
          onClearConnectionError={combinedClearError}
          hasDiscoveredTools={hasDiscoveredTools}
          toolCount={tools.length}
          policyCount={totalPolicyCount}
          credentialsLoading={credentials.isLoading}
          oauthPhase={oauth.phase}
          authMode={credentials.authMode}
          isOAuthConnected={credentials.isOAuthConnected}
          accessTokenExpiresAt={credentials.accessTokenExpiresAt}
          tokenLifetimeHint={credentials.tokenLifetimeHint}
          manualOverride={credentials.manualOverride}
          onManualOverride={() => {
            credentials.setManualOverride(true);
            setShowCredentialForm(true);
          }}
          onBackToOAuth={() => {
            credentials.setManualOverride(false);
            setShowCredentialForm(false);
          }}
        />

        {showCredentialForm && credentials.missingVariables.length > 0 && (
          <div
            className="border-b border-border p-4"
            data-cursor-target="credential-form"
          >
            <EnvVarForm
              title="Credentials Required"
              description="Enter the credentials needed to connect to this MCP server. Toggle &quot;Save for future runs&quot; to persist them in your personal environment, or leave it off for one-time use."
              variables={credentials.missingVariables}
              onSubmit={(values, options) => handleCredentialSubmit(values, options)}
              onCancel={() => setShowCredentialForm(false)}
              isSubmitting={credentials.isSaving}
              poolValues={credentialPoolValues}
              className="w-full max-w-md"
            />
          </div>
        )}
      </Section>

      <Section title="Capabilities">
        <Tabs
          tabs={capabilityTabs}
          activeTab={capabilityTab}
          onTabChange={(id) => setCapabilityTab(id as CapabilityTab)}
          aria-label="MCP server capabilities"
        >
          {capabilityTab === "tools" && (
            <ToolsTabContent tools={tools} />
          )}

          {capabilityTab === "policies" && (
            <PoliciesTabContent
              pinnedPolicies={pinnedPolicies}
              classifiedPolicies={classifiedPolicies}
              hasDiscoveredTools={hasDiscoveredTools}
            />
          )}

          {capabilityTab === "resources" && (
            <ResourceTemplatesList templates={resourceTemplates} />
          )}
        </Tabs>
      </Section>

      {spec && spec.tags.length > 0 && <TagsSection tags={spec.tags} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ConnectBar — single entry point for capability discovery
// ---------------------------------------------------------------------------

function ConnectBar({
  isConnecting,
  connectionError,
  onConnect,
  onClearConnectionError,
  hasDiscoveredTools,
  toolCount,
  policyCount,
  credentialsLoading,
  oauthPhase,
  authMode,
  isOAuthConnected,
  accessTokenExpiresAt,
  tokenLifetimeHint,
  manualOverride,
  onManualOverride,
  onBackToOAuth,
}: {
  readonly isConnecting: boolean;
  readonly connectionError: Error | null;
  readonly onConnect: () => void;
  readonly onClearConnectionError: () => void;
  readonly hasDiscoveredTools: boolean;
  readonly toolCount: number;
  readonly policyCount: number;
  readonly credentialsLoading: boolean;
  readonly oauthPhase: OAuthConnectPhase;
  readonly authMode: "manual" | "oauth";
  readonly isOAuthConnected: boolean;
  readonly accessTokenExpiresAt: bigint;
  readonly tokenLifetimeHint: string | null;
  readonly manualOverride: boolean;
  readonly onManualOverride: () => void;
  readonly onBackToOAuth: () => void;
}) {
  const isOAuthBusy =
    oauthPhase === "initiating" ||
    oauthPhase === "awaiting-callback" ||
    oauthPhase === "completing" ||
    oauthPhase === "connecting";

  const showOAuthPrimary =
    authMode === "oauth" && !isOAuthConnected && !manualOverride;

  const buttonLabel = (() => {
    if (isOAuthBusy) return oauthPhaseLabel(oauthPhase);
    if (isConnecting) return "Connecting...";
    if (showOAuthPrimary) return "Sign in to connect";
    if (hasDiscoveredTools) return "Reconnect";
    return "Connect";
  })();

  const buttonIcon = (() => {
    if (isOAuthBusy || isConnecting) return <Spinner />;
    if (showOAuthPrimary) return <OAuthIcon className="size-3.5" />;
    if (hasDiscoveredTools) return <RefreshIcon className="size-3.5" />;
    return <ConnectIcon className="size-3.5" />;
  })();

  const statusText = (() => {
    if (authMode === "oauth" && isOAuthConnected) {
      const expiryLabel = formatTokenExpiry(accessTokenExpiresAt);
      if (expiryLabel) return `Tokens refresh automatically \u00B7 ${expiryLabel}`;
      const hint = tokenLifetimeHint && tokenLifetimeHint !== "never"
        ? ` \u00B7 Session lasts ~${tokenLifetimeHint}`
        : "";
      return `Tokens refresh automatically${hint}`;
    }
    if (manualOverride) return "Entering token manually";
    if (hasDiscoveredTools) return formatConnectionSummary(toolCount, policyCount);
    return "Not connected yet";
  })();

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between px-3 py-2">
        <div className="flex items-center gap-2">
          {authMode === "oauth" && !manualOverride && (
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium",
                isOAuthConnected
                  ? "bg-success/10 text-success"
                  : "bg-muted text-muted-foreground",
              )}
            >
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  isOAuthConnected ? "bg-success" : "bg-muted-foreground",
                )}
                aria-hidden="true"
              />
              {isOAuthConnected ? "Connected" : "Not connected"}
            </span>
          )}
          <span className="text-xs text-muted-foreground">
            {statusText}
          </span>
        </div>
        <button
          type="button"
          onClick={onConnect}
          disabled={isConnecting || isOAuthBusy || credentialsLoading}
          data-cursor-target="connect-button"
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium",
            showOAuthPrimary
              ? "bg-primary text-primary-foreground hover:bg-primary-hover"
              : "border border-border bg-background text-foreground hover:bg-accent hover:text-accent-foreground",
            "disabled:pointer-events-none disabled:opacity-50",
          )}
        >
          {buttonIcon}
          {buttonLabel}
        </button>
      </div>

      {/* Secondary action: switch between OAuth and manual token entry */}
      {authMode === "oauth" && !isOAuthConnected && !isOAuthBusy && !isConnecting && (
        <div className="border-t border-border px-3 py-1.5">
          {manualOverride ? (
            <button
              type="button"
              onClick={onBackToOAuth}
              className="text-[11px] text-muted-foreground underline decoration-muted-foreground/40 underline-offset-2 hover:text-foreground hover:decoration-foreground"
            >
              Sign in with OAuth instead
            </button>
          ) : (
            <button
              type="button"
              onClick={onManualOverride}
              className="text-[11px] text-muted-foreground underline decoration-muted-foreground/40 underline-offset-2 hover:text-foreground hover:decoration-foreground"
            >
              Enter token manually
            </button>
          )}
        </div>
      )}

      {connectionError && (
        <div className="flex items-start gap-2 border-t border-destructive/20 bg-destructive/5 px-3 py-2">
          <WarningIcon className="mt-0.5 size-3.5 shrink-0 text-destructive" />
          <p className="flex-1 text-xs text-destructive">
            {connectionError.message}
          </p>
          <button
            type="button"
            onClick={onClearConnectionError}
            className="shrink-0 text-xs text-destructive/70 hover:text-destructive"
            aria-label="Dismiss error"
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}

function oauthPhaseLabel(phase: OAuthConnectPhase): string {
  switch (phase) {
    case "initiating":
      return "Starting sign-in...";
    case "awaiting-callback":
      return "Waiting for authorization...";
    case "completing":
      return "Completing sign-in...";
    case "connecting":
      return "Discovering tools...";
    default:
      return "Connecting...";
  }
}

function formatConnectionSummary(toolCount: number, policyCount: number): string {
  const toolLabel = `${toolCount} tool${toolCount !== 1 ? "s" : ""}`;
  if (policyCount === 0) return toolLabel;
  const policyLabel = `${policyCount} ${policyCount !== 1 ? "policies" : "policy"}`;
  return `${toolLabel}, ${policyLabel}`;
}

function formatTokenExpiry(expiresAtSeconds: bigint): string | null {
  if (expiresAtSeconds === BigInt(0)) return null;
  const nowSeconds = BigInt(Math.floor(Date.now() / 1000));
  const remainingSeconds = expiresAtSeconds - nowSeconds;
  if (remainingSeconds <= BigInt(0)) return "Token expired";
  const minutes = Number(remainingSeconds / BigInt(60));
  if (minutes < 1) return "Expires in <1 min";
  if (minutes < 60) return `Expires in ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Expires in ${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `Expires in ${days}d`;
}

// ---------------------------------------------------------------------------
// Internal section components
// ---------------------------------------------------------------------------

function ValidationBanner({ message }: { readonly message: string }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3"
    >
      <WarningIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-destructive">
          Invalid Configuration
        </p>
        <p className="mt-0.5 text-xs text-destructive/80">{message}</p>
      </div>
    </div>
  );
}

function Header({
  server,
  createdAt,
  updatedAt,
  lastDiscoveredAt,
  onVisibilityChange,
  isVisibilityPending,
}: {
  readonly server: McpServer;
  readonly createdAt: Date | null;
  readonly updatedAt: Date | null;
  readonly lastDiscoveredAt: Date | null;
  readonly onVisibilityChange?: (v: ApiResourceVisibility) => void;
  readonly isVisibilityPending?: boolean;
}) {
  const meta = server.metadata;
  const spec = server.spec;
  const status = server.status;
  const displayName = meta?.name || meta?.slug || "Untitled";
  const isPublic =
    meta?.visibility === ApiResourceVisibility.visibility_public;

  return (
    <div className="flex items-start gap-3">
      {spec?.iconUrl ? (
        <img
          src={spec.iconUrl}
          alt=""
          className="mt-0.5 size-8 shrink-0 rounded object-cover"
        />
      ) : (
        <McpServerIcon className="mt-1 size-6 shrink-0 text-muted-foreground" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h2 className="truncate text-lg font-semibold text-foreground">
            {displayName}
          </h2>
          {onVisibilityChange && meta ? (
            <VisibilityToggle
              visibility={meta.visibility}
              onVisibilityChange={onVisibilityChange}
              isPending={isVisibilityPending}
            />
          ) : (
            isPublic && (
              <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                Public
              </span>
            )
          )}
        </div>
        {meta?.slug && (
          <span className="mt-0.5 block truncate font-mono text-xs text-muted-foreground">
            {meta.org ? `${meta.org}/${meta.slug}` : meta.slug}
          </span>
        )}
        <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
          {meta?.org && <span>{meta.org}</span>}
          {status && (
            <ValidationStateBadge state={status.validationState} />
          )}
          {lastDiscoveredAt && (
            <>
              <Dot />
              <span>Discovered {formatDate(lastDiscoveredAt)}</span>
            </>
          )}
          {createdAt && (
            <>
              <Dot />
              <span>Created {formatDate(createdAt)}</span>
            </>
          )}
          {updatedAt && (
            <>
              <Dot />
              <span>Updated {formatDate(updatedAt)}</span>
            </>
          )}
        </div>
        {spec?.description && (
          <p className="mt-2 text-sm text-muted-foreground">
            {spec.description}
          </p>
        )}
      </div>
    </div>
  );
}

function ValidationStateBadge({
  state,
}: {
  readonly state: ValidationState;
}) {
  switch (state) {
    case ValidationState.valid:
      return (
        <>
          <Dot />
          <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
            <CheckIcon className="size-3" />
            Valid
          </span>
        </>
      );
    case ValidationState.invalid:
      return (
        <>
          <Dot />
          <span className="text-destructive">Invalid</span>
        </>
      );
    default:
      return null;
  }
}

function ServerConfigSection({
  serverType,
}: {
  readonly serverType: NonNullable<
    import("@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/spec_pb").McpServerSpec["serverType"]
  >;
}) {
  return (
    <Section title="Server Configuration">
      <div className="flex flex-col gap-2 p-3">
        <div className="flex items-baseline gap-2">
          <span className="text-xs font-medium text-muted-foreground">
            Type
          </span>
          <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs font-medium text-foreground">
            {serverType.case}
          </span>
        </div>

        {serverType.case === "stdio" && (
          <>
            <div className="flex items-baseline gap-2">
              <span className="text-xs font-medium text-muted-foreground">
                Command
              </span>
              <code className="font-mono text-sm text-foreground">
                {serverType.value.command}
                {serverType.value.args.length > 0 &&
                  ` ${serverType.value.args.join(" ")}`}
              </code>
            </div>
            {serverType.value.workingDir && (
              <div className="flex items-baseline gap-2">
                <span className="text-xs font-medium text-muted-foreground">
                  Working Dir
                </span>
                <code className="font-mono text-xs text-foreground">
                  {serverType.value.workingDir}
                </code>
              </div>
            )}
          </>
        )}

        {serverType.case === "http" && (
          <>
            <div className="flex items-baseline gap-2">
              <span className="text-xs font-medium text-muted-foreground">
                URL
              </span>
              <code className="break-all font-mono text-sm text-foreground">
                {serverType.value.url}
              </code>
            </div>
            {serverType.value.timeoutSeconds > 0 && (
              <div className="flex items-baseline gap-2">
                <span className="text-xs font-medium text-muted-foreground">
                  Timeout
                </span>
                <span className="text-xs text-foreground">
                  {serverType.value.timeoutSeconds}s
                </span>
              </div>
            )}
          </>
        )}
      </div>
    </Section>
  );
}

function SourceSection({
  spec,
}: {
  readonly spec: McpServerSpec;
}) {
  return (
    <Section title="Source">
      <div className="flex flex-col gap-2 p-3">
        {spec.repositoryUrl && (
          <div className="flex items-baseline gap-2">
            <span className="shrink-0 text-xs font-medium text-muted-foreground">
              Repository
            </span>
            <a
              href={spec.repositoryUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 break-all font-mono text-xs text-foreground underline decoration-muted-foreground/40 underline-offset-2 hover:decoration-foreground"
            >
              {spec.repositoryUrl}
              <ExternalLinkIcon className="size-3 shrink-0" />
            </a>
          </div>
        )}
        {spec.githubStars > 0 && (
          <div className="flex items-baseline gap-2">
            <span className="shrink-0 text-xs font-medium text-muted-foreground">
              Stars
            </span>
            <span className="text-xs text-foreground">
              {spec.githubStars.toLocaleString()}
            </span>
          </div>
        )}
      </div>
    </Section>
  );
}

function ResourceTemplatesList({
  templates,
}: {
  readonly templates: readonly DiscoveredResourceTemplate[];
}) {
  if (templates.length === 0) return null;

  return (
    <div className="flex flex-col divide-y divide-border">
      {templates.map((tpl) => (
        <div key={tpl.uriTemplate || tpl.name} className="px-3 py-2.5">
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-medium text-foreground">
              {tpl.name}
            </span>
            <code className="font-mono text-[10px] text-muted-foreground">
              {tpl.uriTemplate}
            </code>
          </div>
          {tpl.description && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              {tpl.description}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

function EnvSection({
  data,
  oauthTargetEnvVar,
}: {
  readonly data: { [key: string]: EnvVarDeclaration };
  readonly oauthTargetEnvVar: string | null;
}) {
  const entries = Object.entries(data).sort(([a], [b]) =>
    a.localeCompare(b),
  );

  return (
    <Section title={`Environment Variables (${entries.length})`}>
      <div className="flex flex-col divide-y divide-border">
        {entries.map(([name, env]) => {
          const isOAuthManaged = name === oauthTargetEnvVar;
          return (
            <div key={name} className="flex items-start gap-3 px-3 py-2">
              <code className="shrink-0 font-mono text-sm font-medium text-foreground">
                {name}
              </code>
              <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                {env.isSecret ? "secret" : "config"}
              </span>
              {isOAuthManaged && (
                <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                  oauth
                </span>
              )}
              {env.optional && (
                <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground/70">
                  optional
                </span>
              )}
              {env.description && (
                <span className="text-xs text-muted-foreground">
                  {env.description}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </Section>
  );
}

function TagsSection({ tags }: { readonly tags: readonly string[] }) {
  return (
    <Section title={`Tags (${tags.length})`}>
      <div className="flex flex-wrap gap-1.5 p-3">
        {tags.map((tag) => (
          <span
            key={tag}
            className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground"
          >
            {tag}
          </span>
        ))}
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Capability tab contents (read-only)
// ---------------------------------------------------------------------------

function ToolsTabContent({
  tools,
}: {
  readonly tools: readonly DiscoveredTool[];
}) {
  if (tools.length === 0) {
    return (
      <div className="px-3 py-8 text-center">
        <ConnectIcon className="mx-auto mb-2 size-6 text-muted-foreground/40" />
        <p className="text-xs text-muted-foreground">
          Connect to this MCP server to discover its available tools.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col divide-y divide-border">
      {tools.map((tool) => (
        <div key={tool.name} className="px-3 py-2.5">
          <code className="font-mono text-sm font-medium text-foreground">
            {tool.name}
          </code>
          {tool.description && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              {tool.description}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

function PoliciesTabContent({
  pinnedPolicies,
  classifiedPolicies,
  hasDiscoveredTools,
}: {
  readonly pinnedPolicies: readonly ToolApprovalPolicy[];
  readonly classifiedPolicies: readonly ToolApprovalPolicy[];
  readonly hasDiscoveredTools: boolean;
}) {
  const hasPinnedPolicies = pinnedPolicies.length > 0;
  const hasClassifiedPolicies = classifiedPolicies.length > 0;
  const hasAnyPolicies = hasPinnedPolicies || hasClassifiedPolicies;

  if (!hasAnyPolicies) {
    return (
      <div className="px-3 py-8 text-center">
        <ShieldIcon className="mx-auto mb-2 size-6 text-muted-foreground/40" />
        <p className="text-xs text-muted-foreground">
          {hasDiscoveredTools
            ? "No approval policies yet. Reconnect to reclassify tools."
            : "Connect to discover tools and auto-classify approval policies."}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {hasPinnedPolicies && (
        <PolicyGroup
          icon={<PinIcon className="size-3.5" />}
          label="Pinned"
          policies={pinnedPolicies}
        />
      )}
      {hasClassifiedPolicies && (
        <PolicyGroup
          icon={<SparklesIcon className="size-3.5" />}
          label="Auto-classified"
          policies={classifiedPolicies}
        />
      )}
    </div>
  );
}

function PolicyGroup({
  icon,
  label,
  policies,
}: {
  readonly icon: React.ReactNode;
  readonly label: string;
  readonly policies: readonly ToolApprovalPolicy[];
}) {
  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-1.5 border-b border-border bg-muted/30 px-3 py-1.5">
        <span className="text-muted-foreground">{icon}</span>
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        <span className="text-[10px] text-muted-foreground">
          ({policies.length})
        </span>
      </div>
      <div className="flex flex-col divide-y divide-border">
        {policies.map((policy) => (
          <div key={policy.toolName} className="px-3 py-2.5">
            <div className="flex items-baseline gap-2">
              <code className="font-mono text-sm font-medium text-foreground">
                {policy.toolName}
              </code>
              <ShieldIcon className="size-3 text-amber-500 dark:text-amber-400" />
            </div>
            {policy.message && (
              <p className="mt-0.5 text-xs text-muted-foreground">
                {policy.message}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared layout primitives
// ---------------------------------------------------------------------------

function Section({
  title,
  children,
}: {
  readonly title: string;
  readonly children: React.ReactNode;
}) {
  return (
    <section>
      <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {title}
      </h3>
      <div className="overflow-hidden rounded-lg border border-border">
        {children}
      </div>
    </section>
  );
}

function Dot() {
  return (
    <span className="shrink-0" aria-hidden="true">
      {"\u00B7"}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Non-happy states
// ---------------------------------------------------------------------------

function LoadingSkeleton({ className }: { readonly className?: string }) {
  return (
    <div
      className={cn("flex flex-col gap-6", className)}
      aria-busy="true"
      aria-label="Loading MCP server details"
    >
      <div className="flex items-start gap-3">
        <div className="mt-1 size-6 shrink-0 animate-pulse rounded bg-muted" />
        <div className="flex-1 space-y-2">
          <div className="h-5 w-48 animate-pulse rounded bg-muted" />
          <div className="h-3 w-64 animate-pulse rounded bg-muted" />
          <div className="h-4 w-full max-w-md animate-pulse rounded bg-muted" />
        </div>
      </div>
      {[24, 48, 16, 12].map((h, i) => (
        <div key={i} className="space-y-2">
          <div className="h-3 w-28 animate-pulse rounded bg-muted" />
          <div
            className="animate-pulse rounded-lg border border-border bg-muted/30"
            style={{ height: `${h * 4}px` }}
          />
        </div>
      ))}
    </div>
  );
}

function NotFoundState({ className }: { readonly className?: string }) {
  return (
    <div
      role="status"
      className={cn(
        "flex flex-col items-center gap-2 py-12 text-center",
        className,
      )}
    >
      <McpServerIcon className="size-10 text-muted-foreground/40" />
      <p className="text-sm font-medium text-muted-foreground">
        MCP Server not found
      </p>
      <p className="text-xs text-muted-foreground/60">
        This MCP server doesn&apos;t exist or you don&apos;t have access to it.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// ---------------------------------------------------------------------------
// Icons — inline SVGs following the SDK pattern (no icon library dependency)
// ---------------------------------------------------------------------------

function McpServerIcon({ className }: { readonly className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="2" y="2" width="12" height="5" rx="1" />
      <rect x="2" y="9" width="12" height="5" rx="1" />
      <circle cx="5" cy="4.5" r="0.75" fill="currentColor" stroke="none" />
      <circle cx="5" cy="11.5" r="0.75" fill="currentColor" stroke="none" />
    </svg>
  );
}

function CheckIcon({ className }: { readonly className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m3 8.5 3.5 3.5 6.5-8" />
    </svg>
  );
}

function WarningIcon({ className }: { readonly className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M8 1.5 1 14h14L8 1.5Z" />
      <path d="M8 6v3.5" />
      <circle cx="8" cy="11.5" r="0.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

function ConnectIcon({ className }: { readonly className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6.5 6.5 4.25 4.25" />
      <path d="m9.5 9.5 2.25 2.25" />
      <rect x="1.5" y="1.5" width="5" height="5" rx="1" />
      <rect x="9.5" y="9.5" width="5" height="5" rx="1" />
      <path d="m6.5 9.5-3 3" />
      <path d="m9.5 6.5 3-3" />
    </svg>
  );
}

function RefreshIcon({ className }: { readonly className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2.5 8a5.5 5.5 0 0 1 9.36-3.92" />
      <path d="M13.5 8a5.5 5.5 0 0 1-9.36 3.92" />
      <path d="M12 2v3h-3" />
      <path d="M4 14v-3h3" />
    </svg>
  );
}

function ShieldIcon({ className }: { readonly className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M8 1.5 2.5 4v4c0 3.31 2.35 6.4 5.5 7 3.15-.6 5.5-3.69 5.5-7V4L8 1.5Z" />
    </svg>
  );
}

function PinIcon({ className }: { readonly className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9.5 2.5 13.5 6.5" />
      <path d="M5 7 3 14l7-2" />
      <path d="m5 7 2-2 4.5-1 1.5 1.5-1 4.5-2 2z" />
    </svg>
  );
}

function SparklesIcon({ className }: { readonly className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M3.05 12.95l1.41-1.41M11.54 4.46l1.41-1.41" />
    </svg>
  );
}

function OAuthIcon({ className }: { readonly className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="1.5" y="5" width="13" height="8" rx="1.5" />
      <path d="M4.5 5V3.5a3.5 3.5 0 0 1 7 0V5" />
      <circle cx="8" cy="9.5" r="1.25" />
    </svg>
  );
}

function ExternalLinkIcon({ className }: { readonly className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 8.667v4A1.333 1.333 0 0 1 10.667 14H3.333A1.333 1.333 0 0 1 2 12.667V5.333A1.333 1.333 0 0 1 3.333 4h4" />
      <path d="M10 2h4v4" />
      <path d="M6.667 9.333 14 2" />
    </svg>
  );
}

function Spinner() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      className="animate-spin"
      aria-hidden="true"
    >
      <path d="M8 2a6 6 0 1 0 6 6" />
    </svg>
  );
}
