// A chat built from the hooks alone: no component of the React kit, only
// `@stigmer/react-core`, `@stigmer/client` and React. The guide
// "Build a chat from the hooks" (docs/sdk/react-core/build-a-chat.mdx)
// quotes it in runs, and the visual suite draws it (its `from-hooks` scene)
// over the docs' scripted server, so the guide's code is the code that
// draws on the page. The package's typecheck compiles it.
import { useState, type FormEvent, type ReactElement } from "react";
import type { Stigmer, ToolUse, Turn } from "@stigmer/client";
import { StigmerContext, useCreateRun, useSessionConversation } from "@stigmer/react-core";

// Plain controls, visible on any page: your design system goes here.
const CONTROL = { font: "inherit", color: "inherit", background: "transparent", border: "1px solid currentColor", borderRadius: 6, padding: "6px 12px" };

// ---- the client ----

interface ChatProps {
  client: Stigmer;
  /** The organization the conversation runs in. */
  org: string;
  /** The agent it talks to, as `org/slug`. */
  agent: string;
  /** A conversation to continue; omitted, the first message starts one. */
  sessionId?: string;
}

/** The chat, given a client, the organization it runs in and the agent it talks to. */
export function Chat({ client, ...props }: ChatProps): ReactElement {
  return (
    <StigmerContext.Provider value={client}>
      <Conversation {...props} />
    </StigmerContext.Provider>
  );
}

// ---- the conversation ----

function Conversation({ org, agent, sessionId: existing }: Omit<ChatProps, "client">): ReactElement {
  const [sessionId, setSessionId] = useState<string | null>(existing ?? null);
  const { create, isCreating } = useCreateRun();
  const conversation = useSessionConversation(sessionId, org);

  async function send(message: string): Promise<void> {
    if (sessionId !== null) {
      await conversation.sendFollowUp(message);
      return;
    }
    const [agentOrg, slug] = agent.split("/");
    const started = await create({ org, message, sessionSpec: { agentRef: { org: agentOrg ?? org, slug: slug ?? agent } } });
    setSessionId(started.sessionId);
  }

  return (
    <section aria-label="Conversation" style={{ display: "flex", flexDirection: "column", gap: 12, height: "100%" }}>
      <ol style={{ flex: 1, overflowY: "auto", listStyle: "none", margin: 0, padding: 0 }}>
        {conversation.turns.map((turn) => (
          <TurnView key={turn.runId} turn={turn} />
        ))}
      </ol>
      {conversation.asks.map((ask) => (
        <Ask key={ask.id} ask={ask} onAnswer={(answer) => conversation.answerToolUse(ask.id, answer)} />
      ))}
      <Composer
        busy={isCreating || conversation.isSending}
        canSend={sessionId === null || conversation.canSendFollowUp}
        onSend={send}
        onStop={conversation.isStoppable ? () => conversation.stop() : undefined}
      />
    </section>
  );
}

// ---- a turn ----

function TurnView({ turn }: { turn: Turn }): ReactElement {
  return (
    <li style={{ marginBottom: 16 }}>
      {turn.userMessage && <p style={{ fontWeight: 600 }}>{turn.userMessage.text}</p>}
      {turn.items.map((item) => {
        if (item.kind === "message") return <p key={item.id}>{item.text}</p>;
        if (item.kind === "tool_use") return <ToolLine key={item.id} tool={item} />;
        return null;
      })}
      {turn.status?.phase === "failed" && <p role="alert">The turn failed: {turn.status.error}</p>}
    </li>
  );
}

function ToolLine({ tool }: { tool: ToolUse }): ReactElement {
  const target = typeof tool.input.path === "string" ? tool.input.path : typeof tool.input.command === "string" ? tool.input.command : "";
  const done = tool.result !== undefined ? "done" : tool.state;
  return (
    <p style={{ fontFamily: "monospace", fontSize: 13, opacity: 0.8 }}>
      {tool.name} {target} · {done}
    </p>
  );
}

// ---- an ask ----

function Ask({ ask, onAnswer }: { ask: ToolUse; onAnswer: (answer: "allow" | "deny") => Promise<void> }): ReactElement {
  const command = typeof ask.input.command === "string" ? ask.input.command : ask.name;
  return (
    <div role="group" aria-label={`The agent asks to run ${command}`} style={{ border: "1px solid currentColor", borderRadius: 6, padding: 12 }}>
      <p>
        The agent asks to run <code>{command}</code>.
      </p>
      <button type="button" style={CONTROL} onClick={() => void onAnswer("allow")}>
        Allow
      </button>{" "}
      <button type="button" style={CONTROL} onClick={() => void onAnswer("deny")}>
        Deny
      </button>
    </div>
  );
}

// ---- the composer ----

function Composer({
  busy,
  canSend,
  onSend,
  onStop,
}: {
  busy: boolean;
  canSend: boolean;
  onSend: (message: string) => Promise<void>;
  onStop: (() => Promise<void>) | undefined;
}): ReactElement {
  const [text, setText] = useState("");

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    const message = text.trim();
    if (message === "") return;
    setText("");
    await onSend(message);
  }

  return (
    <form onSubmit={(event) => void submit(event)} style={{ display: "flex", gap: 8 }}>
      <textarea
        aria-label="Message"
        value={text}
        onChange={(event) => setText(event.target.value)}
        rows={2}
        style={{ ...CONTROL, flex: 1, resize: "vertical" }}
      />
      <button type="submit" style={CONTROL} disabled={busy || !canSend}>
        Send
      </button>
      {onStop && (
        <button type="button" style={CONTROL} onClick={() => void onStop()}>
          Stop
        </button>
      )}
    </form>
  );
}
