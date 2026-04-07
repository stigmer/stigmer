"use client";

import { useCallback, useRef, useState } from "react";
import { Check, Copy, KeyRound, Plus } from "lucide-react";
import { ScenarioPlayer } from "../../engine/ScenarioPlayer";
import { useNarrationManifest } from "../../engine/useNarrationManifest";
import { Cursor } from "../../engine/Cursor";
import { CodeEditorView, type FileTreeEntry } from "../../views/CodeEditorView";
import { TerminalView } from "../../views/TerminalView";
import { ManagementShell } from "../../views/ManagementShell";
import { DEMO_CONTENT_ZOOM, DEMO_PLAYER_CLASSES } from "../../shared/tokens";
import {
  type QuickstartTourStep,
  quickstartTourSteps,
  CONNECT_CODE,
  DOMAIN_CODE,
  GENERIC_OUTPUT,
  DOMAIN_FAIL_OUTPUT,
} from "./steps";

// ---------------------------------------------------------------------------
// File tree for the code editor
// ---------------------------------------------------------------------------

const FILE_TREE: FileTreeEntry[] = [
  { name: "ask-agent.ts", type: "file", depth: 0 },
  { name: "package.json", type: "file", depth: 0 },
  { name: "tsconfig.json", type: "file", depth: 0 },
];

// ---------------------------------------------------------------------------
// Inline API key created view (self-contained, no SDK dependency)
// ---------------------------------------------------------------------------

const DEMO_KEY = "sk_live_dEm0k3y_a1b2c3d4e5f6g7h8";

function ApiKeyCreatedPage() {
  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="min-h-0 flex-1 px-4 pt-3 pb-4" style={{ zoom: DEMO_CONTENT_ZOOM }}>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-xs font-semibold text-foreground">API Keys</h3>
          <div className="flex items-center gap-1 rounded-md bg-primary px-2 py-0.5 text-[10px] font-medium text-primary-foreground">
            <Plus className="h-2.5 w-2.5" />
            New API key
          </div>
        </div>

        {/* Key created alert */}
        <div className="mb-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3">
          <div className="mb-1.5 flex items-center gap-1.5">
            <div className="flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500/20">
              <Check className="h-2.5 w-2.5 text-emerald-500" />
            </div>
            <span className="text-[11px] font-semibold text-foreground">
              API key created
            </span>
          </div>
          <p className="mb-2 text-[10px] text-muted-foreground">
            Copy your key now. You won't see it again.
          </p>
          <div
            className="flex items-center gap-2 rounded-md border border-border bg-muted/50 px-2.5 py-1.5"
            data-cursor-target="copy-key"
          >
            <KeyRound className="h-3 w-3 shrink-0 text-muted-foreground" />
            <code className="flex-1 truncate font-mono text-[10px] text-foreground">
              {DEMO_KEY}
            </code>
            <Copy className="h-3 w-3 shrink-0 text-muted-foreground" />
          </div>
        </div>

        {/* Existing keys (simplified) */}
        <div className="space-y-1.5">
          {[
            { name: "ci-pipeline", hint: "Kd9m" },
            { name: "local-dev", hint: "Yw3p" },
          ].map((k) => (
            <div
              key={k.name}
              className="flex items-center justify-between rounded-md border border-border px-2.5 py-1.5"
            >
              <div className="flex items-center gap-2">
                <KeyRound className="h-3 w-3 text-muted-foreground" />
                <span className="text-[10px] font-medium text-foreground">
                  {k.name}
                </span>
              </div>
              <span className="font-mono text-[9px] text-muted-foreground">
                sk_...{k.hint}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step renderer
// ---------------------------------------------------------------------------

function renderStep(step: QuickstartTourStep) {
  switch (step.view) {
    case "api-key-created":
      return (
        <ManagementShell activeNav="api-keys" contentKey="api-keys">
          <ApiKeyCreatedPage />
        </ManagementShell>
      );

    case "code-connect":
      return (
        <CodeEditorView
          filename="ask-agent.ts"
          lines={CONNECT_CODE}
          highlightLines={[7, 8, 9, 10, 12, 13, 14, 15]}
          fileTree={FILE_TREE}
          contentKey="connect"
        />
      );

    case "terminal-generic":
      return (
        <TerminalView
          title="Terminal — zsh"
          cwd="~/stigmer-quickstart"
          lines={GENERIC_OUTPUT}
          contentKey="generic"
        />
      );

    case "code-domain-question":
      return (
        <CodeEditorView
          filename="ask-agent.ts"
          lines={DOMAIN_CODE}
          highlightLines={[15]}
          fileTree={FILE_TREE}
          contentKey="domain"
          slideDirection="forward"
        />
      );

    case "terminal-domain-fail":
      return (
        <TerminalView
          title="Terminal — zsh"
          cwd="~/stigmer-quickstart"
          lines={DOMAIN_FAIL_OUTPUT}
          contentKey="domain-fail"
        />
      );
  }
}

// ---------------------------------------------------------------------------
// Exported component
// ---------------------------------------------------------------------------

/**
 * Quickstart overview tour for the "What you'll build" section.
 *
 * Five-step multi-surface preview: API key from the console →
 * code in the editor → generic response in terminal → change the
 * question → domain response fails. Orients the reader before
 * they start the step-by-step tutorial.
 */
export function QuickstartTour() {
  const narrationManifest = useNarrationManifest("quickstart-tour");
  const containerRef = useRef<HTMLDivElement>(null);
  const [cursorTarget, setCursorTarget] = useState<string | undefined>();

  const handleStepChange = useCallback((step: QuickstartTourStep) => {
    setCursorTarget(step.view === "api-key-created" ? "copy-key" : undefined);
  }, []);

  return (
    <div ref={containerRef} className={DEMO_PLAYER_CLASSES}>
      <ScenarioPlayer
        steps={quickstartTourSteps}
        narrationManifest={narrationManifest}
        onStepChange={handleStepChange}
      >
        {(step) => renderStep(step)}
      </ScenarioPlayer>
      <Cursor target={cursorTarget} containerRef={containerRef} />
    </div>
  );
}
