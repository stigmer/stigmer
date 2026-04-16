"use client";

import { useCallback, useRef, useState } from "react";
import { Check, ShieldCheck, ToggleRight } from "lucide-react";
import { ProviderPicker } from "@stigmer/react";
import { ScenarioPlayer } from "../../engine/ScenarioPlayer";
import { useNarrationManifest } from "../../engine/useNarrationManifest";
import { Cursor } from "../../engine/Cursor";
import { useStepInteractions } from "../../engine/useStepInteractions";
import { CodeEditorView, type FileTreeEntry } from "../../views/CodeEditorView";
import { BrowserView } from "../../views/BrowserView";
import { ManagementShell } from "../../views/ManagementShell";
import { APIExchangeView } from "../../views/APIExchangeView";
import { DEMO_BROWSER_ZOOM, DEMO_CONTENT_ZOOM } from "../../shared/tokens";
import { DemoViewport } from "../../engine/DemoViewport";
import {
  type OverviewTourStep,
  overviewTourSteps,
  PROVISION_CODE,
  GRANT_CODE,
  JIT_CHECKS,
  MANUAL_CHECKS,
  OVERVIEW_INTERACTIONS,
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
// Inline content — JIT toggle section (shown below ProviderPicker)
// ---------------------------------------------------------------------------

function JitToggleSection({ enabled }: { enabled: boolean }) {
  return (
    <div className="mt-3 rounded-md border border-border bg-muted/30 p-2.5">
      <div className="mb-1.5 flex items-center gap-1.5">
        <ShieldCheck className="h-3 w-3 text-primary" />
        <span className="text-xs font-semibold text-foreground">
          JIT Provisioning
        </span>
      </div>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            Auto-provision accounts
          </span>
          <ToggleRight
            className={`h-4 w-4 ${enabled ? "text-primary" : "text-muted-foreground/40"}`}
          />
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            Auto-grant on Organization
          </span>
          <ToggleRight
            className={`h-4 w-4 ${enabled ? "text-primary" : "text-muted-foreground/40"}`}
          />
        </div>
        {enabled && (
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Role</span>
            <span className="rounded bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">
              viewer
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step renderer
// ---------------------------------------------------------------------------

function renderStep(step: OverviewTourStep) {
  switch (step.view) {
    case "jit-register":
      return (
        <ManagementShell activeNav="identity-providers" contentKey="jit-reg">
          <div className="p-3" style={{ zoom: DEMO_CONTENT_ZOOM }}>
            <h2 className="mb-1 text-sm font-semibold">Identity Providers</h2>
            <p className="mb-3 text-[0.65rem] text-muted-foreground">
              Choose your identity provider to get started.
            </p>
            <ProviderPicker onSelect={noop} />
            <JitToggleSection enabled={true} />
          </div>
        </ManagementShell>
      );

    case "jit-login":
      return (
        <BrowserView
          url="acme.cloud/dashboard"
          contentKey="jit-login"
          zoom={DEMO_BROWSER_ZOOM}
        >
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
                  JWT issued
                </p>
                <div className="space-y-0.5 font-mono text-xs text-muted-foreground">
                  <div>
                    <span className="text-primary">&quot;sub&quot;</span>
                    {": "}
                    <span>&quot;auth0|jane_doe_123&quot;</span>
                  </div>
                </div>
              </div>
              <p className="text-xs font-medium text-primary">
                First login — JIT will auto-provision
              </p>
            </div>
          </div>
        </BrowserView>
      );

    case "jit-success":
      return (
        <APIExchangeView
          title="Stigmer API — JIT Provisioning"
          contentKey="jit-success"
          request={{
            method: "POST",
            url: "/agentic/v1/sessions",
            header: "Authorization: Bearer eyJhbGciOiJSUzI1NiIs...",
          }}
          checks={JIT_CHECKS}
          result={{
            label: "200 OK — Session created",
            status: "pass",
          }}
        />
      );

    case "manual-register":
      return (
        <ManagementShell
          activeNav="identity-providers"
          contentKey="manual-reg"
        >
          <div className="p-3" style={{ zoom: DEMO_CONTENT_ZOOM }}>
            <h2 className="mb-1 text-sm font-semibold">Identity Providers</h2>
            <p className="mb-3 text-[0.65rem] text-muted-foreground">
              Choose your identity provider to get started.
            </p>
            <ProviderPicker onSelect={noop} />
            <JitToggleSection enabled={false} />
          </div>
        </ManagementShell>
      );

    case "manual-provision":
      return (
        <CodeEditorView
          filename="onboard-user.ts"
          lines={PROVISION_CODE}
          highlightLines={[1, 2, 3, 4, 5, 6, 7, 8]}
          fileTree={FILE_TREE}
          contentKey="provision"
        />
      );

    case "manual-grant":
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

    case "manual-success":
      return (
        <APIExchangeView
          title="Stigmer API — Request Authorized"
          contentKey="manual-success"
          request={{
            method: "POST",
            url: "/agentic/v1/sessions",
            header: "Authorization: Bearer eyJhbGciOiJSUzI1NiIs...",
          }}
          checks={MANUAL_CHECKS}
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
 * Seven-step two-path walkthrough comparing JIT provisioning
 * (register → login → auto-provisioned success) with manual
 * provisioning (register → provision code → grant code → success).
 */
export function FederationOverviewTour() {
  const narrationManifest = useNarrationManifest("federation-overview-tour");
  const containerRef = useRef<HTMLDivElement>(null);
  const [cursorTarget, setCursorTarget] = useState<string | undefined>();
  const [stepIndex, setStepIndex] = useState(0);

  const handleStepChange = useCallback(
    (_step: OverviewTourStep, index: number) => {
      setCursorTarget(undefined);
      setStepIndex(index);
    },
    [],
  );

  useStepInteractions({
    stepIndex,
    interactions: OVERVIEW_INTERACTIONS,
    narrationManifest,
    containerRef,
    setCursorTarget,
    steps: overviewTourSteps,
  });

  return (
    <DemoViewport containerRef={containerRef}>
      <ScenarioPlayer
        steps={overviewTourSteps}
        narrationManifest={narrationManifest}
        onStepChange={handleStepChange}
      >
        {(step) => renderStep(step)}
      </ScenarioPlayer>
      <Cursor target={cursorTarget} containerRef={containerRef} />
    </DemoViewport>
  );
}
