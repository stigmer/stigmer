# @stigmer/ink-ui

Terminal components for [Stigmer](https://stigmer.ai), the open-source backend for the agents in your product. Add agent execution to your own command-line tool: send a message to an agent, show its work in the terminal as `stigmer run` does, answer its approvals with the keyboard, and get the outcome and an exit code back when the turn ends.

## Install

```bash
npm install @stigmer/ink-ui @stigmer/react-core @stigmer/client @stigmer/apis @bufbuild/protobuf ink react
```

`ink` 7, `react` 19, `@stigmer/react-core` (the conversation hooks, shared with your own code), `@stigmer/client` and `@stigmer/apis` are peers. The kit installs no browser package: no `react-dom`, no component library, no icons.

## Run an agent from your CLI

The whole integration, with a server from `stigmer up` and an agent named `release-checker`:

```ts title="run-agent.mts"
import { createNodeClient, runInTerminal } from "@stigmer/ink-ui";

const org = process.env.STIGMER_ORG ?? "stigmer";
const client = createNodeClient({
  baseUrl: process.env.STIGMER_BASE_URL ?? "http://localhost:7234",
  apiKey: process.env.STIGMER_API_KEY,
});
const outcome = await runInTerminal(client, {
  org,
  sessionSpec: { agentRef: { org, slug: "release-checker" } },
  message: process.argv.slice(2).join(" "),
});
process.exitCode = outcome.exitCode;
```

```bash
npx tsx run-agent.mts Check v2.3 is safe to ship
```

(`.mts` makes the file an ES module, which its top-level `await` needs, whatever your `package.json` says.) The agent's work streams in your terminal. When it asks to run a command, the prompt takes `y`, `a` or `n`. When the turn ends, `runInTerminal` returns its outcome (`phase`, `answer`, `structuredOutput`, `error`, the folded `turn`) and `exitCode`, and your program carries on.

- `until: "exit"` keeps the conversation open for follow-ups until the person leaves (Ctrl+C twice on an empty reply box), as `stigmer run` does.
- `signal` (an `AbortSignal`) stops waiting at once; the run goes on on the server, and the exit code is 130. The library installs no signal handlers: the process is yours.
- A turn that cannot start (no server, a refused key) is written to stderr for a person and rejects with a `TerminalRunError` whose `exitCode` says why.
- Pass `sessionId` instead of `sessionSpec` to send into a conversation you already have.

## Keys

On a terminal, the session takes the keys a person expects from a terminal agent:

| Key | What it does |
|-----|--------------|
| Enter | Send the message |
| `\` then Enter, Ctrl+J, Alt+Enter | Start a new line (Shift+Enter too, where the terminal reports it) |
| Up, Down | Move between the message's lines, then through earlier messages |
| Esc | Stop the agent's turn; a second Esc while it stops ends it now |
| Ctrl+C | Clear the message; on an empty one, it says the agent keeps working and how to come back, and a second press within two seconds leaves |
| Shift+Tab, Ctrl+T | Switch plan and agent mode |
| Ctrl+O | Expand tool calls and thinking |
| `?` | List the keys and your commands |

A paste over 800 characters or three lines shows as `[Pasted text #1 +42 lines]` and is sent whole. Leaving is not stopping: the agent works on the server, so pass `leaveHint` to say how to come back, such as `(id) => \`Come back with: mycli resume ${id}\``.

## Your own commands and completions

The kit ships the menus and no commands of its own: your CLI adds its `/` commands and its completions behind a trigger character.

```ts title="commands.mts"
import type { ComposerExtensions } from "@stigmer/ink-ui";

const tickets = ["TICKET-101 Flaky billing test", "TICKET-102 Rounding in credit notes"];

export const composer: ComposerExtensions = {
  commands: [
    {
      name: "deploy",
      description: "Ship the branch to an environment",
      args: "<environment>",
      run: (environment, session) => session.send(`Deploy this branch to ${environment || "staging"}.`),
    },
  ],
  completions: [
    {
      trigger: "@",
      complete: (query) =>
        tickets
          .filter((ticket) => ticket.toLowerCase().includes(query.toLowerCase()))
          .map((ticket) => ({ label: ticket, insert: `@${ticket.split(" ")[0]}` })),
    },
  ],
};
```

```bash
npx tsx commands.mts
```

Pass it as `runInTerminal(client, input, { until: "exit", composer })`, or to `SessionView`. A command's `session` can `send`, `stop`, `note` (a line in the thread that is not sent), `setMode` and `leave`. A completion item's `attach` (`workspaceFileRefs`, `fileIds`) rides along with the message it is sent in, so a mention can be a real reference. `history` keeps the prompts where you want them; by default they live in memory for the session. `stigmer run` is built this way: `/help`, `/mode`, `/stop`, `/exit`, `@` over the session's local folder, and a history file per directory.

## Exit codes

The same table as the `stigmer` CLI (`ExitCode`, `exitCodeOf`):

| Code | Meaning |
| --- | --- |
| 0 | The turn completed |
| 1 | It failed, was cancelled or was terminated (read `phase` to tell them apart) |
| 2 | Usage: the arguments were wrong |
| 3 | Cannot connect to the server |
| 4 | Not signed in, or not allowed |
| 5 | The session or agent was not found |
| 130 | Interrupted: Ctrl+C, or the host's `signal` |

## On a terminal and off one

`terminalMode` decides two things before anything renders. The screen is live when stdout is a terminal, `TERM` is not `dumb` and the process is not in CI. A person can answer when the screen is live and stdin is a terminal too.

Off a terminal (a pipe, a CI log), the view is read-only: nothing reads keys, Ink writes the final frame once when the turn ends, and each approval is settled by `approveDefault`. Unset, it is denied, as the `stigmer` CLI does, and the view says so. Pass `approveDefault: "approve"` only for an agent you trust to run unattended. A file review waits for a terminal.

## The bin, for any language

`stigmer-ink` is the same thing as one child process, for a host written in Go, Python, Rust or anything that can spawn one:

```text
stigmer-ink --agent acme/release-checker --message "Check v2.3 is safe to ship"
stigmer-ink --session ses_01j... --org acme --message "Go on"
stigmer-ink --session ses_01j... --org acme
```

It reads the key from `STIGMER_API_KEY` and the server from `STIGMER_BASE_URL` (default `http://localhost:7234`), and exits with the table above. `--api-key` works too, but every user of the machine can read a process's arguments. `stigmer-ink --help` lists the rest. [CLI integration](https://stigmer.ai/docs/sdk/ink/cli-integration) has a bridge in each language.

## What the session draws

- **History is written once.** What can no longer change goes into the terminal's own scrollback and is never redrawn: the person's message, each finished block of a reply, a tool group whose calls returned, a finished subagent. Only what is still changing redraws in place, so the screen never flickers and the scrollback above the session is never cleared, however long the turn.
- **Replies follow the window.** Markdown is drawn in weight alone (bold, italic, dim, underline), with no colour, so it reads on a light and a dark terminal. Inline code is bold, a code block sits behind a dim gutter, and a table's columns wrap inside themselves when the window is narrow. `renderMarkdown(text, width)` gives the same drawing as a string, for output outside Ink.
- **Resizing.** What is being written redraws at the new width. What is already in the scrollback keeps the width it was written at, because reflowing it would mean clearing the terminal. A terminal that rewraps lines (Terminal, iTerm2, kitty) can leave a stale copy of a long line that was still being written when the window narrowed.
- **Thinking** shows as one dim line, "✻ Thinking" while it streams and "✻ Thought" once done, with its first 80 characters; Ctrl+O shows all of it.
- **The working line**, just above the reply box, says what the turn is doing and for how long: "⠋ Running a command · 1m 12s". A completed turn leaves "✻ Worked for 1m 12s"; a failed or stopped one keeps its badge.

## Your colours

The kit draws Stigmer's look by default: black and white, with colour only for success, warnings and errors. Give it your brand by role:

```tsx
await runInTerminal(client, input, { theme: { accent: "magenta" } });

<InkStigmerProvider client={client} theme={{ accent: "#7c3aed", danger: "red" }}>
```

The roles are `accent` (prompts, the selected row, spinners), `muted`, `success`, `warning` and `danger`. Your own components read them with `useInkTheme()` or `useRoles()`.

If your colours differ between a light and a dark terminal, pass the theme as a function of the background:

```tsx
await runInTerminal(client, input, {
  theme: (background) => ({ accent: background === "light" ? "#5b21b6" : "#c4b5fd" }),
});
```

`runInTerminal` then asks the terminal for its background colour before it draws (an OSC 11 query, at most 100 ms, falling back to `COLORFGBG`). With your own provider, call `detectBackground()` first and pass its answer as `background`. A plain theme object asks nothing.

## Your own view

`runInTerminal` renders `SessionView`. To draw your own frame, compose the pieces: `InkStigmerProvider`, `SessionView` (`onTurnEnd`, `canAnswer`, `approveDefault`, `composer`, `leaveHint`), `MessageThread`, `WorkingLine`, `FollowUpInput`, `TextField`, `ApprovalPrompt`, `Markdown`, and the conversation hooks from `@stigmer/react-core` (`useSessionConversation`, `useSessionEvents`, `useSessionList`). The [Ink SDK guide](https://stigmer.ai/docs/sdk/ink) walks through it, and the [reference](https://stigmer.ai/docs/sdk/ink/reference) lists every export.

## Develop

```text
npm run typecheck -w @stigmer/ink-ui
npm run test -w @stigmer/ink-ui
npm run stigmer-ink -w @stigmer/ink-ui -- --help
```

The packed kit, its bin and the guide's bridges are run by `make smoke-terminal-kit` (`test/install/smoke-terminal-kit.mjs`).
