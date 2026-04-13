"use client";

import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Plus } from "lucide-react";
import {
  ApiKeyCreatedAlert,
  ApiKeyListPanel,
  CreateApiKeyForm,
  StigmerProvider,
} from "@stigmer/react";
import { createDemoClient, fixtures, buildScenario } from "@stigmer/react/demo";
import { ScenarioPlayer } from "../../engine/ScenarioPlayer";
import { useNarrationManifest } from "../../engine/useNarrationManifest";
import { Cursor } from "../../engine/Cursor";
import { DEMO_ORG } from "../../engine/shared";
import { AppShell } from "../../views/AppShell";
import { ComposerView } from "../../views/ComposerView";
import { ManagementShell } from "../../views/ManagementShell";
import { PulseHighlight } from "../../shared/PulseHighlight";
import { DEMO_CONTENT_ZOOM, DEMO_PLAYER_CLASSES } from "../../shared/tokens";
import {
  type ApiKeySetupStep,
  apiKeySetupSteps,
  getApiKeyList,
  PERSONAL_ENVIRONMENT,
  CREATED_KEY_NAME,
  CREATED_RAW_KEY,
} from "./steps";

function buildDemoScenario() {
  return buildScenario(
    fixtures.apiKey.findAll(() => getApiKeyList()),
    fixtures.environment.get(() => PERSONAL_ENVIRONMENT),
  );
}

function contentKeyFor(step: ApiKeySetupStep): string {
  switch (step.view) {
    case "new-session":
    case "user-profile-click":
    case "user-menu-open":
    case "settings-click":
      return "session";
    case "settings-api-keys":
    case "create-key-click":
    case "create-form":
    case "key-created":
      return "settings";
  }
}

function slideDirectionFor(
  step: ApiKeySetupStep,
): "forward" | "backward" | undefined {
  switch (step.view) {
    case "settings-api-keys":
      return "forward";
    default:
      return undefined;
  }
}

function cursorTargetFor(step: ApiKeySetupStep): string | undefined {
  switch (step.view) {
    case "user-profile-click":
      return "user-profile";
    case "settings-click":
      return "settings-menu-item";
    case "create-key-click":
      return "create-api-key";
    default:
      return undefined;
  }
}

// ---------------------------------------------------------------------------
// API Keys page chrome (inlined — single-consumer, no separate view file)
// ---------------------------------------------------------------------------

const noop = () => {};

function ApiKeysPageChrome({
  highlightCreate,
  children,
}: {
  readonly highlightCreate?: boolean;
  readonly children?: ReactNode;
}) {
  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="min-h-0 flex-1 px-4 pt-3 pb-4" style={{ zoom: DEMO_CONTENT_ZOOM }}>
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-xs font-semibold text-foreground">API Keys</h3>
            <div className="relative" data-cursor-target="create-api-key">
              <div className="flex items-center gap-1 rounded-md bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground">
                <Plus className="h-2.5 w-2.5" />
                New API key
              </div>
              {highlightCreate && <PulseHighlight />}
            </div>
          </div>
          {children}
          <ApiKeyListPanel />
        </section>
      </div>
    </div>
  );
}

function PrefilledCreateForm({ name }: { readonly name?: string }) {
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!name) return;

    const input = wrapperRef.current?.querySelector(
      "#stgm-new-apikey-name",
    ) as HTMLInputElement | null;
    if (!input) return;

    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    setter?.call(input, name);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, [name]);

  return (
    <div ref={wrapperRef} className="mb-3">
      <CreateApiKeyForm org={DEMO_ORG} onCancel={noop} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step renderer
// ---------------------------------------------------------------------------

function renderStep(step: ApiKeySetupStep) {
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

    case "settings-api-keys":
      return (
        <ManagementShell activeNav="api-keys" contentKey={contentKey} slideDirection={slide}>
          <ApiKeysPageChrome />
        </ManagementShell>
      );

    case "create-key-click":
      return (
        <ManagementShell activeNav="api-keys" contentKey={contentKey}>
          <ApiKeysPageChrome highlightCreate />
        </ManagementShell>
      );

    case "create-form":
      return (
        <ManagementShell activeNav="api-keys" contentKey={contentKey}>
          <ApiKeysPageChrome>
            <PrefilledCreateForm name={CREATED_KEY_NAME} />
          </ApiKeysPageChrome>
        </ManagementShell>
      );

    case "key-created":
      return (
        <ManagementShell activeNav="api-keys" contentKey={contentKey}>
          <ApiKeysPageChrome>
            <ApiKeyCreatedAlert
              rawKey={CREATED_RAW_KEY}
              keyName={CREATED_KEY_NAME}
              onDismiss={noop}
              className="mb-3"
            />
          </ApiKeysPageChrome>
        </ManagementShell>
      );
  }
}

/**
 * API key setup demo for the Quickstart "Sign up and get your API key" step.
 *
 * Auto-plays a timed walkthrough of the Stigmer web app showing how
 * to navigate to Settings and create an API key. Uses real
 * `@stigmer/react` components (`ApiKeyListPanel`, `CreateApiKeyForm`,
 * `ApiKeyCreatedAlert`) backed by fixture data — no live backend.
 *
 * Visual storytelling layers:
 * 1. **Captions** — short labels below the demo describing each action
 * 2. **Zone transition** — sidebar swaps from session to management zone
 * 3. **Animated cursor** — pointer targets user profile, menu, and buttons
 * 4. **User menu** — popup mirrors the real Console's profile menu
 */
export function ApiKeySetup() {
  const client = useMemo(() => createDemoClient(buildDemoScenario()), []);
  const narrationManifest = useNarrationManifest("api-key-setup");
  const containerRef = useRef<HTMLDivElement>(null);
  const [cursorTarget, setCursorTarget] = useState<string | undefined>();

  const handleStepChange = useCallback((step: ApiKeySetupStep) => {
    setCursorTarget(cursorTargetFor(step));
  }, []);

  return (
    <StigmerProvider client={client}>
      <div ref={containerRef} className={DEMO_PLAYER_CLASSES}>
        <ScenarioPlayer
          steps={apiKeySetupSteps}
          narrationManifest={narrationManifest}
          onStepChange={handleStepChange}
        >
          {(step) => renderStep(step)}
        </ScenarioPlayer>
        <Cursor target={cursorTarget} containerRef={containerRef} />
      </div>
    </StigmerProvider>
  );
}
