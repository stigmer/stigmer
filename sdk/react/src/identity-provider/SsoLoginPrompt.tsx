"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { cn } from "@stigmer/theme";
import { getUserMessage } from "@stigmer/sdk";
import type { SsoProviderInfo } from "@stigmer/protos/ai/stigmer/iam/identityprovider/v1/io_pb";
import { useSsoProvider } from "./useSsoProvider.js";

/** Props for {@link SsoLoginPrompt}. */
export interface SsoLoginPromptProps {
  /**
   * Pre-filled organization slug, typically read from a URL query
   * parameter (e.g., `?org=acme`).
   *
   * When provided, the component auto-triggers the SSO provider
   * lookup on mount, skipping the org input step.
   */
  readonly initialOrg?: string;

  /**
   * Called when the user clicks the SSO sign-in button.
   *
   * The consumer is responsible for the actual OIDC redirect — this
   * component owns the discovery UI, not the authentication mechanics.
   */
  readonly onSsoLogin: (provider: SsoProviderInfo, org: string) => void;

  /** Additional CSS classes for the root container. */
  readonly className?: string;
}

type Phase =
  | "input"
  | "loading"
  | "found"
  | "not-found"
  | "error";

/**
 * Org-aware SSO discovery prompt.
 *
 * Guides the user through finding and connecting to their
 * organization's SSO provider:
 *
 * 1. Enter an organization slug (or receive one via `initialOrg`)
 * 2. The component calls {@link useSsoProvider} to look up the SSO
 *    configuration
 * 3. If found, displays a prominent "Sign in with [provider]" button
 * 4. If not found, displays a clear message
 *
 * Platform builders embed this component in their own login pages to
 * offer SSO authentication. The Console composes it with an Auth0
 * fallback and OIDC redirect handling.
 *
 * All visual properties flow through `--stgm-*` design tokens.
 *
 * @example
 * ```tsx
 * <SsoLoginPrompt
 *   initialOrg="acme"
 *   onSsoLogin={(provider, org) => {
 *     // Initiate OIDC redirect with provider.issuer, provider.oidcClientId
 *   }}
 * />
 * ```
 */
