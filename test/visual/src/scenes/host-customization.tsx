// A host making the chat its own, in the session view's thread: the
// connected app's turn (the agent searches the issue tracker, files an issue
// and says so) with the host's own card for its "create issue" tool, and
// with the host's own actions on the answer. Both use only the public API:
// `toolCards` on the provider, `messageActions` on the thread.
import { MessageThread, type MessageAction, type MessageInfo, type ToolCardProps, type ToolCards } from "@stigmer/react-sdk";
import { conversationOf, stepStories } from "@stigmer/react-sdk/test";
import type { Drawing } from "./drawing.ts";

/** The host's card for the tracker's "create issue" tool, drawn in its own look from the kit's tokens. */
function IssueCard({ call }: ToolCardProps) {
  const title = typeof call.input["title"] === "string" ? call.input["title"] : "New issue";
  const team = typeof call.input["team"] === "string" ? call.input["team"] : "";
  const done = call.state === "completed" && call.result !== undefined;
  return (
    <section
      aria-label={`Issue: ${title}`}
      style={{
        border: "1px solid var(--stgm-border)",
        borderRadius: 8,
        background: "var(--stgm-card)",
        padding: "12px 14px",
        display: "grid",
        gap: 4,
        fontSize: 14,
        lineHeight: "20px",
      }}
    >
      <span style={{ color: "var(--stgm-muted-foreground)", fontSize: 12, lineHeight: "16px" }}>{done ? (call.result?.text ?? "") : "Filing…"}</span>
      <strong style={{ color: "var(--stgm-foreground)", fontWeight: 600, lineHeight: "20px" }}>{title}</strong>
      {team !== "" && <span style={{ color: "var(--stgm-muted-foreground)", fontSize: 12, lineHeight: "16px" }}>Team {team}</span>}
    </section>
  );
}

const TOOL_CARDS: ToolCards = { "mcp__issue-tracker__create_issue": IssueCard };

function glyph(text: string) {
  return <span aria-hidden="true">{text}</span>;
}

const ACTS: readonly MessageAction[] = [
  { id: "open", label: "Open in the tracker", icon: glyph("↗"), onAction: () => {} },
  { id: "assign", label: "Assign to me", icon: glyph("＋"), onAction: () => {} },
  { id: "link", label: "Copy the issue's link", onAction: () => {} },
  { id: "close", label: "Close the issue", variant: "destructive", onAction: () => {} },
];

function actionsFor(message: MessageInfo): readonly MessageAction[] {
  return message.isFinalAnswer ? ACTS : [];
}

/** The connected app's finished turn, with the host's card, its acts, or both. */
function hostThread(withCards: boolean, withActs: boolean): Drawing {
  const conversation = conversationOf(stepStories["mcp-turn"]);
  return {
    ...(withCards ? { toolCards: TOOL_CARDS } : {}),
    render: () => (
      <MessageThread
        turns={conversation.turns}
        runs={conversation.runs}
        sessionId="ses_gallery"
        contentColumn="center"
        {...(withActs ? { messageActions: actionsFor } : {})}
      />
    ),
  };
}

export const HOST_CUSTOMIZATION_DRAWINGS = {
  "host-tool-card": () => hostThread(true, false),
  "host-message-actions": () => hostThread(false, true),
} as const;
