"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@stigmer/theme";
import type { EnvVarInput } from "@stigmer/sdk";
import { useMcpServer } from "./useMcpServer.js";
import { useMcpServerCredentials } from "./useMcpServerCredentials.js";
import { useMcpServerOAuthConnect } from "./useMcpServerOAuthConnect.js";
import type { OAuthConnectPhase } from "./useMcpServerOAuthConnect.js";
import { useMcpServerConnect } from "./useMcpServerConnect.js";
import { useDisconnectOAuth } from "./useDisconnectOAuth.js";
import { EnvVarForm } from "../environment/EnvVarForm.js";
import { ErrorMessage } from "../error/ErrorMessage.js";
import { StdioSandboxNotice } from "./StdioSandboxNotice.js";
import { OAuthRequiredNotice } from "./OAuthRequiredNotice.js";
import { VendorApprovalBlockedNotice } from "./VendorApprovalBlockedNotice.js";

/** Props for {@link McpServerConnectDialog}. */
export interface McpServerConnectDialogProps {
  /** Organization slug that owns the MCP server. */
  readonly org: string;
  /** MCP server slug. */
  readonly slug: string;
  /**
   * The authenticated user's active organization slug.
   * Used for credential storage — tokens are stored in the user's
   * personal environment within this org.
   * Falls back to `org` when omitted.
   */
  readonly activeOrg?: string;
  /** Whether the dialog is open. */
  readonly open: boolean;
  /** Called when the dialog should close (backdrop click, cancel, or success). */
  readonly onClose: () => void;
  /** Called after a successful connect with the server name. */
  readonly onConnected?: (serverName: string) => void;
  /**
   * Called when the user needs the server's detail page — today the
   * "Use your own OAuth app" escape hatch shown when the platform OAuth
   * app is vendor-approval blocked on an `oauth_only` server, since the
   * BYOA form lives on the detail page, not in this dialog.
   *
   * The host owns navigation (and should close the dialog itself if its
   * route keeps this component mounted). When omitted, the blocked notice
   * still explains the state; only the navigation affordance is dropped.
   */
  readonly onOpenDetails?: () => void;
  /** Additional CSS classes for the dialog element. */
  readonly className?: string;
}

type DialogPhase = "credentials" | "connecting" | "success" | "error";

/**
 * Modal dialog for connecting to an MCP server.
 *
 * Fetches the server, determines whether credentials or OAuth are
 * needed, and walks the user through the connect flow — all without
 * navigating away from the current page.
 *
 * Uses the native `<dialog>` element for accessibility (focus trap,
 * Escape to close, backdrop click).
 *
 * Built on existing hooks: {@link useMcpServer},
 * {@link useMcpServerCredentials}, {@link useMcpServerOAuthConnect},
 * and {@link useMcpServerConnect}.
 *
 * @example
 * ```tsx
 * const [connectTarget, setConnectTarget] = useState<{ org: string; slug: string } | null>(null);
 *
 * <McpServerConnectDialog
 *   org={connectTarget?.org ?? ""}
 *   slug={connectTarget?.slug ?? ""}
 *   open={connectTarget !== null}
 *   onClose={() => setConnectTarget(null)}
 *   onConnected={(name) => toast(`Connected to ${name}`)}
 * />
 * ```
 */
export function McpServerConnectDialog({
  org,
  slug,
  activeOrg,
  open,
  onClose,
  onConnected,
  onOpenDetails,
  className,
}: McpServerConnectDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const resolvedOrg = activeOrg || org;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  const handleDialogClose = useCallback(() => {
    onClose();
  }, [onClose]);

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent<HTMLDialogElement>) => {
      if (e.target === dialogRef.current) {
        onClose();
      }
    },
    [onClose],
  );

  if (!open) return null;

  return (
    <dialog
      ref={dialogRef}
      onClose={handleDialogClose}
      onClick={handleBackdropClick}
      className={cn(
        "stg:m-auto stg:max-h-[85vh] stg:w-full stg:max-w-md stg:overflow-visible stg:rounded-lg stg:border stg:border-border stg:bg-card stg:p-0 stg:text-foreground stg:shadow-lg",
        "stg:backdrop:bg-backdrop",
        className,
      )}
    >
      <div
        className="stg:flex stg:max-h-[85vh] stg:flex-col stg:overflow-y-auto stg:p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <ConnectDialogContent
          org={org}
          slug={slug}
          activeOrg={resolvedOrg}
          onClose={onClose}
          onConnected={onConnected}
          onOpenDetails={onOpenDetails}
        />
      </div>
    </dialog>
  );
}

