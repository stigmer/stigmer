"use client";

import { useCallback } from "react";
import { cn } from "@stigmer/theme";
import type { EnvVarInput } from "@stigmer/sdk";
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
  /** Error from the most recent failed OAuth attempt, or `null`. */
  readonly error: Error | null;
  /** Clear the OAuth error state. */
  readonly onClearError: () => void;
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
          phase={oauthSignIn.phase}
          onSignIn={oauthSignIn.onSignIn}
          error={oauthSignIn.error}
          onClearError={oauthSignIn.onClearError}
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
          {error.message}
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

function InlineOAuthSignIn({
  serverName,
  isConnected,
  phase,
  onSignIn,
  error,
  onClearError,
  onSwitchToManual,
}: {
  readonly serverName: string;
  readonly isConnected: boolean;
  readonly phase: OAuthConnectPhase;
  readonly onSignIn: () => void;
  readonly error: Error | null;
  readonly onClearError: () => void;
  readonly onSwitchToManual?: () => void;
}) {
  const isBusy =
    phase === "initiating" ||
    phase === "awaiting-callback" ||
    phase === "completing" ||
    phase === "connecting";

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span
          className={cn(
            "inline-flex items-center gap-1 text-[0.65rem] font-medium",
            isConnected ? "text-success" : "text-muted-foreground",
          )}
        >
          <span
            className={cn(
              "size-1.5 rounded-full",
              isConnected ? "bg-success" : "bg-muted-foreground",
            )}
            aria-hidden="true"
          />
          {isConnected ? "Signed in" : "Sign-in required"}
        </span>
        <button
          type="button"
          onClick={onSignIn}
          disabled={isBusy}
          className={cn(
            "inline-flex items-center gap-1 rounded px-2 py-0.5 text-[0.65rem] font-medium",
            isConnected
              ? "text-muted-foreground hover:text-foreground hover:bg-accent/50"
              : "bg-primary text-primary-foreground hover:bg-primary-hover",
            "disabled:pointer-events-none disabled:opacity-50",
          )}
        >
          {isBusy ? (
            <InlineSpinner />
          ) : isConnected ? (
            "Re-authenticate"
          ) : (
            `Sign in with ${serverName}`
          )}
        </button>
      </div>
      {error && (
        <div className="flex items-start gap-1.5 text-[0.65rem] text-destructive">
          <span className="flex-1">{error.message}</span>
          <button
            type="button"
            onClick={onClearError}
            className="shrink-0 underline underline-offset-2 hover:no-underline"
          >
            Dismiss
          </button>
        </div>
      )}
      {onSwitchToManual && !isConnected && !isBusy && (
        <button
          type="button"
          onClick={onSwitchToManual}
          className="text-[0.65rem] text-muted-foreground underline decoration-muted-foreground/40 underline-offset-2 hover:text-foreground hover:decoration-foreground"
        >
          Enter token manually
        </button>
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
