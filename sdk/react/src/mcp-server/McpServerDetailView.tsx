"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@stigmer/theme";
import { getUserMessage, isRetryableError } from "@stigmer/sdk";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { OAuthConnectionHealth } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/io_pb";
import type {
  DiscoveredTool,
  DiscoveredResourceTemplate,
} from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/status_pb";
import type { ToolApprovalPolicy, McpServerSpec } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/spec_pb";
import { ValidationState } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/status_pb";
import type { EnvVarDeclaration } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/spec_pb";
import { useMcpServer } from "./useMcpServer";
import { useUpdateMcpServer } from "./useUpdateMcpServer";
import { mcpServerToInput } from "./internal/mcpServerToInput";
import { useMcpServerConnect } from "./useMcpServerConnect";
import { useMcpServerCredentials } from "./useMcpServerCredentials";
import { useMcpServerOAuthConnect } from "./useMcpServerOAuthConnect";
import type { OAuthConnectPhase } from "./useMcpServerOAuthConnect";
import { useDisconnectOAuth } from "./useDisconnectOAuth";
import { useOrgOAuthApp } from "./useOrgOAuthApp";
import { OAuthAppForm } from "./OAuthAppForm";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ErrorMessage } from "../error/ErrorMessage";
import { EnvVarForm } from "../environment/EnvVarForm";
import type { EnvVarFormVariable } from "../environment/EnvVarForm";
import { VisibilityBadge } from "../library/VisibilitySelector";
import { useManageAccess } from "../access/useManageAccess";
import { Tabs, type TabItem } from "../tabs/Tabs";
import { ResourceDetailShell } from "../resource-detail/ResourceDetailShell";
import { Section } from "../resource-detail/Section";
import type { DetailAction, ResourceHeaderMeta } from "../resource-detail/types";
import { InlineEditText } from "../inline-edit/InlineEditText";
import { InlineEditTextarea } from "../inline-edit/InlineEditTextarea";
import { InlineEditImage } from "../inline-edit/InlineEditImage";
import { InlineEditSelect } from "../inline-edit/InlineEditSelect";
import { InlineEditKeyValue } from "../inline-edit/InlineEditKeyValue";
import type { KeyValueRow, SelectOption } from "../inline-edit/types";

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
  /**
   * Primary action rendered as a visible button in the header area.
   */
  readonly primaryAction?: DetailAction;
  /**
   * Secondary actions rendered in the kebab overflow menu.
   */
  readonly actions?: readonly DetailAction[];
  /**
   * When `true`, fields on the detail view become click-to-edit.
   * Each field saves independently via `stigmer.mcpServer.update()`.
   * @default false
   */
  readonly editable?: boolean;
  /**
   * Called after a successful inline field save with the updated server.
   */
  readonly onResourceUpdated?: (server: McpServer) => void;
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
  defaultCapabilityTab = "tools",
  defaultShowCredentialForm = false,
  credentialPoolValues,
  activeOrg,
  primaryAction,
  actions,
  editable = false,
  onResourceUpdated,
  className,
}: McpServerDetailViewProps) {
  const { mcpServer, isLoading, error, refetch } = useMcpServer(org, slug);
  const { update: updateMcpServer, isUpdating } = useUpdateMcpServer();

  const saveMcpField = useCallback(
    async <K extends keyof import("@stigmer/sdk").McpServerInput>(
      field: K,
      value: import("@stigmer/sdk").McpServerInput[K],
    ): Promise<boolean> => {
      if (!mcpServer) return false;
      const input = mcpServerToInput(mcpServer);
      (input as unknown as Record<string, unknown>)[field] = value;
      try {
        const updated = await updateMcpServer(input);
        onResourceUpdated?.(updated);
        refetch();
        return true;
      } catch {
        return false;
      }
    },
    [mcpServer, updateMcpServer, onResourceUpdated, refetch],
  );
  const credentials = useMcpServerCredentials(activeOrg ?? org, mcpServer ?? null);
  const connection = useMcpServerConnect();
  const oauth = useMcpServerOAuthConnect();
  const disconnectOAuth = useDisconnectOAuth();
  const orgOAuthApp = useOrgOAuthApp(
    mcpServer?.metadata?.id ?? null,
    activeOrg ?? org,
  );

  const [showCredentialForm, setShowCredentialForm] = useState(defaultShowCredentialForm);
  const [showByoaForm, setShowByoaForm] = useState(false);
  const [capabilityTab, setCapabilityTab] = useState<CapabilityTab>(defaultCapabilityTab);
  const byoaDialogRef = useRef<HTMLDialogElement>(null);

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

        if (mcpServer?.metadata?.id) {
          const envKeys = Object.keys(mcpServer.spec?.env ?? {});
          const connectOrg = activeOrg ?? org;
          await connection.connect(mcpServer.metadata.id, connectOrg, values, envKeys);
          refetch();
        }

        setShowCredentialForm(false);
      } catch {
        // error state is managed by the hooks — form stays open for retry
      }
    },
    [credentials, mcpServer, connection, refetch],
  );

  const handleDisconnect = useCallback(async () => {
    if (!mcpServer?.metadata?.id) return;
    try {
      await disconnectOAuth.disconnect(mcpServer.metadata.id, activeOrg ?? org);
      credentials.refetch();
      refetch();
    } catch {
      // error state is managed by the disconnect hook
    }
  }, [mcpServer, disconnectOAuth, credentials, refetch, activeOrg, org]);

  // BYOA dialog lifecycle — native <dialog> toggle
  useEffect(() => {
    const dialog = byoaDialogRef.current;
    if (!dialog) return;
    if (showByoaForm && !dialog.open) {
      dialog.showModal();
    } else if (!showByoaForm && dialog.open) {
      dialog.close();
    }
  }, [showByoaForm]);

  const handleByoaDialogCancel = useCallback(
    (e: React.SyntheticEvent) => {
      e.preventDefault();
      setShowByoaForm(false);
      orgOAuthApp.clearErrors();
    },
    [orgOAuthApp],
  );

  const handleByoaSubmit = useCallback(
    async (clientId: string, clientSecret: string) => {
      await orgOAuthApp.setOrgOAuthApp(clientId, clientSecret);
      setShowByoaForm(false);
      orgOAuthApp.refetch();
      credentials.refetch();
      refetch();
    },
    [orgOAuthApp, credentials, refetch],
  );

  const handleRemoveOrgApp = useCallback(async () => {
    await orgOAuthApp.deleteOrgOAuthApp();
    orgOAuthApp.refetch();
    credentials.refetch();
    refetch();
  }, [orgOAuthApp, credentials, refetch]);

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

  // Unified Manage access — visibility (General access) over explicit grants
  // (People), opened from the kebab. Closes the blueprint share gap for MCP
  // servers.
  const access = useManageAccess({
    resource: mcpServer?.metadata
      ? {
          kind: ApiResourceKind.mcp_server,
          kindString: "mcp_server",
          id: mcpServer.metadata.id,
          org: mcpServer.metadata.org,
          name: mcpServer.metadata.name,
        }
      : null,
    visibility: mcpServer?.metadata
      ? {
          kind: "mcpServer",
          current: mcpServer.metadata.visibility,
          org: mcpServer.metadata.org,
          onChanged: refetch,
        }
      : undefined,
  });

  if (isLoading) return <LoadingSkeleton className={className} />;
  if (error)
    return <ErrorMessage error={error} retry={refetch} className={className} />;
  if (!mcpServer) return <NotFoundState className={className} />;

  const meta = mcpServer.metadata;
  const lastDiscoveredAt = capabilities?.lastDiscoveredAt
    ? timestampDate(capabilities.lastDiscoveredAt)
    : null;

  const headerMeta: ResourceHeaderMeta = {
    name: meta?.name || meta?.slug || "Untitled",
    nameElement: editable && saveMcpField ? (
      <InlineEditText
        value={meta?.name || ""}
        onSave={(v) => saveMcpField("name", v)}
        isSaving={isUpdating}
        variant="heading"
        placeholder="Server name"
        validate={(v) => (v.trim() ? null : "Name is required")}
      />
    ) : undefined,
    id: meta?.id || "",
    org: meta?.org,
    slug: meta?.slug,
    qualifiedSlug: meta?.slug
      ? (meta.org ? `${meta.org}/${meta.slug}` : meta.slug)
      : undefined,
    icon: editable && saveMcpField ? (
      <InlineEditImage
        value={spec?.iconUrl ?? ""}
        onSave={(v) => saveMcpField("iconUrl", v || undefined)}
        isSaving={isUpdating}
        fallback={<McpServerIcon className="size-6 text-muted-foreground" />}
        size="md"
      />
    ) : spec?.iconUrl ? undefined : <McpServerIcon className="size-6 text-muted-foreground" />,
    iconUrl: editable ? undefined : spec?.iconUrl || undefined,
    createdAt: specAudit?.createdAt ? timestampDate(specAudit.createdAt) : null,
    updatedAt: specAudit?.updatedAt ? timestampDate(specAudit.updatedAt) : null,
  };

  // Inline visibility is read-only (at-a-glance); editing lives in the
  // Manage access dialog, the single writer for both access axes.
  const visibilityControl = meta ? (
    <VisibilityBadge visibility={meta.visibility} />
  ) : undefined;

  const mergedActions = access.action
    ? [...(actions ?? []), access.action]
    : actions;

  const headerMetaExtra = (
    <>
      {status && <ValidationStateBadge state={status.validationState} />}
      {lastDiscoveredAt && (
        <>
          <Dot />
          <span>Discovered {formatDate(lastDiscoveredAt)}</span>
        </>
      )}
    </>
  );

  const headerBanner =
    status?.validationState === ValidationState.invalid &&
    status.validationMessage ? (
      <ValidationBanner message={status.validationMessage} />
    ) : undefined;

  return (
    <>
    <ResourceDetailShell
      header={headerMeta}
      visibilityControl={visibilityControl}
      headerMetaExtra={headerMetaExtra}
      headerBanner={headerBanner}
      primaryAction={primaryAction}
      actions={mergedActions}
      className={className}
    >
      {(editable || spec?.description) && (
        <Section title="Description">
          {editable && saveMcpField ? (
            <div className="max-h-20 overflow-y-auto p-3">
              <InlineEditTextarea
                value={spec?.description || ""}
                onSave={(v) => saveMcpField("description", v || undefined)}
                isSaving={isUpdating}
                placeholder="Add a description"
                minRows={2}
              />
            </div>
          ) : (
            <div className="p-3">
              <pre className="whitespace-pre-wrap break-words text-sm text-foreground font-sans">
                {spec?.description}
              </pre>
            </div>
          )}
        </Section>
      )}

      {hasSource && <SourceSection spec={spec} />}

      {(editable || spec?.serverType.case) && (
        <ServerConfigSection
          serverType={spec?.serverType}
          editable={editable}
          isSaving={isUpdating}
          saveMcpField={saveMcpField}
        />
      )}

      {(editable || (spec?.env && Object.keys(spec.env).length > 0)) && (
        <EnvSection
          data={spec?.env ?? {}}
          oauthTargetEnvVar={credentials.oauthTargetEnvVar}
          editable={editable}
          isSaving={isUpdating}
          saveMcpField={saveMcpField}
        />
      )}

      <Section title="Connection">
        <ConnectBar
          isConnecting={connection.isConnecting || oauth.isInProgress}
          connectionError={combinedError}
          onConnect={handleConnectClick}
          onClearConnectionError={combinedClearError}
          hasDiscoveredTools={hasDiscoveredTools}
          credentialsLoading={credentials.isLoading}
          oauthPhase={oauth.phase}
          authMode={credentials.authMode}
          isOAuthConnected={credentials.isOAuthConnected}
          connectionHealth={credentials.connectionHealth}
          canDisconnect={credentials.canDisconnect}
          onDisconnect={handleDisconnect}
          isDisconnecting={disconnectOAuth.isDisconnecting}
          disconnectError={disconnectOAuth.error}
          onClearDisconnectError={disconnectOAuth.clearError}
          serverName={mcpServer?.metadata?.name ?? slug}
          accessTokenExpiresAt={credentials.accessTokenExpiresAt}
          tokenLifetimeHint={credentials.tokenLifetimeHint}
          isVendorApprovalPending={credentials.isVendorApprovalPending}
          isVendorApprovalBlocked={credentials.isVendorApprovalBlocked}
          vendorApprovalDocsUrl={credentials.vendorApprovalDocsUrl}
          canBringOwnApp={credentials.canBringOwnApp}
          isOrgOAuthApp={credentials.isOrgOAuthApp}
          onBringOwnApp={() => setShowByoaForm(true)}
          onRemoveOrgApp={handleRemoveOrgApp}
          isRemovingOrgApp={orgOAuthApp.isDeleting}
          removeOrgAppError={orgOAuthApp.deleteError}
          onClearRemoveOrgAppError={orgOAuthApp.clearErrors}
          manualOverride={credentials.manualOverride}
          onManualOverride={() => {
            credentials.setManualOverride(true);
            setShowCredentialForm(true);
          }}
          onBackToOAuth={() => {
            credentials.setManualOverride(false);
            setShowCredentialForm(false);
          }}
          onCancelOAuth={oauth.clearError}
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

      {/* BYOA dialog — native <dialog> for zero-dependency modal behavior */}
      <dialog
        ref={byoaDialogRef}
        onCancel={handleByoaDialogCancel}
        className={cn(
          "m-auto w-full max-w-md rounded-lg border border-border bg-background p-6 shadow-lg",
          "backdrop:bg-black/50",
        )}
      >
        <h3 className="mb-4 text-base font-semibold text-foreground">
          Use your own OAuth app
        </h3>
        <OAuthAppForm
          providerName={mcpServer?.metadata?.name ?? slug}
          vendorDocsUrl={credentials.vendorApprovalDocsUrl}
          onSubmit={handleByoaSubmit}
          onCancel={() => {
            setShowByoaForm(false);
            orgOAuthApp.clearErrors();
          }}
          isSubmitting={orgOAuthApp.isSetting}
          error={orgOAuthApp.setError}
        />
      </dialog>

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

      {(editable || (spec && spec.tags.length > 0)) && (
        <TagsSection tags={spec?.tags ?? []} editable={editable} isSaving={isUpdating} saveMcpField={saveMcpField} />
      )}
    </ResourceDetailShell>
    {access.dialog}
    </>
  );
}

