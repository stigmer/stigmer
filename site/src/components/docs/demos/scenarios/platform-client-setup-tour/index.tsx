"use client";

import { type ReactNode, useCallback, useRef, useState } from "react";
import { Plus } from "lucide-react";
import {
  PlatformClientListPanel,
  CreatePlatformClientForm,
  PlatformClientSecretAlert,
} from "@stigmer/react";
import { PreviewProvider } from "@scenar/preview/runtime";
import { PlatformClientQueryController } from "@stigmer/protos/ai/stigmer/iam/platformclient/v1/query_pb";
import {
  ScenarioPlayer,
  useNarrationManifest,
  useStepInteractions,
  Cursor,
  PulseHighlight,
} from "@scenar/react";
import { PreviewProviders } from "../../../../../../.scenar/providers";
import { connectFixture } from "@scenar/preview/connect";
import { StigmerDemoViewport } from "../../shared/StigmerDemoViewport";
import { DEMO_ORG } from "../../fixtures";
import { AppShell } from "../../views/AppShell";
import { ComposerView } from "../../views/ComposerView";
import { ManagementShell } from "../../views/ManagementShell";
import { DEMO_CONTENT_ZOOM } from "../../shared/tokens";
import {
  type PlatformClientSetupStep,
  platformClientSetupSteps,
  getPlatformClientList,
  CREATED_CLIENT_ID,
  CREATED_CLIENT_SECRET,
} from "./steps";

const previewFixtures = [
  connectFixture(
    PlatformClientQueryController,
    "listByOrg",
    () => getPlatformClientList(),
  ),
];

function contentKeyFor(step: PlatformClientSetupStep): string {
  switch (step.view) {
    case "new-session":
    case "user-profile-click":
    case "user-menu-open":
    case "settings-click":
      return "session";
    case "settings-platform-clients":
    case "create-client-click":
    case "create-form":
    case "secret-revealed":
      return "settings";
  }
}

function slideDirectionFor(
  step: PlatformClientSetupStep,
): "forward" | "backward" | undefined {
  switch (step.view) {
    case "settings-platform-clients":
      return "forward";
    default:
      return undefined;
  }
}

function cursorTargetFor(
  step: PlatformClientSetupStep,
): string | undefined {
  switch (step.view) {
    case "user-profile-click":
      return "user-profile";
    case "settings-click":
      return "settings-menu-item";
    case "create-client-click":
      return "create-platform-client";
    default:
      return undefined;
  }
}

// ---------------------------------------------------------------------------
// Platform Clients page chrome
// ---------------------------------------------------------------------------

const noop = () => {};

function PlatformClientsPageChrome({
  highlightCreate,
  children,
}: {
  readonly highlightCreate?: boolean;
  readonly children?: ReactNode;
}) {
  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div
        className="min-h-0 flex-1 px-4 pt-3 pb-4"
        style={{ zoom: DEMO_CONTENT_ZOOM }}
      >
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-xs font-semibold text-foreground">
              Platform Clients
            </h3>
            <div
              className="group relative"
              data-cursor-target="create-platform-client"
            >
              <div className="flex items-center gap-1 rounded-md bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-80 group-data-[hover=true]:opacity-80">
                <Plus className="h-2.5 w-2.5" />
                New platform client
              </div>
              {highlightCreate && <PulseHighlight />}
            </div>
          </div>
          {children}
          <PlatformClientListPanel org={DEMO_ORG} />
        </section>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step renderer
// ---------------------------------------------------------------------------

function renderStep(step: PlatformClientSetupStep) {
  const contentKey = contentKeyFor(step);
  const slide = slideDirectionFor(step);

  switch (step.view) {
    case "new-session":
      return (
        <AppShell activeNav="new-session" contentKey={contentKey}>
          <ComposerView placeholder="Ask anything..." />
        </AppShell>
      );

    case "user-profile-click":
      return (
        <AppShell
          activeNav="new-session"
          highlightUserProfile
          contentKey={contentKey}
        >
          <ComposerView placeholder="Ask anything..." />
        </AppShell>
      );

    case "user-menu-open":
      return (
        <AppShell
          activeNav="new-session"
          showUserMenu
          contentKey={contentKey}
        >
          <ComposerView placeholder="Ask anything..." />
        </AppShell>
      );

    case "settings-click":
      return (
        <AppShell
          activeNav="new-session"
          showUserMenu
          contentKey={contentKey}
        >
          <ComposerView placeholder="Ask anything..." />
        </AppShell>
      );

    case "settings-platform-clients":
      return (
        <ManagementShell
          activeNav="platform-clients"
          contentKey={contentKey}
          slideDirection={slide}
        >
          <PlatformClientsPageChrome />
        </ManagementShell>
      );

    case "create-client-click":
      return (
        <ManagementShell
          activeNav="platform-clients"
          contentKey={contentKey}
        >
          <PlatformClientsPageChrome highlightCreate />
        </ManagementShell>
      );

    case "create-form":
      return (
        <ManagementShell
          activeNav="platform-clients"
          contentKey={contentKey}
        >
          <PlatformClientsPageChrome>
            <div className="mb-3" data-cursor-target="pc-name-input">
              <CreatePlatformClientForm
                org={DEMO_ORG}
                onCancel={noop}
              />
            </div>
          </PlatformClientsPageChrome>
        </ManagementShell>
      );

    case "secret-revealed":
      return (
        <ManagementShell
          activeNav="platform-clients"
          contentKey={contentKey}
        >
          <PlatformClientsPageChrome>
            <PlatformClientSecretAlert
              clientId={CREATED_CLIENT_ID}
              clientSecret={CREATED_CLIENT_SECRET}
              context="created"
              onDismiss={noop}
              className="mb-3"
            />
          </PlatformClientsPageChrome>
        </ManagementShell>
      );
  }
}

// ---------------------------------------------------------------------------
// Exported component
// ---------------------------------------------------------------------------

/**
 * Platform client setup tour for the PlatformClient documentation page.
 *
 * Auto-plays a timed walkthrough of the Stigmer Console showing how
 * to navigate to Settings > Platform Clients and create a new
 * PlatformClient. Uses real `@stigmer/react` components
 * (`PlatformClientListPanel`, `CreatePlatformClientForm`,
 * `PlatformClientSecretAlert`) backed by fixture data.
 */
export function PlatformClientSetupTour() {
  const narrationManifest = useNarrationManifest(
    "platform-client-setup-tour",
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const [cursorTarget, setCursorTarget] = useState<string | undefined>();
  const [showRipple, setShowRipple] = useState(true);
  const [stepIndex, setStepIndex] = useState(0);

  const handleStepChange = useCallback(
    (step: PlatformClientSetupStep, index: number) => {
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
    steps: platformClientSetupSteps,
    setShowRipple,
  });

  return (
    <PreviewProvider
      providers={PreviewProviders}
      fixtures={previewFixtures}
    >
      <StigmerDemoViewport containerRef={containerRef}>
        <ScenarioPlayer
          steps={platformClientSetupSteps}
          narrationManifest={narrationManifest}
          onStepChange={handleStepChange}
        >
          {(step) => renderStep(step)}
        </ScenarioPlayer>
        <Cursor
          target={cursorTarget}
          containerRef={containerRef}
          showRipple={showRipple}
        />
      </StigmerDemoViewport>
    </PreviewProvider>
  );
}
