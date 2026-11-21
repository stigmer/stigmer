---
name: stigmer-operate
description: >
  Runs the person's own Stigmer server and administers their organization:
  docker run or Compose or the chart, their own Kubernetes, turning on login
  with Keycloak, Okta, Entra or Auth0, a runner on a bigger machine, tracing
  to Langfuse, upgrades and backups, who can use or edit which agent, a key
  for CI, service accounts, the access history for an auditor, and agent
  hours, plan limits and the model bill. Use when the person says "docker
  run or compose", "our own Kubernetes", "turn on login", "a runner on a
  separate machine", "nothing shows up in Langfuse", "upgrade", "back up",
  "only Priya can edit it", "a key for CI", "the auditor wants" or "how
  many hours have we used". To set Stigmer up in this project, use
  stigmer-setup; for their product's users' sign-in and their customers'
  keys, stigmer-integrate; for questions about how a piece works, the
  stigmer skill.
---

# Running their own Stigmer and administering their organization

The person operates Stigmer: on their own machines, or as the admin of
their organization on Stigmer Cloud. Your job is to say which piece of
Stigmer answers the question, read that piece's page, and answer or act the
way the page shows it, for the edition and shape they run. This skill is
the map and the method; the settings, commands and limits are on the pages
it names. Read the page before answering, cite it as a full
`https://stigmer.ai/docs/...` URL, and never write a setting, flag or
command the page doesn't show.

## First, three facts

Find these before you answer or write anything.

1. **Which server the CLI talks to, and what it is.** `stigmer auth whoami`
   names the server's version and edition on its `Server` line and, on a
   newer CLI, its address on `Endpoint`. On an older CLI,
   `stigmer config backend status` gives the address; there, `stigmer
   status` speaks only of a stack `stigmer up` runs on this machine.
2. **Which edition the person says they run.** When it isn't what the CLI
   reaches (they say "Stigmer Cloud", the CLI reaches a self-hosted or
   local open-source server), nothing the CLI reads is theirs: never report
   its hours, keys, members or history as their standing. Answer from the
   docs, and give them the command to run where they are signed in to
   their own.
3. **Which shape they run**, when it's their own server: the laptop
   (`stigmer up`), the single image (`docker run`), Docker Compose, or the
   Helm chart. Settings, upgrades and backups differ by shape, and each
   page has a tab or a section per shape.

## Which piece does what

Most wrong answers here invent a setting or a role. Pick the piece from
this table, then read its page.

| The person needs | The piece | Never | Page |
| --- | --- | --- | --- |
| Stigmer on their own machines | The single image for evaluation; Docker Compose for a team on one machine; the Helm chart on a cluster | the single image for a team's daily use; a Kubernetes operator or custom resources | https://stigmer.ai/docs/guides/self-hosting/overview |
| People signing in | Their own OIDC provider, set with the four `STIGMER_OIDC_` settings the page names | Stigmer's hosted login on their server; editing `docker-compose.yml` or the chart's templates | https://stigmer.ai/docs/guides/self-hosting/authentication |
| A machine calling Stigmer (CI, a script) | A service account's API key, with the smallest role | a person's key | https://stigmer.ai/docs/guides/authentication/service-accounts |
| Who may run or change what | The Organization's roles; one Agent's Editor on Enterprise and Cloud only | a per-Agent permission on open source; Viewers running Agents | https://stigmer.ai/docs/concepts/sharing-and-access |
| More room for the agents' work | The runner (one shared runner per stack), or a runner per Session through a provisioner | registering a runner; a second shared runner; a runner container on another host | https://stigmer.ai/docs/guides/self-hosting/runners, https://stigmer.ai/docs/concepts/runners |
| Runs in their tracing tool | The runner's `OTEL_` variables, the login from a Secret | a server setting; a chart value that turns it on | https://stigmer.ai/docs/guides/self-hosting/tracing |
| A newer release, a backup | The version pin, a backup first; back is a restore | downgrading; editing the chart | https://stigmer.ai/docs/guides/self-hosting/operations |
| Who gave whom access, and when | The access history and its export | calling it a log of everything people did | https://stigmer.ai/docs/guides/authentication/access-history |
| Hours used, the plan's limits | Agent hours against the plan's allowance | a model bill from Stigmer | https://stigmer.ai/docs/concepts/billing |

## Their own server

### Choose the shape

