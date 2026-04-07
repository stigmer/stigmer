"use client";

import { useCallback, useRef, useState } from "react";
import { Check } from "lucide-react";
import { ProviderPicker } from "@stigmer/react";
import { ScenarioPlayer } from "../../engine/ScenarioPlayer";
import { useNarrationManifest } from "../../engine/useNarrationManifest";
import { Cursor } from "../../engine/Cursor";
import { CodeEditorView, type FileTreeEntry } from "../../views/CodeEditorView";
import { BrowserView } from "../../views/BrowserView";
import { ManagementShell } from "../../views/ManagementShell";
import { APIExchangeView } from "../../views/APIExchangeView";
import { DEMO_CONTENT_ZOOM, DEMO_PLAYER_CLASSES } from "../../shared/tokens";
import {
  type OverviewTourStep,
  overviewTourSteps,
  PROVISION_CODE,
  GRANT_CODE,
} from "./steps";

const noop = () => {};

const FILE_TREE: FileTreeEntry[] = [
  { name: "src", type: "folder", depth: 0 },
  { name: "federation", type: "folder", depth: 1 },
  { name: "register-idp.ts", type: "file", depth: 2 },
  { name: "onboard-user.ts", type: "file", depth: 2 },
  { name: "verify-idp.ts", type: "file", depth: 2 },
  { name: "index.ts", type: "file", depth: 1 },
  { name: "package.json", type: "file", depth: 0 },
  { name: "tsconfig.json", type: "file", depth: 0 },
];

// ---------------------------------------------------------------------------
// Step renderer
// ---------------------------------------------------------------------------

function renderStep(step: OverviewTourStep) {
  switch (step.view) {
    case "register-idp":
      return (
        <ManagementShell
          activeNav="identity-providers"
          contentKey="register"
        >
          <div className="p-3" style={{ zoom: DEMO_CONTENT_ZOOM }}>
            <h2 className="mb-1 text-sm font-semibold">Identity Providers</h2>
            <p className="mb-3 text-[0.65rem] text-muted-foreground">
              Choose your identity provider to get started.
            </p>
            <ProviderPicker onSelect={noop} />
          </div>
        </ManagementShell>
      );

    case "provision-account":
      return (
        <CodeEditorView
          filename="onboard-user.ts"
          lines={PROVISION_CODE}
          highlightLines={[1, 2, 3, 4, 5, 6, 7, 8]}
          fileTree={FILE_TREE}
          contentKey="provision"
        />
      );

    case "grant-access":
      return (
        <CodeEditorView
          filename="onboard-user.ts"
          lines={GRANT_CODE}
          highlightLines={[1, 2, 3, 4, 5]}
          fileTree={FILE_TREE}
          contentKey="grant"
          slideDirection="forward"
        />
      );

    case "user-login":
      return (
        <BrowserView url="acme.cloud/dashboard" contentKey="login">
          <div className="flex h-full items-center justify-center bg-gradient-to-b from-background to-muted/30">
            <div className="w-64 space-y-3 text-center">
              <div className="mx-auto flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500/10">
                <Check className="h-4 w-4 text-emerald-500" />
              </div>
              <div>
                <h3 className="text-[11px] font-semibold text-foreground">
                  Welcome, Jane!
                </h3>
                <p className="text-[9px] text-muted-foreground">
                  Authenticated via Auth0
                </p>
              </div>
              <div className="rounded-md border border-border bg-muted/50 p-2 text-left">
                <p className="mb-1 text-[8px] font-semibold uppercase tracking-wider text-muted-foreground">
                  JWT issued
                </p>
                <div className="font-mono text-[8px] text-muted-foreground">
                  <span className="text-primary">&quot;sub&quot;</span>
                  {": "}
                  <span>&quot;auth0|jane_doe_123&quot;</span>
                </div>
              </div>
            </div>
          </div>
        </BrowserView>
      );

    case "api-call-success":
      return (
        <APIExchangeView
          title="Stigmer API — Request Authorized"
          contentKey="success"
          request={{
            method: "POST",
            url: "/agentic/v1/sessions",
            header: "Authorization: Bearer eyJhbGciOiJSUzI1NiIs...",
          }}
          checks={[
            { label: "Token validated", detail: "signature + claims OK", status: "pass" },
            { label: "Identity resolved", detail: "auth0|jane_doe → ida_01abc", status: "pass" },
            { label: "Access authorized", detail: "admin on org_acme", status: "pass" },
          ]}
          result={{
            label: "200 OK — Session created",
            status: "pass",
          }}
        />
      );
  }
}

// ---------------------------------------------------------------------------
// Exported component
// ---------------------------------------------------------------------------

/**
 * Federation overview tour for the guide landing page.
 *
 * Five-step animated walkthrough showing the complete federation
 * setup at a glance: register IdP (console UI with real SDK
 * ProviderPicker) → provision account (code) → grant access
 * (code) → user login → authorized API call.
 */
export function FederationOverviewTour() {
  const narrationManifest = useNarrationManifest("federation-overview-tour");
  const containerRef = useRef<HTMLDivElement>(null);
  const [cursorTarget, setCursorTarget] = useState<string | undefined>();

  const handleStepChange = useCallback((_step: OverviewTourStep) => {
    setCursorTarget(undefined);
  }, []);

  return (
    <div ref={containerRef} className={DEMO_PLAYER_CLASSES}>
      <ScenarioPlayer
        steps={overviewTourSteps}
        narrationManifest={narrationManifest}
        onStepChange={handleStepChange}
      >
        {(step) => renderStep(step)}
      </ScenarioPlayer>
      <Cursor target={cursorTarget} containerRef={containerRef} />
    </div>
  );
}
