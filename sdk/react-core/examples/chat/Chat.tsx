// A chat built from the hooks alone: no component of the React kit, only
// `@stigmer/react-core`, `@stigmer/client` and React. It draws everything a
// conversation shows: the agent's messages, thinking and notes, each step
// in the client's words, the agent's plan with each step under its item, a
// helper's work, the files a turn changed and made, the agent's asks, and
// calls of the app's own tools. The guide "Build a chat from the hooks"
// (docs/sdk/react-core/build-a-chat.mdx) quotes it in runs, the visual
// suite draws it (its `from-hooks` scenes), and its own tests render it
// (`__tests__/Chat.test.tsx`), so the guide's code is the code that draws on the page.
// The package's typecheck compiles it.
import { useState, type FormEvent, type ReactElement } from "react";
import type { File as StigmerFile } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";
import {
  defineCustomTool,
  failureWords,
  stepPhrase,
  turnSteps,
  type Stigmer,
  type Thread,
  type ToolUse,
  type Turn,
  type TurnItem,
} from "@stigmer/client";
import {
  StigmerContext,
  sessionFilesRefreshKey,
  useCreateRun,
  useSessionConversation,
  useSessionFiles,
  useStigmer,
  type UseSessionConversationReturn,
} from "@stigmer/react-core";

// Plain controls, visible on any page: your design system goes here.
const CONTROL = { font: "inherit", color: "inherit", background: "transparent", border: "1px solid currentColor", borderRadius: 6, padding: "6px 12px" };
const STEP = { fontSize: 13, opacity: 0.8, margin: "0 0 4px" };
const LIST = { listStyle: "none", margin: "4px 0 8px", paddingLeft: 14 };
const BOX = { border: "1px solid currentColor", borderRadius: 6, padding: 12 };

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

// ---- your app's tools ----

/** A tool of this app the agent may call; the chat answers it (below). */
const SHOW_PAGE = defineCustomTool({
  name: "show_page",
  description: "Open a page of this app for the person, such as their billing settings.",
  inputSchema: {
    type: "object",
    properties: { path: { type: "string", description: "The page's path in the app, such as /settings/billing." } },
    required: ["path"],
  },
});

// ---- the conversation ----

