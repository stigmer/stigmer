# Host customization of the session viewer

A developer who embeds the session viewer (`SessionViewer`, `AgentChat`,
`NewSessionViewer`) wants it to feel like their own app. They shape it at the
level they need:

- **Add** to our layout: their own card when their tool runs, their own actions
  on a message.
- **Listen and answer**: the agent calls a tool the host's app answers, for
  example opening the host's own form beside the chat.
- **Swap** some of our parts for theirs: today's `threadSlots`.
- **Draw their own screen** from the conversation data: the public hooks
  (`useSessionConversation` and the file and output hooks), the headless layer.
- **Build on the TypeScript SDK** when they want everything their own.

This file is the contract for the first three: every part of the viewer and
whether a host may change it, the asks that justify each way to customize, each
mechanism's data contract, what stays fixed for every host, and where each
setting lives. `SKILL.md` names the decision ("Hosts customize through
mechanisms"); this file is its long form. A mechanism marked "designed" here is
the agreed shape for code not yet written; a change to it is a change to this
file first.

## The rules

1. **Evidence before a mechanism.** A new way to customize is built only with
   corpus rows from at least two kinds of source, at least one of them a real
   host's ask or the kit's own use ("a peer kit has it" is always available, so
   it never counts alone), or with a rule that treats every part alike (the
   row-kind table below). One asker alone gets a corpus row marked "asked once",
   not code.
2. **Mechanisms, not props.** An ask is answered by an existing mechanism before
   a new one is considered, and a new mechanism speaks an existing shape's
   words.
3. **Our extras use the host's mechanisms.** What the kit, the web console or
   the desktop app adds to the viewer goes through the same public mechanism a
   host uses, in the same place. Where it cannot (the run scores, below), the
   reason is written here.
4. **Some things are fixed for every host** (below). A host changes how a
   decision looks, never the decision.
5. **The default viewer's quality never drops.** A host that customizes nothing
   sees the viewer exactly as designed; a mechanism never adds a setting the
   default needs.

The skew test for every mechanism: does its evidence meet rule 1, does it lean
towards one asker, does it hand a host the raw log type, does it pin a part the
next redesign changes, and is there a smaller existing mechanism?

## A narrowed view, never the log type

A new mechanism hands a host a view the kit owns, with only the fields the
mechanism's evidence needs; never `ToolUse`, `Turn` or another log type. A view
field is a promise; a log field the kit did not choose to promise stays free to
change. Two older slots already pass `ToolUse` (`ApprovalCardProps.toolUse` in
`sdk/react/src/run/ApprovalCard.tsx`, `LivenessStatusLineProps.waitingOn` in
`sdk/react/src/run/LivenessStatusLine.tsx`); that is not undone and not
repeated. The headless layer keeps the full types on purpose (Headless first): a
host drawing its own screen gets everything.

## Every part and its decision

The thread draws twenty row kinds (`ThreadItem` in
`sdk/react/src/run/MessageThread.tsx`). Ten open to a host through eleven slot
components (`MessageThreadSlots`); the rest are closed, each for its reason. No
closed kind opens without corpus evidence.

| Part (row kind)                                                        | Today's seam                                                 | Decision                                                                                                                                    |
| ---------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `message`, `queued-message`                                            | `MessageEntry` slot                                          | Open. The slot also receives the answer flag and the host's drawn message actions (below).                                                  |
| `approval-request`                                                     | `ApprovalCard` slot                                          | Open for its look. What it shows and records is fixed.                                                                                      |
| `todos`                                                                | `TodoCard`, `TodoRow` slots                                  | Open. Replacing `TodoCard` switches off the plan layout a to-do turn draws; the docs say so.                                                |
| `plan-completion`, `plan-writing`                                      | `PlanFileCard`, `PlanCompletionCard`, `PlanStreamingCard`    | Open.                                                                                                                                       |
| `setup-progress`, `recalled-memories`, `execution-error`, `liveness`   | one slot each                                                | Open.                                                                                                                                       |
| `tool-group` (a tool call's row)                                       | `registerToolPresenter`, wording only                        | The row and its step line are closed. The **body** of a row for a named MCP tool or the host's own custom tool opens to a host's tool card. |
| a finished turn's kept card                                            | none (designed with tool cards)                              | Open by definition: it exists only to show a host's tool card after the answer.                                                             |
| `plan`, `how-it-got-there`, `subagent`                                 | none                                                         | Closed: the structure of a turn's work, which the viewer's redesigns change (stigmer/stigmer#3046).                                         |
| `outcome`                                                              | `turnOutcome`, on a hand-built `MessageThread` only          | Closed in the viewer: the record of what the turn made and changed.                                                                         |
| `turn-scores`                                                          | none                                                         | Kit-owned, beside the message actions (below).                                                                                              |
| `phase-badge`, `context-compacted`, `agent-version`, `loaded-versions` | none                                                         | Closed: the transcript's integrity (which version answered, what was dropped).                                                              |
| header                                                                 | `headerActions`, `accessSlot`, `nextStep` on `SessionViewer` | Unchanged. `AgentChat` does not forward them until a host asks.                                                                             |
| composer, links in the agent's text                                    | none                                                         | Not asked; corpus rows marked "not asked".                                                                                                  |

## The ask corpus

Each row: the ask, its kinds of source, the public trace, and what answers it.
Every real-host ask so far comes from hosts close to the maintainers; an outside
developer's ask joins this table when one comes.

| Row | Ask                                                       | Kinds of source                               | Public trace                                                                                                                                          | Answer                                                                                    |
| --- | --------------------------------------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| C1  | A host's own card when its own tool runs                  | real host; market                             | stigmer/stigmer#3379; assistant-ui tool UI, CopilotKit tool rendering                                                                                 | Tool cards (designed)                                                                     |
| C2  | The host's own actions on the agent's answer              | real host; kit's own use (run scores); market | stigmer/stigmer#3380; AI Elements message, assistant-ui thread                                                                                        | Message actions (designed)                                                                |
| C3  | A right-click menu on the answer                          | real host, once                               | inside stigmer/stigmer#3380                                                                                                                           | Asked once: the answer flag on the bubble slot lets a host wrap it; the kit draws no menu |
| C4  | The agent asks the host to open its own screens           | real host; market; modelled                   | stigmer/stigmer#973; Managed Agents custom tools, CopilotKit frontend tools, AI SDK tool usage; the integrate bank's `move-off-claude-managed-agents` | Custom tools (designed)                                                                   |
| C5  | The host's design system on thread parts                  | real host                                     | stigmer/stigmer#187                                                                                                                                   | Done: `threadSlots`                                                                       |
| C6  | The host's own recovery on the error notice               | real host                                     | stigmer/stigmer#351                                                                                                                                   | Done: the turn-ending wiring                                                              |
| C7  | Per-run credentials                                       | real host                                     | stigmer/stigmer#166                                                                                                                                   | Done, then removed (stigmer/stigmer#2026)                                                 |
| C8  | The approval prompt looks like the host's confirm dialog  | modelled                                      | the integrate bank's `chat-wears-our-brand`                                                                                                           | Already met: the `ApprovalCard` slot                                                      |
| C9  | Hear what the viewer does (a turn ended, a tool finished) | none                                          | none                                                                                                                                                  | Not asked; no mechanism                                                                   |
| C10 | Links, composer extras, opening the closed rows           | none                                          | none                                                                                                                                                  | Not asked                                                                                 |

The market, read 2026-11-21:

- Drawing a tool's call by name: assistant-ui (a provider-wide toolkit keyed by
  tool name, with a fallback; https://www.assistant-ui.com/docs/tools/tool-ui)
  and CopilotKit (`useRenderTool` by name, with a wildcard;
  https://docs.copilotkit.ai/generative-ui/tool-rendering). The AI SDK leaves it
  to the host's own code (https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-tool-usage).
  ChatKit has server-sent widgets only. No kit keys by MCP server.
- A tool the host answers: all four kits; assistant-ui and CopilotKit pair
  declaring a tool with drawing it in one object
  (https://docs.copilotkit.ai/frontend-tools); Managed Agents defines the wire
  (https://platform.claude.com/docs/en/managed-agents/tools).
- Message actions: AI Elements and assistant-ui by composing components
  (https://elements.ai-sdk.dev/components/message,
  https://www.assistant-ui.com/docs/ui/thread); ChatKit two flags, feedback and
  retry
  (https://openai.github.io/chatkit-js/api/openai/chatkit/type-aliases/threaditemactionsoption/);
  CopilotKit a toolbar slot
  (https://docs.copilotkit.ai/custom-look-and-feel/slots).

The modelled cases are the coding-agent plugin's integration bank
(`coding-agents/evals/integrate`).

## Tool cards (designed; stigmer/stigmer#3379; C1)

A host draws the body of its own tool's row.

- **Matched by the tool's one public name**: `mcp__<server>__<tool>` for an MCP
  tool (`mcpToolName` in `backend/services/runner/src/shared/mcp-tool-names.ts`;
  a plugin's server segment is `plugin_<plugin>_<server>`,
  `backend/libs/ts/plugin-package/src/tool-names.ts`), and the declared name for
  a custom tool. It is the name the agent's tool list, hooks and the console
  already show. The kit composes it from the call's server and bare tool, which
  every record carries; it never parses a name. Built-in tools (shell, edit,
  read and the rest) have no such name, stay the kit's, and keep the wording
  seam.
- **The card receives a narrowed view**, `ToolCallView`:

  ```ts
  interface ToolCallView {
    readonly id: string;
    readonly tool: string;
    readonly server: string; // "" for a custom tool
    readonly input: JsonObject; // model output: untrusted, shown, never acted on alone
    readonly state: ToolUseState; // running | waiting | completed | failed | denied | stopped
    readonly result:
      | { readonly text: string; readonly isError: boolean }
      | undefined;
    readonly sessionId: string;
    readonly runId: string;
    readonly answer?: (text: string) => Promise<void>; // custom tools only
  }
  ```

  It reuses the public `ToolUseState`, and leaves out grants, background
  commands, offloaded output, subagent threads and live output. A field joins
  only with evidence. The log records a call's input whole, so a card never sees
  partial input mid-stream.

- **The row stays ours.** The step line (mark, words, time) keeps its failed
  mark and words when the call failed: a failure is never hidden, and the card
  draws it in its own look from `state` and `result.isError`. While an approval
  waits, the approval card is the row (`sdk/react/src/run/ToolCallItem.tsx`);
  the host's card appears once it is answered. The card replaces only the body
  (`ToolCallDetail`, whose MCP case is `McpToolDetail`,
  `sdk/react/src/run/ToolCallDetail.tsx`), open by default. An error boundary
  falls back to our body when the card throws.
- **The slot law applies**: cards are module-level components in a map the host
  keeps stable, because the rows rely on `React.memo` (Reference stability is
  architectural).
- **A card is never folded away.** It is the host saying "the person should see
  this". While the turn works, the one fold test counts a carded call as one
  that stays in view, as it counts a failure. That test is copied today, in
  `sdk/react/src/run/MessageThread.tsx` (the whole stretch stays open) and in
  `sdk/react/src/run/PlanSteps.tsx` (the rail splits), and becomes one function
  before a carded call joins it, never a third copy. Once the turn finishes, the
  card is drawn once in the turn's lead, after the answer and its outcome, in
  time order, as the plan card is kept there; its step line stays inside "How it
  got there" with our body, so a to-do list's structure is never rewritten. One
  rule, no setting: a host that wants a call kept quiet registers no card for
  it.

## Message actions and the answer flag (designed; stigmer/stigmer#3380; C2, C3)

- **A per-viewer prop**, forwarded by `AgentChat`, in the words of the kit's
  existing data act (`DetailAction`, `sdk/react/src/resource-detail/types.ts`):

  ```ts
  messageActions?: (message: MessageView) => readonly MessageAction[];
  interface MessageView {
    readonly id: string;
    readonly role: "user" | "agent";
    readonly text: string;
    readonly isAnswer: boolean;
    readonly sessionId: string;
    readonly runId: string;
  }
  type MessageAction = Pick<
    DetailAction,
    "id" | "label" | "icon" | "onAction" | "disabled" | "variant"
  >;
  ```

  `requires` names a relation on a page's resource and a message has none;
  `shortcut` would let a host capture a key; `group` and `buttonVariant` place
  acts on a page, not in a quiet row. Thinking and notes get no actions, and
  neither do queued, pending or failed bubbles: they are not in the session's
  log yet, so an act would name a message that does not exist.

- **Drawn by us**, so the look and keyboard access stay ours: on an agent
  message in the quiet row after Copy, on a person's bubble in its floating
  cluster after Copy and Edit; up to two acts with an icon as quiet icon buttons
  whose label is their tooltip and accessible name; every other act in one "More
  actions" overflow, the public `ActionMenu` that `ResourceActionBar` uses
  (`sdk/react/src/resource-detail/ResourceActionBar.tsx`), reachable by Tab and
  arrows; no key shortcuts.
- **The bubble slot learns the answer**: `MessageEntryProps` gains `isAnswer`,
  and its `actions` carries the drawn actions, so a host that replaced the
  bubble keeps them and can wrap it for its own right-click.
- **The run scores** are a stateful control (thumbs with a comment, health,
  judge and eval chips, their popovers; `sdk/react/src/score/RunScores.tsx`)
  that a data act cannot express. They move out of the private `actions` node
  into the same list as a kit-owned entry, drawn first. Rule 3 reads "the same
  list and the same place" for them: opening a component form to hosts would put
  arbitrary components in the quiet row, which rule 5 protects.

**What "the answer" means.** `isAnswer` is true for at most one message per
turn: the message a completed turn closed on, by the rule the thread already
uses to lead with and score a turn (`closingMessageId` in
`sdk/react/src/run/MessageThread.tsx`). A completed Plan-mode turn has none: its
plan is a document, not an answer. It is false while the turn works, for a
stopped or failed turn, and for every message of a turn that ended on a step;
those messages still get the host's actions. A custom tool waiting on the host
is not an ending: the turn resumes after the answer. The viewer and the host
never disagree about which message is the answer.

## Custom tools: the host's side (designed; stigmer/stigmer#973; C4)

The host gives a session tools of its own, and answers them. The wire (the
session create request, the two events, each engine) is designed with the build;
this is what the host writes.

- **One definition, used twice**, as assistant-ui and CopilotKit pair declaring
  a tool with drawing it:

  ```tsx
  const showRegistration = defineCustomTool({
    name: "present_service_registration",
    description,
    inputSchema,
    Card,
  });
  <AgentChat
    customTools={[showRegistration]}
    onCustomToolUse={(call) => openPanel(call)}
  />;
  ```

  The schema part is declared on the session's create request through
  `AgentChat`, `NewSessionViewer` and the TypeScript SDK
  (`sessions.create({ customTools })`). `Card` is the tool card for the tool's
  own name: the viewer's definition first, then the provider's `toolCards` for
  that name, then ours. `SessionViewer` takes the same `customTools` to draw and
  answer a reopened session's calls.

- **Answering**: in the browser, `call.answer(text)`, at once or after the
  person acts; from the host's backend,
  `sessions.answerCustomToolUse(sessionId, callId, content)`. Who may answer
  follows the approval rule exactly: an observer, a guest and a participant may
  not (`onAnswerToolUse` in `sdk/react/src/session/SessionViewer.tsx`).
- **Listening**: `onCustomToolUse(call)` fires for each call that waits on the
  host, live or found waiting when a session opens, never for a call already
  answered on replay (the card draws that one as history). Two open tabs each
  hear it, so a handler must be idempotent.
- **Errors**: a call that fails its `inputSchema` never reaches the host; it
  returns to the agent as a tool error it can fix.
- **Runtime cost**: `defineCustomTool` is a runtime export. The light chat entry
  (`sdk/react/src/chat.ts`) has its own size budget
  (`test/bundle-budgets.json`), so it is measured before it lands there. Type
  exports cost nothing.

## Where each setting lives

| Setting                                                     | Home                                                                        | Why                                                                                                    |
| ----------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Tool cards                                                  | `StigmerProvider`: `toolCards`, a map from a tool's public name to its card | A tool looks the same everywhere in an app; the `loadMermaid` precedent (`sdk/react/src/provider.tsx`) |
| Custom tools (declare, draw, hear)                          | the viewer that creates or shows the session                                | They belong to the page and the session (stigmer/stigmer#973)                                          |
| Message actions                                             | the viewer (`SessionViewer`, `AgentChat`)                                   | They close over the host's routes; the `headerActions` precedent                                       |
| Tool wording (label, summary, disclosure, chrome, grouping) | `registerToolPresenter`, by kind, unchanged                                 | See below                                                                                              |

None adds a provider (One provider). `AgentChat` forwards a narrow set of the
viewer's props (`sdk/react/src/agent-chat/AgentChat.tsx`), so every new
per-viewer mechanism is forwarded explicitly.

## `threadSlots` and `registerToolPresenter`

- **`threadSlots`** stays as it is and covers the ten open row kinds. Its slot
  types are exported from the light chat entry too, so an `AgentChat` host types
  its slots without importing the root.
- **`registerToolPresenter`** is kept, unchanged, until a host asks for wording
  per kind: no provider copy, no deprecation. It is a published export
  (`sdk/react/src/headless.ts`) with no caller in this repository outside its
  tests and docs, and no corpus row asks for it; a tool card already replaces
  the body its `disclosure` and `chrome` tune. Its known flaw (a module-global
  map, so two viewers on one page cannot word a tool differently,
  `sdk/react/src/run/tool-presenter.ts`) has no asker either. Folding or
  retiring it is a later decision with evidence.

## What stays fixed, and why

A host changes how a decision looks, never the decision. Each line names what
holds it today.

| Fixed                                                                                 | Why                                                   | Held by                                                                                                                                             |
| ------------------------------------------------------------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| What an approval shows and records, Allow and Deny included                           | The person decides on what the agent will actually do | `sdk/react/src/run/__tests__/ApprovalCard.test.tsx`; the slot keeps the answer wiring (`sdk/react/src/run/__tests__/message-thread-slots.test.tsx`) |
| The order of events                                                                   | The transcript is the record of what happened         | the `buildThreadItems` suites in `sdk/react/src/run/__tests__`                                                                                      |
| The transcript and its export                                                         | What a reader exports is what the session recorded    | `sdk/react/src/session/__tests__/SessionViewer-transcriptExport.test.tsx`, `sdk/react/src/session/__tests__/useExportTranscript.test.tsx`           |
| Stop, always in reach while a turn can stop (KIT-08 in `test/ux-bar.json`)            | A person can always halt the agent                    | `sdk/react/src/session/__tests__/SessionViewer-sharedAccess.test.tsx`                                                                               |
| Keyboard and screen-reader access; no focus trap, no key taken from the host (KIT-11) | The viewer lives inside someone else's page           | `sdk/react/src/agent-chat/__tests__/agent-chat.a11y.browser.test.tsx`, `sdk/react/src/run/__tests__/a11y/tool-call-rows.a11y.browser.test.tsx`      |
| The closed rows above                                                                 | Each for its reason in the table                      | No test yet: a typed map of every row kind and a test that replaces every seam with a hostile host's parts are the planned guards                   |
