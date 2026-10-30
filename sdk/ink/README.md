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

- `until: "exit"` keeps the conversation open for follow-ups until the person presses Ctrl+C, as `stigmer run` does.
- `signal` (an `AbortSignal`) stops waiting at once; the run goes on on the server, and the exit code is 130. The library installs no signal handlers: the process is yours.
- A turn that cannot start (no server, a refused key) is written to stderr for a person and rejects with a `TerminalRunError` whose `exitCode` says why.
- Pass `sessionId` instead of `sessionSpec` to send into a conversation you already have.

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

## Your colours

The kit draws Stigmer's look by default: black and white, with colour only for success, warnings and errors. Give it your brand by role:

```tsx
await runInTerminal(client, input, { theme: { accent: "magenta" } });

<InkStigmerProvider client={client} theme={{ accent: "#7c3aed", danger: "red" }}>
```

The roles are `accent` (prompts, the selected row, spinners), `muted`, `success`, `warning` and `danger`. Your own components read them with `useInkTheme()` or `useRoles()`.

## Your own view

`runInTerminal` renders `SessionView`. To draw your own frame, compose the pieces: `InkStigmerProvider`, `SessionView` (`onTurnEnd`, `canAnswer`, `approveDefault`), `MessageThread`, `ApprovalPrompt`, `RunProgress`, and the conversation hooks from `@stigmer/react-core` (`useSessionConversation`, `useSessionEvents`, `useSessionList`). The [Ink SDK guide](https://stigmer.ai/docs/sdk/ink) walks through it, and the [reference](https://stigmer.ai/docs/sdk/ink/reference) lists every export.

## Develop

```text
npm run typecheck -w @stigmer/ink-ui
npm run test -w @stigmer/ink-ui
npm run stigmer-ink -w @stigmer/ink-ui -- --help
```

The packed kit, its bin and the guide's bridges are run by `make smoke-terminal-kit` (`test/install/smoke-terminal-kit.mjs`).
