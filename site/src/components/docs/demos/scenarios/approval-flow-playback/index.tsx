"use client";

/**
 * The approval-flow demo: a return request, the agent's call waiting on the
 * real inline gate, and the turn completing once the cursor presses Approve.
 * The press is the real button calling the demo's answer handler, which
 * swaps the waiting frame for the completed one; a step change resets it.
 */

import { useCallback, useRef, useState } from "react";
import { ScenarioPlayer, useNarrationManifest, useStepInteractions, Cursor } from "@scenar/react";
import type { MessageThreadProps } from "@stigmer/react-sdk";
import { StigmerPreviewProvider } from "../../shared/StigmerPreviewProvider";
import { StigmerDemoViewport } from "../../shared/StigmerDemoViewport";
import { AppShell } from "../../views/AppShell";
import { ComposerView } from "../../views/ComposerView";
import { renderWidgetsSidebar } from "../../views/WidgetsSidebar";
import {
  type ApprovalFlowStep,
  approvalFlowSteps,
  completedConversation,
} from "./steps";

/** The gate's answer handler, as `MessageThread` calls it. */
type AnswerHandler = NonNullable<MessageThreadProps["onAnswerToolUse"]>;

/**
 * The demo's answer state. An approval (Approve, or Approve all) lands the
 * completed frame; a Deny leaves the gate waiting, as the demo has no denied
 * ending. `reset` returns to the waiting frame on a step change.
 */
export function useApprovalAnswer(): {
  readonly approved: boolean;
  readonly onAnswer: AnswerHandler;
  readonly reset: () => void;
} {
  const [approved, setApproved] = useState(false);
  const onAnswer: AnswerHandler = useCallback((_toolUseId, answer) => {
    if (answer !== "deny") setApproved(true);
  }, []);
  const reset = useCallback(() => setApproved(false), []);
  return { approved, onAnswer, reset };
}

export function ApprovalFlowPlayback() {
  const narrationManifest = useNarrationManifest("approval-flow-playback");
  const containerRef = useRef<HTMLDivElement>(null);
  const [cursorTarget, setCursorTarget] = useState<string | undefined>();
  const [stepIndex, setStepIndex] = useState(0);
  const { approved, onAnswer, reset } = useApprovalAnswer();

  const handleStepChange = useCallback(
    (_step: ApprovalFlowStep, index: number) => {
      setCursorTarget(undefined);
      setStepIndex(index);
      reset();
    },
    [reset],
  );

  useStepInteractions({
    stepIndex,
    narrationManifest,
    containerRef,
    setCursorTarget,
    steps: approvalFlowSteps,
  });

  return (
    <StigmerPreviewProvider>
      <StigmerDemoViewport containerRef={containerRef}>
        <ScenarioPlayer
          steps={approvalFlowSteps}
          narrationManifest={narrationManifest}
          onStepChange={handleStepChange}
        >
          {(step) => renderStep(step, approved, onAnswer)}
        </ScenarioPlayer>
        <Cursor target={cursorTarget} containerRef={containerRef} />
      </StigmerDemoViewport>
    </StigmerPreviewProvider>
  );
}

/** One step's frame: the waiting gate, or the completed turn once approved. */
export function renderStep(
  step: ApprovalFlowStep,
  approved: boolean,
  onAnswer: AnswerHandler,
) {
  switch (step.view) {
    case "composer-typing":
      return (
        <AppShell activeNav="new-session" contentKey="session">
          <ComposerView
            typingMessage={step.message}
            placeholder="Ask anything..."
          />
        </AppShell>
      );

    case "approval-pending": {
      if (approved) {
        return (
          <AppShell
            activeNav="new-session"
            contentKey="session"
            aside={renderWidgetsSidebar(completedConversation)}
          >
            <ComposerView conversation={completedConversation} />
          </AppShell>
        );
      }
      return (
        <AppShell
          activeNav="new-session"
          contentKey="session"
          aside={renderWidgetsSidebar(step.conversation)}
        >
          <ComposerView
            conversation={step.conversation}
            onAnswerToolUse={onAnswer}
          />
        </AppShell>
      );
    }

    case "conversation":
      return (
        <AppShell
          activeNav="new-session"
          contentKey="session"
          aside={renderWidgetsSidebar(step.conversation)}
        >
          <ComposerView conversation={step.conversation} />
        </AppShell>
      );
  }
}
