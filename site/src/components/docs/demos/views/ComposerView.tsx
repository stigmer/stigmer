"use client";

import { useEffect, useRef } from "react";
import { MessageThread, SessionComposer } from "@stigmer/react";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ApprovalAction } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { DEMO_ORG, MOCK_WORKSPACE } from "../fixtures";
import { DEMO_CONTENT_ZOOM } from "../shared/tokens";

const noop = () => {};

interface ComposerViewProps {
  /** When provided, renders the conversation via MessageThread. */
  execution?: AgentExecution;
  /**
   * When provided, programmatically fills the SessionComposer textarea
   * with this text (simulating user typing).
   */
  typingMessage?: string;
  /** Placeholder text for the SessionComposer textarea. */
  placeholder?: string;
  /** Agent reference chip shown in the composer. */
  agentRef?: { org: string; slug: string };
  /**
   * When provided, `MessageThread` renders `ApprovalCard` items for
   * pending approvals on the active execution. The callback receives
   * the tool call ID, the chosen action, and an optional comment.
   */
  onApprovalSubmit?: (
    toolCallId: string,
    action: ApprovalAction,
    comment?: string,
  ) => void;
}

/**
 * Session composer view used across demo scenarios.
 *
 * Handles three visual states driven by props:
 * 1. **Empty** — `SessionComposer` in its "ready" state
 * 2. **Typing** — `SessionComposer` with pre-filled text
 * 3. **Conversation** — `MessageThread` showing execution messages
 */
export function ComposerView({
  execution,
  typingMessage,
  placeholder = "Describe your skill...",
  agentRef,
  onApprovalSubmit,
}: ComposerViewProps) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-hidden">
        {execution ? (
          <div className="flex h-full flex-col" style={{ zoom: DEMO_CONTENT_ZOOM }}>
            <MessageThread
              executions={[execution]}
              className="max-h-[390px] px-3 py-2"
              onApprovalSubmit={onApprovalSubmit}
            />
          </div>
        ) : (
          <div className="flex h-full items-center justify-center p-4">
            <div className="w-full max-w-xl" style={{ zoom: DEMO_CONTENT_ZOOM }}>
              {typingMessage ? (
                <TypingComposer
                  message={typingMessage}
                  placeholder={placeholder}
                  agentRef={agentRef}
                />
              ) : (
                <SessionComposer
                  onSubmit={noop}
                  placeholder={placeholder}
                  autoFocus={false}
                  workspace={MOCK_WORKSPACE}
                  org={DEMO_ORG}
                  agentRef={agentRef}
                  onAgentRefChange={noop}
                  onMcpServerUsagesChange={noop}
                  onSkillRefsChange={noop}
                />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Wraps `SessionComposer` and programmatically fills the textarea with
 * the given message by setting the native value and dispatching an
 * `input` event. This is a standard React pattern for programmatically
 * updating controlled inputs that don't expose a `value` prop.
 */
function TypingComposer({
  message,
  placeholder,
  agentRef,
}: {
  readonly message: string;
  readonly placeholder: string;
  readonly agentRef?: { org: string; slug: string };
}) {
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
      <SessionComposer
        onSubmit={noop}
        placeholder={placeholder}
        autoFocus={false}
        workspace={MOCK_WORKSPACE}
        org={DEMO_ORG}
        agentRef={agentRef}
        onAgentRefChange={noop}
        onMcpServerUsagesChange={noop}
        onSkillRefsChange={noop}
      />
    </div>
  );
}
