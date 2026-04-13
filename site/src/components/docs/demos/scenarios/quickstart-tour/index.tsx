"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { Plus } from "lucide-react";
import {
  ApiKeyCreatedAlert,
  ApiKeyListPanel,
  StigmerProvider,
} from "@stigmer/react";
import { createDemoClient, fixtures, buildScenario } from "@stigmer/react/demo";
import { ScenarioPlayer } from "../../engine/ScenarioPlayer";
import { useNarrationManifest } from "../../engine/useNarrationManifest";
import { Cursor } from "../../engine/Cursor";
import {
  type StepInteractions,
  useStepInteractions,
} from "../../engine/useStepInteractions";
import { CodeEditorView, type FileTreeEntry } from "../../views/CodeEditorView";
import { TerminalView } from "../../views/TerminalView";
import { ManagementShell } from "../../views/ManagementShell";
import { DEMO_CONTENT_ZOOM, DEMO_PLAYER_CLASSES } from "../../shared/tokens";
import {
  type QuickstartTourStep,
  quickstartTourSteps,
  getApiKeyList,
  PERSONAL_ENVIRONMENT,
  CREATED_KEY_NAME,
  CREATED_RAW_KEY,
  CONNECT_CODE,
  DOMAIN_CODE,
  GENERIC_OUTPUT,
  DOMAIN_FAIL_OUTPUT,
} from "./steps";

const noop = () => {};

function buildDemoScenario() {
  return buildScenario(
    fixtures.apiKey.findAll(() => getApiKeyList()),
    fixtures.environment.get(() => PERSONAL_ENVIRONMENT),
  );
}

// ---------------------------------------------------------------------------
// File tree for the code editor
// ---------------------------------------------------------------------------

const FILE_TREE: FileTreeEntry[] = [
  { name: "ask-agent.ts", type: "file", depth: 0 },
  { name: "package.json", type: "file", depth: 0 },
  { name: "tsconfig.json", type: "file", depth: 0 },
];

// ---------------------------------------------------------------------------
// API Keys page chrome (real SDK components)
// ---------------------------------------------------------------------------

function ApiKeysPageChrome() {
  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="min-h-0 flex-1 px-4 pt-3 pb-4" style={{ zoom: DEMO_CONTENT_ZOOM }}>
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-xs font-semibold text-foreground">API Keys</h3>
            <div className="flex items-center gap-1 rounded-md bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground">
              <Plus className="h-2.5 w-2.5" />
              New API key
            </div>
          </div>
          <ApiKeyCreatedAlert
            rawKey={CREATED_RAW_KEY}
            keyName={CREATED_KEY_NAME}
            onDismiss={noop}
            className="mb-3"
          />
          <ApiKeyListPanel />
        </section>
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
          <ApiKeysPageChrome />
        </ManagementShell>
      );

    case "code-connect":
      return (
        <CodeEditorView
          filename="ask-agent.ts"
          lines={CONNECT_CODE}
          highlightLines={[7, 8, 9, 10, 12, 13, 14, 15]}
          fileTree={FILE_TREE}
          workspaceName="stigmer-quickstart"
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
          workspaceName="stigmer-quickstart"
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
// Mid-step interactions
// ---------------------------------------------------------------------------

const INTERACTIONS: StepInteractions = {
  0: [
    { atPercent: 0.5, type: "set-cursor", target: "copy-key" },
  ],
  1: [
    { atPercent: 0.0, type: "clear-cursor" },
  ],
};

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
  const client = useMemo(() => createDemoClient(buildDemoScenario()), []);
  const narrationManifest = useNarrationManifest("quickstart-tour");
  const containerRef = useRef<HTMLDivElement>(null);
  const [cursorTarget, setCursorTarget] = useState<string | undefined>();
  const [stepIndex, setStepIndex] = useState(0);

  const handleStepChange = useCallback(
    (_step: QuickstartTourStep, index: number) => {
      setCursorTarget(undefined);
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
    steps: quickstartTourSteps,
  });

  return (
    <StigmerProvider client={client}>
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
    </StigmerProvider>
  );
}