export function SsoLoginPrompt({
  initialOrg,
  onSsoLogin,
  className,
}: SsoLoginPromptProps) {
  const [orgInput, setOrgInput] = useState(initialOrg ?? "");
  const [submittedOrg, setSubmittedOrg] = useState<string | null>(
    initialOrg ?? null,
  );
  const { ssoProvider, isLoading, error } = useSsoProvider(submittedOrg);
  const inputRef = useRef<HTMLInputElement>(null);

  const phase = resolvePhase(submittedOrg, isLoading, ssoProvider, error);

  // Focus the org input when returning to the input phase.
  useEffect(() => {
    if (phase === "input") {
      inputRef.current?.focus();
    }
  }, [phase]);

  const handleSubmitOrg = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      const trimmed = orgInput.trim().toLowerCase();
      if (trimmed) setSubmittedOrg(trimmed);
    },
    [orgInput],
  );

  const handleReset = useCallback(() => {
    setSubmittedOrg(null);
    setOrgInput("");
  }, []);

  const handleRetry = useCallback(() => {
    if (submittedOrg) {
      setSubmittedOrg(null);
      // Re-trigger after clearing so the hook resets, then re-set.
      queueMicrotask(() => setSubmittedOrg(submittedOrg));
    }
  }, [submittedOrg]);

  const handleSsoClick = useCallback(() => {
    if (ssoProvider && submittedOrg) {
      onSsoLogin(ssoProvider, submittedOrg);
    }
  }, [ssoProvider, submittedOrg, onSsoLogin]);

  const handleSsoKeyDown = useCallback(
    (e: KeyboardEvent<HTMLButtonElement>) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        handleSsoClick();
      }
    },
    [handleSsoClick],
  );

  return (
    <div
      className={cn("stg:w-full", className)}
      role="region"
      aria-label="SSO sign-in"
    >
      {phase === "input" && (
        <OrgInputForm
          ref={inputRef}
          value={orgInput}
          onChange={setOrgInput}
          onSubmit={handleSubmitOrg}
        />
      )}

      {phase === "loading" && (
        <LoadingState org={submittedOrg!} />
      )}

      {phase === "found" && ssoProvider && (
        <FoundState
          provider={ssoProvider}
          org={submittedOrg!}
          onClick={handleSsoClick}
          onKeyDown={handleSsoKeyDown}
          onChangeOrg={handleReset}
        />
      )}

      {phase === "not-found" && (
        <NotFoundState org={submittedOrg!} onBack={handleReset} />
      )}

      {phase === "error" && error && (
        <ErrorState error={error} onRetry={handleRetry} onBack={handleReset} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Phase resolution
// ---------------------------------------------------------------------------

function resolvePhase(
  submittedOrg: string | null,
  isLoading: boolean,
  ssoProvider: SsoProviderInfo | null,
  error: Error | null,
): Phase {
  if (!submittedOrg) return "input";
  if (isLoading) return "loading";
  if (error) return "error";
  if (ssoProvider) return "found";
  return "not-found";
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

import { forwardRef } from "react";

interface OrgInputFormProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onSubmit: (e: FormEvent) => void;
}

const OrgInputForm = forwardRef<HTMLInputElement, OrgInputFormProps>(
  function OrgInputForm({ value, onChange, onSubmit }, ref) {
    return (
      <form onSubmit={onSubmit} className="stg:space-y-3">
        <label
          htmlFor="sso-org-input"
          className="stg:block stg:text-sm stg:font-medium stg:text-foreground"
        >
          Organization
        </label>
        <input
          ref={ref}
          id="sso-org-input"
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Enter your organization slug"
          autoComplete="organization"
          spellCheck={false}
          className={cn(
            "stg:block stg:w-full stg:rounded-md stg:border stg:border-input stg:bg-background stg:px-3 stg:py-2",
            "stg:text-sm stg:text-foreground stg:placeholder:text-muted-foreground",
            "stg:focus:outline-none stg:focus:ring-2 stg:focus:ring-ring",
            "stg:transition-colors",
          )}
        />
        <button
          type="submit"
          disabled={!value.trim()}
          className={cn(
            "stg:w-full stg:rounded-md stg:px-4 stg:py-2 stg:text-sm stg:font-medium",
            "stg:bg-primary stg:text-primary-foreground",
            "stg:hover:bg-primary-hover",
            "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
            "stg:disabled:pointer-events-none stg:disabled:opacity-50",
            "stg:transition-colors",
          )}
        >
          Continue
        </button>
      </form>
    );
  },
);

function LoadingState({ org }: { org: string }) {
  return (
    <div
      className="stg:flex stg:flex-col stg:items-center stg:gap-3 stg:py-4"
      aria-busy="true"
      aria-label={`Looking up SSO provider for ${org}`}
    >
      <SpinnerIcon />
      <p className="stg:text-sm stg:text-muted-foreground">
        Looking up <span className="stg:font-medium stg:text-foreground">{org}</span>&hellip;
      </p>
    </div>
  );
}

function FoundState({
  provider,
  org,
  onClick,
  onKeyDown,
  onChangeOrg,
}: {
  provider: SsoProviderInfo;
  org: string;
  onClick: () => void;
  onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => void;
  onChangeOrg: () => void;
}) {
  return (
    <div className="stg:space-y-4">
      <div className="stg:text-center">
        <p className="stg:text-xs stg:text-muted-foreground">
          Signing in to{" "}
          <span className="stg:font-medium stg:text-foreground">{org}</span>
        </p>
      </div>

      <button
        type="button"
        onClick={onClick}
        onKeyDown={onKeyDown}
        className={cn(
          "stg:flex stg:w-full stg:items-center stg:justify-center stg:gap-2 stg:rounded-md stg:px-4 stg:py-2.5",
          "stg:text-sm stg:font-medium",
          "stg:bg-primary stg:text-primary-foreground",
          "stg:hover:bg-primary-hover",
          "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
          "stg:transition-colors",
        )}
      >
        <SsoShieldIcon />
        Sign in with {provider.displayName}
      </button>

      <button
        type="button"
        onClick={onChangeOrg}
        className="stg:block stg:w-full stg:text-center stg:text-xs stg:text-muted-foreground stg:hover:text-foreground stg:transition-colors"
      >
        Not your organization? Change
      </button>
    </div>
  );
}

function NotFoundState({
  org,
  onBack,
}: {
  org: string;
  onBack: () => void;
}) {
  return (
    <div className="stg:space-y-3 stg:text-center">
      <p className="stg:text-sm stg:text-muted-foreground">
        No SSO provider configured for{" "}
        <span className="stg:font-medium stg:text-foreground">{org}</span>.
      </p>
      <button
        type="button"
        onClick={onBack}
        className="stg:text-xs stg:text-primary stg:hover:text-primary-hover stg:transition-colors"
      >
        Try a different organization
      </button>
    </div>
  );
}

function ErrorState({
  error,
  onRetry,
  onBack,
}: {
  error: Error;
  onRetry: () => void;
  onBack: () => void;
}) {
  return (
    <div className="stg:space-y-3 stg:text-center" role="alert">
      <p className="stg:text-sm stg:text-destructive">{getUserMessage(error)}</p>
      <div className="stg:flex stg:items-center stg:justify-center stg:gap-3">
        <button
          type="button"
          onClick={onRetry}
          className={cn(
            "stg:rounded-md stg:px-3 stg:py-1.5 stg:text-xs stg:font-medium",
            "stg:bg-primary stg:text-primary-foreground stg:hover:bg-primary-hover",
            "stg:transition-colors",
          )}
        >
          Retry
        </button>
        <button
          type="button"
          onClick={onBack}
          className="stg:text-xs stg:text-muted-foreground stg:hover:text-foreground stg:transition-colors"
        >
          Back
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

function SpinnerIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      className="stg:animate-spin stg:text-muted-foreground"
      aria-hidden="true"
    >
      <path d="M8 2a6 6 0 1 0 6 6" />
    </svg>
  );
}

function SsoShieldIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M8 1.5L2 4v4c0 3.5 2.5 5.5 6 7 3.5-1.5 6-3.5 6-7V4L8 1.5z" />
      <path d="M6 8l1.5 1.5L10 6.5" />
    </svg>
  );
}