function Conversation({ org, agent, sessionId: existing }: Omit<ChatProps, "client">): ReactElement {
  const [sessionId, setSessionId] = useState<string | null>(existing ?? null);
  const { create, isCreating, error: startError } = useCreateRun();
  const conversation = useSessionConversation(sessionId, org);
  // The files the turns made, read again as each turn starts and ends.
  const files = useSessionFiles(org, sessionId, sessionFilesRefreshKey(conversation.runs));

  async function send(message: string): Promise<void> {
    if (sessionId !== null) {
      await conversation.sendFollowUp(message);
      return;
    }
    const [agentOrg, slug] = agent.split("/");
    const started = await create({
      org,
      message,
      sessionSpec: { agentRef: { org: agentOrg ?? org, slug: slug ?? agent }, customTools: [SHOW_PAGE] },
    });
    setSessionId(started.sessionId);
  }

  return (
    <section aria-label="Conversation" style={{ display: "flex", flexDirection: "column", gap: 12, height: "100%" }}>
      <ol style={{ flex: 1, overflowY: "auto", listStyle: "none", margin: 0, padding: 0 }}>
        {conversation.turns.map((turn) => (
          <TurnView key={turn.runId} turn={turn} made={files.outputsByRun.get(turn.runId) ?? []} onReview={conversation.reviewFileChanges} />
        ))}
      </ol>
      {conversation.asks.map((ask) => (
        <Ask key={ask.id} ask={ask} onAnswer={(answer) => conversation.answerToolUse(ask.id, answer)} />
      ))}
      {conversation.customToolUses.map((call) => (
        <AppToolCall
          key={call.id}
          call={call}
          error={conversation.customToolAnswerErrors.get(call.id)}
          onAnswer={(text, isError) => conversation.answerCustomToolUse(call.id, text, { isError })}
        />
      ))}
      {startError && <p role="alert">The conversation did not start: {startError.message}</p>}
      {conversation.sendError && (
        <p role="alert">
          “{conversation.pendingUserMessage}” was not sent: {conversation.sendError.message}{" "}
          <button type="button" style={CONTROL} onClick={conversation.retryLastSend}>
            Retry
          </button>
        </p>
      )}
      {conversation.answerError && <p role="alert">Your answer did not reach the agent: {conversation.answerError.message}</p>}
      {conversation.fileReviewError && <p role="alert">Your decision on a file did not reach the agent: {conversation.fileReviewError.message}</p>}
      {conversation.stopError && <p role="alert">The turn did not stop: {conversation.stopError.message}</p>}
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

function TurnView({ turn, made, onReview }: { turn: Turn; made: readonly StigmerFile[]; onReview: UseSessionConversationReturn["reviewFileChanges"] }): ReactElement {
  // The steps draw together, where the turn's first step happened.
  const firstStep = turn.items.findIndex((item) => item.kind === "tool_use");
  return (
    <li style={{ marginBottom: 16 }}>
      {turn.userMessage && <p style={{ fontWeight: 600 }}>{turn.userMessage.text}</p>}
      {turn.items.map((item, index) => {
        if (item.kind !== "tool_use") return <Item key={item.id} item={item} />;
        return index === firstStep ? <Steps key="steps" turn={turn} /> : null;
      })}
      <TurnFiles turn={turn} made={made} onReview={onReview} />
      {turn.status?.phase === "failed" && <p role="alert">The turn failed: {turn.status.error}</p>}
    </li>
  );
}

function Item({ item }: { item: Exclude<TurnItem, ToolUse> }): ReactElement {
  switch (item.kind) {
    case "message":
      return <p>{item.text}</p>;
    case "user_message":
      return <p style={{ fontWeight: 600 }}>{item.text}</p>;
    case "thinking":
      return (
        <details>
          <summary>Thinking</summary>
          <p>{item.text}</p>
        </details>
      );
    case "note":
      return <p style={STEP}>Note: {item.text}</p>;
    case "compacted":
      return <p style={STEP}>Earlier messages summarized</p>;
  }
}

// ---- steps ----

const TODO_STATUS = { pending: "to do", in_progress: "working", completed: "done", cancelled: "dropped" } as const;
const WAITS_FOR: Partial<Record<ToolUse["state"], string>> = { waiting: "waiting for your approval", waiting_on_host: "waiting for the app" };

/** The turn's steps: under the agent's plan when it keeps one, then the rest in order. */
function Steps({ turn }: { turn: Turn }): ReactElement {
  const { plan, loose } = turnSteps(turn);
  return (
    <>
      {plan.length > 0 && (
        <ol aria-label="Plan" style={{ margin: "4px 0 8px", paddingLeft: 22 }}>
          {plan.map(({ todo, calls }) => (
            <li key={todo.id}>
              {todo.content} · {TODO_STATUS[todo.status]}
              <StepList tools={calls} />
            </li>
          ))}
        </ol>
      )}
      <StepList tools={loose} />
    </>
  );
}

function StepList({ tools }: { tools: readonly ToolUse[] }): ReactElement | null {
  if (tools.length === 0) return null;
  return (
    <ul style={LIST}>
      {tools.map((tool) => (
        <Step key={tool.id} tool={tool} />
      ))}
    </ul>
  );
}

function Step({ tool }: { tool: ToolUse }): ReactElement {
  const phrase = stepPhrase(tool);
  const waits = WAITS_FOR[tool.state];
  const why = phrase.tense === "failed" && tool.result ? failureWords(tool.result.text) : "";
  return (
    <li style={STEP}>
      {phrase.text}
      {waits && ` · ${waits}`}
      {why && ` · ${why}`}
      {tool.thread && <Helper thread={tool.thread} />}
    </li>
  );
}

/** A helper the agent sent off: what it was asked, its own steps, and its reply. */
function Helper({ thread }: { thread: Thread }): ReactElement {
  const steps = thread.items.filter((item): item is ToolUse => item.kind === "tool_use");
  return (
    <div role="group" aria-label={`Helper: ${thread.agentName}`} style={{ margin: "4px 0", paddingLeft: 12, borderLeft: "1px solid currentColor" }}>
      <p style={{ margin: 0 }}>
        {thread.agentName}, asked: {thread.input}
      </p>
      <StepList tools={steps} />
      {thread.reply && <p style={{ margin: 0 }}>{thread.reply}</p>}
    </div>
  );
}

// ---- files ----

const DECIDED = { kept: "kept", undoing: "undoing", undone: "undone", undo_failed: "couldn't undo" } as const;
const CAPTION = { fontSize: 13, fontWeight: 600, margin: "8px 0 0" };

/** What the turn changed, kept or undone while undecided, and the files it made. */
function TurnFiles({ turn, made, onReview }: { turn: Turn; made: readonly StigmerFile[]; onReview: UseSessionConversationReturn["reviewFileChanges"] }): ReactElement {
  const changed = turn.fileReview.flatMap((set) => set.files.map((file) => ({ set, file })));
  return (
    <>
      {changed.length > 0 && <p aria-hidden style={CAPTION}>Files changed</p>}
      {changed.length > 0 && (
        <ul aria-label="Files changed" style={LIST}>
          {changed.map(({ set, file }) => (
            <li key={file.fileChangeId}>
              {file.path} · +{file.linesAdded} −{file.linesRemoved}{" "}
              {file.state === "undecided" ? (
                <>
                  <button type="button" style={CONTROL} aria-label={`Keep ${file.path}`} onClick={() => void onReview(set.changeSetId, "keep", { fileChangeId: file.fileChangeId, expectedDigest: file.digest })}>
                    Keep
                  </button>{" "}
                  <button type="button" style={CONTROL} aria-label={`Undo ${file.path}`} onClick={() => void onReview(set.changeSetId, "undo", { fileChangeId: file.fileChangeId, expectedDigest: file.digest })}>
                    Undo
                  </button>
                </>
              ) : (
                DECIDED[file.state]
              )}
            </li>
          ))}
        </ul>
      )}
      {made.length > 0 && <p aria-hidden style={CAPTION}>Files made</p>}
      {made.length > 0 && (
        <ul aria-label="Files made" style={LIST}>
          {made.map((file) => (
            <li key={file.metadata?.id}>
              <MadeFile file={file} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** A file the turn made, opened in a new tab through a short-lived link. */
function MadeFile({ file }: { file: StigmerFile }): ReactElement {
  const stigmer = useStigmer();
  const [error, setError] = useState<string | null>(null);

  async function open(): Promise<void> {
    try {
      const { url } = await stigmer.file.getDownloadUrl(file.metadata?.id ?? "");
      window.open(url, "_blank", "noopener");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  }

  return (
    <>
      <button type="button" style={CONTROL} onClick={() => void open()}>
        {file.spec?.filename}
      </button>
      {error && <span role="alert"> The file did not open: {error}</span>}
    </>
  );
}

// ---- an ask ----

function Ask({ ask, onAnswer }: { ask: ToolUse; onAnswer: (answer: "allow" | "deny") => Promise<void> }): ReactElement {
  const command = typeof ask.input.command === "string" ? ask.input.command : "";
  return (
    <div role="group" aria-label="The agent asks first" style={BOX}>
      <p>
        The agent asks first: {stepPhrase(ask).text}
        {command && (
          <>
            {" "}
            <code>{command}</code>
          </>
        )}
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

// ---- a call of your app's tool ----

function AppToolCall({ call, error, onAnswer }: { call: ToolUse; error: Error | undefined; onAnswer: (text: string, isError: boolean) => Promise<void> }): ReactElement {
  const asked = stepPhrase(call).text;
  // Do what the tool asks in your app (here, open call.input.path), then
  // answer: the agent reads the text as the tool's result.
  return (
    <div role="group" aria-label={`The agent asks your app: ${asked}`} style={BOX}>
      <p>
        The agent asks your app: <strong>{asked}</strong>
      </p>
      <pre style={{ fontSize: 13, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{JSON.stringify(call.input, null, 2)}</pre>
      <button type="button" style={CONTROL} onClick={() => void onAnswer("Done.", false)}>
        Done
      </button>{" "}
      <button type="button" style={CONTROL} onClick={() => void onAnswer("The app couldn't do it.", true)}>
        Can't
      </button>
      {error && <p role="alert">Your app's answer did not reach the agent: {error.message}</p>}
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
    // A message that fails to start a conversation stays in the box; a
    // follow-up that fails is kept by the hook, shown above with Retry.
    try {
      await onSend(message);
      setText("");
    } catch {
      // The error is shown above the composer.
    }
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
