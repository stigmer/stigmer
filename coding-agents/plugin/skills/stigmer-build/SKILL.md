---
name: stigmer-build
description: >
  Designs and changes the person's Stigmer agents and connects them to
  people: where a secret or a customer's password goes, an MCP server and
  which tools the agent may use, a tool that waits for a person's yes,
  packages and a locked network in its sandbox, their own skills and
  Claude Code plugin unchanged, a chat link, Slack (theirs or a
  customer's), WhatsApp and reminders, staff taking over, routines on a
  schedule or started by another system. Use when the person says "where
  does the password go", "hook up our MCP server", "only the read tools",
  "a refund must wait for a yes", "install tesseract in its sandbox",
  "reuse our Claude Code plugin", "customers want it in their own Slack",
  "a WhatsApp reminder", "every Monday at 9" or "start it when Airflow
  finishes", or asks what an agent uses before changing it. To set
  Stigmer up, use stigmer-setup; to run an agent, stigmer-run; to call it
  from their code or put the chat in their app, stigmer-integrate; for
  questions about Stigmer, the stigmer skill.
---

# Building a Stigmer agent and connecting it to people

The person has an agent, or wants one, and needs it set up for a job: the
keys it uses, its tools, where it asks first, what its sandbox has, and who
reaches it and when. Your job is to say which piece of Stigmer does each
part, read that piece's page, and answer or act the way the page shows it.
This skill is the map and the method; the fields, commands and rules are on
the pages it names. Read the page before answering, cite it as a full
`https://stigmer.ai/docs/...` URL, and never write a field, flag or command
the page doesn't show.

## First, two facts

Find these before you answer or write anything.

1. **Where Stigmer runs.** `stigmer auth whoami` names the server's version
   and edition and the Organization; `stigmer config backend status` its
   address. Slack, WhatsApp, staff taking over conversations and roles on
   one routine are Stigmer Cloud's (some also Enterprise's), and an
   Environment takes effect only where the server starts sandboxes. Say
   what needs Cloud before giving the steps; when you don't know the
   edition, say which editions have it.
2. **What already exists.** `stigmer get agent <agent> -o yaml` prints the
   live definition; the person's project may keep manifests (`stigmer/`
   or `*.yaml` with `kind: Agent`). A change starts from the live
   definition and keeps everything the person didn't ask to change.

## Which piece does what

Most wrong answers here invent a field. Pick the piece from this table,
then read its page.

