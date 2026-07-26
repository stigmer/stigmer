import { useEffect, useRef } from "react";
import {
  MessageThread,
  SessionComposer,
  type SessionComposerHandle,
} from "@stigmer/react";
import type { ResourceRef } from "@stigmer/sdk";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { DEMO_ORG, MOCK_WORKSPACE } from "./fixtures";
import "./ComposerView.css";

const noop = () => {};

interface ComposerViewProps {
  /** When set, renders the conversation via `MessageThread`. */
  readonly execution?: AgentExecution;
  /**
   * Render the execution's pending-approval gates inline on their tool rows.
   * `MessageThread` gates approval UI on the presence of an
   * `onApprovalSubmit` handler (`includeApprovals = onApprovalSubmit !=
   * null`) — but a playback has no decision to route, so the demo layer
   * names the *intent* and passes an inert handler to the SDK internally.
   * The depicted execution must carry `status.pendingApprovals` whose
   * `toolCallId` matches an inline tool call, or the gate falls through to
   * the bottom backstop card (which ticks an elapsed-time counter — a
   * DD-006 violation in a packed embed).
   */
  readonly showApprovals?: boolean;
  /**
   * When set, renders `SessionComposer` with its textarea pre-filled with this
   * text (simulating the user having typed a prompt).
   */
  readonly typingMessage?: string;
  /**
   * Pre-selected agent shown in the composer's toolbar trigger (e.g. the
   * Agent Creator a "new agent" flow opens with). Display-only in a demo —
   * selection callbacks are inert.
   */
  readonly agentRef?: ResourceRef | null;
  /** Placeholder for the `SessionComposer` textarea. */
  readonly placeholder?: string;
  /**
   * Heading rendered above the composer in the empty/typing state, as the
   * real `NewSessionViewer` does (e.g. "Add an Agent" in a draft session,
   * "What would you like to work on?" on the home screen).
   */
  readonly heading?: string;
}

/**
 * The session surface used across demo scenarios, in one of two states:
 * an empty/typing `SessionComposer`, or a `MessageThread` of a completed
 * execution. Both are real `@stigmer/react` components; the wrapper only
 * frames them at the real new-session pane's own geometry (`max-w-2xl`,
 * centered, heading above) — never zooms them (one scale factor per frame).
 */
export function ComposerView({
  execution,
  showApprovals = false,
  typingMessage,
  agentRef,
  placeholder = "Describe your agent...",
  heading,
}: ComposerViewProps) {
  if (execution) {
    return (
      <div className="composer">
        <div className="composer__thread">
          <MessageThread
            executions={[execution]}
            onApprovalSubmit={showApprovals ? noop : undefined}
            className="composer__message-thread"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="composer composer--center">
      <div className="composer__center-inner">
        {heading && <h1 className="composer__heading">{heading}</h1>}
        {typingMessage ? (
          <TypingComposer message={typingMessage} placeholder={placeholder} />
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
  );
}

/**
 * Renders `SessionComposer` looking mid-typing by seeding `message` through
 * the component's own public imperative handle
 * (`SessionComposerHandle.setMessage`) — the documented seam for setting the
 * composer's text from outside. State enters upstream through a supported
 * API (the DD-006 rule-7 shape, like `CreateApiKeyForm.initialName`), never
 * by dispatching synthetic DOM events at the textarea.
 */
function TypingComposer({
  message,
  placeholder,
}: {
  readonly message: string;
  readonly placeholder: string;
}) {
  const composerRef = useRef<SessionComposerHandle>(null);

  useEffect(() => {
    composerRef.current?.setMessage(message);
  }, [message]);

  return (
    <SessionComposer
      ref={composerRef}
      onSubmit={noop}
      placeholder={placeholder}
      autoFocus={false}
      workspace={MOCK_WORKSPACE}
      org={DEMO_ORG}
      onAgentRefChange={noop}
      onMcpServerUsagesChange={noop}
      onSkillRefsChange={noop}
    />
  );
}
