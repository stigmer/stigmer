"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { StigmerProvider } from "@stigmer/react";
import { createDemoClient, fixtures, buildScenario } from "@stigmer/react/demo";
import { ScenarioPlayer } from "../../engine/ScenarioPlayer";
import { Cursor } from "../../engine/Cursor";
import { AppShell } from "../../views/AppShell";
import { ComposerView } from "../../views/ComposerView";
import { SettingsView } from "../../views/SettingsView";
import { DEMO_PLAYER_CLASSES } from "../../shared/tokens";
import {
  type ApiKeySetupStep,
  apiKeySetupSteps,
  API_KEY_LIST,
  PERSONAL_ENVIRONMENT,
  PERSONAL_ENV_ID,
  CREATED_KEY_NAME,
  CREATED_RAW_KEY,
} from "./steps";

const demoScenario = buildScenario(
  fixtures.apiKey.findAll(() => API_KEY_LIST),
  fixtures.environment.get(() => PERSONAL_ENVIRONMENT),
);

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
        <AppShell contentKey={contentKey} slideDirection={slide}>
          <SettingsView
            apiKeyState="list"
            personalEnvId={PERSONAL_ENV_ID}
          />
        </AppShell>
      );

    case "create-key-click":
      return (
        <AppShell contentKey={contentKey}>
          <SettingsView
            apiKeyState="list"
            highlightCreate
            personalEnvId={PERSONAL_ENV_ID}
          />
        </AppShell>
      );

    case "create-form":
      return (
        <AppShell contentKey={contentKey}>
          <SettingsView
            apiKeyState="creating"
            createFormName={CREATED_KEY_NAME}
            personalEnvId={PERSONAL_ENV_ID}
          />
        </AppShell>
      );

    case "key-created":
      return (
        <AppShell contentKey={contentKey}>
          <SettingsView
            apiKeyState="created"
            rawKey={CREATED_RAW_KEY}
            keyName={CREATED_KEY_NAME}
            personalEnvId={PERSONAL_ENV_ID}
          />
        </AppShell>
      );
  }
}

/**
 * API key setup demo for the Quickstart "Sign up and get your API key" step.
 *
 * Auto-plays a timed walkthrough of the Stigmer web app showing how
 * to navigate to Settings and create an API key. Uses real
 * `@stigmer/react` components (`ApiKeyListPanel`, `CreateApiKeyForm`,
 * `ApiKeyCreatedAlert`, `EnvironmentVariableEditor`) backed by
 * fixture data — no live backend.
 *
 * Visual storytelling layers:
 * 1. **Captions** — short labels below the demo describing each action
 * 2. **Slide transitions** — content slides when navigating to Settings
 * 3. **Animated cursor** — pointer targets user profile, menu, and buttons
 * 4. **User menu** — popup mirrors the real Console's profile menu
 */
export function ApiKeySetup() {
  const client = useMemo(() => createDemoClient(demoScenario), []);
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
          onStepChange={handleStepChange}
        >
          {(step) => renderStep(step)}
        </ScenarioPlayer>
        <Cursor target={cursorTarget} containerRef={containerRef} />
      </div>
    </StigmerProvider>
  );
}
