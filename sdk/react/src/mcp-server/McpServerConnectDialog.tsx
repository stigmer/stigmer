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
        "m-auto max-h-[85vh] w-full max-w-md overflow-visible rounded-lg border border-border bg-card p-0 text-foreground shadow-lg",
        "backdrop:bg-black/50",
        className,
      )}
    >
      <div
        className="flex max-h-[85vh] flex-col overflow-y-auto p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <ConnectDialogContent
          org={org}
          slug={slug}
          activeOrg={resolvedOrg}
          onClose={onClose}
          onConnected={onConnected}
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
}: {
  readonly org: string;
  readonly slug: string;
  readonly activeOrg: string;
  readonly onClose: () => void;
  readonly onConnected?: (serverName: string) => void;
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
    oauth.startOAuth(serverId, activeOrg, declaredEnvKeys).then(
      () => {
        creds.refetch();
        setPhase("success");
        onConnected?.(serverName);
      },
      () => {
        setPhase("error");
      },
    );
  }, [serverId, activeOrg, declaredEnvKeys, oauth, creds, onConnected, serverName]);

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
        <div className="flex flex-col items-center gap-3 py-8">
          <LoadingSpinner />
          <p className="text-sm text-muted-foreground">Loading server details...</p>
        </div>
      </>
    );
  }

  if (serverError) {
    return (
      <>
        <DialogHeader title="Connect MCP Server" onClose={onClose} />
        <div className="py-4">
          <ErrorMessage error={serverError} />
        </div>
      </>
    );
  }

  if (!mcpServer) {
    return (
      <>
        <DialogHeader title="Connect MCP Server" onClose={onClose} />
        <p className="py-4 text-sm text-muted-foreground">MCP server not found.</p>
      </>
    );
  }

  if (phase === "success") {
    return (
      <>
        <DialogHeader title="Connected" onClose={onClose} />
        <div className="flex flex-col items-center gap-3 py-6">
          <SuccessIcon />
          <p className="text-sm font-medium text-foreground">
            Successfully connected to {serverName}
          </p>
          <p className="text-xs text-muted-foreground">
            Tools and capabilities have been discovered.
          </p>
          <button
            type="button"
            onClick={onClose}
            className={cn(
              "mt-2 inline-flex items-center rounded-md px-4 py-2 text-sm font-medium",
              "bg-primary text-primary-foreground",
              "hover:bg-primary-hover",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
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
        <p className="mb-4 text-xs leading-relaxed text-muted-foreground">
          {mcpServer.spec.description}
        </p>
      )}

      <StdioSandboxNotice serverType={mcpServer.spec?.serverType} className="mb-4" />

      {activeError && (
        <div className="mb-4">
          <ErrorMessage
            error={activeError}
            retry={() => {
              clearConnectError();
              oauth.clearError();
              setPhase("credentials");
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
          onSwitchToManual={() => creds.setManualOverride(true)}
          disabled={isConnectingPhase}
        />
      )}

      {creds.missingVariables.length > 0 && (
        <div className="mt-2">
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
          className="mt-2 text-xs text-muted-foreground underline hover:text-foreground"
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
            "mt-4 inline-flex w-full items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium",
            "bg-primary text-primary-foreground",
            "hover:bg-primary-hover",
            "disabled:pointer-events-none disabled:opacity-50",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
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
            "mt-4 inline-flex w-full items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium",
            "bg-primary text-primary-foreground",
            "hover:bg-primary-hover",
            "disabled:pointer-events-none disabled:opacity-50",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}
        >
          {isConnectingPhase && <LoadingSpinner size="sm" />}
          {isConnectingPhase ? "Discovering tools..." : "Discover Tools"}
        </button>
      )}

      {!creds.isReady &&
        creds.missingVariables.length === 0 &&
        creds.authMode === "manual" && (
          <p className="mt-4 text-center text-xs text-muted-foreground">
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
    <div className="mb-4 flex items-start justify-between gap-3">
      <h2 className="text-base font-semibold text-foreground">{title}</h2>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
  onSwitchToManual,
  disabled,
}: {
  readonly isConnected: boolean;
  readonly phase: OAuthConnectPhase;
  readonly onSignIn: () => void;
  readonly isVendorApprovalBlocked: boolean;
  readonly onSwitchToManual: () => void;
  readonly disabled?: boolean;
}) {
  if (isConnected) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-border bg-muted-faint px-3 py-2">
        <span className="size-2 shrink-0 rounded-full bg-green-500" />
        <span className="text-sm text-foreground">OAuth connected</span>
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
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={onSignIn}
        disabled={disabled || isInProgress || isVendorApprovalBlocked}
        className={cn(
          "inline-flex w-full items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium",
          "bg-primary text-primary-foreground",
          "hover:bg-primary-hover",
          "disabled:pointer-events-none disabled:opacity-50",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        )}
      >
        {isInProgress && <LoadingSpinner size="sm" />}
        {isInProgress ? (phaseLabel[phase] ?? "Connecting...") : "Sign in with OAuth"}
      </button>
      {isVendorApprovalBlocked && (
        <p className="text-xs text-muted-foreground">
          OAuth sign-in is pending vendor approval. You can enter your token manually instead.
        </p>
      )}
      <button
        type="button"
        onClick={onSwitchToManual}
        disabled={disabled || isInProgress}
        className="text-xs text-muted-foreground underline hover:text-foreground"
      >
        Enter token manually
      </button>
    </div>
  );
}

function LoadingSpinner({ size = "md" }: { readonly size?: "sm" | "md" }) {
  const cls = size === "sm" ? "size-3.5" : "size-5";
  return (
    <svg
      className={cn(cls, "animate-spin text-current")}
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
        className="opacity-25"
      />
      <path
        d="M12 2a10 10 0 0 1 10 10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        className="opacity-75"
      />
    </svg>
  );
}

function SuccessIcon() {
  return (
    <svg
      className="size-10 text-green-500"
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
      className="size-4"
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