// ---------------------------------------------------------------------------
// ConnectBar — single entry point for capability discovery
// ---------------------------------------------------------------------------

/** Maps an OAuthConnectionHealth enum to pill display properties. */
function healthPillProps(
  health: OAuthConnectionHealth,
  isVendorApprovalPending: boolean,
): { pillClass: string; dotClass: string; label: string } {
  if (isVendorApprovalPending) {
    return {
      pillClass: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
      dotClass: "bg-amber-500",
      label: "Pending approval",
    };
  }
  switch (health) {
    case OAuthConnectionHealth.OAUTH_CONNECTION_HEALTH_HEALTHY:
      return {
        pillClass: "bg-success/10 text-success",
        dotClass: "bg-success",
        label: "Connected",
      };
    case OAuthConnectionHealth.OAUTH_CONNECTION_HEALTH_TOKEN_EXPIRED_REFRESHABLE:
      return {
        pillClass: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
        dotClass: "bg-amber-500",
        label: "Token expired",
      };
    case OAuthConnectionHealth.OAUTH_CONNECTION_HEALTH_TOKEN_EXPIRED:
      return {
        pillClass: "bg-destructive-subtle text-destructive",
        dotClass: "bg-destructive",
        label: "Re-auth needed",
      };
    default:
      return {
        pillClass: "bg-muted text-muted-foreground",
        dotClass: "bg-muted-foreground",
        label: "Not connected",
      };
  }
}

