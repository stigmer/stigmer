"use client";

import { useCallback, useState } from "react";
import { cn } from "@stigmer/theme";
import { getUserMessage, isRetryableError } from "@stigmer/sdk";
import type { EnvVarInput } from "@stigmer/sdk";
import { OAuthConnectionHealth } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/io_pb";
import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import type { DiscoveredTool } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/status_pb";
import type { ToolApprovalPolicy } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/spec_pb";
import {
  EnvVarForm,
  type EnvVarFormVariable,
  type EnvVarFormSubmitOptions,
} from "../environment/EnvVarForm";
import { McpToolSelector } from "./McpToolSelector";
import type { OAuthConnectPhase } from "./useMcpServerOAuthConnect";

// ---------------------------------------------------------------------------
// Credential sub-props
// ---------------------------------------------------------------------------

/**
 * Props for the inline credentials form shown when a server requires
 * environment variables that are missing from the user's personal
 * environment.
 *
 * This is modeled as a sub-object of {@link McpServerConfigPanelProps}
 * so the presence of `credentials` controls whether the form is
 * rendered — no status string inspection required.
 */
export interface McpServerCredentialsProps {
  /** Missing env vars to collect (one form field per variable). */
  readonly variables: EnvVarFormVariable[];
  /** Called when the user submits credentials via the form. */
  readonly onSubmit: (
    values: Record<string, EnvVarInput>,
    options: EnvVarFormSubmitOptions,
  ) => void;
  /** When true, form inputs are disabled and the submit button shows a spinner. */
  readonly isSubmitting?: boolean;
  /**
   * Initial state of the "Save for future runs" toggle.
   * @default true
   */
  readonly defaultSaveForFuture?: boolean;
  /**
   * When `true`, the save toggle is hidden and the form always uses
   * `defaultSaveForFuture` as the submit value.
   * @default false
   */
  readonly hideSaveToggle?: boolean;
  /**
   * Lookup function for pre-filling fields from the session env pool.
   * When provided, fields whose keys return a value are pre-populated.
   */
  readonly poolValues?: (key: string) => EnvVarInput | undefined;
}

// ---------------------------------------------------------------------------
// OAuth sign-in sub-props
// ---------------------------------------------------------------------------

/**
 * Props for the inline OAuth sign-in action shown when a server requires
 * OAuth authentication. Presence controls rendering — when `oauthSignIn`
 * is provided on {@link McpServerConfigPanelProps}, the OAuth button
 * is rendered above the credentials form.
 */
export interface McpServerOAuthSignInProps {
  /** Initiates the OAuth popup flow. Must be called from a click handler. */
  readonly onSignIn: () => void;
  /** Current phase of the OAuth flow. */
  readonly phase: OAuthConnectPhase;
  /** `true` when the OAuth token already exists in the personal environment. */
  readonly isConnected: boolean;
  /**
   * Health of the OAuth connection. Drives the status dot color and
   * label beyond the binary `isConnected` boolean.
   */
  readonly connectionHealth?: OAuthConnectionHealth;
  /**
   * Called to disconnect the OAuth grant. When provided and the user
   * is connected, a "Disconnect" link is shown. The parent is responsible
   * for refreshing credentials after the promise resolves.
   */
  readonly onDisconnect?: () => Promise<void>;
  /** `true` while a disconnect operation is in flight. */
  readonly isDisconnecting?: boolean;
  /** Error from the most recent failed disconnect, or `null`. */
  readonly disconnectError?: Error | null;
  /** Clear the disconnect error state. */
  readonly onClearDisconnectError?: () => void;
  /** Error from the most recent failed OAuth attempt, or `null`. */
  readonly error: Error | null;
  /** Clear the OAuth error state. */
  readonly onClearError: () => void;
  /**
   * `true` when the platform's OAuth app is pending vendor approval.
   * Disables the sign-in button and shows an informational message.
   */
  readonly isVendorApprovalPending?: boolean;
  /**
   * `true` when the platform OAuth app's vendor approval is PENDING
   * or REJECTED — the platform sign-in flow is blocked. Covers both
   * statuses. When omitted, falls back to `isVendorApprovalPending`.
   */
  readonly isVendorApprovalBlocked?: boolean;
  /**
   * Documentation URL for bringing your own OAuth token.
   * Shown as a help link when `isVendorApprovalPending` is `true`.
   */
  readonly vendorApprovalDocsUrl?: string | null;
  /**
   * `true` when the BYOA (Bring Your Own App) option is relevant:
   * the server uses vendor OAuth and no org override exists.
   */
  readonly canBringOwnApp?: boolean;
  /**
   * `true` when an org-level BYOA override is active.
   */
  readonly isOrgOAuthApp?: boolean;
  /**
   * Open the BYOA form. The parent is responsible for rendering the
   * form/dialog and handling the mutation.
   */
  readonly onBringOwnApp?: () => void;
  /**
   * Remove the org's BYOA override. The parent is responsible for
   * refreshing state after the promise resolves.
   */
  readonly onRemoveOrgApp?: () => Promise<void>;
  /** `true` while a remove-org-app operation is in flight. */
  readonly isRemovingOrgApp?: boolean;
}

