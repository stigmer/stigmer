---
name: stigmer-run
description: >
  Runs the person's Stigmer agents and reads what their runs did: runs an
  agent on a file in this project and hands back what it made, finds an
  agent's last run, saves a run's output files, says why a run failed,
  answers a run waiting for approval, sends a follow-up into the same
  conversation, and reads how a run was graded. Also how to check an
  agent before and after a change: scores, evals, and turning a bad
  conversation into a test. Use when the person says "run X on this
  file", "what did X find last time", "pull the report X made", "why did
  the run fail", "it's stuck waiting for approval", "ask it a follow-up",
  "how was it graded", "turn this into a test" or "make sure the new
  instructions aren't worse". For questions about Stigmer itself, use the
  stigmer skill; to set Stigmer up, the stigmer-setup skill.
---

# Running Stigmer agents and reading their runs

The person has agents on Stigmer and wants work done with them, or wants to
know what a run did. Work from what the run itself recorded: its record,
its events, the files it saved and its scores. Never answer from the agent's
definition, a guess, or a new run when they asked about an old one.

Every job below names the command line first, the path every edition and
every shell has, then the Stigmer tool that does the same where there is
one (the plugin's tools, when they are connected). Use either. Before a
flag you have not used in this session, check it with `stigmer <command>
--help`: the installed CLI wins for syntax. For anything the command line
and this skill don't settle, read the page named with the job
(`stigmer docs read <page>`) and cite it as a full
`https://stigmer.ai/docs/...` URL.

## The rules that hold for every job

- Reading runs, their events, their files and their scores is free: do it
  without asking.
- Starting a run spends the person's model tokens. Start one only when they
  asked for a run, never to answer a question about a run that already
  happened.
- A run's approval is the person's to give: answer `allow` or `allow-all`
  only when they said so, for that call. Cancelling a run can't be undone:
  propose it first.
- A key never passes through you or this chat. When a run failed on a key,
  say which key and where the person fixes it; they enter the new one
  themselves.
- Never put `--auto-approve` or `--approve-default allow` on a run the person
  did not ask to run unattended, and when you suggest either, say what it
  skips: every question the agent would have asked them.

## Run an agent on a file and hand back what it made

The person says "run invoice-checker on samples/march.csv and give me what it
made".

```bash
stigmer run invoice-checker --attach samples/march.csv -m "Check these invoices" --download outputs
```

- `--attach <path>` sends the file with the message (repeat it for more, at
  most 20); the agent finds it under `.stigmer/uploads/`. A folder given to
  `--attach` joins the conversation file by file.
- Off a terminal the command streams the turn and returns when it ends.
  `--download <dir>` saves what the turn made as it ends.
- Then read what it made and give the person the content itself, its
  findings in their words, not a description of where the file is. Read
  the saved file, or the run's outputs (below).

With the Stigmer tools: `run_agent` with `agent`, `message` and `files`
(paths in this project), then poll `get_run` until its phase is completed or
failed, then `get_run_outputs`. The tools take a project file only when the
tool server runs on this machine (`stigmer mcp-server`) and the file is
inside a folder you have open; when `run_agent` refuses a file, use the
command line above.

Docs: `cli/commands/run`, `concepts/files`.

## Find an agent's last run

"What did invoice-checker find last time?" is about a run that already
happened. Find it; don't start a new one.

```bash
stigmer list runs --agent invoice-checker --limit 5
```

It lists the agent's runs, newest first, across all its conversations, with
each run's id, phase and start. The first finished one is "the last run".
`stigmer get run <run-id>` reads one whole.

With the Stigmer tools: `list_runs` with `agent` (each run with its phase and
its error in one line), then `get_run` for one of them.

Docs: `cli/commands/list`, `concepts/sessions`.

## Read what a run made, and save it

A run's files are what its agent saved in its outputs folder (a report, a
CSV). To answer "what did it find", read the file and report what it says.

```bash
stigmer download run <run-id> --output-dir reports
```

It saves every file the run made into `reports/`, each at its place in the
outputs folder, and prints the paths. Then read the file you saved and quote
what the person asked for (its first line, the flagged rows). Say where the
file now is.

With the Stigmer tools: `get_run_outputs` with `run_id` returns each output's
path and, for text, its content (at most 512 KB a file). It never writes to
disk: to save the files, run the download command above.

The run's answer in the chat (what the agent said, not a file) is in
`stigmer runs logs <run-id>`, or `get_run`'s `turn.answer`.

Docs: `cli/commands/download`, `concepts/files`.

## Why a run failed

1. **Read the run first.** `stigmer runs logs <run-id>` prints its events,
   the error among them (a `session.error` line, in the provider's own
   words); `stigmer get run <run-id>` shows its record, whose
   `status.error` holds the failure. With the tools: `get_run`
   (`run.status.error`, and `turn.error`). Find the run with
   `stigmer list runs --agent <agent>` when the person has no id.
2. **Give the cause the run gives, in plain words, before any fix.** Quote
   the error's own words. Never guess a cause from the agent's
   instructions, its inputs or the person's plan when the run names
   another.
3. **Then the fix for that cause**, from the page that covers it.

The failures people meet most:

