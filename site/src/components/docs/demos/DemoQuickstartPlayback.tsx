"use client";

import { useEffect, useMemo, useRef } from "react";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import {
  StigmerProvider,
  MessageThread,
  SessionComposer,
} from "@stigmer/react";
import type { UseWorkspaceEntriesReturn } from "@stigmer/react";
import { createDemoClient } from "@stigmer/react/demo";
import type { DemoScenario } from "@stigmer/react/demo";
import { ScenarioPlayer } from "./ScenarioPlayer";
import { DemoAppShell } from "./DemoAppShell";
import { DemoWidgetsSidebar } from "./DemoWidgetsSidebar";
import {
  type QuickstartStep,
  quickstartPlaybackSteps,
} from "./scenarios/quickstart-playback";

const DEMO_ORG = "demo-org";

const emptyScenario: DemoScenario = { fixtures: new Map() };

const noop = () => {};

const MOCK_WORKSPACE: UseWorkspaceEntriesReturn = {
  entries: [],
  addGitRepo: noop,
  addLocalPath: noop,
  remove: noop,
  clear: noop,
  toInput: () => [],
  hasEntries: false,
};

const composerProps = {
  onSubmit: noop,
  placeholder: "Ask anything...",
  autoFocus: false,
  workspace: MOCK_WORKSPACE,
  org: DEMO_ORG,
  onAgentRefChange: noop,
  onMcpServerUsagesChange: noop,
  onSkillRefsChange: noop,
} as const;

// ---------------------------------------------------------------------------
// TypingComposer — shows text in the SessionComposer textarea
// ---------------------------------------------------------------------------

/**
 * Wraps `SessionComposer` and programmatically fills the textarea with
 * the given message by setting the native value and dispatching an
 * `input` event. This is a standard React pattern for programmatically
 * updating controlled inputs that don't expose a `value` prop.
 */
function TypingComposer({ message }: { readonly message: string }) {
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const textarea = wrapperRef.current?.querySelector("textarea");
    if (!textarea) return;

    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    setter?.call(textarea, message);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  }, [message]);

  return (
    <div ref={wrapperRef}>
      <SessionComposer {...composerProps} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

function widgetsSidebar(execution: AgentExecution) {
  const executions = [execution];
  return (
    <DemoWidgetsSidebar
      execution={execution}
      executions={executions}
      org={DEMO_ORG}
    />
  );
}

function renderStep(step: QuickstartStep) {
  switch (step.view) {
    case "composer-empty":
      return (
        <DemoAppShell activeNav="new-session" contentKey="session">
          <div className="flex h-full items-center justify-center p-4">
            <div className="w-full max-w-xl" style={{ zoom: 0.88 }}>
              <SessionComposer {...composerProps} />
            </div>
          </div>
        </DemoAppShell>
      );

    case "composer-typing":
      return (
        <DemoAppShell activeNav="new-session" contentKey="session">
          <div className="flex h-full items-center justify-center p-4">
            <div className="w-full max-w-xl" style={{ zoom: 0.88 }}>
              <TypingComposer message={step.message} />
            </div>
          </div>
        </DemoAppShell>
      );

    case "conversation":
      return (
        <DemoAppShell
          activeNav="new-session"
          contentKey="session"
          aside={widgetsSidebar(step.execution)}
        >
          <MessageThread executions={[step.execution]} />
        </DemoAppShell>
      );
  }
}

/**
 * Animated quickstart conversation for the Cloud quickstart page.
 *
 * Auto-plays a timed sequence of messages through a real MessageThread
 * inside a three-column DemoAppShell, showing a basic exchange with
 * the implicit assistant agent. Starts from an empty composer to
 * establish the user journey. Backed by fixture data — no live
 * backend required.
 */
export function DemoQuickstartPlayback() {
  const client = useMemo(() => createDemoClient(emptyScenario), []);

  return (
    <StigmerProvider client={client}>
      <div className="not-prose mx-auto max-w-4xl">
        <ScenarioPlayer steps={quickstartPlaybackSteps}>
          {(step) => renderStep(step)}
        </ScenarioPlayer>
      </div>
    </StigmerProvider>
  );
}
