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
import { useMcpServer } from "./useMcpServer.js";
import type { UseMcpServerReturn } from "./useMcpServer.js";
import { useUpdateMcpServer } from "./useUpdateMcpServer.js";
import { mcpServerToInput } from "./internal/mcpServerToInput.js";
import { useMcpServerConnect } from "./useMcpServerConnect.js";
import { useMcpServerCredentials } from "./useMcpServerCredentials.js";
import {
  useMcpServerOAuthConnect,
  getOAuthConnectErrorMessage,
} from "./useMcpServerOAuthConnect.js";
import type { OAuthConnectPhase } from "./useMcpServerOAuthConnect.js";
import { StdioSandboxNotice } from "./StdioSandboxNotice.js";
import { OAuthRequiredNotice } from "./OAuthRequiredNotice.js";
import { VendorApprovalBlockedNotice } from "./VendorApprovalBlockedNotice.js";
import { useDisconnectOAuth } from "./useDisconnectOAuth.js";
import { useOrgOAuthApp } from "./useOrgOAuthApp.js";
import { OAuthAppForm } from "./OAuthAppForm.js";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ErrorMessage } from "../error/ErrorMessage.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "../internal/tooltip.js";
import { EnvVarForm } from "../environment/EnvVarForm.js";
import type { EnvVarFormVariable } from "../environment/EnvVarForm.js";
import { VisibilityBadge } from "../library/VisibilitySelector.js";
import { useManageAccess } from "../access/useManageAccess.js";
import { Tabs, type TabItem } from "../tabs/Tabs.js";
import { ResourceDetailShell } from "../resource-detail/ResourceDetailShell.js";
import { Section } from "../resource-detail/Section.js";
import type { DetailAction, ResourceHeaderMeta } from "../resource-detail/types.js";
import { InlineEditText } from "../inline-edit/InlineEditText.js";
import { InlineEditTextarea } from "../inline-edit/InlineEditTextarea.js";
import { InlineEditImage } from "../inline-edit/InlineEditImage.js";
import { InlineEditSelect } from "../inline-edit/InlineEditSelect.js";
import { InlineEditKeyValue } from "../inline-edit/InlineEditKeyValue.js";
import type { KeyValueRow, SelectOption } from "../inline-edit/types.js";

/** Tab identifier for the MCP server capability panel. */
export type CapabilityTab = "tools" | "policies" | "resources";