- **The model provider refused the call** ("credit balance is too low",
  "invalid x-api-key", "model not found", rate limits). The refusal is about
  the provider account behind the key the run used: the organization's own
  provider key in **Models & providers** (`stigmer provider-key list`), or,
  on Stigmer running on the person's own machine, the runner's key that
  `stigmer setup` saved. It is not the agent, its input or Stigmer's plan.
  The fix is in that provider account (add credit, fix billing, grant the
  model) or a replacement key the person enters themselves
  (`stigmer provider-key set anthropic` prompts for it), then the run again.
  Docs: `guides/integrations/model-provider-keys`.
- **A tool call was denied or never answered**: the run's events show the
  ask and the answer. See "A run waiting for approval".
- **Stopped by the platform** (terminated: stalled, or out of its tool-call
  budget): the error says which; a follow-up in the same conversation
  carries on.

Docs: `cli/commands/runs`, `cli/commands/logs`, `concepts/scores`.

## A run waiting for approval

A run that waits for approval is not stuck and does not time out: it waits
for a person's answer, as long as it takes.

- **See what it wants to do**: `stigmer runs logs <run-id>` shows the tool
  call it waits on and its `tool_use_id`. Or re-attach with
  `stigmer resume <session-id>`, which shows the ask and takes the answer.
  With the tools: `get_run`'s `turn.asks`.
- **Let it carry on, on the person's word**: `stigmer runs approve <run-id>`
  allows the one call it waits on. Name a call with `--tool-call <id>`;
  `--action deny --comment "<why>"` refuses it and the agent adapts;
  `--action allow-all` allows it and every waiting call of its kind for the
  rest of the turn. With the tools: `submit_run_approval`. The
  conversation's owner (who started it) answers, from the CLI, the console
  or the tools alike; someone it is only shared with cannot.
- **For a scripted run that must not park itself**: start it with
  `stigmer run <agent> --approve-default allow -m "<message>"` (or
  `allow-all`), which answers every ask without a person; unset, a run off
  a terminal denies each ask and carries on. `--auto-approve` approves every
  tool call before it asks. Say what either skips: the agent will act
  without asking anyone.

Docs: `concepts/approval-flows`, `cli/commands/runs`, `cli/commands/run`.

## A follow-up in the same conversation

A run is one turn of a conversation (a Session). A follow-up goes into that
same Session, where the agent sees everything said and done so far, so
nothing starts fresh. `stigmer run <agent>` again starts a new conversation.

- **From a terminal**: `stigmer resume <session-id>` opens the conversation,
  shows it, and takes the next message. The session id is on the run
  (`stigmer get run <run-id>` shows `spec.session_id`), in
  `stigmer list sessions`, or in the picker a bare `stigmer resume` opens;
  `stigmer resume "<words from its subject>"` searches. The id is given in
  full.
- **From a script or an agent, with no one typing**: `stigmer resume` is
  interactive and takes no message argument. Send the follow-up with the
  Stigmer tools' `run_agent` and its `session_id`, or with the SDK's
  `run.sendMessage`.
- `stigmer runs resume <run-id>` is something else: it continues a paused
  run.

Docs: `cli/commands/resume`, `concepts/sessions`.

## How a run was graded

```bash
stigmer runs scores <run-id>
```

It lists every score the run carries: the platform's run-health check, a
person's thumbs, an AI judge's verdict, and an eval's checks on one of its
tries, each with its verdict and reason. With the tools: `get_run_scores`.

- Report what the scores say and where you read them. When there is no
  judge score, say plainly the run was **not graded** by an AI judge (AI
  grading is off until someone turns it on for the agent), and give the
  reason the read gives; never grade it yourself in its place.
- To let the person judge the grade, read what the run made too (above) and
  put its findings beside the scores.
- How the agent does over many runs: `stigmer agent quality <agent>`.
- Never switch AI grading on, create a scoring rule or rate a run for the
  person unless they asked: grading spends their model tokens.

Docs: `concepts/scores`, `cli/commands/runs`, `cli/commands/agent`.

## Turn a bad conversation into a test

```bash
stigmer runs to-eval-case <run-id>
```

It writes a test case from the run under `evals/`: the request it answered,
the conversation before it, every answer an MCP tool gave the run as a mock
(so a failed call is replayed, never made again for real), and an `llm`
grader whose FAIL line names what went wrong. The person writes its PASS
line: only they know what a right reply holds. `--eval <eval>` adds the case
to an eval instead. Then run it on the agent:
`stigmer eval run --agent <agent> --eval <eval>`.

Docs: `guides/evals/test-with-evals`, `cli/commands/runs`.

## Check a change before shipping it

Evals are the way to know a new version of an agent (new instructions, a new
skill) is not worse than the one customers use now.

1. Write test cases in Claude Code's plugin-eval format, a folder per case
   with its request and graders, or turn real runs into cases (above), and
   push them as an eval: `stigmer push eval evals --name <eval>`.
2. Run the eval on the agent as it is now, as the baseline:
   `stigmer eval run --agent <agent> --eval <eval>`.
3. Change the agent (a new version), run the same eval again, and compare
   the two eval runs case by case; each is stamped with the agent's and the
   eval's version.

Eval tries are runs: they spend model tokens. Say so before running one.

Docs: `guides/evals/test-with-evals`, `cli/commands/eval`.
