"use client";

import { useCallback, useRef, useState } from "react";
import { ScenarioPlayer } from "../../engine/ScenarioPlayer";
import { useNarrationManifest } from "../../engine/useNarrationManifest";
import { Cursor } from "../../engine/Cursor";
import { BrowserView } from "../../views/BrowserView";
import { CodeEditorView, type FileTreeEntry } from "../../views/CodeEditorView";
import { TerminalView } from "../../views/TerminalView";
import { PulseHighlight } from "../../shared/PulseHighlight";
import { DEMO_PLAYER_CLASSES } from "../../shared/tokens";

const FILE_TREE: FileTreeEntry[] = [
  { name: "src", type: "folder", depth: 0 },
  { name: "handlers", type: "folder", depth: 1 },
  { name: "onboard-user.ts", type: "file", depth: 2 },
  { name: "federation", type: "folder", depth: 1 },
  { name: "register-idp.ts", type: "file", depth: 2 },
  { name: "verify-idp.ts", type: "file", depth: 2 },
  { name: "package.json", type: "file", depth: 0 },
];
import {
  type ProvisionGrantStep,
  provisionGrantSteps,
  CHECK_CODE,
  CREATE_CODE,
  GRANT_CODE,
  NOT_FOUND_OUTPUT,
  CREATED_OUTPUT,
  GRANTED_OUTPUT,
} from "./steps";

// ---------------------------------------------------------------------------
// Cursor targets
// ---------------------------------------------------------------------------

function cursorTargetFor(step: ProvisionGrantStep): string | undefined {
  switch (step.view) {
    case "user-signup":
      return "signup-btn";
    default:
      return undefined;
  }
}

// ---------------------------------------------------------------------------
// Inline page content
// ---------------------------------------------------------------------------

function SignupPage() {
  return (
    <div className="flex h-full items-center justify-center bg-gradient-to-b from-background to-muted/30">
      <div className="w-56 rounded-lg border border-border bg-card p-4 shadow-sm">
        <div className="mb-3 text-center">
          <div className="mx-auto mb-1.5 flex h-6 w-6 items-center justify-center rounded-md bg-primary/10">
            <span className="text-[10px] font-bold text-primary">A</span>
          </div>
          <h3 className="text-[11px] font-semibold text-foreground">
            Acme Cloud
          </h3>
          <p className="text-[9px] text-muted-foreground">
            Create your account
          </p>
        </div>

        <div className="space-y-2">
          <div>
            <label className="text-[9px] text-muted-foreground">Name</label>
            <div className="rounded-md border border-border bg-background px-2 py-1 text-[10px] text-foreground">
              Jane Doe
            </div>
          </div>
          <div>
            <label className="text-[9px] text-muted-foreground">Email</label>
            <div className="rounded-md border border-border bg-background px-2 py-1 text-[10px] text-foreground">
              jane@acme.com
            </div>
          </div>
          <div className="relative" data-cursor-target="signup-btn">
            <div className="rounded-md bg-primary py-1 text-center text-[10px] font-medium text-primary-foreground">
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

function renderStep(step: ProvisionGrantStep) {
  switch (step.view) {
    case "user-signup":
      return (
        <BrowserView url="acme.cloud/signup" contentKey="signup">
          <SignupPage />
        </BrowserView>
      );

    case "code-check":
      return (
        <CodeEditorView
          filename="onboard-user.ts"
          lines={CHECK_CODE}
          highlightLines={[2, 3, 4, 5, 6]}
          fileTree={FILE_TREE}
          contentKey="check"
        />
      );

    case "terminal-not-found":
      return (
        <TerminalView
          title="Terminal — zsh"
          lines={NOT_FOUND_OUTPUT}
          contentKey="not-found"
        />
      );

    case "code-create":
      return (
        <CodeEditorView
          filename="onboard-user.ts"
          lines={CREATE_CODE}
          highlightLines={[1, 2, 3, 4, 5, 6, 7, 8, 9]}
          fileTree={FILE_TREE}
          contentKey="create"
        />
      );

    case "terminal-created":
      return (
        <TerminalView
          title="Terminal — zsh"
          lines={CREATED_OUTPUT}
          contentKey="created"
        />
      );

    case "code-grant":
      return (
        <CodeEditorView
          filename="onboard-user.ts"
          lines={GRANT_CODE}
          highlightLines={[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]}
          fileTree={FILE_TREE}
          contentKey="grant"
        />
      );

    case "terminal-granted":
      return (
        <TerminalView
          title="Terminal — zsh"
          lines={GRANTED_OUTPUT}
          contentKey="granted"
        />
      );
  }
}

// ---------------------------------------------------------------------------
// Exported component
// ---------------------------------------------------------------------------

/**
 * Provision & grant playback for the federation guide.
 *
 * Seven-step walkthrough: user signup → check existing account →
 * NOT_FOUND → create federated account → account created →
 * grant IAM Policy → onboarding complete.
 */
export function ProvisionGrantPlayback() {
  const narrationManifest = useNarrationManifest("provision-grant-playback");
  const containerRef = useRef<HTMLDivElement>(null);
  const [cursorTarget, setCursorTarget] = useState<string | undefined>();

  const handleStepChange = useCallback((step: ProvisionGrantStep) => {
    setCursorTarget(cursorTargetFor(step));
  }, []);

  return (
    <div ref={containerRef} className={DEMO_PLAYER_CLASSES}>
      <ScenarioPlayer
        steps={provisionGrantSteps}
        narrationManifest={narrationManifest}
        onStepChange={handleStepChange}
      >
        {(step) => renderStep(step)}
      </ScenarioPlayer>
      <Cursor target={cursorTarget} containerRef={containerRef} />
    </div>
  );
}
