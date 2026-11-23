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

This file is the contract for the first three, and the data the fourth reads:
every part of the viewer and whether a host may change it, the asks that justify
each way to customize, each mechanism's data contract, what stays fixed for
every host, and where each setting lives. `SKILL.md` names the decision ("Hosts
customize through mechanisms"); this file is its long form. A mechanism marked
"built" is in the code. One marked "designed" is the agreed shape for code not
yet written, and a sentence about it in the present tense describes that design,
not today's code. A change to a design is a change to this file first.

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
mechanism's evidence needs; never `ToolUse`, `Turn`, `ThreadMessage` or another
log type, and never a log enum as its own word set. A view field is a promise; a
log field the kit did not choose to promise stays free to change.

The older seams already pass log types: `ApprovalCardProps.toolUse` and
`LivenessStatusLineProps.waitingOn` are `ToolUse`
(`sdk/react/src/run/ApprovalCard.tsx`,
`sdk/react/src/run/LivenessStatusLine.tsx`), `MessageEntryProps.message` is a
`ThreadMessage`, the to-do and memory slots take `Todo` and `MemoryRecall`, and
`turnOutcome` takes a `Turn` (`sdk/react/src/run/MessageThread.tsx`). That is
not undone and not repeated: what a new mechanism adds to an old seam (the
final-answer flag on the bubble slot, below) arrives as a view. The headless
layer keeps the full types on purpose (Headless first): a host drawing its own
screen gets everything.

## Every part and its decision

The thread draws twenty row kinds (`ThreadItem` in
`sdk/react/src/run/MessageThread.tsx`). Ten open to a host through eleven slot
components (`MessageThreadSlots`); the rest are closed, each for its reason. No
closed kind opens without corpus evidence.

The decisions are code: `sdk/react/src/run/row-kinds.ts` maps every kind to its
decision and reason, so a new kind fails to compile until it is decided, and a
new slot fails until an open kind claims it. A test
(`sdk/react/src/run/__tests__/row-kinds.test.ts`) fails when this table and the
map disagree.

| Part (row kind)                                                        | Today's seam                                                 | Decision                                                                                                                                                                                                                    |
| ---------------------------------------------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `message`, `queued-message`                                            | `MessageEntry` slot                                          | Open. The slot also receives the message's view and the host's message actions as data (below).                                                                                                                             |
| `approval-request`                                                     | `ApprovalCard` slot                                          | Open for its look, for an ask with no row of its own; an ask inside a tool's row is drawn by that row. What either shows and records is fixed.                                                                              |
| `todos`                                                                | `TodoCard`, `TodoRow` slots                                  | Open. Replacing either switches off the plan layout a to-do turn draws (the steps go back to time order); the docs say so.                                                                                                  |
| `plan-completion`, `plan-writing`                                      | `PlanFileCard`, `PlanCompletionCard`, `PlanStreamingCard`    | Open.                                                                                                                                                                                                                       |
| `setup-progress`, `recalled-memories`, `execution-error`, `liveness`   | one slot each                                                | Open.                                                                                                                                                                                                                       |
| `tool-group` (a tool call's row)                                       | `registerToolPresenter`, wording only                        | The row and its step line are closed. The **body** of a row for a named MCP tool or the host's own custom tool opens to a host's tool card.                                                                                 |
| `plan`, `how-it-got-there`, `subagent`                                 | none                                                         | Closed: the structure of a turn's work, which the viewer's redesigns change (stigmer/stigmer#3046).                                                                                                                         |
| `outcome`                                                              | `turnOutcome`, on a hand-built `MessageThread` only          | Closed in the viewer: the record of what the turn made and changed.                                                                                                                                                         |
| `turn-scores`                                                          | none                                                         | Kit-owned: the scores of a completed turn with no final answer (it ended on a step, or Stigmer stopped it), at its foot. A turn with one carries them in its final answer's row instead, beside the host's actions (below). |
| `phase-badge`, `context-compacted`, `agent-version`, `loaded-versions` | none                                                         | Closed: the transcript's integrity (which version answered, what was dropped).                                                                                                                                              |
| header                                                                 | `headerActions`, `accessSlot`, `nextStep` on `SessionViewer` | Unchanged. `AgentChat` does not forward them until a host asks.                                                                                                                                                             |
| composer, links in the agent's text                                    | none                                                         | Not asked; corpus rows marked "not asked".                                                                                                                                                                                  |

Tool cards add no row kind of their own: where a finished turn shows them is
presentation (below), so the redesigns stay free to move it.

## The ask corpus

Each row: the ask, its kinds of source, the public trace, and what answers it.
Every real-host ask so far comes from hosts close to the maintainers; an outside
developer's ask joins this table when one comes.

| Row | Ask                                                       | Kinds of source                                   | Public trace                                                                                                                                                                                                            | Answer                                                                                                                                   |
| --- | --------------------------------------------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | A host's own card when its own MCP tool runs              | real host; market                                 | stigmer/stigmer#3379 (where the ask came from is in its comments); assistant-ui tool UI, CopilotKit tool rendering                                                                                                      | Tool cards (built)                                                                                                                       |
| C2  | The host's own actions on a message, the answer above all | real host; market; the kit's own use (the scores) | stigmer/stigmer#3380 (its comments); AI Elements message, assistant-ui thread                                                                                                                                           | Message actions (built)                                                                                                                  |
| C3  | A right-click menu on the answer                          | real host, once                                   | inside stigmer/stigmer#3380                                                                                                                                                                                             | Asked once: no menu drawn by the kit; the bubble slot's data (for C2 and C5) lets a host build one                                       |
| C4  | The agent asks the host to open its own screens           | real host; market; modelled                       | stigmer/stigmer#973; Managed Agents custom tools, CopilotKit frontend tools, AI SDK tool usage; the integrate bank's `move-off-claude-managed-agents`                                                                   | Custom tools (built)                                                                                                                     |
| C5  | The host's design system on thread parts                  | real host                                         | stigmer/stigmer#187                                                                                                                                                                                                     | Done: `threadSlots`                                                                                                                      |
| C6  | The host's own recovery on the error notice               | real host                                         | stigmer/stigmer#351                                                                                                                                                                                                     | Done: the turn-ending wiring                                                                                                             |
| C7  | Per-run credentials                                       | real host                                         | stigmer/stigmer#166                                                                                                                                                                                                     | Done, then removed (stigmer/stigmer#2026)                                                                                                |
| C8  | The approval prompt looks like the host's confirm dialog  | modelled                                          | the integrate bank's `chat-wears-our-brand`                                                                                                                                                                             | Partly met: the `ApprovalCard` slot draws an ask with no row of its own, not one inside a tool's row. One kind of source, so no new seam |
| C9  | Hear what the viewer does (a turn ended, a tool finished) | none                                              | none                                                                                                                                                                                                                    | Not asked; no mechanism                                                                                                                  |
| C10 | Links, composer extras, opening the closed rows           | none                                              | none                                                                                                                                                                                                                    | Not asked                                                                                                                                |
| C11 | Draw the whole screen from the conversation data          | the kit's own use; market; modelled               | `sdk/ink` (the terminal kit draws its own screen from `@stigmer/react-core` alone); the AI SDK's hooks-only chat, assistant-ui's headless primitives; the integrate bank's `account-changes-approved-in-our-ops-screen` | The public hooks and the guide's program (below)                                                                                         |

The scores count as the kit's own use for C2 with a limit: they are a control a
data act cannot express, and they are hidden from the `endUser` and `guest`
audiences (`sdk/react/src/session/audience.ts`). C2 meets rule 1 on the real
host and the market; the scores decide only where the kit's own entry sits.

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

## Tool cards (built for MCP tools; stigmer/stigmer#3379; C1, C4)

A host draws the body of its own tool's row.

- **Matched by the tool's one public name**: `mcp__<server>__<tool>` for an MCP
  tool (`mcpToolName` in `backend/services/runner/src/shared/mcp-tool-names.ts`;
  a plugin's server segment is `plugin_<plugin>_<server>`,
  `backend/libs/ts/plugin-package/src/tool-names.ts`), and the declared name for
  a custom tool. It is the name the agent's tool list, hooks and the console
  already show. The kit composes it from the call's server slug and bare tool,
  which every record carries; it never parses a name (the client's
  `toolPublicName`, held equal to the runner's by
  `test/fixtures/tool-view/public-names.json`). Built-in tools (shell, edit,
  read and the rest), the memory attachment's tools and a server tool named like
  a built-in resolve to the kit's own kinds, have no such name, stay the kit's,
  and keep the wording seam. A custom tool's name joins with custom tools
  (below).
- **The card receives a narrowed view** and, for a custom tool's call a viewer
  may answer, the answer:

  ```ts
  type ToolCallState =
    | "running"
    | "needs-approval" // a person must allow it first
    | "waiting-on-host" // a custom tool's call, until the host answers
    | "completed"
    | "failed"
    | "denied"
    | "stopped";
  interface ToolCallInfo {
    readonly id: string;
    readonly tool: string;
    readonly server: string; // "" for a custom tool
    readonly input: JsonObject; // model output: untrusted, shown, never acted on alone
    readonly state: ToolCallState;
    readonly result:
      | {
          readonly text: string;
          readonly isError: boolean;
          readonly truncated: boolean;
        }
      | undefined;
    readonly sessionId: string;
    readonly runId: string;
  }
  interface ToolCardProps {
    readonly call: ToolCallInfo;
    readonly answer?: CustomToolAnswer; // a custom tool's waiting call, for a viewer who may answer
  }
  type CustomToolAnswer = (
    text: string,
    options?: { readonly isError?: boolean },
  ) => Promise<void>;
  ```

  The state set is the kit's own, mapped from the log's (`ToolUseState`, whose
  `waiting` means "asks a person"), so a new log state reaches a host only when
  the kit maps it. `truncated` is true when the log kept only the head of an
  offloaded output. The view leaves out grants, background commands, subagent
  threads and live output; a field joins only with evidence. The log records a
  call's input whole, so a card never sees partial input mid-stream.

- **The row stays ours.** The step line (mark, words, time) keeps its failed
  mark when the call failed, and a failure always draws the row as a card: a
  failure is never hidden, and the card draws it in its own look from `state`
  and `result.isError`. The tool presenter (`registerToolPresenter`) still words
  that step line in every state, its failure included; a blank or throwing label
  leaves the kit's words, so the row keeps its accessible name. While an
  approval waits for a viewer who answers it, the approval is the row
  (`sdk/react/src/run/ToolCallItem.tsx`) and the host's card appears once it is
  answered. For a viewer who cannot answer, the card draws with `needs-approval`
  under our line, which says whom it waits on; the card gets no way to answer,
  so the decision stays ours. The card replaces only the body (`ToolCallDetail`,
  whose MCP case is `McpToolDetail`, `sdk/react/src/run/ToolCallDetail.tsx`),
  open by default. An error boundary falls back to our body when the card
  throws.
- **Stable by the provider, module-level by the host.** The provider compares
  the `toolCards` map entry by entry, as it keeps the host's `loadMermaid`
  stable (`sdk/react/src/provider.tsx`), so a map literal does not re-render
  every row; the cards themselves are module-level components, because the rows
  rely on `React.memo` (Reference stability is architectural).
- **A call with a host card is never inside a closed region.** It is the host
  saying "the person should see this". Six places close a step, and each treats
  such a call as it treats a failure, from one shared test
  (`sdk/react/src/run/step-fold.ts` and `sdk/react/src/run/tool-card.tsx`),
  never a copy per place:
  - a working turn's quiet stretch folds into one line (`MessageThread.tsx`);
  - a plan's loose steps fold the same way (`PlanSteps.tsx`);
  - a to-do item's steps close once the item stops being live (`PlanSteps.tsx`,
    `useAutoDisclosure`), unless a step under it, its own or a helper's at any
    depth, has a card;
  - a helper's row closes when its call stops running: the thread draws a helper
    through `ToolCallItem`, whose helper body is flat; a host that draws
    `SubagentSection` itself gets its closing form
    (`sdk/react/src/run/SubagentSection.tsx`), held the same way;
  - a run of grouped calls folds into one chip
    (`sdk/react/src/run/segment-tool-calls.ts`, drawn by `ToolRunGroup`): a call
    with a host card is never grouped, whatever the presenter's `runGroupable`
    says;
  - a finished turn folds its working under "How it got there": the cards come
    out of the fold (below).

- **After the turn ends, each host card is visible once, in time order**,
  without opening anything. Where a finished turn shows it is presentation, not
  contract: today's design draws it after the answer and its outcome, with its
  step line left inside "How it got there" with our body, so a to-do list is
  never rewritten. One rule, no setting: a host that wants a call kept quiet
  registers no card for it.

## Message actions and the final answer (built; stigmer/stigmer#3380; C2, C3)

- **Why a new mechanism.** A `MessageEntry` slot that wraps the built-in bubble
  can already pass its own buttons as `actions` (`MessageEntryProps.actions`, a
  public `ReactNode`, `sdk/react/src/run/MessageEntry.tsx`). It is not enough:
  it puts arbitrary host components in the quiet row (rule 5), it drops the
  scores the thread fills that prop with, a person's bubble does not draw it,
  and the slot cannot know which message is the final answer, nor its run and
  session. The mechanism is that row's data form.
- **A per-viewer prop**, forwarded by `AgentChat`, in the words of the kit's
  existing data act (`DetailAction`, `sdk/react/src/resource-detail/types.ts`):

  ```ts
  messageActions?: (message: MessageInfo) => readonly MessageAction[];
  interface MessageInfo {
    readonly id: string;
    readonly role: "user" | "agent";
    readonly text: string;
    readonly isFinalAnswer: boolean;
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
  log yet, so an act would name a message that does not exist. Nor does a
  person's message before the session's events carry it (the thread draws it
  under a made-up id), an agent message still streaming (its text still
  changes), or a plan document (it has its own acts and no quiet row).

- **Drawn by us**, so the look and keyboard access stay ours: on an agent
  message in the quiet row after Copy, on a person's bubble in its floating
  cluster after Copy and Edit; up to two acts with an icon as quiet icon buttons
  whose label is their tooltip and accessible name; every other act in one "More
  actions" overflow, the public `ActionMenu` that `ResourceActionBar` uses
  (`sdk/react/src/resource-detail/ResourceActionBar.tsx`), reachable by Tab and
  arrows; no key shortcuts.
- **The bubble slot gets the data too.** `MessageEntryProps` gains the message's
  `MessageInfo` and its `MessageAction[]` as data (`messageInfo` and
  `messageActions`), beside the drawn `actions` node it has today. A host that
  replaced the bubble through the slots (C5) still serves C2, and can put the
  same acts in its own right-click menu (C3) without the kit drawing one.
- **The run scores** are a stateful control (thumbs with a comment, health,
  judge and eval chips, their popovers; `sdk/react/src/score/RunScores.tsx`)
  that a data act cannot express. They stay the kit's entry in the same row,
  drawn first, before the host's acts. Rule 3 reads "the same row and the same
  place" for them: opening a component form to hosts would put arbitrary
  components in the quiet row, which rule 5 protects.

**What "the final answer" means.** One function decides it, and the viewer's
lead, the scores' place and `isFinalAnswer` all read it. A turn's final answer
is its closing message (`closingMessageId` in
`sdk/react/src/run/MessageThread.tsx`) when the turn finished: completed, and
not by Stigmer's own stop, which ends a turn the agent had not finished
(`finishedTurn`, same file). A completed Plan-mode turn has none: its plan is a
document, not an answer. `isFinalAnswer` is false while the turn works, for a
stopped or failed turn, for a turn Stigmer stopped, and for every message of a
turn that ended on a step; those messages still get the host's actions. The
function is `finalAnswerId` (same file): the scores sit wherever the lead does,
so a turn Stigmer stopped carries them at its foot. A custom tool waiting on the
host is not an ending: the turn resumes after the answer.

## Custom tools: the host's side (built; stigmer/stigmer#973; C4)

The host gives a session tools of its own, and answers them. The wire, both
engines and the kit's side are built.

What is built, and where it lives:

- **Declared on the session.** `SessionSpec.custom_tools`
  (`apis/ai/stigmer/agentic/session/v1/spec.proto`), added to the agent's own
  tools as a session's `plugins` and `skill_refs` are. Managed Agents'
  `agent_with_overrides` was not taken: its `tools` replaces the agent's whole
  list. The server and the runner run one check
  (`backend/libs/ts/tool-vocabulary/src/custom-tools.ts`): names of letters,
  digits, `_` and `-`, at most 64, never a built-in's or `mcp__`; object
  schemas; at most 32 tools and 64 KB of schemas. The tools are fixed once a
  turn has run.
- **Two events, Managed Agents' own.** `agent.custom_tool_use` (the runner's)
  opens a gate and idles the session `requires_action`;
  `user.custom_tool_result` (the server's, from `answerCustomToolUse` or the
  Managed Agents send) closes it. The log's fold reads a waiting call as
  `waiting_on_host`, lists it in `Turn.customToolUses` apart from `asks`, and
  keeps `ToolUse.custom` after the answer
  (`backend/libs/ts/session-log/src/fold.ts`).
- **Each engine pauses as for an approval.** The turn ends, nothing is held, and
  a fresh run hands the model the host's answer as the call's result
  (`backend/services/runner/src/shared/custom-tools.ts`,
  `backend/services/runner/src/harness/custom-tool-answers.ts`). Claude reaches
  the tools through one more loopback server, `stigmer-host`, listed with the
  engine's own tools (the model sees `mcp__stigmer-host__<name>`); the Stigmer
  harness binds the bare name and pauses in its own middleware ahead of the
  approval gate (`backend/services/runner/src/middleware/custom-tools.ts`),
  since an `interrupt()` inside a tool body reaches the error hints. Every row,
  event and card carries the declared name. One contract states the behaviour
  for both engines
  (`backend/services/runner/src/__test-utils__/custom-tool-contract/contract.ts`).
- **Offered only where someone can answer.** Only the main agent, never a
  sub-agent; never on an unattended turn (a chat link's visitor, a channel, a
  schedule); whatever the agent's tool lists say.

The kit's side, built:

- **Declared once, drawn by name.** `defineCustomTool` declares a tool (its
  name, description and input schema; built in `@stigmer/client`,
  `sdk/typescript/src/custom-tools.ts`, and re-exported from the kit's root
  entry); its card, if any, is a tool card registered in the provider's
  `toolCards` under the same name, so a tool's look has one home:

  ```tsx
  const showRegistration = defineCustomTool({
    name: "present_service_registration",
    description,
    inputSchema,
  });
  <StigmerProvider
    client={client}
    toolCards={{ present_service_registration: RegistrationCard }}
  >
    <AgentChat
      customTools={[showRegistration]}
      onCustomToolUse={(call, answer) => openPanel(call, answer)}
    />
  </StigmerProvider>;
  ```

- **Declared where the session is created, heard where it is shown.**
  `customTools` is read once, when the session is created: on `AgentChat`,
  `NewSessionViewer` (through `useNewSessionFlow` and the run bootstrap spec,
  `sdk/react-core/src/run/useCreateRun.ts`) and `useCreateSession`; the
  TypeScript SDK declares them in the create request's own input. The tools are
  fixed once a turn has run. `SessionViewer` takes no `customTools`: a prop that
  carried a declaration and declared nothing would mislead. It takes
  `onCustomToolUse` only, and `AgentChat` forwards that to the viewer it shows.
- **Answering**: `answer(text, { isError? })` (`CustomToolAnswer`,
  `sdk/react/src/run/tool-cards-context.ts`), bound to the session and the call,
  the same for a card and the callback; `isError` tells the agent the tool
  failed or the person cancelled. It resolves when the server records the
  answer; the same answer again resolves, a different one rejects. It stays
  callable after the chat unmounts, for a host's panel that outlives it. From
  the host's backend, `stigmer.session.answerCustomToolUse` with
  `AnswerCustomToolUseInput`: text blocks and `is_error`. Only the session's
  owner answers (`can_edit`), so a backend answers with the person's own
  credential. Who may answer in the viewer follows the approval rule exactly: an
  observer, a guest and a participant may not (`onAnswerToolUse` and
  `onAnswerCustomToolUse` in `sdk/react/src/session/SessionViewer.tsx`). A card
  drawn for one who may not gets no `answer`. A host drawing its own screen
  answers with `useAnswerCustomToolUse`, or the conversation's bound
  `answerCustomToolUse` beside its `customToolUses`
  (`sdk/react-core/src/session/useSessionConversation.ts`).
- **A call nobody may answer** never exists: an unattended turn is offered no
  custom tools. A call nobody answers in an attended session waits, as an
  approval does, until someone stops the session.
- **Listening**: `onCustomToolUse(call, answer)` fires once for each call that
  waits on the host, per mounted viewer: live, or found waiting when a session
  opens, so a reopened conversation fires again for a call still waiting; never
  for a call already answered (the card draws that one as history), and never
  for a viewer that may not answer
  (`sdk/react/src/session/useCustomToolUseCallback.ts`). Two open tabs each hear
  it, so a handler must be idempotent. A handler that throws is reported once
  and the call still waits.
- **Without a card**, our row draws the call: "Waiting for the app", opening to
  the call's input, with no answer button. Every reader of an open call counts
  one waiting on the app (`awaitsAnswer` in
  `sdk/typescript/src/run/step-words.ts`).
- **Errors**: a call that fails its `inputSchema` never reaches the host; it
  returns to the agent as a tool error it can fix (both engines). A declared
  input property named like a secret (`password`, `token`, `secret`, `api_key`,
  `apikey`, `credentials`, `auth`, `authorization`) is refused at create, since
  its value would reach the host redacted
  (`backend/libs/ts/tool-vocabulary/src/custom-tools.ts`).
- **Runtime cost**: the light chat entry (`sdk/react/src/chat.ts`) exports the
  types only (`CustomToolAnswer`, `OnCustomToolUse`); a chat page imports
  `defineCustomTool` from `@stigmer/client`, as it imports the client itself, so
  that entry re-exports no client value. The root entry re-exports
  `defineCustomTool` beside `createRunnerAdapter`.

## Drawing your own screen

A host that draws no viewer of ours reads the conversation from the public hooks
in `@stigmer/react-core` and draws it in its own markup: a terminal, a native
app, or a page in its own design system (Headless first). The level's promise is
that every kind of thing a session shows is public data, in that one package,
with the client's own words for it where a host wants ours (`stepPhrase`,
`turnSteps`, `describeTurnEnding`). The guide "Build a chat from the hooks"
(`docs/sdk/react-core/build-a-chat.mdx`) draws all of it in one program,
`sdk/react-core/examples/chat/Chat.tsx`.

Our grouping of a turn into rows is not public: `buildThreadItems` and
`ThreadItem` stay internal, because the structure of a turn's work is what the
viewer's redesigns change (stigmer/stigmer#3046), and no host has asked for our
rows. What a host needs of our structure is public as a pure function: a turn's
plan with each step under its to-do item is `turnSteps`.

Where each row kind's data is public is code: `sdk/react/src/run/row-data.ts`
maps every kind to the fields and names it reads, so a new kind fails to compile
until it names where a host reads it, and a renamed field or export fails too.
Only one kind reads a name outside the core, the agent version's label
(`agentVersionLabel`, from the kit's headless layer); a test
(`sdk/react/src/run/__tests__/row-data.test.ts`) fails on any other, and when
this table and the map disagree.

| Part (row kind)                     | Where a host reads it                                                                                                                                                                                                               |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `message`                           | `useSessionConversation.turns`, `Turn.userMessage`, `Turn.items`, `Turn.answer`; a turn started with no message: `syntheticUserPrompt`                                                                                              |
| `queued-message`                    | `useSessionConversation.queued`, `useSessionConversation.pendingUserMessage`                                                                                                                                                        |
| `approval-request`                  | `Turn.asks`, `useSessionConversation.asks`, answered with `useSessionConversation.answerToolUse`; worded by `stepPhrase`                                                                                                            |
| `todos`                             | `Turn.todos`; each item with its steps: `turnSteps`                                                                                                                                                                                 |
| `plan-completion`                   | the plan file a plan turn made: `useSessionFiles` keyed by `sessionFilesRefreshKey`, beside `useSessionConversation.runs`                                                                                                           |
| `plan-writing`                      | `Turn.items` while a plan turn writes, `useSessionConversation.runs`                                                                                                                                                                |
| `setup-progress`                    | `useSessionConversation.activeTurn`, `useSessionConversation.activeRun`, `Turn.liveness`                                                                                                                                            |
| `recalled-memories`                 | `Turn.memory`, `useSessionConversation.runs`                                                                                                                                                                                        |
| `execution-error`                   | `Turn.status`, `Turn.errors`; worded by `describeTurnEnding`                                                                                                                                                                        |
| `liveness`                          | `Turn.liveness`, `useSessionConversation.stopBackgroundCommand`; worded by `describeTurnActivity`                                                                                                                                   |
| `tool-group`                        | `Turn.items`, `ToolUse.state`, `ToolUse.result`; the app's own tools: `useSessionConversation.customToolUses`, answered with `useSessionConversation.answerCustomToolUse`; worded by `stepPhrase`, `failureWords`, `toolPublicName` |
| `plan`                              | `Turn.todos`, `Turn.items`; `turnSteps`, `stepPhrase`                                                                                                                                                                               |
| `how-it-got-there`                  | `Turn.items`, `Turn.answer`; `stepPhrase`                                                                                                                                                                                           |
| `subagent`                          | `ToolUse.thread`; `stepPhrase`                                                                                                                                                                                                      |
| `outcome`                           | `Turn.fileReview`, decided with `useSessionConversation.reviewFileChanges`; `Turn.structuredOutput`; the files it made: `useSessionFiles` keyed by `sessionFilesRefreshKey`                                                         |
| `turn-scores`                       | None: the scores are a control a data view cannot express, hidden from end users and guests.                                                                                                                                        |
| `phase-badge`                       | `Turn.status`, `Turn.ended`                                                                                                                                                                                                         |
| `context-compacted`                 | `Turn.items`                                                                                                                                                                                                                        |
| `agent-version`                     | `useSessionConversation.runs`, labelled by `agentVersionLabel` (the kit's headless layer)                                                                                                                                           |
| `loaded-versions`                   | `useSessionConversation.runs`                                                                                                                                                                                                       |
| Every file the conversation made    | `useSessionOutputs` (one entry per output path, newest turn winning) over the files list                                                                                                                                            |
| Every file the conversation changed | `useSessionFileChanges` (one net change per path), its text by `useFileChangeContent`                                                                                                                                               |
| The conversation's state            | `useSessionConversation`: `activePhase`, `isStoppable` and `stop`, `sendFollowUp`, the errors                                                                                                                                       |

Who may answer is the server's rule, the same at every level: only the
conversation's owner answers an approval or a call of the app's own tool; a page
showing someone else's conversation draws both without their controls.

## Where each setting lives

| Setting                                                     | Home                                                                        | Why                                                                                                    |
| ----------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Tool cards, a custom tool's included                        | `StigmerProvider`: `toolCards`, a map from a tool's public name to its card | A tool looks the same everywhere in an app; the `loadMermaid` precedent (`sdk/react/src/provider.tsx`) |
| Custom tools (declare, hear, answer)                        | declared where the session is created; heard and answered by the viewer     | They belong to the page and the session (stigmer/stigmer#973)                                          |
| Message actions                                             | the viewer (`SessionViewer`, `AgentChat`)                                   | They close over the host's routes; the `headerActions` precedent                                       |
| Tool wording (label, summary, disclosure, chrome, grouping) | `registerToolPresenter`, by kind, unchanged                                 | See below                                                                                              |

None adds a provider (One provider). `AgentChat` forwards a narrow set of the
viewer's props (`sdk/react/src/agent-chat/AgentChat.tsx`), so every new
per-viewer mechanism is forwarded explicitly.

## `threadSlots` and `registerToolPresenter`

- **`threadSlots`** stays as it is and covers the ten open row kinds. Its slot
  types are exported only from the root entry today, so an `AgentChat` host who
  imports from the light chat entry cannot name the types `threadSlots` takes
  (Integration ergonomics); they are to be exported from that entry too.
- **`registerToolPresenter`** is kept, unchanged, until a host asks for wording
  per kind: no provider copy, no deprecation. It is a published export
  (`sdk/react/src/headless.ts`) with no caller in this repository outside its
  tests and docs, and no corpus row asks for it. Beside tool cards it keeps
  wording a call's step line; its `disclosure` and `chrome` do not apply to a
  host card's body, and its `runGroupable` never groups a call with a host card.
  Its known flaw (a module-global map, so two viewers on one page cannot word a
  tool differently, `sdk/react/src/run/tool-presenter.ts`) has no asker either.
  Folding or retiring it is a later decision with evidence.

## What stays fixed, and why

A host changes how a decision looks, never the decision. Each line names what
holds it.

| Fixed                                                                                     | Why                                                                     | Held by                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| What an approval shows and records, Allow and Deny included                               | The person decides on what the agent will actually do                   | The built-in card: `sdk/react/src/run/__tests__/ApprovalCard.test.tsx`; the slot keeps the answer wiring (`sdk/react/src/run/__tests__/message-thread-slots.test.tsx`). A replacing slot's drawing is the host's; the hostile-host test proves it still receives the decision's wiring and that an ask inside a tool's row, which no slot draws, always shows Allow and Deny (`sdk/react/src/run/__tests__/hostile-host.test.tsx`). |
| A host part that throws never takes the viewer down; the kit's part draws in its place    | A host's bug must not cost the person the decision, the failure or Stop | `sdk/react/src/run/__tests__/hostile-host.test.tsx` (every slot, card, message action and presenter override throwing), `sdk/react/src/session/__tests__/SessionViewer-hostileHost.test.tsx` (Stop), and by keyboard and axe in `sdk/react/src/run/__tests__/a11y/host-customization.a11y.browser.test.tsx`                                                                                                                         |
| The recorded order of events                                                              | The transcript is the record of what happened                           | The transcript export (below). A finished turn's answer-first lead is presentation over that order (`sdk/react/src/run/__tests__/buildThreadItems-answer.test.ts`), and host cards after a turn are presentation too.                                                                                                                                                                                                               |
| The transcript and its export                                                             | What a reader exports is what the session recorded                      | `sdk/react/src/session/__tests__/SessionViewer-transcriptExport.test.tsx`, `sdk/react/src/session/__tests__/useExportTranscript.test.tsx`                                                                                                                                                                                                                                                                                           |
| Stop, always in reach while a turn can stop (KIT-08 in `test/ux-bar.json`, still pending) | A person can always halt the agent                                      | Two cases so far: an owner's waiting turn (`sdk/react/src/session/__tests__/SessionViewer-sharedAccess.test.tsx`) and a working turn under a host whose every part throws (`sdk/react/src/session/__tests__/SessionViewer-hostileHost.test.tsx`)                                                                                                                                                                                    |
| Keyboard and screen-reader access; no focus trap, no key taken from the host (KIT-11)     | The viewer lives inside someone else's page                             | `sdk/react/src/agent-chat/__tests__/agent-chat.a11y.browser.test.tsx`; a thread under a throwing host in `sdk/react/src/run/__tests__/a11y/host-customization.a11y.browser.test.tsx`                                                                                                                                                                                                                                                |
| The closed rows above                                                                     | Each for its reason in the table                                        | The row-kind map (`sdk/react/src/run/row-kinds.ts`), which fails to compile on an undecided kind, and its test against this table                                                                                                                                                                                                                                                                                                   |

A part a host replaces whole and draws as nothing is the host drawing that part:
the kit cannot tell an empty drawing from a deliberate one. For the
`ApprovalCard` and `RunErrorNotice` slots that hides a decision or a failure,
which a host must not do; the docs say so.
