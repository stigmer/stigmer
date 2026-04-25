"use client";

import { useCallback, useRef, useState } from "react";
import { Check } from "lucide-react";
import {
  ScenarioPlayer,
  useNarrationManifest,
  Cursor,
  useStepInteractions,
  DesktopView,
  BrowserView,
  LoginCardPage,
} from "@scenar/react";
import { StigmerDemoViewport } from "../../shared/StigmerDemoViewport";
import { DEMO_BROWSER_ZOOM } from "../../shared/tokens";
import {
  type DesktopFirstLaunchStep,
  desktopFirstLaunchSteps,
} from "./steps";

// ---------------------------------------------------------------------------
// Hand-crafted content for each view
// ---------------------------------------------------------------------------

function DesktopLoginScreen() {
  return (
    <div className="flex h-full items-center justify-center bg-background">
      <div className="w-56 space-y-3 text-center">
        <div className="mx-auto flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
          <span className="text-sm font-bold text-primary">S</span>
        </div>
        <div>
          <h3 className="text-sm font-semibold text-foreground">
            Stigmer Desktop
          </h3>
          <p className="text-xs text-muted-foreground">
            Sign in to get started
          </p>
        </div>
        <div data-cursor-target="sign-in-btn">
          <button className="w-full rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground">
            Sign in with Stigmer
          </button>
        </div>
        <p className="text-xs text-muted-foreground">
          Running locally? The app detects your local server automatically.
        </p>
      </div>
    </div>
  );
}

function AuthCallbackPage() {
  return (
    <div className="flex h-full items-center justify-center bg-gradient-to-b from-background to-muted/30">
      <div className="w-56 space-y-2 text-center">
        <div className="mx-auto flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500/10">
          <Check className="h-3.5 w-3.5 text-emerald-500" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-foreground">
            Sign-in successful
          </h3>
          <p className="text-xs text-muted-foreground">
            Redirecting to Stigmer Desktop…
          </p>
        </div>
      </div>
    </div>
  );
}

function DesktopSessionsScreen() {
  return (
    <div className="flex h-full flex-col bg-background">
      <div className="flex items-center gap-4 border-b border-border px-4 py-2">
        <span className="text-xs font-semibold text-foreground">Sessions</span>
        <span className="text-xs text-muted-foreground">Agents</span>
        <span className="text-xs text-muted-foreground">Skills</span>
        <span className="text-xs text-muted-foreground">Settings</span>
      </div>
      <div className="flex flex-1 items-center justify-center">
        <div className="w-56 space-y-2 text-center">
          <p className="text-sm font-medium text-foreground">
            Welcome to Stigmer
          </p>
          <p className="text-xs text-muted-foreground">
            Start a new session to talk to your agents.
          </p>
          <button className="mt-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground">
            New Session
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step renderer
// ---------------------------------------------------------------------------

function renderStep(step: DesktopFirstLaunchStep) {
  switch (step.view) {
    case "desktop-login":
      return (
        <DesktopView title="Stigmer" contentKey="login">
          <DesktopLoginScreen />
        </DesktopView>
      );

    case "browser-auth":
      return (
        <BrowserView
          url="auth.stigmer.ai/login"
          contentKey="auth"
          zoom={DEMO_BROWSER_ZOOM}
        >
          <LoginCardPage
            appName="Stigmer"
            subtitle="Sign in to your account"
            fields={[
              { label: "Email", value: "you@example.com" },
              { label: "Password", type: "password" },
            ]}
            submitLabel="Sign in"
          />
        </BrowserView>
      );

    case "browser-callback":
      return (
        <BrowserView
          url="auth.stigmer.ai/callback"
          contentKey="callback"
          slideDirection="forward"
          zoom={DEMO_BROWSER_ZOOM}
        >
          <AuthCallbackPage />
        </BrowserView>
      );

    case "desktop-ready":
      return (
        <DesktopView title="Stigmer" contentKey="sessions">
          <DesktopSessionsScreen />
        </DesktopView>
      );
  }
}

// ---------------------------------------------------------------------------
// Exported component
// ---------------------------------------------------------------------------

/**
 * Desktop first-launch walkthrough.
 *
 * Four-step playback: desktop login screen → browser auth page →
 * callback redirect → desktop app sessions view. Shows the complete
 * sign-in flow a user experiences on first launch.
 */
export function DesktopFirstLaunch() {
  const narrationManifest = useNarrationManifest("desktop-first-launch");
  const containerRef = useRef<HTMLDivElement>(null);
  const [cursorTarget, setCursorTarget] = useState<string | undefined>();
  const [stepIndex, setStepIndex] = useState(0);

  const handleStepChange = useCallback(
    (_step: DesktopFirstLaunchStep, index: number) => {
      setCursorTarget(undefined);
      setStepIndex(index);
    },
    [],
  );

  useStepInteractions({
    stepIndex,
    narrationManifest,
    containerRef,
    setCursorTarget,
    steps: desktopFirstLaunchSteps,
  });

  return (
    <StigmerDemoViewport containerRef={containerRef}>
      <ScenarioPlayer
        steps={desktopFirstLaunchSteps}
        narrationManifest={narrationManifest}
        onStepChange={handleStepChange}
      >
        {(step) => renderStep(step)}
      </ScenarioPlayer>
      <Cursor target={cursorTarget} containerRef={containerRef} />
    </StigmerDemoViewport>
  );
}
