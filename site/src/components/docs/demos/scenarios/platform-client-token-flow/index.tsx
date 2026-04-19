"use client";

import { useCallback, useRef, useState } from "react";
import { Check, Code2, Zap } from "lucide-react";
import {
  ScenarioPlayer,
  useNarrationManifest,
  Cursor,
  useStepInteractions,
  BrowserView,
  TerminalView,
  LoginCardPage,
} from "@scenar/react";
import { APIExchangeView } from "../../views/APIExchangeView";
import { DEMO_BROWSER_ZOOM } from "../../shared/tokens";
import { StigmerDemoViewport } from "../../shared/StigmerDemoViewport";
import {
  type TokenFlowStep,
  tokenFlowSteps,
  MINT_CALL_LINES,
  TOKEN_RESPONSE_LINES,
  ERROR_UNAUTHENTICATED_LINES,
  ERROR_NOT_FOUND_LINES,
  CREDENTIAL_CHECKS,
  USER_TOKEN_CHECKS,
  USER_TOKEN_RESULT,
} from "./steps";

// ---------------------------------------------------------------------------
// Cursor targets
// ---------------------------------------------------------------------------

function cursorTargetFor(step: TokenFlowStep): string | undefined {
  switch (step.view) {
    case "platform-login":
      return "sign-in-btn";
    default:
      return undefined;
  }
}

// ---------------------------------------------------------------------------
// Inline page content for BrowserView
// ---------------------------------------------------------------------------

function StigmerEmbeddedPage() {
  return (
    <div className="flex h-full items-center justify-center bg-gradient-to-b from-background to-muted/30">
      <div className="w-60 space-y-2 text-center">
        <div className="mx-auto flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500/10">
          <Check className="h-3.5 w-3.5 text-emerald-500" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-foreground">
            Welcome, Jane!
          </h3>
          <p className="text-xs text-muted-foreground">
            Stigmer components ready
          </p>
        </div>

        <div className="rounded-md border border-border bg-muted/50 p-2 text-left">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            StigmerProvider initialized
          </p>
          <div className="space-y-1">
            <div className="flex items-center gap-1.5">
              <Zap className="h-3 w-3 text-primary" />
              <span className="text-xs text-foreground">
                getAccessToken wired
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <Code2 className="h-3 w-3 text-primary" />
              <span className="text-xs text-foreground">
                SessionComposer, MessageThread
              </span>
            </div>
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          Jane can now use agents, sessions, and tools
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step renderer
// ---------------------------------------------------------------------------

function renderStep(step: TokenFlowStep) {
  switch (step.view) {
    case "platform-login":
      return (
        <BrowserView
          url="app.acme.com/login"
          contentKey="login"
          zoom={DEMO_BROWSER_ZOOM}
        >
          <LoginCardPage
            appName="Acme Dashboard"
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

    case "backend-mint":
      return (
        <TerminalView
          title="Your Backend — mintUserToken"
          contentKey="mint-call"
          lines={MINT_CALL_LINES}
        />
      );

    case "stigmer-validates-credentials":
      return (
        <APIExchangeView
          title="Stigmer API — Credential Validation"
          contentKey="validate-creds"
          request={{
            method: "POST",
            url: "/iam/v1/platformclient/mintUserToken",
            header:
              "client_id: stgm_cid_d3m0kEy... / client_secret: ••••",
          }}
          checks={CREDENTIAL_CHECKS}
        />
      );

    case "token-response":
      return (
        <TerminalView
          title="Your Backend — Token Response"
          contentKey="token-response"
          lines={TOKEN_RESPONSE_LINES}
        />
      );

    case "frontend-uses-token":
      return (
        <BrowserView
          url="app.acme.com/dashboard"
          contentKey="dashboard"
          slideDirection="forward"
          zoom={DEMO_BROWSER_ZOOM}
        >
          <StigmerEmbeddedPage />
        </BrowserView>
      );

    case "stigmer-validates-user-token":
      return (
        <APIExchangeView
          title="Stigmer API — User Token Validation"
          contentKey="validate-user"
          request={{
            method: "POST",
            url: "/agentic/v1/sessions",
            header: "Authorization: Bearer eyJhbGciOiJFZDI1NTE5Iiwi...",
          }}
          checks={USER_TOKEN_CHECKS}
          result={USER_TOKEN_RESULT}
        />
      );

    case "error-unauthenticated":
      return (
        <TerminalView
          title="Error — Invalid Credentials"
          contentKey="error-unauth"
          lines={ERROR_UNAUTHENTICATED_LINES}
        />
      );

    case "error-not-found":
      return (
        <TerminalView
          title="Error — User Not Found"
          contentKey="error-notfound"
          slideDirection="forward"
          lines={ERROR_NOT_FOUND_LINES}
        />
      );
  }
}

// ---------------------------------------------------------------------------
// Exported component
// ---------------------------------------------------------------------------

/**
 * PlatformClient token flow playback for the PlatformClient
 * documentation page.
 *
 * Auto-plays a timed walkthrough of the end-to-end token minting
 * flow: platform login -> backend mintUserToken -> Stigmer validates
 * credentials -> JWT response -> frontend StigmerProvider -> API
 * call validation. Includes error scenarios for UNAUTHENTICATED and
 * NOT_FOUND.
 *
 * Uses three illustration views (BrowserView, TerminalView,
 * APIExchangeView) — no SDK components or live backend needed.
 */
export function PlatformClientTokenFlow() {
  const narrationManifest = useNarrationManifest(
    "platform-client-token-flow",
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const [cursorTarget, setCursorTarget] = useState<string | undefined>();
  const [stepIndex, setStepIndex] = useState(0);

  const handleStepChange = useCallback(
    (step: TokenFlowStep, index: number) => {
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
    steps: tokenFlowSteps,
  });

  return (
    <StigmerDemoViewport containerRef={containerRef}>
      <ScenarioPlayer
        steps={tokenFlowSteps}
        narrationManifest={narrationManifest}
        onStepChange={handleStepChange}
      >
        {(step) => renderStep(step)}
      </ScenarioPlayer>
      <Cursor target={cursorTarget} containerRef={containerRef} />
    </StigmerDemoViewport>
  );
}
