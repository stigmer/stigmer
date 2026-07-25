import { useEffect, useRef } from "react";
import { MessageThread, SessionComposer } from "@stigmer/react";
import type { ResourceRef } from "@stigmer/sdk";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { DEMO_CONTENT_ZOOM, DEMO_ORG, MOCK_WORKSPACE } from "./fixtures";
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
}

/**
 * The session surface used across demo scenarios, in one of two states:
 * an empty/typing `SessionComposer`, or a `MessageThread` of a completed
 * execution. Both are real `@stigmer/react` components; the wrapper only sizes
 * and zooms them to fit the demo shell.
 */
export function ComposerView({
  execution,
  showApprovals = false,
  typingMessage,
  agentRef,
  placeholder = "Describe your agent...",
}: ComposerViewProps) {
  if (execution) {
    return (
      <div className="composer">
        <div className="composer__thread" style={{ zoom: DEMO_CONTENT_ZOOM }}>
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
      <div className="composer__center-inner" style={{ zoom: DEMO_CONTENT_ZOOM }}>
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
 * Wraps `SessionComposer` and fills its textarea with `message` by setting the
 * native value and dispatching an `input` event — the standard way to drive a
 * controlled input that owns its own value. Purely visual: it makes the
 * composer look mid-typing for the tour.
 */
function TypingComposer({
  message,
  placeholder,
}: {
  readonly message: string;
  readonly placeholder: string;
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
        onAgentRefChange={noop}
        onMcpServerUsagesChange={noop}
        onSkillRefsChange={noop}
      />
    </div>
  );
}