/** Props for {@link McpServerDetailView}. */
export interface McpServerDetailViewProps {
  /** Organization slug that owns the MCP server. */
  readonly org: string;
  /** MCP server slug (URL-friendly identifier unique within the org). */
  readonly slug: string;
  /**
   * Hoisted resource state from {@link useMcpServer}, for callers that
   * already own the fetch. When provided, the view issues **no**
   * `getByReference` RPC of its own and renders entirely from this state —
   * loading, error, and not-found included, so a caller mid-fetch still
   * gets the loading skeleton rather than a false not-found.
   *
   * Ownership contract: supplying this state means supplying its
   * lifecycle. The view calls `mcpServerState.refetch()` after connect,
   * disconnect, and inline edits, so the `refetch` you pass must refresh
   * the data behind `mcpServer` or the view will render stale state after
   * those actions.
   *
   * Two callers this serves:
   * - A page that already fetched the server (e.g. for export/YAML
   *   actions) passes `useMcpServer(org, slug)` straight through instead
   *   of paying a duplicate RPC.
   * - A guided tour or demo supplies frozen state
   *   (`{ mcpServer, isLoading: false, isRefetching: false, error: null,
   *   refetch: noop }`) so every depicted beat renders deterministically
   *   from data the tour owns (scenar-cloud DD-006).
   *
   * When omitted, the view fetches by `org`/`slug` itself, as before.
   */
  readonly mcpServerState?: UseMcpServerReturn;
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
 * Fetches the server via {@link useMcpServer} internally — or renders
 * from hoisted state when the caller passes `mcpServerState` — and shows
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
 *
 * @example
 * ```tsx
 * // Hoisted — the page already fetched the server (e.g. for YAML
 * // export actions), so pass that state through instead of paying a
 * // second getByReference RPC.
 * const state = useMcpServer(org, slug);
 * <McpServerDetailView org={org} slug={slug} mcpServerState={state} />
 * ```
 */
export function McpServerDetailView({
  org,
  slug,
  mcpServerState,
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
  // Hoisted-state mode: when the caller supplies `mcpServerState`, disable
  // the internal fetch via the hook's documented null-skip (a stable no-op,
  // so `fetched` reports isLoading=false with no RPC) and render from the
  // caller's state instead — all four states (loading/error/not-found/data)
  // transfer intact.
  const fetched = useMcpServer(
    mcpServerState ? null : org,
    mcpServerState ? null : slug,
  );
  const { mcpServer, isLoading, error, refetch } = mcpServerState ?? fetched;
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
      // Error state is managed by the oauth hook — but refetch anyway:
      // completeOAuthConnect persists the grant BEFORE the chained
      // discovery runs, so a discovery-leg failure still changed server
      // state. Without this, stale isOAuthConnected=false makes the next
      // Connect click relaunch the popup instead of retrying discovery
      // (stigmer/stigmer#229).
      credentials.refetch();
      refetch();
    }
  }, [mcpServer, oauth, credentials, refetch]);

  // A failure in the "connecting" phase proves sign-in already succeeded —
  // the grant exists server-side even while the grant-status refetch is
  // still in flight. Retry bare discovery; never relaunch the popup and
  // never demand credentials the flow already has.
  const isDiscoveryRetry =
    credentials.authMode === "oauth" && oauth.failedPhase === "connecting";

  const handleConnectClick = useCallback(async () => {
    if (!mcpServer?.metadata?.id) return;

    if (
      credentials.authMode === "oauth" &&
      !credentials.isOAuthConnected &&
      !credentials.manualOverride &&
      !isDiscoveryRetry
    ) {
      handleOAuthSignIn();
      return;
    }

    if (!credentials.isReady && !isDiscoveryRetry) {
      setShowCredentialForm(true);
      return;
    }

    const envKeys = Object.keys(mcpServer.spec?.env ?? {});
    try {
      await connection.connect(mcpServer.metadata.id, activeOrg ?? org, undefined, envKeys);
      // Discovery succeeded — retire the OAuth chain's stale
      // discovery-failure error so the banner doesn't outlive the state
      // it described.
      oauth.clearError();
      refetch();
    } catch {
      // error state is managed by the hook
    }
  }, [mcpServer, credentials.authMode, credentials.isOAuthConnected, credentials.manualOverride, credentials.isReady, isDiscoveryRetry, connection, oauth.clearError, refetch, handleOAuthSignIn, activeOrg, org]);

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

  // "Signed in but never discovered" (stigmer/stigmer#229): the OAuth flow
  // persists the grant in completeOAuthConnect BEFORE the chained discovery
  // runs, so a failed/interrupted discovery leg leaves a healthy grant with
  // empty discovered_capabilities. Both inputs are server truth, so this
  // derivation survives reloads and self-heals once discovery lands (even
  // when the workflow outlives the browser's RPC). Token-expired grants are
  // excluded — re-auth, not discovery, is their next step.
  const isOAuthStranded =
    credentials.authMode === "oauth" &&
    credentials.isOAuthConnected &&
    credentials.connectionHealth !==
      OAuthConnectionHealth.OAUTH_CONNECTION_HEALTH_TOKEN_EXPIRED &&
    !hasDiscoveredTools;

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
  // OAuth-chain errors compose through the phase-aware helper so a
  // discovery-leg failure reads "signed in, but discovery failed" instead
  // of masquerading as a failed sign-in.
  const combinedErrorMessage = connection.error
    ? getUserMessage(connection.error)
    : oauth.error
      ? getOAuthConnectErrorMessage(oauth.error, oauth.failedPhase)
      : null;
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
        fallback={<McpServerIcon className="stg:size-6 stg:text-muted-foreground" />}
        size="md"
      />
    ) : spec?.iconUrl ? undefined : <McpServerIcon className="stg:size-6 stg:text-muted-foreground" />,
    iconUrl: editable ? undefined : spec?.iconUrl || undefined,
    createdAt: specAudit?.createdAt ? timestampDate(specAudit.createdAt) : null,
    updatedAt: specAudit?.updatedAt ? timestampDate(specAudit.updatedAt) : null,
  };

  // Inline visibility is at-a-glance AND a shortcut into the Manage access
  // dialog — the single writer for both access axes. The chip is navigation
  // only; it stays a static badge for users who cannot view access.
  const visibilityControl = meta ? (
    <VisibilityBadge
      visibility={meta.visibility}
      onClick={access.action ? access.open : undefined}
    />
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
            <div className="stg:max-h-20 stg:overflow-y-auto stg:p-3">
              <InlineEditTextarea
                value={spec?.description || ""}
                onSave={(v) => saveMcpField("description", v || undefined)}
                isSaving={isUpdating}
                placeholder="Add a description"
                minRows={2}
              />
            </div>
          ) : (
            <div className="stg:p-3">
              <pre className="stg:whitespace-pre-wrap stg:break-words stg:text-sm stg:text-foreground stg:font-sans">
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

      {/* scrollTarget: guided tours/demos bring the connect flow into view
          (see IdentityTransportStep's "mcp-transport" for the convention). */}
      <Section title="Connection" scrollTarget="mcp-connection">
        <StdioSandboxNotice serverType={spec?.serverType} className="stg:mb-3" />
        <OAuthRequiredNotice oauthOnly={spec?.auth?.oauthOnly} className="stg:mb-3" />
        <ConnectBar
          manualEntrySupported={credentials.manualEntrySupported}
          isConnecting={connection.isConnecting || oauth.isInProgress}
          connectionError={combinedError}
          connectionErrorMessage={combinedErrorMessage}
          onConnect={handleConnectClick}
          onClearConnectionError={combinedClearError}
          hasDiscoveredTools={hasDiscoveredTools}
          isOAuthStranded={isOAuthStranded}
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
            className="stg:border-b stg:border-border stg:p-4"
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
              className="stg:w-full stg:max-w-md"
            />
          </div>
        )}
      </Section>

      {/* BYOA dialog — native <dialog> for zero-dependency modal behavior */}
      <dialog
        ref={byoaDialogRef}
        onCancel={handleByoaDialogCancel}
        className={cn(
          "stg:m-auto stg:w-full stg:max-w-md stg:rounded-lg stg:border stg:border-border stg:bg-background stg:p-6 stg:shadow-lg",
          "stg:backdrop:bg-black/50",
        )}
      >
        <h3 className="stg:mb-4 stg:text-base stg:font-semibold stg:text-foreground">
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

      <Section title="Capabilities" scrollTarget="mcp-capabilities">
        <Tabs
          tabs={capabilityTabs}
          activeTab={capabilityTab}
          onTabChange={(id) => setCapabilityTab(id as CapabilityTab)}
          aria-label="MCP server capabilities"
        >
          {capabilityTab === "tools" && (
            <ToolsTabContent
              tools={tools}
              isOAuthStranded={isOAuthStranded}
              onDiscover={handleConnectClick}
              isDiscovering={connection.isConnecting || oauth.isInProgress}
            />
          )}

          {capabilityTab === "policies" && (
            <PoliciesTabContent
              pinnedPolicies={pinnedPolicies}
              classifiedPolicies={classifiedPolicies}
              hasDiscoveredTools={hasDiscoveredTools}
              isOAuthStranded={isOAuthStranded}
            />
          )}

          {capabilityTab === "resources" && (
            <ResourceTemplatesList templates={resourceTemplates} />
          )}
        </Tabs>
      </Section>

      {(editable || (spec && spec.tags.length > 0)) && (
        <TagsSection tags={spec?.tags ?? []} editable={editable} />
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
      pillClass: "stg:bg-amber-500/10 stg:text-amber-600 stg:dark:text-amber-400",
      dotClass: "stg:bg-amber-500",
      label: "Pending approval",
    };
  }
  switch (health) {
    case OAuthConnectionHealth.OAUTH_CONNECTION_HEALTH_HEALTHY:
      return {
        pillClass: "stg:bg-success/10 stg:text-success",
        dotClass: "stg:bg-success",
        label: "Connected",
      };
    case OAuthConnectionHealth.OAUTH_CONNECTION_HEALTH_TOKEN_EXPIRED_REFRESHABLE:
      return {
        pillClass: "stg:bg-amber-500/10 stg:text-amber-600 stg:dark:text-amber-400",
        dotClass: "stg:bg-amber-500",
        label: "Token expired",
      };
    case OAuthConnectionHealth.OAUTH_CONNECTION_HEALTH_TOKEN_EXPIRED:
      return {
        pillClass: "stg:bg-destructive-subtle stg:text-destructive",
        dotClass: "stg:bg-destructive",
        label: "Re-auth needed",
      };
    default:
      return {
        pillClass: "stg:bg-muted stg:text-muted-foreground",
        dotClass: "stg:bg-muted-foreground",
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
  connectionErrorMessage,
  onConnect,
  onClearConnectionError,
  hasDiscoveredTools,
  isOAuthStranded,
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
  manualEntrySupported,
  manualOverride,
  onManualOverride,
  onBackToOAuth,
  onCancelOAuth,
}: {
  readonly isConnecting: boolean;
  readonly connectionError: Error | null;
  /** Display copy for `connectionError`, pre-composed by the parent (phase-aware for OAuth-chain failures). */
  readonly connectionErrorMessage: string | null;
  readonly onConnect: () => void;
  readonly onClearConnectionError: () => void;
  readonly hasDiscoveredTools: boolean;
  /** OAuth grant is healthy but discovery never landed — see the derivation in the parent. */
  readonly isOAuthStranded: boolean;
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
  /** `false` for `oauth_only` servers — the manual-entry link is suppressed. */
  readonly manualEntrySupported: boolean;
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
    if (isOAuthStranded) return "Discover tools";
    if (hasDiscoveredTools) return "Reconnect";
    return "Connect";
  })();

  const buttonIcon = (() => {
    if (isOAuthBusy || isConnecting) return <Spinner />;
    if (showOAuthPrimary || needsReAuth) return <OAuthIcon className="stg:size-3.5" />;
    if (hasDiscoveredTools) return <RefreshIcon className="stg:size-3.5" />;
    return <ConnectIcon className="stg:size-3.5" />;
  })();

  const statusText = (() => {
    if (authMode === "oauth" && isOAuthConnected) {
      // Stranded takes precedence over token health: "tokens refresh
      // automatically" reads as all-done while the Tools tab is empty.
      if (isOAuthStranded) return "Signed in \u2014 tools not discovered yet";
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
      <div className="stg:flex stg:flex-col">
        <div className="stg:flex stg:items-center stg:gap-2 stg:px-3 stg:py-2">
          <WarningIcon className="stg:size-3.5 stg:shrink-0 stg:text-destructive" />
          <p className="stg:flex-1 stg:text-xs stg:text-foreground">
            Remove OAuth credentials for <span className="stg:font-medium">{serverName}</span>?
            You can reconnect at any time.
          </p>
          <div className="stg:flex stg:shrink-0 stg:items-center stg:gap-1.5">
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
                "stg:inline-flex stg:items-center stg:gap-1 stg:rounded-md stg:px-2.5 stg:py-1 stg:text-xs stg:font-medium",
                "stg:bg-destructive stg:text-destructive-foreground stg:hover:bg-destructive-hover",
                "stg:disabled:pointer-events-none stg:disabled:opacity-50",
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
                "stg:inline-flex stg:items-center stg:rounded-md stg:px-2.5 stg:py-1 stg:text-xs stg:font-medium",
                "stg:border stg:border-border stg:bg-background stg:text-foreground stg:hover:bg-accent stg:hover:text-accent-foreground",
                "stg:disabled:pointer-events-none stg:disabled:opacity-50",
              )}
            >
              Cancel
            </button>
          </div>
        </div>
        {disconnectError && (
          <div className="stg:flex stg:items-start stg:gap-2 stg:border-t stg:border-destructive/20 stg:bg-destructive-subtle stg:px-3 stg:py-2">
            <WarningIcon className="stg:mt-0.5 stg:size-3.5 stg:shrink-0 stg:text-destructive" />
            <p className="stg:flex-1 stg:text-xs stg:text-destructive">
              {getUserMessage(disconnectError)}
            </p>
            <button
              type="button"
              onClick={onClearDisconnectError}
              className="stg:shrink-0 stg:text-xs stg:text-destructive-muted stg:hover:text-destructive"
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
      <div className="stg:flex stg:flex-col">
        <div className="stg:flex stg:items-center stg:gap-2 stg:px-3 stg:py-2">
          <WarningIcon className="stg:size-3.5 stg:shrink-0 stg:text-destructive" />
          <p className="stg:flex-1 stg:text-xs stg:text-foreground">
            Remove your custom OAuth app for{" "}
            <span className="stg:font-medium">{serverName}</span>? The server
            will revert to the platform&apos;s OAuth app.
          </p>
          <div className="stg:flex stg:shrink-0 stg:items-center stg:gap-1.5">
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
                "stg:inline-flex stg:items-center stg:gap-1 stg:rounded-md stg:px-2.5 stg:py-1 stg:text-xs stg:font-medium",
                "stg:bg-destructive stg:text-destructive-foreground stg:hover:bg-destructive-hover",
                "stg:disabled:pointer-events-none stg:disabled:opacity-50",
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
                "stg:inline-flex stg:items-center stg:rounded-md stg:px-2.5 stg:py-1 stg:text-xs stg:font-medium",
                "stg:border stg:border-border stg:bg-background stg:text-foreground stg:hover:bg-accent stg:hover:text-accent-foreground",
                "stg:disabled:pointer-events-none stg:disabled:opacity-50",
              )}
            >
              Cancel
            </button>
          </div>
        </div>
        {removeOrgAppError && (
          <div className="stg:flex stg:items-start stg:gap-2 stg:border-t stg:border-destructive/20 stg:bg-destructive-subtle stg:px-3 stg:py-2">
            <WarningIcon className="stg:mt-0.5 stg:size-3.5 stg:shrink-0 stg:text-destructive" />
            <p className="stg:flex-1 stg:text-xs stg:text-destructive">
              {getUserMessage(removeOrgAppError)}
            </p>
            <button
              type="button"
              onClick={onClearRemoveOrgAppError}
              className="stg:shrink-0 stg:text-xs stg:text-destructive-muted stg:hover:text-destructive"
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
    <div className="stg:flex stg:flex-col">
      <div className="stg:flex stg:items-center stg:justify-between stg:px-3 stg:py-2">
        <div className="stg:flex stg:items-center stg:gap-2">
          {authMode === "oauth" && !manualOverride && (
            <span
              className={cn(
                "stg:inline-flex stg:items-center stg:gap-1.5 stg:rounded-full stg:px-2 stg:py-0.5 stg:text-[10px] stg:font-medium",
                pill.pillClass,
              )}
            >
              <span
                className={cn("stg:size-1.5 stg:rounded-full", pill.dotClass)}
                aria-hidden="true"
              />
              {pill.label}
            </span>
          )}
          <span className="stg:text-xs stg:text-muted-foreground">
            {oauthSignInDisabled ? "OAuth sign-in is pending vendor approval" : statusText}
          </span>
          {showDisconnectLink && (
            <button
              type="button"
              onClick={() => setDisconnectPhase("confirming")}
              className="stg:text-[11px] stg:text-muted-foreground stg:underline stg:decoration-muted-foreground/40 stg:underline-offset-2 stg:hover:text-foreground stg:hover:decoration-foreground"
            >
              Disconnect
            </button>
          )}
          {showRemoveOrgAppLink && (
            <button
              type="button"
              onClick={() => setRemoveOrgAppPhase("confirming")}
              className="stg:text-[11px] stg:text-muted-foreground stg:underline stg:decoration-muted-foreground/40 stg:underline-offset-2 stg:hover:text-foreground stg:hover:decoration-foreground"
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
            "stg:inline-flex stg:items-center stg:gap-1.5 stg:rounded-md stg:px-2.5 stg:py-1 stg:text-xs stg:font-medium",
            showOAuthPrimary || needsReAuth
              ? "stg:bg-primary stg:text-primary-foreground stg:hover:bg-primary-hover"
              : "stg:border stg:border-border stg:bg-background stg:text-foreground stg:hover:bg-accent stg:hover:text-accent-foreground",
            "stg:disabled:pointer-events-none stg:disabled:opacity-50",
          )}
        >
          {buttonIcon}
          {buttonLabel}
        </button>
      </div>

      {oauthPhase === "awaiting-callback" && (
        <div className="stg:flex stg:items-center stg:gap-3 stg:border-t stg:border-border stg:px-3 stg:py-1.5">
          <button
            type="button"
            onClick={onCancelOAuth}
            className="stg:text-[11px] stg:text-muted-foreground stg:underline stg:decoration-muted-foreground/40 stg:underline-offset-2 stg:hover:text-foreground stg:hover:decoration-foreground"
          >
            Cancel sign-in
          </button>
        </div>
      )}

      {/* Vendor approval blocked banner with BYOA CTA */}
      {oauthSignInDisabled && (
        <VendorApprovalBlockedNotice
          blocked
          pending={isVendorApprovalPending}
          manualEntrySupported={manualEntrySupported}
          canBringOwnApp={canBringOwnApp}
          docsUrl={vendorApprovalDocsUrl}
          onBringOwnApp={onBringOwnApp}
          className="stg:border-t stg:border-amber-500/20"
        />
      )}

      {/* Secondary actions: manual entry, BYOA, back to OAuth. Suppressed
          entirely for oauth_only servers with no BYOA option, so no empty
          action bar renders. */}
      {authMode === "oauth" && !isOAuthConnected && !isOAuthBusy && !isConnecting &&
        (manualOverride || manualEntrySupported || canBringOwnApp) && (
        <div className="stg:flex stg:items-center stg:gap-3 stg:border-t stg:border-border stg:px-3 stg:py-1.5">
          {manualOverride ? (
            <button
              type="button"
              onClick={onBackToOAuth}
              className="stg:text-[11px] stg:text-muted-foreground stg:underline stg:decoration-muted-foreground/40 stg:underline-offset-2 stg:hover:text-foreground stg:hover:decoration-foreground"
            >
              {isVendorApprovalPending ? "Back to OAuth status" : "Sign in with OAuth instead"}
            </button>
          ) : (
            <>
              {manualEntrySupported && (
                <button
                  type="button"
                  onClick={onManualOverride}
                  className="stg:text-[11px] stg:text-muted-foreground stg:underline stg:decoration-muted-foreground/40 stg:underline-offset-2 stg:hover:text-foreground stg:hover:decoration-foreground"
                >
                  Enter token manually
                </button>
              )}
              {canBringOwnApp && !isVendorApprovalBlocked && (
                <button
                  type="button"
                  onClick={onBringOwnApp}
                  className="stg:text-[11px] stg:text-muted-foreground stg:underline stg:decoration-muted-foreground/40 stg:underline-offset-2 stg:hover:text-foreground stg:hover:decoration-foreground"
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
          className="stg:flex stg:items-start stg:gap-2 stg:border-t stg:border-destructive/20 stg:bg-destructive-subtle stg:px-3 stg:py-2"
          role="alert"
        >
          <WarningIcon className="stg:mt-0.5 stg:size-3.5 stg:shrink-0 stg:text-destructive" />
          <p className="stg:flex-1 stg:text-xs stg:text-destructive">
            {connectionErrorMessage ?? getUserMessage(connectionError)}
          </p>
          <div className="stg:flex stg:shrink-0 stg:items-center stg:gap-2">
            {isRetryableError(connectionError) && (
              <button
                type="button"
                onClick={() => {
                  onClearConnectionError();
                  onConnect();
                }}
                className="stg:text-xs stg:font-medium stg:text-destructive stg:underline stg:underline-offset-2 stg:hover:no-underline"
              >
                Try again
              </button>
            )}
            <button
              type="button"
              onClick={onClearConnectionError}
              className="stg:text-xs stg:text-destructive-muted stg:hover:text-destructive"
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
      className="stg:flex stg:items-start stg:gap-2.5 stg:rounded-lg stg:border stg:border-destructive/30 stg:bg-destructive-subtle stg:px-4 stg:py-3"
    >
      <WarningIcon className="stg:mt-0.5 stg:size-4 stg:shrink-0 stg:text-destructive" />
      <div className="stg:min-w-0 stg:flex-1">
        <p className="stg:text-sm stg:font-medium stg:text-destructive">
          Invalid Configuration
        </p>
        <p className="stg:mt-0.5 stg:text-xs stg:text-destructive-muted">{message}</p>
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
          <span className="stg:inline-flex stg:items-center stg:gap-1 stg:text-emerald-600 stg:dark:text-emerald-400">
            <CheckIcon className="stg:size-3" />
            Valid
          </span>
        </>
      );
    case ValidationState.invalid:
      return (
        <>
          <Dot />
          <span className="stg:text-destructive">Invalid</span>
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
      <div className="stg:flex stg:flex-col stg:gap-2 stg:p-3">
        <div className="stg:flex stg:items-baseline stg:gap-2">
          <span className="stg:text-xs stg:font-medium stg:text-muted-foreground">
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
            <span className="stg:rounded stg:bg-muted stg:px-1.5 stg:py-0.5 stg:font-mono stg:text-xs stg:font-medium stg:text-foreground">
              {serverType?.case ?? "none"}
            </span>
          )}
        </div>

        {serverType?.case === "stdio" && (
          <>
            <div className="stg:flex stg:items-baseline stg:gap-2">
              <span className="stg:text-xs stg:font-medium stg:text-muted-foreground">
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
                <code className="stg:font-mono stg:text-sm stg:text-foreground">
                  {serverType.value.command}
                  {serverType.value.args.length > 0 &&
                    ` ${serverType.value.args.join(" ")}`}
                </code>
              )}
            </div>
            {(editable || serverType.value.workingDir) && (
              <div className="stg:flex stg:items-baseline stg:gap-2">
                <span className="stg:text-xs stg:font-medium stg:text-muted-foreground">
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
                  <code className="stg:font-mono stg:text-xs stg:text-foreground">
                    {serverType.value.workingDir}
                  </code>
                )}
              </div>
            )}
          </>
        )}

        {serverType?.case === "http" && (
          <>
            <div className="stg:flex stg:items-baseline stg:gap-2">
              <span className="stg:text-xs stg:font-medium stg:text-muted-foreground">
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
                <code className="stg:break-all stg:font-mono stg:text-sm stg:text-foreground">
                  {serverType.value.url}
                </code>
              )}
            </div>
            {(editable || serverType.value.timeoutSeconds > 0) && (
              <div className="stg:flex stg:items-baseline stg:gap-2">
                <span className="stg:text-xs stg:font-medium stg:text-muted-foreground">
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
                  <span className="stg:text-xs stg:text-foreground">
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
    <div className="stg:border-t stg:border-border">
      <div className="stg:flex stg:items-center stg:justify-between stg:px-3 stg:py-2">
        <div className="stg:flex stg:items-center stg:gap-1.5">
          <span className="stg:text-xs stg:font-medium stg:text-muted-foreground">{title}</span>
          {count > 0 && (
            <span className="stg:inline-flex stg:min-w-[1.25rem] stg:items-center stg:justify-center stg:rounded-full stg:bg-muted stg:px-1 stg:py-px stg:text-[10px] stg:font-medium stg:leading-none stg:text-muted-foreground">
              {count}
            </span>
          )}
        </div>
        {editable && (
          <button
            type="button"
            onClick={() => onEditingChange(!editing)}
            className="stg:text-[11px] stg:text-muted-foreground stg:underline stg:decoration-muted-foreground/40 stg:underline-offset-2 stg:hover:text-foreground stg:hover:decoration-foreground"
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
        <div className="stg:flex stg:flex-col stg:divide-y stg:divide-border">
          {rows.map((row) => (
            <div key={row.key} className="stg:flex stg:items-start stg:gap-2 stg:px-3 stg:py-1.5">
              <code className="stg:shrink-0 stg:font-mono stg:text-xs stg:font-medium stg:text-foreground">
                {row.key}
              </code>
              <span className="stg:min-w-0 stg:break-all stg:font-mono stg:text-xs stg:text-muted-foreground">
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
      <Tooltip key={match.index}>
        <TooltipTrigger
          render={
            <span className="stg:inline-flex stg:items-center stg:gap-0.5 stg:rounded stg:bg-primary-subtle stg:px-1 stg:py-px stg:text-[10px] stg:font-medium stg:text-primary" />
          }
        >
          {match[0]}
        </TooltipTrigger>
        <TooltipContent side="top">
          {`Resolved from environment variable: ${match[1]}`}
        </TooltipContent>
      </Tooltip>,
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
      <div className="stg:flex stg:flex-col stg:gap-2 stg:p-3">
        {spec.repositoryUrl && (
          <div className="stg:flex stg:items-baseline stg:gap-2">
            <span className="stg:shrink-0 stg:text-xs stg:font-medium stg:text-muted-foreground">
              Repository
            </span>
            <a
              href={spec.repositoryUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="stg:inline-flex stg:items-center stg:gap-1 stg:break-all stg:font-mono stg:text-xs stg:text-foreground stg:underline stg:decoration-muted-foreground/40 stg:underline-offset-2 stg:hover:decoration-foreground"
            >
              {spec.repositoryUrl}
              <ExternalLinkIcon className="stg:size-3 stg:shrink-0" />
            </a>
          </div>
        )}
        {spec.githubStars > 0 && (
          <div className="stg:flex stg:items-baseline stg:gap-2">
            <span className="stg:shrink-0 stg:text-xs stg:font-medium stg:text-muted-foreground">
              Stars
            </span>
            <span className="stg:text-xs stg:text-foreground">
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
    <div className="stg:flex stg:flex-col stg:divide-y stg:divide-border">
      {templates.map((tpl) => (
        <div key={tpl.uriTemplate || tpl.name} className="stg:px-3 stg:py-2.5">
          <div className="stg:flex stg:items-baseline stg:gap-2">
            <span className="stg:text-sm stg:font-medium stg:text-foreground">
              {tpl.name}
            </span>
            <code className="stg:font-mono stg:text-[10px] stg:text-muted-foreground">
              {tpl.uriTemplate}
            </code>
          </div>
          {tpl.description && (
            <p className="stg:mt-0.5 stg:text-xs stg:text-muted-foreground">
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
        <div className="stg:flex stg:flex-col stg:divide-y stg:divide-border">
          {entries.map(([name, env]) => {
            const isOAuthManaged = name === oauthTargetEnvVar;
            return (
              <div key={name} className="stg:flex stg:items-start stg:gap-3 stg:px-3 stg:py-2">
                <code className="stg:shrink-0 stg:font-mono stg:text-sm stg:font-medium stg:text-foreground">
                  {name}
                </code>
                <span className="stg:shrink-0 stg:rounded stg:bg-muted stg:px-1.5 stg:py-0.5 stg:text-[10px] stg:font-medium stg:text-muted-foreground">
                  {env.isSecret ? "secret" : "config"}
                </span>
                {isOAuthManaged && (
                  <span className="stg:shrink-0 stg:rounded stg:bg-primary-subtle stg:px-1.5 stg:py-0.5 stg:text-[10px] stg:font-medium stg:text-primary">
                    oauth
                  </span>
                )}
                {env.optional && (
                  <span className="stg:shrink-0 stg:rounded stg:bg-muted stg:px-1.5 stg:py-0.5 stg:text-[10px] stg:font-medium stg:text-muted-foreground-subtle">
                    optional
                  </span>
                )}
                {env.description && (
                  <span className="stg:text-xs stg:text-muted-foreground">
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
}: {
  readonly tags: readonly string[];
  readonly editable?: boolean;
}) {
  // Display-only by design: tags are curated marketplace categorization,
  // not per-connection state. (McpServerInput does carry `tags`, so an
  // editing affordance is unblocked if the product ever wants one.)
  return (
    <Section title="Tags" count={tags.length}>
      <div className="stg:flex stg:flex-wrap stg:gap-1.5 stg:p-3">
        {tags.map((tag) => (
          <span
            key={tag}
            className="stg:rounded-full stg:bg-muted stg:px-2.5 stg:py-0.5 stg:text-xs stg:font-medium stg:text-muted-foreground"
          >
            {tag}
          </span>
        ))}
        {editable && tags.length === 0 && (
          <p className="stg:text-xs stg:text-muted-foreground stg:italic">No tags</p>
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
  isOAuthStranded,
  onDiscover,
  isDiscovering,
}: {
  readonly tools: readonly DiscoveredTool[];
  /** OAuth grant is healthy but discovery never landed — renders the recovery empty state. */
  readonly isOAuthStranded: boolean;
  /** Runs tool discovery (the parent's connect handler). */
  readonly onDiscover: () => void;
  /** `true` while a discovery attempt is in flight. */
  readonly isDiscovering: boolean;
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
    // Two distinct empty states: "never connected" (informational) vs
    // "signed in but discovery never landed" (stigmer/stigmer#229) — the
    // latter must carry its own recovery action, because the user already
    // did the thing the informational copy asks for.
    return (
      <div className="stg:px-3 stg:py-8 stg:text-center">
        <ConnectIcon className="stg:mx-auto stg:mb-2 stg:size-6 stg:text-muted-foreground-faint" />
        {isOAuthStranded ? (
          <>
            <p className="stg:text-xs stg:text-muted-foreground">
              Signed in, but tools haven&apos;t been discovered yet.
            </p>
            <button
              type="button"
              onClick={onDiscover}
              disabled={isDiscovering}
              className={cn(
                "stg:mt-3 stg:inline-flex stg:items-center stg:gap-1.5 stg:rounded-md stg:px-2.5 stg:py-1 stg:text-xs stg:font-medium",
                "stg:bg-primary stg:text-primary-foreground stg:hover:bg-primary-hover",
                "stg:disabled:pointer-events-none stg:disabled:opacity-50",
              )}
            >
              {isDiscovering && <Spinner />}
              {isDiscovering ? "Discovering tools..." : "Discover tools"}
            </button>
          </>
        ) : (
          <p className="stg:text-xs stg:text-muted-foreground">
            Connect to this MCP server to discover its available tools.
          </p>
        )}
      </div>
    );
  }

  const isFiltered = search.trim().length > 0;

  return (
    <div className="stg:flex stg:flex-col">
      <div className="stg:flex stg:items-center stg:gap-2 stg:px-3 stg:pb-2">
        <div className="stg:relative stg:flex-1">
          <SearchIcon className="stg:pointer-events-none stg:absolute stg:left-2 stg:top-1/2 stg:size-3.5 stg:-translate-y-1/2 stg:text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tools…"
            aria-label="Search tools"
            className="stg:w-full stg:rounded-md stg:border stg:border-border stg:bg-background stg:py-1.5 stg:pl-7 stg:pr-7 stg:text-xs stg:text-foreground stg:placeholder:text-muted-foreground stg:focus:outline-none stg:focus:ring-2 stg:focus:ring-ring"
          />
          {isFiltered && (
            <button
              type="button"
              onClick={() => setSearch("")}
              aria-label="Clear search"
              className="stg:absolute stg:right-2 stg:top-1/2 stg:-translate-y-1/2 stg:text-muted-foreground stg:hover:text-foreground"
            >
              <CloseIcon className="stg:size-3" />
            </button>
          )}
        </div>
        <span className="stg:shrink-0 stg:text-[10px] stg:text-muted-foreground">
          {isFiltered ? `${filtered.length} of ${tools.length}` : tools.length}
        </span>
      </div>

      {filtered.length === 0 ? (
        <div className="stg:px-3 stg:py-6 stg:text-center">
          <p className="stg:text-xs stg:text-muted-foreground">
            No tools matching &ldquo;{search}&rdquo;
          </p>
        </div>
      ) : (
        <div className="stg:max-h-96 stg:overflow-y-auto">
          <div className="stg:flex stg:flex-col stg:divide-y stg:divide-border">
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
                    className="stg:flex stg:w-full stg:items-start stg:gap-2 stg:px-3 stg:py-2.5 stg:text-left stg:transition-colors stg:hover:bg-muted-faint"
                    aria-expanded={isExpanded}
                  >
                    <ChevronIcon
                      className={cn(
                        "stg:mt-0.5 stg:size-3 stg:shrink-0 stg:text-muted-foreground stg:transition-transform",
                        isExpanded && "stg:rotate-90",
                      )}
                    />
                    <div className="stg:min-w-0 stg:flex-1">
                      <code className="stg:font-mono stg:text-sm stg:font-medium stg:text-foreground">
                        {tool.name}
                      </code>
                      {tool.description && (
                        <p className="stg:mt-0.5 stg:text-xs stg:text-muted-foreground">
                          {tool.description}
                        </p>
                      )}
                    </div>
                    {hasSchema && (
                      <span className="stg:mt-0.5 stg:shrink-0 stg:rounded stg:bg-muted stg:px-1.5 stg:py-0.5 stg:text-[10px] stg:font-medium stg:text-muted-foreground">
                        schema
                      </span>
                    )}
                  </button>
                  {isExpanded && hasSchema && (
                    <div className="stg:border-t stg:border-border stg:bg-muted-faint stg:px-3 stg:py-2">
                      <pre className="stg:max-h-64 stg:overflow-auto stg:whitespace-pre-wrap stg:break-words stg:rounded stg:border stg:border-border stg:bg-background stg:p-2 stg:font-mono stg:text-[11px] stg:text-foreground">
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
  isOAuthStranded,
}: {
  readonly pinnedPolicies: readonly ToolApprovalPolicy[];
  readonly classifiedPolicies: readonly ToolApprovalPolicy[];
  readonly hasDiscoveredTools: boolean;
  /** OAuth grant is healthy but discovery never landed — adjusts the empty-state copy. */
  readonly isOAuthStranded: boolean;
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
      <div className="stg:px-3 stg:py-8 stg:text-center">
        <ShieldIcon className="stg:mx-auto stg:mb-2 stg:size-6 stg:text-muted-foreground-faint" />
        <p className="stg:text-xs stg:text-muted-foreground">
          {hasDiscoveredTools
            ? "No approval policies yet. Reconnect to reclassify tools."
            : isOAuthStranded
              ? "Signed in \u2014 discover tools to auto-classify approval policies."
              : "Connect to discover tools and auto-classify approval policies."}
        </p>
      </div>
    );
  }

  return (
    <div className="stg:flex stg:flex-col">
      <div className="stg:flex stg:items-center stg:gap-2 stg:px-3 stg:pb-2">
        <div className="stg:relative stg:flex-1">
          <SearchIcon className="stg:pointer-events-none stg:absolute stg:left-2 stg:top-1/2 stg:size-3.5 stg:-translate-y-1/2 stg:text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search policies…"
            aria-label="Search policies"
            className="stg:w-full stg:rounded-md stg:border stg:border-border stg:bg-background stg:py-1.5 stg:pl-7 stg:pr-7 stg:text-xs stg:text-foreground stg:placeholder:text-muted-foreground stg:focus:outline-none stg:focus:ring-2 stg:focus:ring-ring"
          />
          {isFiltered && (
            <button
              type="button"
              onClick={() => setSearch("")}
              aria-label="Clear search"
              className="stg:absolute stg:right-2 stg:top-1/2 stg:-translate-y-1/2 stg:text-muted-foreground stg:hover:text-foreground"
            >
              <CloseIcon className="stg:size-3" />
            </button>
          )}
        </div>
        <span className="stg:shrink-0 stg:text-[10px] stg:text-muted-foreground">
          {isFiltered ? `${filteredTotal} of ${totalCount}` : totalCount}
        </span>
      </div>

      {filteredTotal === 0 ? (
        <div className="stg:px-3 stg:py-6 stg:text-center">
          <p className="stg:text-xs stg:text-muted-foreground">
            No policies matching &ldquo;{search}&rdquo;
          </p>
        </div>
      ) : (
        <div className="stg:max-h-96 stg:overflow-y-auto">
          {filteredPinned.length > 0 && (
            <PolicyGroup
              icon={<PinIcon className="stg:size-3.5" />}
              label="Pinned"
              policies={filteredPinned}
            />
          )}
          {filteredClassified.length > 0 && (
            <PolicyGroup
              icon={<SparklesIcon className="stg:size-3.5" />}
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
    <div className="stg:flex stg:flex-col">
      <div className="stg:flex stg:items-center stg:gap-1.5 stg:border-b stg:border-border stg:bg-muted-faint stg:px-3 stg:py-1.5">
        <span className="stg:text-muted-foreground">{icon}</span>
        <span className="stg:text-[10px] stg:font-medium stg:uppercase stg:tracking-wider stg:text-muted-foreground">
          {label}
        </span>
        <span className="stg:text-[10px] stg:text-muted-foreground">
          ({policies.length})
        </span>
      </div>
      <div className="stg:flex stg:flex-col stg:divide-y stg:divide-border">
        {policies.map((policy) => (
          <div key={policy.toolName} className="stg:px-3 stg:py-2.5">
            <div className="stg:flex stg:items-baseline stg:gap-2">
              <code className="stg:font-mono stg:text-sm stg:font-medium stg:text-foreground">
                {policy.toolName}
              </code>
              <span className="stg:inline-flex stg:items-center stg:gap-1 stg:rounded stg:bg-amber-500/10 stg:px-1.5 stg:py-0.5 stg:text-[10px] stg:font-medium stg:text-amber-600 stg:dark:text-amber-400">
                <ShieldIcon className="stg:size-2.5" />
                requires approval
              </span>
            </div>
            {policy.message && (
              <p className="stg:mt-0.5 stg:text-xs stg:text-muted-foreground">
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
    <span className="stg:shrink-0" aria-hidden="true">
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
      className={cn("stg:flex stg:flex-col stg:gap-6", className)}
      aria-busy="true"
      aria-label="Loading MCP server details"
    >
      <div className="stg:flex stg:items-start stg:gap-3">
        <div className="stg:mt-1 stg:size-6 stg:shrink-0 stg:animate-pulse stg:rounded stg:bg-muted" />
        <div className="stg:flex-1 stg:space-y-2">
          <div className="stg:h-5 stg:w-48 stg:animate-pulse stg:rounded stg:bg-muted" />
          <div className="stg:h-3 stg:w-64 stg:animate-pulse stg:rounded stg:bg-muted" />
          <div className="stg:h-4 stg:w-full stg:max-w-md stg:animate-pulse stg:rounded stg:bg-muted" />
        </div>
      </div>
      {[24, 48, 16, 12].map((h, i) => (
        <div key={i} className="stg:space-y-2">
          <div className="stg:h-3 stg:w-28 stg:animate-pulse stg:rounded stg:bg-muted" />
          <div
            className="stg:animate-pulse stg:rounded-lg stg:border stg:border-border stg:bg-muted-faint"
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
        "stg:flex stg:flex-col stg:items-center stg:gap-2 stg:py-12 stg:text-center",
        className,
      )}
    >
      <McpServerIcon className="stg:size-10 stg:text-muted-foreground-faint" />
      <p className="stg:text-sm stg:font-medium stg:text-muted-foreground">
        MCP Server not found
      </p>
      <p className="stg:text-xs stg:text-muted-foreground-subtle">
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
      className="stg:animate-spin"
      aria-hidden="true"
    >
      <path d="M8 2a6 6 0 1 0 6 6" />
    </svg>
  );
}
