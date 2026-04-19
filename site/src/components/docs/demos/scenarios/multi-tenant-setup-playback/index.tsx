"use client";

import { useCallback, useRef, useState } from "react";
import {
  ScenarioPlayer,
  useNarrationManifest,
  Cursor,
  useStepInteractions,
  BrowserView,
  CodeEditorView,
  type FileTreeEntry,
  TerminalView,
  AdminListPage,
  LoginCardPage,
  StatusBadge,
} from "@scenar/react";
import { DEMO_BROWSER_ZOOM, DEMO_TERMINAL_MAX_WIDTH } from "../../shared/tokens";
import { StigmerDemoViewport } from "../../shared/StigmerDemoViewport";
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
// Step renderer
// ---------------------------------------------------------------------------

function renderStep(step: MultiTenantSetupStep) {
  switch (step.view) {
    case "tenant-signup":
      return (
        <BrowserView url="acme.cloud/admin/tenants" contentKey="admin" zoom={DEMO_BROWSER_ZOOM}>
          <AdminListPage
            appName="Acme Cloud"
            breadcrumbs={["Tenants"]}
            title="Tenant Organizations"
            ctaLabel="Create tenant"
            ctaTargetId="create-tenant-btn"
            columns={[
              { key: "name", label: "Name" },
              { key: "id", label: "External ID" },
              { key: "status", label: "Status", align: "right" },
            ]}
            rows={[
              {
                id: "alpha",
                cells: {
                  name: "Tenant Alpha",
                  id: "acme-tenant-alpha-id",
                  status: <StatusBadge label="Provisioning..." variant="warning" />,
                },
              },
              {
                id: "globex",
                cells: {
                  name: "Globex Corp",
                  id: "acme-globex-corp-id",
                  status: <StatusBadge label="Active" variant="success" />,
                },
              },
              {
                id: "initech",
                cells: {
                  name: "Initech",
                  id: "acme-initech-id",
                  status: <StatusBadge label="Active" variant="success" />,
                },
              },
            ]}
          />
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
          maxWidth={DEMO_TERMINAL_MAX_WIDTH}
          lines={ORG_CREATED_OUTPUT}
          contentKey="org-created"
        />
      );

    case "user-signup":
      return (
        <BrowserView url="tenant-alpha.acme.cloud/signup" contentKey="signup" zoom={DEMO_BROWSER_ZOOM}>
          <LoginCardPage
            appName="Tenant Alpha"
            subtitle="Create your account"
            fields={[
              { label: "Name", value: "Jane Doe" },
              { label: "Email", value: "jane@acme.com" },
            ]}
            submitLabel="Create account"
            submitTargetId="signup-btn"
          />
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
          maxWidth={DEMO_TERMINAL_MAX_WIDTH}
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
    narrationManifest,
    containerRef,
    setCursorTarget,
    steps: multiTenantSetupSteps,
  });

  return (
    <StigmerDemoViewport containerRef={containerRef}>
      <ScenarioPlayer
        steps={multiTenantSetupSteps}
        narrationManifest={narrationManifest}
        onStepChange={handleStepChange}
      >
        {(step) => renderStep(step)}
      </ScenarioPlayer>
      <Cursor target={cursorTarget} containerRef={containerRef} />
    </StigmerDemoViewport>
  );
}
