"use client";

import { useCallback, useRef, useState } from "react";
import { Building2, Plus } from "lucide-react";
import { ScenarioPlayer } from "../../engine/ScenarioPlayer";
import { useNarrationManifest } from "../../engine/useNarrationManifest";
import { Cursor } from "../../engine/Cursor";
import {
  type StepInteractions,
  useStepInteractions,
} from "../../engine/useStepInteractions";
import { BrowserView } from "../../views/BrowserView";
import { CodeEditorView, type FileTreeEntry } from "../../views/CodeEditorView";
import { TerminalView } from "../../views/TerminalView";
import { PulseHighlight } from "../../shared/PulseHighlight";
import { DEMO_BROWSER_ZOOM } from "../../shared/tokens";
import { DemoViewport } from "../../engine/DemoViewport";
import {
  type MultiTenantSetupStep,
  multiTenantSetupSteps,
  CREATE_ORG_CODE,
  LOOKUP_ORG_CODE,
  PROVISION_GRANT_CODE,
  ORG_CREATED_OUTPUT,
  USER_ONBOARDED_OUTPUT,
} from "./steps";

// ---------------------------------------------------------------------------
// File tree
// ---------------------------------------------------------------------------

const FILE_TREE: FileTreeEntry[] = [
  { name: "src", type: "folder", depth: 0 },
  { name: "tenants", type: "folder", depth: 1 },
  { name: "onboard-tenant.ts", type: "file", depth: 2 },
  { name: "onboard-tenant-user.ts", type: "file", depth: 2 },
  { name: "federation", type: "folder", depth: 1 },
  { name: "register-idp.ts", type: "file", depth: 2 },
  { name: "package.json", type: "file", depth: 0 },
];

// ---------------------------------------------------------------------------
// Cursor targets
// ---------------------------------------------------------------------------

function cursorTargetFor(step: MultiTenantSetupStep): string | undefined {
  switch (step.view) {
    case "tenant-signup":
      return "create-tenant-btn";
    case "user-signup":
      return "signup-btn";
    default:
      return undefined;
  }
}

// ---------------------------------------------------------------------------
// Inline page content — Platform admin panel
// ---------------------------------------------------------------------------

