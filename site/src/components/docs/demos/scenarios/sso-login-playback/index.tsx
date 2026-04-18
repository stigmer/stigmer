"use client";

import { useCallback, useRef, useState } from "react";
import { Check, Shield } from "lucide-react";
import {
  ScenarioPlayer,
  useNarrationManifest,
  Cursor,
  BrowserView,
  PulseHighlight,
} from "@scenar/react";
import { ManagementShell } from "../../views/ManagementShell";
import { DEMO_BROWSER_ZOOM, DEMO_CONTENT_ZOOM } from "../../shared/tokens";
import { StigmerDemoViewport } from "../../shared/StigmerDemoViewport";
import { type SsoLoginStep, ssoLoginSteps } from "./steps";

// ---------------------------------------------------------------------------
// Cursor targets
// ---------------------------------------------------------------------------

function cursorTargetFor(step: SsoLoginStep): string | undefined {
  switch (step.view) {
    case "idp-detail":
      return "copy-url-btn";
    case "sso-login":
      return "sso-sign-in-btn";
    default:
      return undefined;
  }
}

// ---------------------------------------------------------------------------
// Step 1: IdP detail panel with SSO URL (ManagementShell)
// ---------------------------------------------------------------------------

function IdpDetailContent() {
  return (
    <div className="p-3" style={{ zoom: DEMO_CONTENT_ZOOM }}>
      {/* Header */}
      <div className="mb-3">
        <button
          type="button"
          className="mb-1 flex items-center gap-1 text-[0.65rem] text-muted-foreground"
        >
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
            <path d="M10 3L5 8l5 5" />
          </svg>
          Back to list
        </button>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-foreground">
              Acme SSO
            </h3>
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs text-muted-foreground">
                acme-sso
              </span>
              <span className="inline-flex items-center rounded-full border border-primary/30 bg-primary/5 px-2 py-0.5 text-[0.6rem] font-medium text-primary">
                SSO
              </span>
            </div>
          </div>
          <span className="shrink-0 rounded-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground">
            Edit
          </span>
        </div>
      </div>

      {/* Fields */}
      <dl className="space-y-2">
        <DetailField
          label="JWKS URI"
          value="https://acme.us.auth0.com/.well-known/jwks.json"
          mono
        />
        <DetailField
          label="Allowed issuers"
          value="https://acme.us.auth0.com/"
          mono
        />
        <DetailField
          label="Expected audience"
          value="https://api.stigmer.ai/"
          mono
        />
        <DetailField label="OIDC client ID" value="abc123def456" mono />

        {/* SSO Login URL — copyable */}
        <div>
          <dt className="text-[0.65rem] font-medium text-muted-foreground">
            SSO login URL
          </dt>
          <dd className="mt-0.5">
            <div className="flex items-center gap-2">
              <span className="break-all font-mono text-xs text-foreground select-all">
                https://app.stigmer.ai/login?org=acme
              </span>
              <div className="relative" data-cursor-target="copy-url-btn">
                <button
                  type="button"
                  className="shrink-0 rounded px-1.5 py-0.5 text-[0.6rem] text-muted-foreground hover:bg-accent/50 hover:text-foreground transition-colors"
                >
                  Copy
                </button>
                <PulseHighlight />
              </div>
            </div>
            <p className="mt-0.5 text-[0.65rem] text-muted-foreground">
              Share this URL with your team members to sign in via SSO
            </p>
          </dd>
        </div>

        <div className="flex gap-6">
          <DetailField label="Created" value="Apr 7, 2026" />
          <DetailField label="Updated" value="Apr 7, 2026" />
        </div>
      </dl>
    </div>
  );
}