function ConnectDialogContent({
  org,
  slug,
  activeOrg,
  onClose,
  onConnected,
  onOpenDetails,
}: {
  readonly org: string;
  readonly slug: string;
  readonly activeOrg: string;
  readonly onClose: () => void;
  readonly onConnected?: (serverName: string) => void;
  readonly onOpenDetails?: () => void;
}) {
  const { mcpServer, isLoading: isServerLoading, error: serverError } = useMcpServer(org, slug);
  const creds = useMcpServerCredentials(activeOrg, mcpServer);
  const { connect, isConnecting, error: connectError, clearError: clearConnectError } = useMcpServerConnect();
  const oauth = useMcpServerOAuthConnect();
  const disconnect = useDisconnectOAuth();

  const [phase, setPhase] = useState<DialogPhase>("credentials");

  const serverName = mcpServer?.metadata?.name ?? slug;
  const serverId = mcpServer?.metadata?.id ?? "";
  const declaredEnvKeys = Object.keys(mcpServer?.spec?.env ?? {});

  const handleConnect = useCallback(async () => {
    if (!serverId) return;

    setPhase("connecting");
    try {
      await connect(serverId, activeOrg, undefined, declaredEnvKeys);
      setPhase("success");
      onConnected?.(serverName);
    } catch {
      setPhase("error");
    }
  }, [serverId, activeOrg, declaredEnvKeys, connect, onConnected, serverName]);

  const handleCredentialSubmit = useCallback(
    async (values: Record<string, EnvVarInput>) => {
      await creds.saveCredentials(values);
      creds.refetch();
    },
    [creds],
  );

  const handleOAuthSignIn = useCallback(() => {
    if (!serverId) return;
    // A previous failure in the "connecting" phase means sign-in already
    // succeeded and only discovery failed — retry bare discovery instead
    // of relaunching the OAuth popup (stigmer/stigmer#229).
    if (oauth.failedPhase === "connecting") {
      void handleConnect();
      return;
    }
    oauth.startOAuth(serverId, activeOrg, declaredEnvKeys).then(
      () => {
        creds.refetch();
        setPhase("success");
        onConnected?.(serverName);
      },
      () => {
        // completeOAuthConnect persists the grant BEFORE the chained
        // discovery runs, so even a failed attempt may have changed
        // server state — refetch so the dialog offers "Discover Tools"
        // instead of another popup round.
        creds.refetch();
        setPhase("error");
      },
    );
  }, [serverId, activeOrg, declaredEnvKeys, oauth, creds, onConnected, serverName, handleConnect]);

  // Auto-trigger connect when credentials become ready (manual-only servers)
  useEffect(() => {
    if (
      phase === "credentials" &&
      creds.isReady &&
      !creds.isLoading &&
      mcpServer &&
      creds.authMode === "manual"
    ) {
      // Don't auto-connect; let user click the button
    }
  }, [phase, creds.isReady, creds.isLoading, mcpServer, creds.authMode]);

  if (isServerLoading || creds.isLoading) {
    return (
      <>
        <DialogHeader title="Connect MCP Server" onClose={onClose} />
        <div className="stg:flex stg:flex-col stg:items-center stg:gap-3 stg:py-8">
          <LoadingSpinner />
          <p className="stg:text-sm stg:text-muted-foreground">Loading server details...</p>
        </div>
      </>
    );
  }

  if (serverError) {
    return (
      <>
        <DialogHeader title="Connect MCP Server" onClose={onClose} />
        <div className="stg:py-4">
          <ErrorMessage error={serverError} />
        </div>
      </>
    );
  }

  if (!mcpServer) {
    return (
      <>
        <DialogHeader title="Connect MCP Server" onClose={onClose} />
        <p className="stg:py-4 stg:text-sm stg:text-muted-foreground">MCP server not found.</p>
      </>
    );
  }

  if (phase === "success") {
    return (
      <>
        <DialogHeader title="Connected" onClose={onClose} />
        <div className="stg:flex stg:flex-col stg:items-center stg:gap-3 stg:py-6">
          <SuccessIcon />
          <p className="stg:text-sm stg:font-medium stg:text-foreground">
            Successfully connected to {serverName}
          </p>
          <p className="stg:text-xs stg:text-muted-foreground">
            Tools and capabilities have been discovered.
          </p>
          <button
            type="button"
            onClick={onClose}
            className={cn(
              "stg:mt-2 stg:inline-flex stg:items-center stg:rounded-md stg:px-4 stg:py-2 stg:text-sm stg:font-medium",
              "stg:bg-primary stg:text-primary-foreground",
              "stg:hover:bg-primary-hover",
              "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
            )}
          >
            Done
          </button>
        </div>
      </>
    );
  }

  const isConnectingPhase = phase === "connecting" || isConnecting || oauth.isInProgress;
  const activeError = connectError ?? oauth.error;

  return (
    <>
      <DialogHeader title={serverName} onClose={onClose} />

      {mcpServer.spec?.description && (
        <p className="stg:mb-4 stg:text-xs stg:leading-relaxed stg:text-muted-foreground">
          {mcpServer.spec.description}
        </p>
      )}

      <StdioSandboxNotice serverType={mcpServer.spec?.serverType} className="stg:mb-4" />
      <OAuthRequiredNotice oauthOnly={mcpServer.spec?.auth?.oauthOnly} className="stg:mb-4" />

      {activeError && (
        <div className="stg:mb-4">
          <ErrorMessage
            error={activeError}
            title={
              // Honest header for the two-act failure: the grant is stored,
              // only the discovery leg broke. Without it the raw RPC error
              // reads as a failed sign-in.
              oauth.error && oauth.failedPhase === "connecting"
                ? "Signed in, but tool discovery failed"
                : undefined
            }
            retry={() => {
              // Capture before clearError() resets it: a discovery-leg
              // failure retries discovery directly — sign-in is done.
              const wasDiscoveryFailure = oauth.failedPhase === "connecting";
              clearConnectError();
              oauth.clearError();
              if (wasDiscoveryFailure) {
                void handleConnect();
              } else {
                setPhase("credentials");
              }
            }}
          />
        </div>
      )}

      {creds.authMode === "oauth" && !creds.manualOverride && (
        <OAuthSection
          isConnected={creds.isOAuthConnected}
          phase={oauth.phase}
          onSignIn={handleOAuthSignIn}
          isVendorApprovalBlocked={creds.isVendorApprovalBlocked}
          isVendorApprovalPending={creds.isVendorApprovalPending}
          isOrgOAuthApp={creds.isOrgOAuthApp}
          manualEntrySupported={creds.manualEntrySupported}
          canBringOwnApp={creds.canBringOwnApp}
          vendorApprovalDocsUrl={creds.vendorApprovalDocsUrl}
          onSwitchToManual={
            creds.manualEntrySupported
              ? () => creds.setManualOverride(true)
              : undefined
          }
          onOpenDetails={onOpenDetails}
          disabled={isConnectingPhase}
        />
      )}

      {creds.missingVariables.length > 0 && (
        <div className="stg:mt-2">
          <EnvVarForm
            variables={creds.missingVariables}
            onSubmit={(values) => handleCredentialSubmit(values)}
            isSubmitting={creds.isSaving}
            disabled={isConnectingPhase}
            hideSaveToggle
          />
        </div>
      )}

      {creds.authMode === "oauth" && creds.manualOverride && (
        <button
          type="button"
          onClick={() => creds.setManualOverride(false)}
          disabled={isConnectingPhase}
          className="stg:mt-2 stg:text-xs stg:text-muted-foreground stg:underline stg:hover:text-foreground"
        >
          Sign in with OAuth instead
        </button>
      )}

      {creds.isReady && creds.authMode === "manual" && (
        <button
          type="button"
          onClick={handleConnect}
          disabled={isConnectingPhase}
          className={cn(
            "stg:mt-4 stg:inline-flex stg:w-full stg:items-center stg:justify-center stg:gap-2 stg:rounded-md stg:px-4 stg:py-2 stg:text-sm stg:font-medium",
            "stg:bg-primary stg:text-primary-foreground",
            "stg:hover:bg-primary-hover",
            "stg:disabled:pointer-events-none stg:disabled:opacity-50",
            "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
          )}
        >
          {isConnectingPhase && <LoadingSpinner size="sm" />}
          {isConnectingPhase ? "Connecting..." : "Connect"}
        </button>
      )}

      {creds.isReady && creds.authMode === "oauth" && creds.isOAuthConnected && (
        <button
          type="button"
          onClick={handleConnect}
          disabled={isConnectingPhase}
          className={cn(
            "stg:mt-4 stg:inline-flex stg:w-full stg:items-center stg:justify-center stg:gap-2 stg:rounded-md stg:px-4 stg:py-2 stg:text-sm stg:font-medium",
            "stg:bg-primary stg:text-primary-foreground",
            "stg:hover:bg-primary-hover",
            "stg:disabled:pointer-events-none stg:disabled:opacity-50",
            "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
          )}
        >
          {isConnectingPhase && <LoadingSpinner size="sm" />}
          {isConnectingPhase ? "Discovering tools..." : "Discover Tools"}
        </button>
      )}

      {!creds.isReady &&
        creds.missingVariables.length === 0 &&
        creds.authMode === "manual" && (
          <p className="stg:mt-4 stg:text-center stg:text-xs stg:text-muted-foreground">
            No credentials required — this server is ready to connect.
          </p>
        )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function DialogHeader({
  title,
  onClose,
}: {
  readonly title: string;
  readonly onClose: () => void;
}) {
  return (
    <div className="stg:mb-4 stg:flex stg:items-start stg:justify-between stg:gap-3">
      <h2 className="stg:text-base stg:font-semibold stg:text-foreground">{title}</h2>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="stg:inline-flex stg:size-7 stg:shrink-0 stg:items-center stg:justify-center stg:rounded-md stg:text-muted-foreground stg:transition-colors stg:hover:bg-accent stg:hover:text-accent-foreground stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring"
      >
        <CloseIcon />
      </button>
    </div>
  );
}

function OAuthSection({
  isConnected,
  phase,
  onSignIn,
  isVendorApprovalBlocked,
  isVendorApprovalPending,
  isOrgOAuthApp,
  manualEntrySupported,
  canBringOwnApp,
  vendorApprovalDocsUrl,
  onSwitchToManual,
  onOpenDetails,
  disabled,
}: {
  readonly isConnected: boolean;
  readonly phase: OAuthConnectPhase;
  readonly onSignIn: () => void;
  readonly isVendorApprovalBlocked: boolean;
  readonly isVendorApprovalPending: boolean;
  /**
   * `true` when the org's own BYOA OAuth app is the effective one. The
   * vendor-approval block describes the PLATFORM app, so it neither
   * disables sign-in nor warrants the blocked notice when the org's own
   * app is what sign-in will use (the caller-side org-override gate the
   * notice's contract expects).
   */
  readonly isOrgOAuthApp: boolean;
  readonly manualEntrySupported: boolean;
  readonly canBringOwnApp: boolean;
  readonly vendorApprovalDocsUrl: string | null;
  /** When omitted (e.g. `oauth_only` servers), no manual-entry link is shown. */
  readonly onSwitchToManual?: () => void;
  /** Navigates to the detail page, where the BYOA form lives. */
  readonly onOpenDetails?: () => void;
  readonly disabled?: boolean;
}) {
  if (isConnected) {
    return (
      <div className="stg:flex stg:items-center stg:gap-2 stg:rounded-md stg:border stg:border-border stg:bg-muted-faint stg:px-3 stg:py-2">
        <span className="stg:size-2 stg:shrink-0 stg:rounded-full stg:bg-green-500" />
        <span className="stg:text-sm stg:text-foreground">OAuth connected</span>
      </div>
    );
  }

  const isInProgress = phase !== "idle" && phase !== "done";
  const phaseLabel: Record<string, string> = {
    initiating: "Starting OAuth...",
    "awaiting-callback": "Waiting for authorization...",
    completing: "Completing OAuth...",
    connecting: "Discovering tools...",
  };

  return (
    <div className="stg:flex stg:flex-col stg:gap-2">
      <button
        type="button"
        onClick={onSignIn}
        disabled={
          disabled || isInProgress || (isVendorApprovalBlocked && !isOrgOAuthApp)
        }
        className={cn(
          "stg:inline-flex stg:w-full stg:items-center stg:justify-center stg:gap-2 stg:rounded-md stg:px-4 stg:py-2 stg:text-sm stg:font-medium",
          "stg:bg-primary stg:text-primary-foreground",
          "stg:hover:bg-primary-hover",
          "stg:disabled:pointer-events-none stg:disabled:opacity-50",
          "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
        )}
      >
        {isInProgress && <LoadingSpinner size="sm" />}
        {isInProgress
          ? (phaseLabel[phase] ?? "Connecting...")
          : isOrgOAuthApp
            ? "Sign in with your app"
            : "Sign in with OAuth"}
      </button>
      {!isOrgOAuthApp && (
        <VendorApprovalBlockedNotice
          blocked={isVendorApprovalBlocked}
          pending={isVendorApprovalPending}
          manualEntrySupported={manualEntrySupported}
          canBringOwnApp={canBringOwnApp}
          docsUrl={vendorApprovalDocsUrl}
          onBringOwnApp={onOpenDetails}
          className="stg:rounded-md stg:border stg:border-amber-500/20"
        />
      )}
      {onSwitchToManual && (
        <button
          type="button"
          onClick={onSwitchToManual}
          disabled={disabled || isInProgress}
          className="stg:text-xs stg:text-muted-foreground stg:underline stg:hover:text-foreground"
        >
          Enter token manually
        </button>
      )}
    </div>
  );
}

function LoadingSpinner({ size = "md" }: { readonly size?: "sm" | "md" }) {
  const cls = size === "sm" ? "stg:size-3.5" : "stg:size-5";
  return (
    <svg
      className={cn(cls, "stg:animate-spin stg:text-current")}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        className="stg:opacity-25"
      />
      <path
        d="M12 2a10 10 0 0 1 10 10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        className="stg:opacity-75"
      />
    </svg>
  );
}

function SuccessIcon() {
  return (
    <svg
      className="stg:size-10 stg:text-green-500"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      className="stg:size-4"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m4 4 8 8M12 4l-8 8" />
    </svg>
  );
}
