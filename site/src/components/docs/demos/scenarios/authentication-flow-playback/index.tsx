"use client";

import { useCallback, useRef, useState } from "react";
import { Check } from "lucide-react";
import { ScenarioPlayer, useNarrationManifest, Cursor, useStepInteractions, BrowserView, TerminalView, LoginCardPage } from "@scenar/react";
import { APIExchangeView } from "../../views/APIExchangeView";
import { DEMO_BROWSER_ZOOM, DEMO_TERMINAL_MAX_WIDTH } from "../../shared/tokens";
import { StigmerDemoViewport } from "../../shared/StigmerDemoViewport";
import {
  type AuthFlowStep,
  authFlowSteps,
  API_CALL_LINES,
  SUCCESS_LINES,
  ERROR_401_LINES,
  ERROR_403_LINES,
  VALIDATION_CHECKS,
  RESOLVE_CHECKS,
  RESOLVE_RESULT,
} from "./steps";

// ---------------------------------------------------------------------------
// Cursor targets
// ---------------------------------------------------------------------------

function cursorTargetFor(step: AuthFlowStep): string | undefined {
  switch (step.view) {
    case "browser-login":
      return "sign-in-btn";
    default:
      return undefined;
  }
}

// ---------------------------------------------------------------------------
// Inline page content for BrowserView
// ---------------------------------------------------------------------------

function AuthenticatedPage() {
  return (
    <div className="flex h-full items-center justify-center bg-gradient-to-b from-background to-muted/30">
      <div className="w-56 space-y-2 text-center">
        <div className="mx-auto flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500/10">
          <Check className="h-3.5 w-3.5 text-emerald-500" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-foreground">
            Welcome, Jane!
          </h3>
          <p className="text-xs text-muted-foreground">
            Authenticated via Auth0
          </p>
        </div>

        <div className="rounded-md border border-border bg-muted/50 p-1.5 text-left">
          <p className="mb-0.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            JWT Access Token
          </p>
          <div className="space-y-0 font-mono text-xs">
            <div className="text-muted-foreground">
              {"{"}{" "}
              <span className="text-primary">&quot;iss&quot;</span>
              {": "}
              <span>&quot;acme.us.auth0.com&quot;</span>,
            </div>
            <div className="text-muted-foreground">
              {"  "}
              <span className="text-primary">&quot;sub&quot;</span>
              {": "}
              <span>&quot;auth0|jane_doe_123&quot;</span>,
            </div>
            <div className="text-muted-foreground">
              {"  "}
              <span className="text-primary">&quot;aud&quot;</span>
              {": "}
              <span>&quot;https://api.stigmer.ai/&quot;</span>,
            </div>
            <div className="text-muted-foreground">
              {"  "}
              <span className="text-primary">&quot;exp&quot;</span>
              {": "}
              <span>1744012800</span>
              {" }"}
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

function renderStep(step: AuthFlowStep) {
  switch (step.view) {
    case "browser-login":
      return (
        <BrowserView url="acme.cloud/login" contentKey="login" zoom={DEMO_BROWSER_ZOOM}>
          <LoginCardPage
            appName="Acme Cloud"
            subtitle="Sign in to your account"
            fields={[
              { label: "Email", value: "jane@acme.com" },
              { label: "Password", type: "password" },
            ]}
            submitLabel="Sign in"
            submitTargetId="sign-in-btn"
          />
        </BrowserView>
      );

    case "browser-jwt":
      return (
        <BrowserView
          url="acme.cloud/dashboard"
          contentKey="dashboard"
          slideDirection="forward"
          zoom={DEMO_BROWSER_ZOOM}
        >
          <AuthenticatedPage />
        </BrowserView>
      );

    case "api-call":
      return (
        <TerminalView
          title="Terminal — zsh"
          maxWidth={DEMO_TERMINAL_MAX_WIDTH}
          contentKey="api-call"
          lines={API_CALL_LINES}
        />
      );

    case "validate-token":
      return (
        <APIExchangeView
          title="Stigmer API — Token Validation"
          contentKey="validate"
          request={{
            method: "POST",
            url: "/agentic/v1/sessions",
            header: "Authorization: Bearer eyJhbGciOiJSUzI1NiIs...",
          }}
          checks={VALIDATION_CHECKS}
        />
      );

    case "resolve-authorize":
      return (
        <APIExchangeView
          title="Stigmer API — Identity & Authorization"
          contentKey="resolve"
          slideDirection="forward"
          checks={RESOLVE_CHECKS}
          result={RESOLVE_RESULT}
        />
      );

    case "success-response":
      return (
        <TerminalView
          title="Terminal — zsh"
          maxWidth={DEMO_TERMINAL_MAX_WIDTH}
          contentKey="success"
          lines={SUCCESS_LINES}
        />
      );

    case "error-401":
      return (
        <TerminalView
          title="Terminal — Error Scenario"
          maxWidth={DEMO_TERMINAL_MAX_WIDTH}
          contentKey="error-401"
          lines={ERROR_401_LINES}
        />
      );

    case "error-403":
      return (
        <TerminalView
          title="Terminal — Error Scenario"
          maxWidth={DEMO_TERMINAL_MAX_WIDTH}
          contentKey="error-403"
          slideDirection="forward"
          lines={ERROR_403_LINES}
        />
      );
  }
}

// ---------------------------------------------------------------------------
// Exported component
// ---------------------------------------------------------------------------

/**
 * Authentication flow demo for the federation guide.
 *
 * Auto-plays a timed walkthrough of the end-to-end federated
 * authentication flow: user login → JWT → API call → token
 * validation → identity resolution → authorization → response.
 * Includes error scenarios for 401 and 403.
 *
 * Uses three illustration views (BrowserView, TerminalView,
 * APIExchangeView) — no SDK components or live backend needed.
 */
export function AuthenticationFlowPlayback() {
  const narrationManifest = useNarrationManifest(
    "authentication-flow-playback",
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const [cursorTarget, setCursorTarget] = useState<string | undefined>();
  const [stepIndex, setStepIndex] = useState(0);

  const handleStepChange = useCallback(
    (step: AuthFlowStep, index: number) => {
      setCursorTarget(cursorTargetFor(step));
      setStepIndex(index);
    },
    [],
  );

  useStepInteractions({
    stepIndex,
    narrationManifest,
    containerRef,
    setCursorTarget,
    steps: authFlowSteps,
  });

  return (
    <StigmerDemoViewport containerRef={containerRef}>
      <ScenarioPlayer
        steps={authFlowSteps}
        narrationManifest={narrationManifest}
        onStepChange={handleStepChange}
      >
        {(step) => renderStep(step)}
      </ScenarioPlayer>
      <Cursor target={cursorTarget} containerRef={containerRef} />
    </StigmerDemoViewport>
  );
}