function DetailField({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-[0.65rem] font-medium text-muted-foreground">
        {label}
      </dt>
      <dd
        className={`mt-0.5 break-all text-xs text-foreground ${mono ? "font-mono" : ""}`}
      >
        {value}
      </dd>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 2: SSO login page (BrowserView)
// ---------------------------------------------------------------------------

function SsoLoginPage() {
  return (
    <div className="flex h-full items-center justify-center bg-gradient-to-b from-background to-muted/30">
      <div className="w-56 space-y-3">
        {/* Header */}
        <div className="text-center">
          <div className="mx-auto mb-1.5 flex h-6 w-6 items-center justify-center rounded-lg bg-primary/10">
            <span className="text-xs font-bold text-primary">S</span>
          </div>
          <h3 className="text-sm font-semibold text-foreground">
            Sign in to Stigmer
          </h3>
          <p className="text-xs text-muted-foreground">
            Signing in to{" "}
            <span className="font-medium text-foreground">acme</span>
          </p>
        </div>

        {/* SSO button */}
        <div className="relative" data-cursor-target="sso-sign-in-btn">
          <button
            type="button"
            className="flex w-full items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
          >
            <Shield className="h-3 w-3" />
            Sign in with Acme SSO
          </button>
          <PulseHighlight />
        </div>

        {/* Change org link */}
        <p className="text-center text-xs text-muted-foreground">
          Not your organization?{" "}
          <span className="text-primary">Change</span>
        </p>

        {/* Divider */}
        <div className="flex items-center gap-2">
          <div className="h-px flex-1 bg-border" />
          <span className="text-xs text-muted-foreground">or</span>
          <div className="h-px flex-1 bg-border" />
        </div>

        {/* Email fallback */}
        <button
          type="button"
          className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-center text-xs font-medium text-foreground"
        >
          Sign in with email
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 3: External IdP login page (BrowserView)
// ---------------------------------------------------------------------------

function ExternalIdpLogin() {
  return (
    <div className="flex h-full items-center justify-center bg-gradient-to-b from-background to-muted/30">
      <div className="w-52 rounded-lg border border-border bg-card p-3 shadow-sm">
        <div className="mb-2 text-center">
          <div className="mx-auto mb-1 flex h-5 w-5 items-center justify-center rounded-md bg-orange-500/10">
            <span className="text-xs font-bold text-orange-600">A</span>
          </div>
          <h3 className="text-sm font-semibold text-foreground">
            Acme Identity
          </h3>
          <p className="text-xs text-muted-foreground">
            Sign in to continue to Stigmer
          </p>
        </div>

        <div className="space-y-1.5">
          <div>
            <label className="text-xs text-muted-foreground">Email</label>
            <div className="rounded-md border border-border bg-background px-2 py-0.5 text-xs text-foreground">
              jane@acme.com
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">
              Password
            </label>
            <div className="rounded-md border border-border bg-background px-2 py-0.5 text-xs text-muted-foreground">
              ••••••••••
            </div>
          </div>
          <div className="rounded-md bg-orange-600 py-0.5 text-center text-xs font-medium text-white">
            Sign in
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 4: Console welcome (BrowserView)
// ---------------------------------------------------------------------------

function ConsoleWelcome() {
  return (
    <div className="flex h-full items-center justify-center bg-gradient-to-b from-background to-muted/30">
      <div className="w-60 space-y-2.5 text-center">
        <div className="mx-auto flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500/10">
          <Check className="h-4 w-4 text-emerald-500" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-foreground">
            Welcome, Jane!
          </h3>
          <p className="text-xs text-muted-foreground">
            Authenticated via Acme SSO
          </p>
        </div>

        <div className="rounded-md border border-border bg-muted/50 p-2 text-left">
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                Organization
              </span>
              <span className="font-mono text-xs text-foreground">
                acme
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Role</span>
              <span className="inline-flex items-center rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-xs font-medium text-emerald-600">
                viewer
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Account</span>
              <span className="text-xs text-foreground">
                Created on first login
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step renderer
// ---------------------------------------------------------------------------

function renderStep(step: SsoLoginStep) {
  switch (step.view) {
    case "idp-detail":
      return (
        <ManagementShell
          activeNav="identity-providers"
          contentKey="idp-detail"
        >
          <IdpDetailContent />
        </ManagementShell>
      );

    case "sso-login":
      return (
        <BrowserView
          url="app.stigmer.ai/login?org=acme"
          contentKey="sso-login"
          zoom={DEMO_BROWSER_ZOOM}
        >
          <SsoLoginPage />
        </BrowserView>
      );

    case "idp-redirect":
      return (
        <BrowserView
          url="login.acme.com/authorize"
          contentKey="idp-redirect"
          slideDirection="forward"
          zoom={DEMO_BROWSER_ZOOM}
        >
          <ExternalIdpLogin />
        </BrowserView>
      );

    case "console-welcome":
      return (
        <BrowserView
          url="app.stigmer.ai/sessions"
          contentKey="console-welcome"
          slideDirection="forward"
          zoom={DEMO_BROWSER_ZOOM}
        >
          <ConsoleWelcome />
        </BrowserView>
      );
  }
}

// ---------------------------------------------------------------------------
// Exported component
// ---------------------------------------------------------------------------

/**
 * SSO login playback for the "Set up SSO" guide page.
 *
 * Four-step walkthrough: admin sees SSO URL on IdP detail panel →
 * team member visits login URL with SSO discovery → external IdP
 * authentication → console access with automatic provisioning.
 */
export function SsoLoginPlayback() {
  const narrationManifest = useNarrationManifest("sso-login-playback");
  const containerRef = useRef<HTMLDivElement>(null);
  const [cursorTarget, setCursorTarget] = useState<string | undefined>();

  const handleStepChange = useCallback(
    (step: SsoLoginStep, _index: number) => {
      setCursorTarget(cursorTargetFor(step));
    },
    [],
  );

  return (
    <StigmerDemoViewport containerRef={containerRef}>
      <ScenarioPlayer
        steps={ssoLoginSteps}
        narrationManifest={narrationManifest}
        onStepChange={handleStepChange}
      >
        {(step) => renderStep(step)}
      </ScenarioPlayer>
      <Cursor target={cursorTarget} containerRef={containerRef} />
    </StigmerDemoViewport>
  );
}