The single image (`docker run`) is for evaluation only, and the page says
why: it has no sign-in, so it trusts every caller and can't be given one,
and an upgrade ends runs in flight. A team on one machine runs the Docker Compose stack; a team with a
cluster runs the Helm chart. Page:
https://stigmer.ai/docs/guides/self-hosting/overview, then the shape's own
page (https://stigmer.ai/docs/guides/self-hosting/all-in-one,
https://stigmer.ai/docs/guides/self-hosting/docker-compose,
https://stigmer.ai/docs/guides/self-hosting/kubernetes).

- A fresh stack trusts every caller who can reach it: keep it private
  (`kubectl port-forward`, a private network) until sign-in is on, and say
  so before the steps.
- On Compose every setting is a line in `.env`; never edit
  `docker-compose.yml`. On the chart, settings go in the values file and
  keys in Secrets created before the install; the page names which.
- Never name a setting or Helm value the page doesn't show.

### Turn sign-in on

Register the clients in their provider (the console's, and the one for
installed apps so the CLI and desktop app sign in), set the issuer,
audience and client ids (in `.env`, or the chart's values), restart, sign
in, then make keys. Page:
https://stigmer.ai/docs/guides/self-hosting/authentication.

- Keys are made after sign-in is on: one made while the server trusted
  everyone is refused afterwards.
- The runner gets its own key (`STIGMER_TOKEN`, or the chart's Secret).
- Their CLI: add the server as a backend
  (`stigmer config backend add <name> --endpoint <host:port>`), use it, and
  `stigmer auth login` once the installed-apps client is registered.
- CI: a service account's key, kept as a CI secret the job reads as
  `STIGMER_API_KEY`. Never a person's key.

### More room for the agents' work

Tell the person first how a runner works, since it decides the answer: a
runner takes runs from a Temporal task queue; it is not a resource,
nothing registers it, and the server never picks or calls it. Then answer
each part from the self-hosting runner page:

- **The shared runner on another machine**: the page says why neither
  Compose nor the chart runs it there today (the server and the runner
  share file storage by disk), in "What the runner is given".
- **Several runners**: "One runner, one replica" says why the chart runs
  one, and that a second shared runner isn't something the guides teach.
- **Work off the server's machine**: "A runner per Session" is the
  mechanism (a sandbox provisioner), and says what the shipped stacks can't
  exercise of it yet.

The runner page is longer than one tool answer holds. When a read comes
back as a saved file you can't open, save the page and read it in parts:
`stigmer docs read guides/self-hosting/runners > "$TMPDIR/runners.md"`,
then read that file through to its end. Pages:
https://stigmer.ai/docs/guides/self-hosting/runners,
https://stigmer.ai/docs/concepts/runners.

- Present only what the page presents as working on their shape.

### Send runs to their tracing tool

Whatever release they name, have them confirm the one their server runs
with the tracing page's command for their shape (on the chart,
`helm list -n stigmer`, whose chart version is the Stigmer version), never
the CLI's own version, and say which releases have tracing, from the same
page. The variables go on the runner: on the chart in
`runner.extraEnv`, the login read from a Secret; on a laptop, in the shell
`stigmer up` starts from. Langfuse takes its OTLP address and a Basic-auth
header built from its public and secret keys. Page:
https://stigmer.ai/docs/guides/self-hosting/tracing.

- On Docker Compose the runner can't take these settings today; the page
  says so and links the issue. Never offer an edit to `docker-compose.yml`
  or an override file as the fix.
- Never state which release added something without reading it from the
  docs or the release notes.

### Upgrade and back up

A backup first, then the version pin moved (`STIGMER_VERSION` in `.env`,
or the chart's `--version`); the server migrates forward on start, and the
only way back is a restore. Page:
https://stigmer.ai/docs/guides/self-hosting/operations.

## Their organization

### Who may do what

The Organization's roles: **Member** starts conversations with the Agents
shared with them and changes only their own; **Viewer** sees and starts no
conversation; **Admin** manages every Agent, people and settings. Granting
**Editor** on one Agent is Enterprise and Cloud; open source grants roles
on the Organization only. Read the page and say which edition each step
needs. Page: https://stigmer.ai/docs/concepts/sharing-and-access.

- When their edition can't do what they asked, say so, and give the
  choices the page leaves (a wider role, or the edition that has it).

### A key for a job

A service account with the smallest role the job needs, and an API key
for that service account, saved to a file and kept as the job's secret.
Tell the person why that role: Member starts conversations with the
Agents shared with the Organization and changes none it didn't make; a
Viewer can't start a conversation; an Admin manages every Agent, so it
could change them. Pages:
https://stigmer.ai/docs/guides/authentication/service-accounts,
https://stigmer.ai/docs/cli/commands/service-account,
https://stigmer.ai/docs/cli/commands/apikey.

- Never a person's key (`stigmer apikey create` without
  `--service-account`), never `--scope` or `--permissions`: neither exists.

### The access history

Every time someone was given or lost a role, with who made the change and
when; not what people did with it. The page says who reads it, how to
export it as JSON Lines, how to filter one role since a date, where it
begins, and which plans read it. Page:
https://stigmer.ai/docs/guides/authentication/access-history.

- `stigmer access-history export` takes `--after` alone; filter its lines
  as the page shows.

### Usage and the bill

Agent hours against the plan's allowance, what happens at it, and where to
see both (`stigmer usage hours` on Stigmer Cloud, or **Settings >
Billing**). Model calls run on the Organization's own provider keys:
Stigmer never bills or prices them, so their spend is on their provider's
account. Page: https://stigmer.ai/docs/concepts/billing,
https://stigmer.ai/docs/cli/commands/usage.

- Say what happens at the allowance on their plan, in the page's words:
  Free pauses new work until the reset date the page names and bills
  nothing past it; a plan that prices hours bills them.
- Never give a model-spend figure from Stigmer.

### Their customers' sign-in and keys

Their product's users signing in without a Stigmer login, and each
customer's keys kept apart, are the stigmer-integrate skill's job: load
it.

## Acting for the person

When the person asks you to make the change, not only to explain it:

- A key, a role, someone's access, and anything that costs money follow
  the stigmer skill's safety rules: propose it first, naming what would be
  made or changed (the service account's name and role, which key), and
  act on their yes in this conversation.
- Make a service account's key with `--save-to-env <file>` so the key goes
  to the file the CLI names, never to this chat; say where it went and
  that the job reads it as `STIGMER_API_KEY` from its secret store.
- Read back what you made (`stigmer service-account list`,
  `stigmer service-account keys <name>`) and say what is left for them to
  do (the CI secret, a provider's client).
- An access job touches no Agent: never change, push or delete one while
  doing it.