function TenantAdminPage() {
  return (
    <div className="flex h-full flex-col bg-gradient-to-b from-background to-muted/30">
      <div className="border-b border-border px-4 py-2.5">
        <div className="flex items-center gap-1.5">
          <div className="flex h-5 w-5 items-center justify-center rounded-md bg-primary/10">
            <span className="text-xs font-bold text-primary">A</span>
          </div>
          <span className="text-sm font-semibold text-foreground">
            Acme Cloud
          </span>
          <span className="text-xs text-muted-foreground">/ Tenants</span>
        </div>
      </div>

      <div className="flex-1 p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">
            Tenant Organizations
          </h3>
          <div
            className="relative flex items-center gap-1 rounded-md bg-primary px-2 py-0.5"
            data-cursor-target="create-tenant-btn"
          >
            <Plus className="h-2.5 w-2.5 text-primary-foreground" />
            <span className="text-xs font-medium text-primary-foreground">
              Create tenant
            </span>
            <PulseHighlight />
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2">
            <Building2 className="h-3 w-3 text-primary" />
            <div>
              <div className="text-xs font-medium text-foreground">
                Tenant Alpha
              </div>
              <div className="text-xs text-muted-foreground">
                acme-tenant-alpha-id
              </div>
            </div>
            <span className="ml-auto rounded-full bg-amber-500/10 px-1.5 py-0.5 text-xs font-medium text-amber-600">
              Provisioning...
            </span>
          </div>
          <div className="flex items-center gap-2 rounded-md border border-border px-3 py-2">
            <Building2 className="h-3 w-3 text-muted-foreground" />
            <div>
              <div className="text-xs font-medium text-foreground">
                Globex Corp
              </div>
              <div className="text-xs text-muted-foreground">
                acme-globex-corp-id
              </div>
            </div>
            <span className="ml-auto rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-xs font-medium text-emerald-600">
              Active
            </span>
          </div>
          <div className="flex items-center gap-2 rounded-md border border-border px-3 py-2">
            <Building2 className="h-3 w-3 text-muted-foreground" />
            <div>
              <div className="text-xs font-medium text-foreground">
                Initech
              </div>
              <div className="text-xs text-muted-foreground">
                acme-initech-id
              </div>
            </div>
            <span className="ml-auto rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-xs font-medium text-emerald-600">
              Active
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline page content — Tenant-branded signup
// ---------------------------------------------------------------------------

function TenantSignupPage() {
  return (
    <div className="flex h-full items-center justify-center bg-gradient-to-b from-background to-muted/30">
      <div className="w-52 rounded-lg border border-border bg-card p-3 shadow-sm">
        <div className="mb-2 text-center">
          <div className="mx-auto mb-1 flex h-5 w-5 items-center justify-center rounded-md bg-primary/10">
            <Building2 className="h-2.5 w-2.5 text-primary" />
          </div>
          <h3 className="text-sm font-semibold text-foreground">
            Tenant Alpha
          </h3>
          <p className="text-xs text-muted-foreground">
            Create your account
          </p>
        </div>

        <div className="space-y-1.5">
          <div>
            <label className="text-xs text-muted-foreground">Name</label>
            <div className="rounded-md border border-border bg-background px-2 py-0.5 text-xs text-foreground">
              Jane Doe
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Email</label>
            <div className="rounded-md border border-border bg-background px-2 py-0.5 text-xs text-foreground">
              jane@acme.com
            </div>
          </div>
          <div className="relative" data-cursor-target="signup-btn">
            <div className="rounded-md bg-primary py-0.5 text-center text-xs font-medium text-primary-foreground">
              Create account
            </div>
            <PulseHighlight />
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step renderer
// ---------------------------------------------------------------------------

function renderStep(step: MultiTenantSetupStep) {
  switch (step.view) {
    case "tenant-signup":
      return (
        <BrowserView url="acme.cloud/admin/tenants" contentKey="admin" zoom={DEMO_BROWSER_ZOOM}>
          <TenantAdminPage />
        </BrowserView>
      );

    case "code-create-org":
      return (
        <CodeEditorView
          filename="onboard-tenant.ts"
          lines={CREATE_ORG_CODE}
          highlightLines={[5, 6, 7, 8, 9, 10, 11]}
          fileTree={FILE_TREE}
          contentKey="create-org"
        />
      );

    case "terminal-org-created":
      return (
        <TerminalView
          title="Terminal — zsh"
          lines={ORG_CREATED_OUTPUT}
          contentKey="org-created"
        />
      );

    case "user-signup":
      return (
        <BrowserView url="tenant-alpha.acme.cloud/signup" contentKey="signup" zoom={DEMO_BROWSER_ZOOM}>
          <TenantSignupPage />
        </BrowserView>
      );

    case "code-lookup-org":
      return (
        <CodeEditorView
          filename="onboard-tenant-user.ts"
          lines={LOOKUP_ORG_CODE}
          highlightLines={[1, 2, 3, 4, 5, 6, 7]}
          fileTree={FILE_TREE}
          contentKey="lookup"
        />
      );

    case "code-provision-grant":
      return (
        <CodeEditorView
          filename="onboard-tenant-user.ts"
          lines={PROVISION_GRANT_CODE}
          highlightLines={[1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14]}
          fileTree={FILE_TREE}
          contentKey="provision-grant"
          slideDirection="forward"
        />
      );

    case "terminal-user-onboarded":
      return (
        <TerminalView
          title="Terminal — zsh"
          lines={USER_ONBOARDED_OUTPUT}
          contentKey="user-onboarded"
        />
      );
  }
}

// ---------------------------------------------------------------------------
// Exported component
// ---------------------------------------------------------------------------

/**
 * Multi-tenant setup playback for the federation guide.
 *
 * Seven-step walkthrough: tenant signup → create platform-managed org →
 * org created → user signup → lookup org by external ID →
 * provision + grant → tenant user onboarded.
 */
const INTERACTIONS: StepInteractions = {};

export function MultiTenantSetupPlayback() {
  const narrationManifest = useNarrationManifest(
    "multi-tenant-setup-playback",
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const [cursorTarget, setCursorTarget] = useState<string | undefined>();
  const [stepIndex, setStepIndex] = useState(0);

  const handleStepChange = useCallback(
    (step: MultiTenantSetupStep, index: number) => {
      setCursorTarget(cursorTargetFor(step));
      setStepIndex(index);
    },
    [],
  );

  useStepInteractions({
    stepIndex,
    interactions: INTERACTIONS,
    narrationManifest,
    containerRef,
    setCursorTarget,
    steps: multiTenantSetupSteps,
  });

  return (
    <DemoViewport containerRef={containerRef}>
      <ScenarioPlayer
        steps={multiTenantSetupSteps}
        narrationManifest={narrationManifest}
        onStepChange={handleStepChange}
      >
        {(step) => renderStep(step)}
      </ScenarioPlayer>
      <Cursor target={cursorTarget} containerRef={containerRef} />
    </DemoViewport>
  );
}