/** Health-aware status detail text shown alongside the pill. */
function healthStatusText(
  health: OAuthConnectionHealth,
  accessTokenExpiresAt: bigint,
  tokenLifetimeHint: string | null,
): string {
  switch (health) {
    case OAuthConnectionHealth.OAUTH_CONNECTION_HEALTH_HEALTHY: {
      const expiryLabel = formatTokenExpiry(accessTokenExpiresAt);
      if (expiryLabel) return `Tokens refresh automatically \u00B7 ${expiryLabel}`;
      const hint =
        tokenLifetimeHint && tokenLifetimeHint !== "never"
          ? ` \u00B7 Session lasts ~${tokenLifetimeHint}`
          : "";
      return `Tokens refresh automatically${hint}`;
    }
    case OAuthConnectionHealth.OAUTH_CONNECTION_HEALTH_TOKEN_EXPIRED_REFRESHABLE:
      return "Will refresh automatically on next use";
    case OAuthConnectionHealth.OAUTH_CONNECTION_HEALTH_TOKEN_EXPIRED:
      return "Token expired \u2014 sign in again to reconnect";
    default:
      return "Not connected yet";
  }
}

type DisconnectPhase = "idle" | "confirming" | "disconnecting";

type RemoveOrgAppPhase = "idle" | "confirming" | "removing";