| The person needs | The piece | Never | Page |
| --- | --- | --- | --- |
| A password, token or key the agent's tools use | A vault holds the value; the Agent declares the variable in `env` as a secret with no value | the instructions, a Skill, an Environment, a plain `value`, a message | https://stigmer.ai/docs/vaults, https://stigmer.ai/docs/agents |
| Each customer's own key under one name | A vault per customer, named on that customer's conversations, routines or channel; or an Organization per customer | one vault every customer's conversations use | https://stigmer.ai/docs/guides/authentication/customer-keys |
| Packages installed before work starts, and a locked-down network | An Environment (apt and pip packages, `networking`), the Agent's default or named per conversation or routine | install steps in the instructions or a Skill; keys in the Environment | https://stigmer.ai/docs/environments/set-up-an-environment, https://stigmer.ai/docs/environments |
| A tool that waits for a person's yes | The tool's mark (an MCP tool's `destructiveHint`) or a `PreToolUse` hook that asks | a field on the Agent, or telling the model to ask | https://stigmer.ai/docs/approval-flows |
| Their MCP server | A plugin holding it (`stigmer mcp add`), listed in the Agent's `plugins` | a token pasted into a header | https://stigmer.ai/docs/guides/integrations/connect-an-mcp-server |
| Only some tools | The Agent's `tools` and `disallowed_tools`, in the full tool-name form | bare tool names | https://stigmer.ai/docs/tools |
| Know-how written down | A Skill (`stigmer push skill`), listed in the Agent's `skill_refs` | pasting it into the instructions | https://stigmer.ai/docs/skills |
| A team's Claude Code, Cursor or Codex plugin | The folder, unchanged, as a plugin (`stigmer push plugin`), listed in the Agent's `plugins` | rewriting it; its Skills in `skill_refs` | https://stigmer.ai/docs/plugins, https://stigmer.ai/docs/plugins/install-a-plugin, https://stigmer.ai/docs/plugins/use-hooks |
| A schedule, or another system starting the agent | A Routine | their own cron or a polling script as the answer | https://stigmer.ai/docs/routines |
| People outside Stigmer chatting with it | A Channel: a chat link, the embed, Slack or WhatsApp | a home-made bot or inbox | https://stigmer.ai/docs/channels |

## Designing the agent

### Keep a secret out of the instructions

The Agent's `env` names the variable as a secret with no value; the value
lives in a vault and is found by its name when a run starts, so a shell
command the agent runs (psql, curl) reads it as an environment variable.
Pages: https://stigmer.ai/docs/vaults, https://stigmer.ai/docs/agents ("Where the secrets
come from"), https://stigmer.ai/docs/cli/commands/vault.

- One customer, one vault, the same variable name in each; the vault is
  named on that customer's conversations, routines or channel. In an
  Organization several customers share, a customer's vault never gets
  Organization visibility.
- An Agent carries no vaults: never invent a field for them on it.
- The value is saved by the person, never typed on a command line or
  pasted into the chat: `stigmer vault set-secret` asks for it, or reads it
  with `--from-env` from a variable they set. There is no `--value` flag.

### Attach an MCP server and limit its tools

`stigmer mcp add <name> <url>`, with a header naming a vault key
(`--header 'Authorization=Bearer ${NAME}'`), then list the plugin in the
Agent's `plugins`. Limit it in `tools`, in the form the page gives for that
route (`mcp__plugin_<plugin>_<server>__<tool>`; a hyphen in the name stays).
Page: https://stigmer.ai/docs/guides/integrations/connect-an-mcp-server.

- A parenthesised specifier never narrows a tool to some calls.

### Make a tool wait for a person's yes

Approval comes from the tool, not the Agent: their MCP server marks the
tool `destructiveHint: true`, or a `PreToolUse` hook asks before it; read
tools stay unmarked. The run then waits, durably, until someone allows or
denies the call. Page: https://stigmer.ai/docs/approval-flows.

- Never recommend approving every call (`auto_approve_all`, **Allow all**)
  as the setup.
- On Slack, WhatsApp or a chat link nobody can approve: a call that asks is
  skipped there, and the customer never sees a prompt.

### Packages and a locked-down network

An Environment lists apt and pip packages, installed before the first turn
of every fresh sandbox, and its `networking` limits the hosts. Make it the
Agent's default Environment, or name it per conversation or routine.
Pages: https://stigmer.ai/docs/environments/set-up-an-environment, https://stigmer.ai/docs/environments.

- Packages under limited networking need the package registries allowed
  too, and that opens them to the agent: say so, for the security team.
- An Environment holds no keys.

### Bring their own skills and plugin

A Claude Code, Cursor or Codex plugin folder works unchanged, its skills
and its `hooks.json` included: an Organization admin pushes it
(`stigmer push plugin <dir>`, or the console), and the Agent lists it in
`plugins`, which brings its Skills and hooks with it. A loose skill folder
is pushed the same way, by an admin (`stigmer push skill <dir>`), and
listed in `skill_refs`.
Pages: https://stigmer.ai/docs/plugins/install-a-plugin, https://stigmer.ai/docs/plugins/use-hooks.

- Only `PreToolUse` and `PostToolUse` command hooks run; the plugin's page
  lists the rest as not run. Hooks in the repository's `.claude/settings.json`
  never run for the Agent.
- A hook's paths are the sandbox's: a rule about `/reports` is written
  against `$CLAUDE_PROJECT_DIR`.

### See what an agent uses now

`stigmer get agent <agent> -o yaml`, then `stigmer get skill <skill> -o yaml`
for each skill it lists (or the `get_agent` and `get_skill` tools). Report
what you read from their Stigmer, not what the docs say an agent usually
has. When the person asked only to look, change nothing.

## Connecting it to people

### A chat link or the embed

`stigmer channel link <agent>` makes the hosted chat link (its audience is
the Organization's members unless they choose `--audience public`). The
chat inside their own app is the stigmer-integrate skill's job.
Pages: https://stigmer.ai/docs/channels/create-a-chat-link, https://stigmer.ai/docs/channels/embed-an-agent.

### Slack

An Organization admin adds a Slack channel on the Agent (**Add channel →
Slack**), which installs the bot into one workspace; the bot answers as
**Stigmer** unless they connect through their own Slack app. Each
customer's workspace gets its own channel on the Agent, with a vault of
that customer's keys; one app serves every workspace. The page says who
must finish a customer's install. Stigmer Cloud only.
Pages: https://stigmer.ai/docs/channels/connect-slack, https://stigmer.ai/docs/channels/bring-your-own-slack-app.

- There is no self-install link a customer opens alone, no Slack App
  Directory listing, and no CLI command that installs Slack.
- Tell the person why each customer's channel needs its own vault: a
  channel's conversations have no signed-in person, so its tools take keys
  only from the vaults attached to that channel, never anyone's own vault.

### WhatsApp, with reminders

Their own Meta app, registered in Stigmer, and a WhatsApp channel on the
Agent: replies first. For a reminder, tell the person both rules and why:
WhatsApp delivers free-form text only within 24 hours of the person's last
message, so a reminder is a template approved in WhatsApp Manager, sent
once the channel's proactive messaging is on; and the sweep is a scheduled
routine whose message finds who is due and sends the template, because a
routine's run may message anyone while a member's own conversation only
answers them. Stigmer Cloud only.
Pages: https://stigmer.ai/docs/channels/set-up-your-meta-app, https://stigmer.ai/docs/channels/connect-whatsapp,
https://stigmer.ai/docs/channels/send-proactive-messages-with-templates.

- Templates are written in Meta's tools, never in Stigmer.
- Meta bills templates, and replies past its free tier: the page says what
  the Meta account needs.

### Staff take over a conversation

In the console's **Conversations**, a person with **Participant** on the
channel takes a conversation over, replies through the same number, and
hands it back. WhatsApp only today; on Slack staff read, and only the
Agent replies. Page: https://stigmer.ai/docs/channels/take-over-conversations.

### A routine on a schedule

A `kind: Routine` manifest (or the console's **New routine**): the Agent,
the message every run starts from, a `cron` and its `time_zone`, the vaults
its tools need (no one is signed in when it runs) and, if it needs one, an
Environment. Applied with `stigmer apply -f <file>`: `stigmer routine`
has no command that creates one. Page: https://stigmer.ai/docs/routines/run-an-agent-on-a-schedule.

- A routine is created off. Turning it on, or **Enable & run now**, starts
  runs that spend the Organization's model keys: ask first, and leave it
  off unless the person said to turn it on.
- What a run makes is a File of the run, downloaded from the conversation
  or with `stigmer download run`; Stigmer doesn't email it.

### A routine another system starts

A routine with no `cron`, whose message tells the Agent to use the note;
the other system sends one HTTP call with the routine's id and a note,
using a service account's key kept in its secret store. Every run acts as
the routine's owner, never the caller: to keep it off a person's login, the
service account creates and owns the routine. Pages:
https://stigmer.ai/docs/routines/start-a-routine-from-another-system, https://stigmer.ai/docs/routines.

- The request takes the routine's `id` and the note's `text`, nothing else;
  there is no per-routine webhook URL.
- A note can tell the Agent what happened; it can't change what the routine
  asks.

## Acting for the person

When the person asks you to make the change, not only to explain it:

- Write it as a manifest in their project (next to the ones they keep) and
  apply it with `stigmer apply -f <file>`. For an Agent that already
  exists, start from `stigmer get agent <agent> -o yaml`, change only what
  they asked, show the change, and say it replaces the live version before
  applying it. `stigmer apply -f <file> --dry-run` checks the file's
  shape on this machine only; the server may still refuse what it can't
  serve (an Environment's packages where its sandboxes can't install
  them). Say what it refused, in its words, and never drop part of the
  ask to get past it.
- A secret is saved by the person (`stigmer vault set-secret`, which asks
  for it) or from a variable they set (`--from-env`); its value never
  appears in this chat or in a file you write.
- Turning on a routine or a channel spends the Organization's model keys:
  propose it, and act on their yes.
- Read back what you made (`stigmer get routine <routine>`,
  `stigmer get environment <environment>`, `stigmer get agent <agent>`)
  and tell them which files you wrote and what is left for them to do (a
  Slack install, a Meta app, a template's approval).