// ---------------------------------------------------------------------------
// Component props
// ---------------------------------------------------------------------------

/** Props for {@link McpServerConfigPanel}. */
export interface McpServerConfigPanelProps {
  /** The MCP server resource — used for header display (name, icon, description). */
  readonly mcpServer: McpServer;
  /**
   * When provided, the credentials form is shown above the tool selector.
   * Omit when no credentials are needed or they have already been provided.
   *
   * While credentials are pending, the tool selector is rendered in a
   * disabled state so the user completes step 1 (credentials) before
   * step 2 (tool customization).
   */
  readonly credentials?: McpServerCredentialsProps;
  /**
   * When provided, an inline OAuth sign-in button is rendered above the
   * credentials form. The button initiates the popup-based OAuth flow.
   *
   * Use alongside `credentials` for mixed-mode servers that require
   * both OAuth and manual env vars, or on its own for OAuth-only servers.
   */
  readonly oauthSignIn?: McpServerOAuthSignInProps;
  /** Discovered tools from `status.discovered_capabilities.tools`. */
  readonly discoveredTools: DiscoveredTool[];
  /** Approval policies from `status.tool_approvals` and `spec.pinned_tool_approvals`. */
  readonly toolApprovals: ToolApprovalPolicy[];
  /** Currently enabled tool names (controlled). */
  readonly enabledTools: string[];
  /** Called when tool selection changes. */
  readonly onEnabledToolsChange: (enabledTools: string[]) => void;
  /** Called when the user clicks "Back" to return to the picker list. */
  readonly onBack: () => void;
  /**
   * When provided, a "Enter token manually" link is shown below the
   * OAuth sign-in section. Clicking it switches the panel to manual
   * token entry mode — the caller is responsible for updating the
   * `credentials` and `oauthSignIn` props accordingly.
   */
  readonly onSwitchToManual?: () => void;
  /**
   * When provided, a "Sign in with OAuth instead" link is shown near
   * the credentials form. Clicking it reverts to the OAuth flow.
   */
  readonly onSwitchToOAuth?: () => void;
  /** Error to display inline (e.g., from credential submission failure). */
  readonly error?: Error | null;
  /** Disables all interaction. */
  readonly disabled?: boolean;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * Per-server configuration panel composing a credentials form
 * ({@link EnvVarForm}) and a tool selector ({@link McpToolSelector}).
 *
 * Designed to render inside the same popover container as
 * {@link McpServerPicker}: the picker list transitions to this panel
 * when the user drills into a specific server's configuration.
 *
 * The panel's content is driven by the `credentials` prop:
 * - **Present** (server needs setup) — the credentials form is shown
 *   above the tool selector. The tool selector renders disabled as a
 *   preview of what tools the server provides.
 * - **Absent** (server is ready) — only the tool selector is shown,
 *   fully interactive for customizing which tools to enable.
 *
 * This is a **pure presentational component** with no knowledge of
 * the setup hook, personal environments, or session creation. All
 * state is controlled via props — platform builders can use it with
 * any state management approach.
 *
 * All visual properties flow through `--stgm-*` design tokens.
 *
 * @example
 * ```tsx
 * // Server that needs credentials:
 * <McpServerConfigPanel
 *   mcpServer={server}
 *   credentials={{
 *     variables: missingVars,
 *     onSubmit: (values, opts) => submitEnvVars(ref, values, opts),
 *   }}
 *   discoveredTools={tools}
 *   toolApprovals={approvals}
 *   enabledTools={defaultEnabledTools}
 *   onEnabledToolsChange={(t) => setEnabledTools(ref, t)}
 *   onBack={() => setView("list")}
 * />
 *
 * // Server that is ready (tool customization only):
 * <McpServerConfigPanel
 *   mcpServer={server}
 *   discoveredTools={tools}
 *   toolApprovals={approvals}
 *   enabledTools={entry.enabledTools}
 *   onEnabledToolsChange={(t) => setEnabledTools(ref, t)}
 *   onBack={() => setView("list")}
 * />
 * ```
 */
export function McpServerConfigPanel({
  mcpServer,
  credentials,
  oauthSignIn,
  discoveredTools,
  toolApprovals,
  enabledTools,
  onEnabledToolsChange,
  onBack,
  onSwitchToManual,
  onSwitchToOAuth,
  error,
  disabled,
  className,
}: McpServerConfigPanelProps) {
  const serverName = mcpServer.metadata?.name ?? mcpServer.metadata?.slug ?? "MCP Server";
  const iconUrl = mcpServer.spec?.iconUrl;
  const description = mcpServer.spec?.description;
  const isDisabled = disabled || credentials?.isSubmitting;

  const isOAuthBusy = oauthSignIn
    ? oauthSignIn.phase === "initiating" ||
      oauthSignIn.phase === "awaiting-callback" ||
      oauthSignIn.phase === "completing" ||
      oauthSignIn.phase === "connecting"
    : false;

  const handleCredentialSubmit = useCallback(
    (values: Record<string, EnvVarInput>, options: EnvVarFormSubmitOptions) => {
      credentials?.onSubmit(values, options);
    },
    [credentials],
  );

  return (
    <div
      className={cn("space-y-3", className)}
      role="region"
      aria-label={`Configure ${serverName}`}
    >
      {/* Header */}
      <div className="flex items-start gap-2">
        <button
          type="button"
          onClick={onBack}
          disabled={credentials?.isSubmitting || isOAuthBusy}
          className={cn(
            "mt-0.5 shrink-0 rounded p-0.5",
            "text-muted-foreground hover:text-foreground hover:bg-accent/50",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            "disabled:pointer-events-none disabled:opacity-50",
          )}
          aria-label="Back to MCP server list"
        >
          <BackArrowIcon />
        </button>

        <div className="flex min-w-0 flex-1 items-start gap-2">
          {iconUrl && (
            <img
              src={iconUrl}
              alt=""
              width={16}
              height={16}
              className="mt-0.5 size-4 shrink-0 rounded-sm object-contain"
            />
          )}
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-xs font-medium text-foreground">
              {serverName}
            </h3>
            {description && (
              <p className="line-clamp-2 text-[0.65rem] leading-relaxed text-muted-foreground">
                {description}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* OAuth sign-in — shown when the server requires OAuth authentication */}
      {oauthSignIn && (
        <InlineOAuthSignIn
          serverName={serverName}
          isConnected={oauthSignIn.isConnected}
          connectionHealth={oauthSignIn.connectionHealth}
          phase={oauthSignIn.phase}
          onSignIn={oauthSignIn.onSignIn}
          onDisconnect={oauthSignIn.onDisconnect}
          isDisconnecting={oauthSignIn.isDisconnecting}
          disconnectError={oauthSignIn.disconnectError}
          onClearDisconnectError={oauthSignIn.onClearDisconnectError}
          error={oauthSignIn.error}
          onClearError={oauthSignIn.onClearError}
          isVendorApprovalPending={oauthSignIn.isVendorApprovalPending}
          isVendorApprovalBlocked={oauthSignIn.isVendorApprovalBlocked}
          vendorApprovalDocsUrl={oauthSignIn.vendorApprovalDocsUrl}
          canBringOwnApp={oauthSignIn.canBringOwnApp}
          isOrgOAuthApp={oauthSignIn.isOrgOAuthApp}
          onBringOwnApp={oauthSignIn.onBringOwnApp}
          onRemoveOrgApp={oauthSignIn.onRemoveOrgApp}
          isRemovingOrgApp={oauthSignIn.isRemovingOrgApp}
          onSwitchToManual={onSwitchToManual}
        />
      )}

      {/* Switch back to OAuth — shown in manual override mode */}
      {!oauthSignIn && onSwitchToOAuth && (
        <button
          type="button"
          onClick={onSwitchToOAuth}
          className="text-[0.65rem] text-muted-foreground underline decoration-muted-foreground/40 underline-offset-2 hover:text-foreground hover:decoration-foreground"
        >
          Sign in with OAuth instead
        </button>
      )}

      {/* Credentials form — only when credentials prop is provided */}
      {credentials && (
        <EnvVarForm
          variables={credentials.variables}
          onSubmit={handleCredentialSubmit}
          isSubmitting={credentials.isSubmitting}
          disabled={disabled || isOAuthBusy}
          title="Credentials required"
          defaultSaveForFuture={credentials.defaultSaveForFuture}
          hideSaveToggle={credentials.hideSaveToggle}
          poolValues={credentials.poolValues}
          className="w-full"
        />
      )}

      {/* Error display */}
      {error && (
        <div
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 px-2.5 py-2 text-xs text-destructive"
        >
          {getUserMessage(error)}
        </div>
      )}

      {/* Tool selector — always shown, disabled while credentials are pending */}
      <McpToolSelector
        tools={discoveredTools}
        toolApprovals={toolApprovals}
        enabledTools={enabledTools}
        onChange={onEnabledToolsChange}
        disabled={!!isDisabled || !!credentials || isOAuthBusy}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline OAuth sign-in (compact, for config panel context)
// ---------------------------------------------------------------------------

/** Maps OAuthConnectionHealth to compact status dot + label for InlineOAuthSignIn. */
function inlineHealthProps(
  health: OAuthConnectionHealth | undefined,
  isConnected: boolean,
  isVendorApprovalPending: boolean,
): { textClass: string; dotClass: string; label: string } {
  if (isVendorApprovalPending && !isConnected) {
    return {
      textClass: "text-amber-600 dark:text-amber-400",
      dotClass: "bg-amber-500",
      label: "Pending approval",
    };
  }
  switch (health) {
    case OAuthConnectionHealth.OAUTH_CONNECTION_HEALTH_HEALTHY:
      return {
        textClass: "text-success",
        dotClass: "bg-success",
        label: "Signed in",
      };
    case OAuthConnectionHealth.OAUTH_CONNECTION_HEALTH_TOKEN_EXPIRED_REFRESHABLE:
      return {
        textClass: "text-amber-600 dark:text-amber-400",
        dotClass: "bg-amber-500",
        label: "Token expired",
      };
    case OAuthConnectionHealth.OAUTH_CONNECTION_HEALTH_TOKEN_EXPIRED:
      return {
        textClass: "text-destructive",
        dotClass: "bg-destructive",
        label: "Re-auth needed",
      };
    default:
      return {
        textClass: "text-muted-foreground",
        dotClass: "bg-muted-foreground",
        label: "Sign-in required",
      };
  }
}

type InlineDisconnectPhase = "idle" | "confirming" | "disconnecting";
type InlineRemoveOrgAppPhase = "idle" | "confirming" | "removing";

function InlineOAuthSignIn({
  serverName,
  isConnected,
  connectionHealth,
  phase,
  onSignIn,
  onDisconnect,
  isDisconnecting,
  disconnectError,
  onClearDisconnectError,
  error,
  onClearError,
  isVendorApprovalPending,
  isVendorApprovalBlocked,
  vendorApprovalDocsUrl,
  canBringOwnApp,
  isOrgOAuthApp,
  onBringOwnApp,
  onRemoveOrgApp,
  isRemovingOrgApp,
  onSwitchToManual,
}: {
  readonly serverName: string;
  readonly isConnected: boolean;
  readonly connectionHealth?: OAuthConnectionHealth;
  readonly phase: OAuthConnectPhase;
  readonly onSignIn: () => void;
  readonly onDisconnect?: () => Promise<void>;
  readonly isDisconnecting?: boolean;
  readonly disconnectError?: Error | null;
  readonly onClearDisconnectError?: () => void;
  readonly error: Error | null;
  readonly onClearError: () => void;
  readonly isVendorApprovalPending?: boolean;
  readonly isVendorApprovalBlocked?: boolean;
  readonly vendorApprovalDocsUrl?: string | null;
  readonly canBringOwnApp?: boolean;
  readonly isOrgOAuthApp?: boolean;
  readonly onBringOwnApp?: () => void;
  readonly onRemoveOrgApp?: () => Promise<void>;
  readonly isRemovingOrgApp?: boolean;
  readonly onSwitchToManual?: () => void;
}) {
  const [disconnectPhase, setDisconnectPhase] = useState<InlineDisconnectPhase>("idle");
  const [removeOrgAppPhase, setRemoveOrgAppPhase] = useState<InlineRemoveOrgAppPhase>("idle");

  const blocked = isVendorApprovalBlocked ?? isVendorApprovalPending;

  const isBusy =
    phase === "initiating" ||
    phase === "awaiting-callback" ||
    phase === "completing" ||
    phase === "connecting";

  const signInDisabled = isBusy || (!!blocked && !isOrgOAuthApp);
  const anyBusy = isBusy || !!isDisconnecting || !!isRemovingOrgApp;

  const needsReAuth =
    connectionHealth === OAuthConnectionHealth.OAUTH_CONNECTION_HEALTH_TOKEN_EXPIRED;

  const status = inlineHealthProps(
    connectionHealth,
    isConnected,
    !!isVendorApprovalPending && !isOrgOAuthApp,
  );

  const showDisconnectLink =
    isConnected && onDisconnect && !anyBusy && disconnectPhase === "idle";

  const showRemoveOrgAppLink =
    isOrgOAuthApp && onRemoveOrgApp && !anyBusy && removeOrgAppPhase === "idle";

  // Inline disconnect confirmation
  if (disconnectPhase === "confirming" || disconnectPhase === "disconnecting") {
    return (
      <div className="space-y-1.5">
        <p className="text-[0.65rem] text-foreground">
          Remove credentials? You can reconnect at any time.
        </p>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            disabled={!!isDisconnecting}
            onClick={async () => {
              if (!onDisconnect) return;
              setDisconnectPhase("disconnecting");
              try {
                await onDisconnect();
                setDisconnectPhase("idle");
              } catch {
                setDisconnectPhase("confirming");
              }
            }}
            className={cn(
              "inline-flex items-center gap-1 rounded px-2 py-0.5 text-[0.65rem] font-medium",
              "bg-destructive text-destructive-foreground hover:bg-destructive/90",
              "disabled:pointer-events-none disabled:opacity-50",
            )}
          >
            {isDisconnecting && <InlineSpinner />}
            Disconnect
          </button>
          <button
            type="button"
            disabled={!!isDisconnecting}
            onClick={() => {
              setDisconnectPhase("idle");
              onClearDisconnectError?.();
            }}
            className={cn(
              "inline-flex items-center rounded px-2 py-0.5 text-[0.65rem] font-medium",
              "text-muted-foreground hover:text-foreground hover:bg-accent/50",
              "disabled:pointer-events-none disabled:opacity-50",
            )}
          >
            Cancel
          </button>
        </div>
        {disconnectError && (
          <div className="flex items-start gap-1.5 text-[0.65rem] text-destructive" role="alert">
            <span className="flex-1">{getUserMessage(disconnectError)}</span>
            <button
              type="button"
              onClick={() => onClearDisconnectError?.()}
              className="shrink-0 underline underline-offset-2 hover:no-underline"
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
      <div className="space-y-1.5">
        <p className="text-[0.65rem] text-foreground">
          Remove your custom OAuth app? The server will revert to the
          platform&apos;s app.
        </p>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            disabled={!!isRemovingOrgApp}
            onClick={async () => {
              if (!onRemoveOrgApp) return;
              setRemoveOrgAppPhase("removing");
              try {
                await onRemoveOrgApp();
                setRemoveOrgAppPhase("idle");
              } catch {
                setRemoveOrgAppPhase("confirming");
              }
            }}
            className={cn(
              "inline-flex items-center gap-1 rounded px-2 py-0.5 text-[0.65rem] font-medium",
              "bg-destructive text-destructive-foreground hover:bg-destructive/90",
              "disabled:pointer-events-none disabled:opacity-50",
            )}
          >
            {isRemovingOrgApp && <InlineSpinner />}
            Remove
          </button>
          <button
            type="button"
            disabled={!!isRemovingOrgApp}
            onClick={() => setRemoveOrgAppPhase("idle")}
            className={cn(
              "inline-flex items-center rounded px-2 py-0.5 text-[0.65rem] font-medium",
              "text-muted-foreground hover:text-foreground hover:bg-accent/50",
              "disabled:pointer-events-none disabled:opacity-50",
            )}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span
            className={cn(
              "inline-flex items-center gap-1 text-[0.65rem] font-medium",
              status.textClass,
            )}
          >
            <span
              className={cn("size-1.5 rounded-full", status.dotClass)}
              aria-hidden="true"
            />
            {status.label}
          </span>
          {isOrgOAuthApp && isConnected && (
            <span className="text-[0.6rem] text-muted-foreground">
              Your app
            </span>
          )}
          {showDisconnectLink && (
            <button
              type="button"
              onClick={() => setDisconnectPhase("confirming")}
              className="text-[0.65rem] text-muted-foreground underline decoration-muted-foreground/40 underline-offset-2 hover:text-foreground hover:decoration-foreground"
            >
              Disconnect
            </button>
          )}
          {showRemoveOrgAppLink && (
            <button
              type="button"
              onClick={() => setRemoveOrgAppPhase("confirming")}
              className="text-[0.65rem] text-muted-foreground underline decoration-muted-foreground/40 underline-offset-2 hover:text-foreground hover:decoration-foreground"
            >
              Remove custom app
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={onSignIn}
          disabled={signInDisabled}
          className={cn(
            "inline-flex items-center gap-1 rounded px-2 py-0.5 text-[0.65rem] font-medium",
            isConnected && !needsReAuth
              ? "text-muted-foreground hover:text-foreground hover:bg-accent/50"
              : "bg-primary text-primary-foreground hover:bg-primary-hover",
            "disabled:pointer-events-none disabled:opacity-50",
          )}
        >
          {isBusy ? (
            <InlineSpinner />
          ) : isOrgOAuthApp && !isConnected ? (
            "Sign in with your app"
          ) : isConnected && !needsReAuth ? (
            "Re-authenticate"
          ) : needsReAuth ? (
            "Sign in to reconnect"
          ) : (
            `Sign in with ${serverName}`
          )}
        </button>
      </div>

      {/* Vendor approval blocked message with BYOA CTA */}
      {blocked && !isConnected && !isOrgOAuthApp && (
        <div className="text-[0.65rem] text-amber-700 dark:text-amber-300">
          <p>
            OAuth sign-in is pending vendor approval.
            {canBringOwnApp && onBringOwnApp
              ? " You can use your own OAuth app or enter a token manually."
              : ""}
          </p>
          {canBringOwnApp && onBringOwnApp && (
            <button
              type="button"
              onClick={onBringOwnApp}
              className="mt-1 inline-flex items-center gap-1 rounded bg-amber-600 px-2 py-0.5 text-[0.6rem] font-medium text-white hover:bg-amber-700 dark:bg-amber-500 dark:text-amber-950 dark:hover:bg-amber-400"
            >
              Use your own OAuth app
            </button>
          )}
          {vendorApprovalDocsUrl && !canBringOwnApp && (
            <a
              href={vendorApprovalDocsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-amber-600/40 underline-offset-2 hover:decoration-amber-600 dark:decoration-amber-400/40 dark:hover:decoration-amber-400"
            >
              Learn how to bring your own token
            </a>
          )}
        </div>
      )}

      {/* Org override indicator when not connected */}
      {isOrgOAuthApp && !isConnected && (
        <span className="text-[0.6rem] text-muted-foreground">
          Using your OAuth app
        </span>
      )}

      {error && (
        <div className="flex items-start gap-1.5 text-[0.65rem] text-destructive" role="alert">
          <span className="flex-1">{getUserMessage(error)}</span>
          <div className="flex shrink-0 items-center gap-1.5">
            {isRetryableError(error) && (
              <button
                type="button"
                onClick={() => {
                  onClearError();
                  onSignIn();
                }}
                className="font-medium underline underline-offset-2 hover:no-underline"
              >
                Try again
              </button>
            )}
            <button
              type="button"
              onClick={onClearError}
              className="underline underline-offset-2 hover:no-underline"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Secondary actions: manual entry, BYOA */}
      {!isConnected && !isBusy && (
        <div className="flex items-center gap-2">
          {onSwitchToManual && (
            <button
              type="button"
              onClick={onSwitchToManual}
              className="text-[0.65rem] text-muted-foreground underline decoration-muted-foreground/40 underline-offset-2 hover:text-foreground hover:decoration-foreground"
            >
              Enter token manually
            </button>
          )}
          {canBringOwnApp && onBringOwnApp && !blocked && (
            <button
              type="button"
              onClick={onBringOwnApp}
              className="text-[0.65rem] text-muted-foreground underline decoration-muted-foreground/40 underline-offset-2 hover:text-foreground hover:decoration-foreground"
            >
              Use your own OAuth app
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function InlineSpinner() {
  return (
    <svg
      width="10"
      height="10"
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

// ---------------------------------------------------------------------------
// Icons (internal to this module)
// ---------------------------------------------------------------------------

function BackArrowIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M10 3L5 8l5 5" />
    </svg>
  );
}