function ConnectBar({
  isConnecting,
  connectionError,
  onConnect,
  onClearConnectionError,
  hasDiscoveredTools,
  credentialsLoading,
  oauthPhase,
  authMode,
  isOAuthConnected,
  connectionHealth,
  canDisconnect,
  onDisconnect,
  isDisconnecting,
  disconnectError,
  onClearDisconnectError,
  serverName,
  accessTokenExpiresAt,
  tokenLifetimeHint,
  isVendorApprovalPending,
  isVendorApprovalBlocked,
  vendorApprovalDocsUrl,
  canBringOwnApp,
  isOrgOAuthApp,
  onBringOwnApp,
  onRemoveOrgApp,
  isRemovingOrgApp,
  removeOrgAppError,
  onClearRemoveOrgAppError,
  manualOverride,
  onManualOverride,
  onBackToOAuth,
  onCancelOAuth,
}: {
  readonly isConnecting: boolean;
  readonly connectionError: Error | null;
  readonly onConnect: () => void;
  readonly onClearConnectionError: () => void;
  readonly hasDiscoveredTools: boolean;
  readonly credentialsLoading: boolean;
  readonly oauthPhase: OAuthConnectPhase;
  readonly authMode: "manual" | "oauth";
  readonly isOAuthConnected: boolean;
  readonly connectionHealth: OAuthConnectionHealth;
  readonly canDisconnect: boolean;
  readonly onDisconnect: () => Promise<void>;
  readonly isDisconnecting: boolean;
  readonly disconnectError: Error | null;
  readonly onClearDisconnectError: () => void;
  readonly serverName: string;
  readonly accessTokenExpiresAt: bigint;
  readonly tokenLifetimeHint: string | null;
  readonly isVendorApprovalPending: boolean;
  readonly isVendorApprovalBlocked: boolean;
  readonly vendorApprovalDocsUrl: string | null;
  readonly canBringOwnApp: boolean;
  readonly isOrgOAuthApp: boolean;
  readonly onBringOwnApp: () => void;
  readonly onRemoveOrgApp: () => Promise<void>;
  readonly isRemovingOrgApp: boolean;
  readonly removeOrgAppError: Error | null;
  readonly onClearRemoveOrgAppError: () => void;
  readonly manualOverride: boolean;
  readonly onManualOverride: () => void;
  readonly onBackToOAuth: () => void;
  readonly onCancelOAuth: () => void;
}) {
  const [disconnectPhase, setDisconnectPhase] = useState<DisconnectPhase>("idle");
  const [removeOrgAppPhase, setRemoveOrgAppPhase] = useState<RemoveOrgAppPhase>("idle");

  const isOAuthBusy =
    oauthPhase === "initiating" ||
    oauthPhase === "awaiting-callback" ||
    oauthPhase === "completing" ||
    oauthPhase === "connecting";

  const showOAuthPrimary =
    authMode === "oauth" && !isOAuthConnected && !manualOverride;

  const needsReAuth =
    connectionHealth === OAuthConnectionHealth.OAUTH_CONNECTION_HEALTH_TOKEN_EXPIRED;

  const oauthSignInDisabled =
    isVendorApprovalBlocked && showOAuthPrimary && !isOrgOAuthApp;

  const anyBusy = isConnecting || isOAuthBusy || isDisconnecting || isRemovingOrgApp;

  const buttonLabel = (() => {
    if (isOAuthBusy) return oauthPhaseLabel(oauthPhase);
    if (isConnecting) return "Connecting...";
    if (isOrgOAuthApp && showOAuthPrimary) return "Sign in with your app";
    if (showOAuthPrimary || needsReAuth) return "Sign in to connect";
    if (hasDiscoveredTools) return "Reconnect";
    return "Connect";
  })();

  const buttonIcon = (() => {
    if (isOAuthBusy || isConnecting) return <Spinner />;
    if (showOAuthPrimary || needsReAuth) return <OAuthIcon className="size-3.5" />;
    if (hasDiscoveredTools) return <RefreshIcon className="size-3.5" />;
    return <ConnectIcon className="size-3.5" />;
  })();

  const statusText = (() => {
    if (authMode === "oauth" && isOAuthConnected) {
      const base = healthStatusText(connectionHealth, accessTokenExpiresAt, tokenLifetimeHint);
      return isOrgOAuthApp ? `${base} \u00B7 Using your OAuth app` : base;
    }
    if (isOrgOAuthApp && showOAuthPrimary) return "Using your OAuth app";
    if (manualOverride) return "Entering token manually";
    if (hasDiscoveredTools) return "Connected";
    return "Not connected yet";
  })();

  const pill = healthPillProps(connectionHealth, isVendorApprovalPending && !isOAuthConnected);

  const showDisconnectLink =
    canDisconnect && !anyBusy && !manualOverride && disconnectPhase === "idle";

  const showRemoveOrgAppLink =
    isOrgOAuthApp && !anyBusy && removeOrgAppPhase === "idle";

  // Inline disconnect confirmation replaces the main bar content
  if (disconnectPhase === "confirming" || disconnectPhase === "disconnecting") {
    return (
      <div className="flex flex-col">
        <div className="flex items-center gap-2 px-3 py-2">
          <WarningIcon className="size-3.5 shrink-0 text-destructive" />
          <p className="flex-1 text-xs text-foreground">
            Remove OAuth credentials for <span className="font-medium">{serverName}</span>?
            You can reconnect at any time.
          </p>
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              disabled={isDisconnecting}
              onClick={async () => {
                setDisconnectPhase("disconnecting");
                try {
                  await onDisconnect();
                  setDisconnectPhase("idle");
                } catch {
                  setDisconnectPhase("confirming");
                }
              }}
              className={cn(
                "inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium",
                "bg-destructive text-destructive-foreground hover:bg-destructive-hover",
                "disabled:pointer-events-none disabled:opacity-50",
              )}
            >
              {isDisconnecting && <Spinner />}
              Disconnect
            </button>
            <button
              type="button"
              disabled={isDisconnecting}
              onClick={() => {
                setDisconnectPhase("idle");
                onClearDisconnectError();
              }}
              className={cn(
                "inline-flex items-center rounded-md px-2.5 py-1 text-xs font-medium",
                "border border-border bg-background text-foreground hover:bg-accent hover:text-accent-foreground",
                "disabled:pointer-events-none disabled:opacity-50",
              )}
            >
              Cancel
            </button>
          </div>
        </div>
        {disconnectError && (
          <div className="flex items-start gap-2 border-t border-destructive/20 bg-destructive-subtle px-3 py-2">
            <WarningIcon className="mt-0.5 size-3.5 shrink-0 text-destructive" />
            <p className="flex-1 text-xs text-destructive">
              {getUserMessage(disconnectError)}
            </p>
            <button
              type="button"
              onClick={onClearDisconnectError}
              className="shrink-0 text-xs text-destructive-muted hover:text-destructive"
              aria-label="Dismiss error"
            >
              Dismiss
            </button>
          </div>
        )}
      </div>
    );
  }

  // Inline "remove custom app" confirmation
  if (removeOrgAppPhase === "confirming" || removeOrgAppPhase === "removing") {
    return (
      <div className="flex flex-col">
        <div className="flex items-center gap-2 px-3 py-2">
          <WarningIcon className="size-3.5 shrink-0 text-destructive" />
          <p className="flex-1 text-xs text-foreground">
            Remove your custom OAuth app for{" "}
            <span className="font-medium">{serverName}</span>? The server
            will revert to the platform&apos;s OAuth app.
          </p>
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              disabled={isRemovingOrgApp}
              onClick={async () => {
                setRemoveOrgAppPhase("removing");
                try {
                  await onRemoveOrgApp();
                  setRemoveOrgAppPhase("idle");
                } catch {
                  setRemoveOrgAppPhase("confirming");
                }
              }}
              className={cn(
                "inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium",
                "bg-destructive text-destructive-foreground hover:bg-destructive-hover",
                "disabled:pointer-events-none disabled:opacity-50",
              )}
            >
              {isRemovingOrgApp && <Spinner />}
              Remove
            </button>
            <button
              type="button"
              disabled={isRemovingOrgApp}
              onClick={() => {
                setRemoveOrgAppPhase("idle");
                onClearRemoveOrgAppError();
              }}
              className={cn(
                "inline-flex items-center rounded-md px-2.5 py-1 text-xs font-medium",
                "border border-border bg-background text-foreground hover:bg-accent hover:text-accent-foreground",
                "disabled:pointer-events-none disabled:opacity-50",
              )}
            >
              Cancel
            </button>
          </div>
        </div>
        {removeOrgAppError && (
          <div className="flex items-start gap-2 border-t border-destructive/20 bg-destructive-subtle px-3 py-2">
            <WarningIcon className="mt-0.5 size-3.5 shrink-0 text-destructive" />
            <p className="flex-1 text-xs text-destructive">
              {getUserMessage(removeOrgAppError)}
            </p>
            <button
              type="button"
              onClick={onClearRemoveOrgAppError}
              className="shrink-0 text-xs text-destructive-muted hover:text-destructive"
              aria-label="Dismiss error"
            >
              Dismiss
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between px-3 py-2">
        <div className="flex items-center gap-2">
          {authMode === "oauth" && !manualOverride && (
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium",
                pill.pillClass,
              )}
            >
              <span
                className={cn("size-1.5 rounded-full", pill.dotClass)}
                aria-hidden="true"
              />
              {pill.label}
            </span>
          )}
          <span className="text-xs text-muted-foreground">
            {oauthSignInDisabled ? "OAuth sign-in is pending vendor approval" : statusText}
          </span>
          {showDisconnectLink && (
            <button
              type="button"
              onClick={() => setDisconnectPhase("confirming")}
              className="text-[11px] text-muted-foreground underline decoration-muted-foreground/40 underline-offset-2 hover:text-foreground hover:decoration-foreground"
            >
              Disconnect
            </button>
          )}
          {showRemoveOrgAppLink && (
            <button
              type="button"
              onClick={() => setRemoveOrgAppPhase("confirming")}
              className="text-[11px] text-muted-foreground underline decoration-muted-foreground/40 underline-offset-2 hover:text-foreground hover:decoration-foreground"
            >
              Remove custom app
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={onConnect}
          disabled={anyBusy || credentialsLoading || oauthSignInDisabled}
          data-cursor-target="connect-button"
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium",
            showOAuthPrimary || needsReAuth
              ? "bg-primary text-primary-foreground hover:bg-primary-hover"
              : "border border-border bg-background text-foreground hover:bg-accent hover:text-accent-foreground",
            "disabled:pointer-events-none disabled:opacity-50",
          )}
        >
          {buttonIcon}
          {buttonLabel}
        </button>
      </div>

      {oauthPhase === "awaiting-callback" && (
        <div className="flex items-center gap-3 border-t border-border px-3 py-1.5">
          <button
            type="button"
            onClick={onCancelOAuth}
            className="text-[11px] text-muted-foreground underline decoration-muted-foreground/40 underline-offset-2 hover:text-foreground hover:decoration-foreground"
          >
            Cancel sign-in
          </button>
        </div>
      )}

      {/* Vendor approval blocked banner with BYOA CTA */}
      {oauthSignInDisabled && (
        <div className="flex items-start gap-2 border-t border-amber-500/20 bg-amber-500/5 px-3 py-2">
          <WarningIcon className="mt-0.5 size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
          <div className="flex-1 text-xs text-amber-700 dark:text-amber-300">
            <p>
              The platform&apos;s OAuth app is awaiting vendor approval.
              {canBringOwnApp
                ? " You can use your own OAuth app or enter a token manually."
                : " You can still connect by entering your own token manually."}
            </p>
            {canBringOwnApp && (
              <button
                type="button"
                onClick={onBringOwnApp}
                data-cursor-target="byoa-cta-button"
                className="mt-1.5 inline-flex items-center gap-1 rounded-md bg-amber-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-amber-700 dark:bg-amber-500 dark:text-amber-950 dark:hover:bg-amber-400"
              >
                Use your own OAuth app
              </button>
            )}
            {vendorApprovalDocsUrl && !canBringOwnApp && (
              <a
                href={vendorApprovalDocsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-flex items-center gap-1 underline decoration-amber-600/40 underline-offset-2 hover:decoration-amber-600 dark:decoration-amber-400/40 dark:hover:decoration-amber-400"
              >
                Learn how to bring your own token
                <ExternalLinkIcon className="size-3 shrink-0" />
              </a>
            )}
          </div>
        </div>
      )}

      {/* Secondary actions: manual entry, BYOA, back to OAuth */}
      {authMode === "oauth" && !isOAuthConnected && !isOAuthBusy && !isConnecting && (
        <div className="flex items-center gap-3 border-t border-border px-3 py-1.5">
          {manualOverride ? (
            <button
              type="button"
              onClick={onBackToOAuth}
              className="text-[11px] text-muted-foreground underline decoration-muted-foreground/40 underline-offset-2 hover:text-foreground hover:decoration-foreground"
            >
              {isVendorApprovalPending ? "Back to OAuth status" : "Sign in with OAuth instead"}
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={onManualOverride}
                className="text-[11px] text-muted-foreground underline decoration-muted-foreground/40 underline-offset-2 hover:text-foreground hover:decoration-foreground"
              >
                Enter token manually
              </button>
              {canBringOwnApp && !isVendorApprovalBlocked && (
                <button
                  type="button"
                  onClick={onBringOwnApp}
                  className="text-[11px] text-muted-foreground underline decoration-muted-foreground/40 underline-offset-2 hover:text-foreground hover:decoration-foreground"
                >
                  Use your own OAuth app
                </button>
              )}
            </>
          )}
        </div>
      )}

      {connectionError && (
        <div
          className="flex items-start gap-2 border-t border-destructive/20 bg-destructive-subtle px-3 py-2"
          role="alert"
        >
          <WarningIcon className="mt-0.5 size-3.5 shrink-0 text-destructive" />
          <p className="flex-1 text-xs text-destructive">
            {getUserMessage(connectionError)}
          </p>
          <div className="flex shrink-0 items-center gap-2">
            {isRetryableError(connectionError) && (
              <button
                type="button"
                onClick={() => {
                  onClearConnectionError();
                  onConnect();
                }}
                className="text-xs font-medium text-destructive underline underline-offset-2 hover:no-underline"
              >
                Try again
              </button>
            )}
            <button
              type="button"
              onClick={onClearConnectionError}
              className="text-xs text-destructive-muted hover:text-destructive"
              aria-label="Dismiss error"
            >
              Dismiss
            </button>
          </div>
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
      className="flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive-subtle px-4 py-3"
    >
      <WarningIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-destructive">
          Invalid Configuration
        </p>
        <p className="mt-0.5 text-xs text-destructive-muted">{message}</p>
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

const TRANSPORT_OPTIONS: SelectOption[] = [
  { value: "http", label: "HTTP", description: "Connect via HTTP/SSE endpoint" },
  { value: "stdio", label: "Stdio", description: "Launch a local process with stdin/stdout" },
];

function ServerConfigSection({
  serverType,
  editable,
  isSaving,
  saveMcpField,
}: {
  readonly serverType?: import("@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/spec_pb").McpServerSpec["serverType"];
  readonly editable?: boolean;
  readonly isSaving?: boolean;
  readonly saveMcpField?: <K extends keyof import("@stigmer/sdk").McpServerInput>(
    field: K,
    value: import("@stigmer/sdk").McpServerInput[K],
  ) => Promise<boolean>;
}) {
  const [headersEditing, setHeadersEditing] = useState(false);
  const [queryParamsEditing, setQueryParamsEditing] = useState(false);

  const currentHttpConfig = useMemo(() => {
    if (serverType?.case !== "http") return null;
    const v = serverType.value;
    return {
      url: v.url,
      headers: v.headers && Object.keys(v.headers).length > 0 ? { ...v.headers } : undefined,
      queryParams: v.queryParams && Object.keys(v.queryParams).length > 0 ? { ...v.queryParams } : undefined,
      timeoutSeconds: v.timeoutSeconds || undefined,
    };
  }, [serverType]);

  const handleTransportChange = useCallback(
    async (newType: string) => {
      if (!saveMcpField) return false;
      if (newType === "http") {
        const ok = await saveMcpField("http", { url: "" });
        if (ok) await saveMcpField("stdio", undefined);
        return ok;
      }
      const ok = await saveMcpField("stdio", { command: "" });
      if (ok) await saveMcpField("http", undefined);
      return ok;
    },
    [saveMcpField],
  );

  const headerRows: KeyValueRow[] = useMemo(() => {
    if (!currentHttpConfig?.headers) return [];
    return Object.entries(currentHttpConfig.headers).map(([key, value]) => ({ key, value }));
  }, [currentHttpConfig?.headers]);

  const queryParamRows: KeyValueRow[] = useMemo(() => {
    if (!currentHttpConfig?.queryParams) return [];
    return Object.entries(currentHttpConfig.queryParams).map(([key, value]) => ({ key, value }));
  }, [currentHttpConfig?.queryParams]);

  const handleHeadersSave = useCallback(
    async (rows: KeyValueRow[]) => {
      if (!saveMcpField || !currentHttpConfig) return false;
      const headers: Record<string, string> = {};
      for (const row of rows) {
        if (row.key.trim()) headers[row.key.trim()] = row.value;
      }
      return saveMcpField("http", {
        ...currentHttpConfig,
        headers: Object.keys(headers).length > 0 ? headers : undefined,
      });
    },
    [saveMcpField, currentHttpConfig],
  );

  const handleQueryParamsSave = useCallback(
    async (rows: KeyValueRow[]) => {
      if (!saveMcpField || !currentHttpConfig) return false;
      const queryParams: Record<string, string> = {};
      for (const row of rows) {
        if (row.key.trim()) queryParams[row.key.trim()] = row.value;
      }
      return saveMcpField("http", {
        ...currentHttpConfig,
        queryParams: Object.keys(queryParams).length > 0 ? queryParams : undefined,
      });
    },
    [saveMcpField, currentHttpConfig],
  );

  return (
    <Section title="Server Configuration">
      <div className="flex flex-col gap-2 p-3">
        <div className="flex items-baseline gap-2">
          <span className="text-xs font-medium text-muted-foreground">
            Type
          </span>
          {editable && saveMcpField ? (
            <InlineEditSelect
              value={serverType?.case ?? "http"}
              options={TRANSPORT_OPTIONS}
              onSave={handleTransportChange}
              isSaving={isSaving}
            />
          ) : (
            <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs font-medium text-foreground">
              {serverType?.case ?? "none"}
            </span>
          )}
        </div>

        {serverType?.case === "stdio" && (
          <>
            <div className="flex items-baseline gap-2">
              <span className="text-xs font-medium text-muted-foreground">
                Command
              </span>
              {editable && saveMcpField ? (
                <InlineEditText
                  value={`${serverType.value.command}${serverType.value.args.length > 0 ? ` ${serverType.value.args.join(" ")}` : ""}`}
                  onSave={async (v) => {
                    const parts = v.trim().split(/\s+/);
                    return saveMcpField("stdio", {
                      command: parts[0] || "",
                      args: parts.slice(1),
                    });
                  }}
                  isSaving={isSaving}
                  placeholder="e.g. npx -y @modelcontextprotocol/server"
                />
              ) : (
                <code className="font-mono text-sm text-foreground">
                  {serverType.value.command}
                  {serverType.value.args.length > 0 &&
                    ` ${serverType.value.args.join(" ")}`}
                </code>
              )}
            </div>
            {(editable || serverType.value.workingDir) && (
              <div className="flex items-baseline gap-2">
                <span className="text-xs font-medium text-muted-foreground">
                  Working Dir
                </span>
                {editable && saveMcpField ? (
                  <InlineEditText
                    value={serverType.value.workingDir ?? ""}
                    onSave={async (v) =>
                      saveMcpField("stdio", {
                        command: serverType.value.command,
                        args: [...serverType.value.args],
                        workingDir: v || undefined,
                      })
                    }
                    isSaving={isSaving}
                    placeholder="/path/to/working/dir"
                  />
                ) : (
                  <code className="font-mono text-xs text-foreground">
                    {serverType.value.workingDir}
                  </code>
                )}
              </div>
            )}
          </>
        )}

        {serverType?.case === "http" && (
          <>
            <div className="flex items-baseline gap-2">
              <span className="text-xs font-medium text-muted-foreground">
                URL
              </span>
              {editable && saveMcpField ? (
                <InlineEditText
                  value={serverType.value.url}
                  onSave={async (v) =>
                    saveMcpField("http", { ...currentHttpConfig!, url: v })
                  }
                  isSaving={isSaving}
                  placeholder="https://example.com/mcp"
                />
              ) : (
                <code className="break-all font-mono text-sm text-foreground">
                  {serverType.value.url}
                </code>
              )}
            </div>
            {(editable || serverType.value.timeoutSeconds > 0) && (
              <div className="flex items-baseline gap-2">
                <span className="text-xs font-medium text-muted-foreground">
                  Timeout
                </span>
                {editable && saveMcpField ? (
                  <InlineEditText
                    value={serverType.value.timeoutSeconds > 0 ? String(serverType.value.timeoutSeconds) : ""}
                    onSave={async (v) =>
                      saveMcpField("http", {
                        ...currentHttpConfig!,
                        timeoutSeconds: v ? Number(v) : undefined,
                      })
                    }
                    isSaving={isSaving}
                    placeholder="30"
                    validate={(v) => {
                      if (v && (isNaN(Number(v)) || Number(v) < 0)) return "Must be a positive number";
                      return null;
                    }}
                  />
                ) : (
                  <span className="text-xs text-foreground">
                    {serverType.value.timeoutSeconds}s
                  </span>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {serverType?.case === "http" && (editable || headerRows.length > 0) && (
        <HttpKeyValueSubsection
          title="Headers"
          count={headerRows.length}
          rows={headerRows}
          editable={editable}
          isSaving={isSaving}
          editing={headersEditing}
          onEditingChange={setHeadersEditing}
          onSave={handleHeadersSave}
          keyLabel="Header name"
        />
      )}

      {serverType?.case === "http" && (editable || queryParamRows.length > 0) && (
        <HttpKeyValueSubsection
          title="Query Parameters"
          count={queryParamRows.length}
          rows={queryParamRows}
          editable={editable}
          isSaving={isSaving}
          editing={queryParamsEditing}
          onEditingChange={setQueryParamsEditing}
          onSave={handleQueryParamsSave}
          keyLabel="Parameter name"
        />
      )}
    </Section>
  );
}

/** Renders a key-value subsection (headers or query params) within ServerConfigSection. */
function HttpKeyValueSubsection({
  title,
  count,
  rows,
  editable,
  isSaving,
  editing,
  onEditingChange,
  onSave,
  keyLabel,
}: {
  readonly title: string;
  readonly count: number;
  readonly rows: readonly KeyValueRow[];
  readonly editable?: boolean;
  readonly isSaving?: boolean;
  readonly editing: boolean;
  readonly onEditingChange: (v: boolean) => void;
  readonly onSave: (rows: KeyValueRow[]) => Promise<boolean>;
  readonly keyLabel: string;
}) {
  return (
    <div className="border-t border-border">
      <div className="flex items-center justify-between px-3 py-2">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">{title}</span>
          {count > 0 && (
            <span className="inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-muted px-1 py-px text-[10px] font-medium leading-none text-muted-foreground">
              {count}
            </span>
          )}
        </div>
        {editable && (
          <button
            type="button"
            onClick={() => onEditingChange(!editing)}
            className="text-[11px] text-muted-foreground underline decoration-muted-foreground/40 underline-offset-2 hover:text-foreground hover:decoration-foreground"
          >
            {editing ? "Done" : "Edit"}
          </button>
        )}
      </div>
      {editable && editing ? (
        <InlineEditKeyValue
          value={[...rows]}
          onSave={onSave}
          isSaving={isSaving}
          editing={editing}
          onEditingChange={onEditingChange}
          keyLabel={keyLabel}
          showValue
          valueLabel="Value"
        />
      ) : (
        <div className="flex flex-col divide-y divide-border">
          {rows.map((row) => (
            <div key={row.key} className="flex items-start gap-2 px-3 py-1.5">
              <code className="shrink-0 font-mono text-xs font-medium text-foreground">
                {row.key}
              </code>
              <span className="min-w-0 break-all font-mono text-xs text-muted-foreground">
                {renderHeaderValue(row.value)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const ENV_VAR_PLACEHOLDER = /\$\{([^}]+)\}/g;

/** Renders a header value, highlighting ${VAR} placeholders with a variable badge. */
function renderHeaderValue(value: string): React.ReactNode {
  if (!ENV_VAR_PLACEHOLDER.test(value)) return value;

  ENV_VAR_PLACEHOLDER.lastIndex = 0;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = ENV_VAR_PLACEHOLDER.exec(value)) !== null) {
    if (match.index > lastIndex) {
      parts.push(value.slice(lastIndex, match.index));
    }
    parts.push(
      <span
        key={match.index}
        className="inline-flex items-center gap-0.5 rounded bg-primary-subtle px-1 py-px text-[10px] font-medium text-primary"
        title={`Resolved from environment variable: ${match[1]}`}
      >
        {match[0]}
      </span>,
    );
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < value.length) {
    parts.push(value.slice(lastIndex));
  }

  return <>{parts}</>;
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
  editable,
  isSaving,
  saveMcpField,
}: {
  readonly data: { [key: string]: EnvVarDeclaration };
  readonly oauthTargetEnvVar: string | null;
  readonly editable?: boolean;
  readonly isSaving?: boolean;
  readonly saveMcpField?: <K extends keyof import("@stigmer/sdk").McpServerInput>(
    field: K,
    value: import("@stigmer/sdk").McpServerInput[K],
  ) => Promise<boolean>;
}) {
  const entries = Object.entries(data).sort(([a], [b]) =>
    a.localeCompare(b),
  );

  const envRows: KeyValueRow[] = useMemo(
    () =>
      entries.map(([key, decl]) => ({
        key,
        value: "",
        isSecret: decl.isSecret,
        description: decl.description,
        optional: decl.optional,
      })),
    [entries],
  );

  const handleEnvSave = useCallback(
    async (rows: KeyValueRow[]) => {
      if (!saveMcpField) return false;
      const env: Record<string, { isSecret?: boolean; description?: string; optional?: boolean }> = {};
      for (const row of rows) {
        if (row.key.trim()) {
          env[row.key.trim()] = {
            isSecret: row.isSecret || undefined,
            description: row.description || undefined,
            optional: row.optional || undefined,
          };
        }
      }
      return saveMcpField("env", Object.keys(env).length > 0 ? env : undefined);
    },
    [saveMcpField],
  );

  const [envEditing, setEnvEditing] = useState(false);

  return (
    <Section title="Environment Variables" count={entries.length} onEdit={editable ? () => setEnvEditing((v) => !v) : undefined}>
      {editable ? (
        <InlineEditKeyValue
          value={envRows}
          onSave={handleEnvSave}
          isSaving={isSaving}
          editing={envEditing}
          onEditingChange={setEnvEditing}
          showSecretToggle
          showOptionalToggle
          showDescription
          keyLabel="Variable name"
        />
      ) : (
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
                  <span className="shrink-0 rounded bg-primary-subtle px-1.5 py-0.5 text-[10px] font-medium text-primary">
                    oauth
                  </span>
                )}
                {env.optional && (
                  <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground-subtle">
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
      )}
    </Section>
  );
}

function TagsSection({
  tags,
  editable,
  isSaving,
  saveMcpField,
}: {
  readonly tags: readonly string[];
  readonly editable?: boolean;
  readonly isSaving?: boolean;
  readonly saveMcpField?: <K extends keyof import("@stigmer/sdk").McpServerInput>(
    field: K,
    value: import("@stigmer/sdk").McpServerInput[K],
  ) => Promise<boolean>;
}) {
  const tagRows: KeyValueRow[] = useMemo(
    () => tags.map((t) => ({ key: t, value: "" })),
    [tags],
  );

  const handleTagsSave = useCallback(
    async (rows: KeyValueRow[]) => {
      if (!saveMcpField) return false;
      // Tags are stored as string[] on the spec but not directly on McpServerInput.
      // For now, save them through the full input by modifying the spec.
      // Tags don't have a direct field on McpServerInput, so we handle this at
      // a higher level if needed. For now, show read-only in edit mode.
      return false;
    },
    [saveMcpField],
  );

  return (
    <Section title="Tags" count={tags.length}>
      <div className="flex flex-wrap gap-1.5 p-3">
        {tags.map((tag) => (
          <span
            key={tag}
            className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground"
          >
            {tag}
          </span>
        ))}
        {editable && tags.length === 0 && (
          <p className="text-xs text-muted-foreground italic">No tags</p>
        )}
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
  const [search, setSearch] = useState("");
  const [expandedTool, setExpandedTool] = useState<string | null>(null);

  const filtered = useMemo(() => {
    if (!search.trim()) return tools;
    const q = search.toLowerCase();
    return tools.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.description?.toLowerCase().includes(q),
    );
  }, [tools, search]);

  if (tools.length === 0) {
    return (
      <div className="px-3 py-8 text-center">
        <ConnectIcon className="mx-auto mb-2 size-6 text-muted-foreground-faint" />
        <p className="text-xs text-muted-foreground">
          Connect to this MCP server to discover its available tools.
        </p>
      </div>
    );
  }

  const isFiltered = search.trim().length > 0;

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 px-3 pb-2">
        <div className="relative flex-1">
          <SearchIcon className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tools…"
            aria-label="Search tools"
            className="w-full rounded-md border border-border bg-background py-1.5 pl-7 pr-7 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
          {isFiltered && (
            <button
              type="button"
              onClick={() => setSearch("")}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <CloseIcon className="size-3" />
            </button>
          )}
        </div>
        <span className="shrink-0 text-[10px] text-muted-foreground">
          {isFiltered ? `${filtered.length} of ${tools.length}` : tools.length}
        </span>
      </div>

      {filtered.length === 0 ? (
        <div className="px-3 py-6 text-center">
          <p className="text-xs text-muted-foreground">
            No tools matching &ldquo;{search}&rdquo;
          </p>
        </div>
      ) : (
        <div className="max-h-96 overflow-y-auto">
          <div className="flex flex-col divide-y divide-border">
            {filtered.map((tool) => {
              const isExpanded = expandedTool === tool.name;
              const hasSchema =
                tool.inputSchema != null &&
                Object.keys(tool.inputSchema).length > 0;

              return (
                <div key={tool.name}>
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedTool(isExpanded ? null : tool.name)
                    }
                    className="flex w-full items-start gap-2 px-3 py-2.5 text-left transition-colors hover:bg-muted-faint"
                    aria-expanded={isExpanded}
                  >
                    <ChevronIcon
                      className={cn(
                        "mt-0.5 size-3 shrink-0 text-muted-foreground transition-transform",
                        isExpanded && "rotate-90",
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <code className="font-mono text-sm font-medium text-foreground">
                        {tool.name}
                      </code>
                      {tool.description && (
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {tool.description}
                        </p>
                      )}
                    </div>
                    {hasSchema && (
                      <span className="mt-0.5 shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                        schema
                      </span>
                    )}
                  </button>
                  {isExpanded && hasSchema && (
                    <div className="border-t border-border bg-muted-faint px-3 py-2">
                      <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded border border-border bg-background p-2 font-mono text-[11px] text-foreground">
                        {JSON.stringify(tool.inputSchema, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
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
  const [search, setSearch] = useState("");

  const totalCount = pinnedPolicies.length + classifiedPolicies.length;
  const hasAnyPolicies = totalCount > 0;

  const filteredPinned = useMemo(() => {
    if (!search.trim()) return pinnedPolicies;
    const q = search.toLowerCase();
    return pinnedPolicies.filter(
      (p) =>
        p.toolName.toLowerCase().includes(q) ||
        p.message?.toLowerCase().includes(q),
    );
  }, [pinnedPolicies, search]);

  const filteredClassified = useMemo(() => {
    if (!search.trim()) return classifiedPolicies;
    const q = search.toLowerCase();
    return classifiedPolicies.filter(
      (p) =>
        p.toolName.toLowerCase().includes(q) ||
        p.message?.toLowerCase().includes(q),
    );
  }, [classifiedPolicies, search]);

  const filteredTotal = filteredPinned.length + filteredClassified.length;
  const isFiltered = search.trim().length > 0;

  if (!hasAnyPolicies) {
    return (
      <div className="px-3 py-8 text-center">
        <ShieldIcon className="mx-auto mb-2 size-6 text-muted-foreground-faint" />
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
      <div className="flex items-center gap-2 px-3 pb-2">
        <div className="relative flex-1">
          <SearchIcon className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search policies…"
            aria-label="Search policies"
            className="w-full rounded-md border border-border bg-background py-1.5 pl-7 pr-7 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
          {isFiltered && (
            <button
              type="button"
              onClick={() => setSearch("")}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <CloseIcon className="size-3" />
            </button>
          )}
        </div>
        <span className="shrink-0 text-[10px] text-muted-foreground">
          {isFiltered ? `${filteredTotal} of ${totalCount}` : totalCount}
        </span>
      </div>

      {filteredTotal === 0 ? (
        <div className="px-3 py-6 text-center">
          <p className="text-xs text-muted-foreground">
            No policies matching &ldquo;{search}&rdquo;
          </p>
        </div>
      ) : (
        <div className="max-h-96 overflow-y-auto">
          {filteredPinned.length > 0 && (
            <PolicyGroup
              icon={<PinIcon className="size-3.5" />}
              label="Pinned"
              policies={filteredPinned}
            />
          )}
          {filteredClassified.length > 0 && (
            <PolicyGroup
              icon={<SparklesIcon className="size-3.5" />}
              label="Auto-classified"
              policies={filteredClassified}
            />
          )}
        </div>
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
      <div className="flex items-center gap-1.5 border-b border-border bg-muted-faint px-3 py-1.5">
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
              <span className="inline-flex items-center gap-1 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
                <ShieldIcon className="size-2.5" />
                requires approval
              </span>
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
            className="animate-pulse rounded-lg border border-border bg-muted-faint"
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
      <McpServerIcon className="size-10 text-muted-foreground-faint" />
      <p className="text-sm font-medium text-muted-foreground">
        MCP Server not found
      </p>
      <p className="text-xs text-muted-foreground-subtle">
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

function SearchIcon({ className }: { readonly className?: string }) {
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
      <circle cx="7" cy="7" r="4.5" />
      <path d="m10.5 10.5 3 3" />
    </svg>
  );
}

function CloseIcon({ className }: { readonly className?: string }) {
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
      <path d="m4 4 8 8M12 4l-8 8" />
    </svg>
  );
}

function ChevronIcon({ className }: { readonly className?: string }) {
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
      <path d="m6 4 4 4-4 4" />
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
