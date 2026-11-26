---
name: stigmer-setup
description: Sets up Stigmer for the project in front of you and keeps working with it. Stigmer runs AI agents for the users of the person's own app. Use when the person asks to set up Stigmer, to add an AI agent for their app's users, to put an agent's chat in their app, or to make, run, change or read Stigmer agents.
---

# Set up Stigmer for this project

Stigmer runs AI agents for the people who use this app: an agent takes a file a
user hands it (a ledger, a ticket export, a contract) and hands back the work.
You will take the person from nothing to their agent's chat inside their own
app, in this order. Each step ends with something they can see; tell them what
it is in one line.

Stigmer is in Beta. Say so once, at step 1, in these words, with the page:
"Stigmer is in Beta: things may change, and your work is kept. Tell us what
breaks." (https://stigmer.ai/docs/beta)

0. Find the command line
1. Where it runs, and signing in
2. What should your agent do for your users?
3. The model key
4. Watch it work
5. Make it yours
6. Put it in your app
7. Bring others in

## Rules for every step

- Use the person's own words for their product; call the people who use it
  "users".
- Ask before writing anything outside `stigmer/`, `stigmer-output/`,
  `.gitignore`, the stack's env file and the two files step 6 hands over.
- Never print, echo or ask for a key, and never put one on a command line. A
  key travels only through stdin or a file the CLI writes itself.
- Never make a second service account or overwrite an existing agent without
  asking.
- When a command fails, stop and say what failed in plain words, with the one
  next thing to do. The CLI's own message usually says it; quote it. When the
  server named a place to ask for help (a `Stuck? …` line), pass that line on
  too, so the person knows where to ask.
- Commands that wait on the person (`stigmer auth login`) can take minutes. Run
  them in the background where your tool allows it, or with the longest timeout
  it allows, and tell the person what will open.

## 0. Find the command line

Run `stigmer version`. If it is missing, ask the person, then install it with
`npm install -g @stigmer/cli` (or `brew install stigmer/tap/stigmer` on a Mac
with Homebrew).

## 1. Where it runs, and signing in

If the prompt named a Stigmer address, use it: `https://api.stigmer.ai` is
Stigmer Cloud; `localhost:7234` is this computer; any other is a server at its
own address. Otherwise ask: Stigmer Cloud, their own Stigmer server (its
address), or this computer.

Later steps send the person to pages of Stigmer's console, written here as
`<console>`. Its address is the console the prompt named ("its console is
…"); otherwise `https://app.stigmer.ai` on Stigmer Cloud,
`http://localhost:7234` on this computer, and the server's own address for a
server at its own address.

- **Stigmer Cloud**: `stigmer config backend set cloud`.
- **A server at its own address**: `stigmer config backend add <name> --endpoint <host:port>`
  (port 443 for https), then `stigmer config backend use <name>`.
- **This computer**: `stigmer up` (it starts Stigmer locally, with a console at
  http://localhost:7234). Nothing to sign in to: skip to choosing the
  organization below.

Then sign in: `stigmer auth login`. It prints an address and opens the browser;
the person signs in there. Where no browser can open (an SSH session, a remote
sandbox), run `stigmer auth login --device` and tell the person to open the
address it prints and enter the code. `stigmer auth whoami` says who they are
and which organization the CLI uses, and ends with a `Stuck? …` line when the
server names a place to ask for help: keep it for when something fails. If it says none is set and they belong to
several, ask which and run `stigmer config context set --org <slug>`.

## 2. What should your agent do for your users?

Read this repository first: the README, the routes and pages, the data models,
the nouns the code uses. Then run `stigmer example list` and suggest the
example that fits the app, saying why in one line ("Invoice match: your app
stores purchase orders and invoices"). If none fits, propose an agent of their
own from what the app does: a short name for its job (`ticket-triage`, not
`my-agent`), and instructions that say what file it takes and what it saves.

The person chooses. Then:

- **An example**: `stigmer example get <id>` writes its manifest and sample
  files into `stigmer/<id>/`.
- **Their own**: write the manifest into `stigmer/<slug>.yaml`, in this shape,
  and show it to them:

  ```yaml
  apiVersion: agentic.stigmer.ai/v1
  kind: Agent
  metadata:
    name: <slug>
  spec:
    description: <one line>
    instructions: |
      <what it reads, what it does, and the file it hands back: "Hand back the summary as a file named summary.md">
  ```

Make it with `stigmer apply -f <the manifest>`. Their agent is now a file in
their repository they can review and commit. If an agent with that slug already
exists, ask before applying over it.

## 3. The model key

Run `stigmer provider-key list`. If a provider is ready, this step is done.

If `ANTHROPIC_API_KEY` is set in your environment, pipe it to the CLI:
`printenv ANTHROPIC_API_KEY | stigmer provider-key set anthropic --key-stdin`
(on this computer, `printenv ANTHROPIC_API_KEY | stigmer setup --api-key-stdin`,
then `stigmer down` and `stigmer up`, so the runner takes the key).

Otherwise the person enters the key themselves, where you never see it. Never
ask them for it, and never suggest typing it, or a command that asks for it,
into this chat: what is typed here lands in your transcript. Ask the command
line where the key goes: `stigmer provider-key set anthropic < /dev/null`.
With nothing to read it asks for nothing and sends nothing, and says where:

- **The console**: it names the page, as `Add it in the console: …/models` or
  as the console's Models & providers page, which is `<console>/models`. Give
  the person that address, and open it for them with the system's opener (`open`
  on a Mac, `xdg-open` on Linux, `start` on Windows) when you can. They paste
  the key there, and the console checks it with the provider as they save it.
  Wait for them to say it is saved, then run `stigmer provider-key list` and go
  on when it reads "connected".
- **This computer**: it names `stigmer setup`. Ask the person to run
  `stigmer setup` in a terminal window of their own, outside this coding agent:
  it asks for the key at a hidden prompt. When they say it is done, run
  `stigmer down` and `stigmer up`, so the runner takes the key.
- **The runners**: it says "This server's runners use the keys whoever runs them gives them".
  The server keeps no keys. Say so, and who runs them. When
  `stigmer provider-key list` reads "not known", the server cannot see its
  runners' keys: go on to step 4, whose run shows whether a runner has one.

The key is checked with the provider. A key it rejects: quote the words the
person saw, and send them back to the same place.

## 4. Watch it work

Run the agent once on its sample, saving what it makes:

```bash
stigmer run <slug> -m "<the example's first message>" --attach <each sample> --download stigmer-output/
```

`stigmer example get` printed the exact command for an example. For their own
agent with no sample, write a small made-up one in the shape their app uses,
and say it is made up. Add `stigmer-output/` to `.gitignore`.

Then show the person what came back: name the file it saved by its path
(`stigmer-output/variance-report.md`), offer to open it with the system's
opener, read it, and say in one line what it shows.

## 5. Make it yours

Offer one change, and make it if they want it: sharper instructions in the
manifest, a run on one of their own files, or the ready-made Spreadsheet export
skill. For the skill, run `stigmer example get spreadsheet-export`, then
`stigmer push skill stigmer/skills/spreadsheet-export`, then add these lines to
the agent's manifest, under `spec:`:

```yaml
  skill_refs:
    - kind: skill
      slug: spreadsheet-export
```

Apply the manifest again and run again; its runs now also hand back a `.csv`.

## 6. Put it in your app

1. Find the app's stack: Next.js, a Node, Python, Go or Java backend. The chat
   is a React component.
2. **On Stigmer Cloud or their own server**, the app's backend signs its users
   in to Stigmer with an admin service account's key:
   - `stigmer service-account list`. If an admin account for the app exists
     (`app-backend`), use it; never make a second without asking. Otherwise
     `stigmer service-account create app-backend --role admin`.
   - Pick the stack's env file (`.env.local` for Next.js, `.env` otherwise) and
     check it is git-ignored (`git check-ignore <file>`); add it to
     `.gitignore` if not. Then
     `stigmer apikey create --service-account app-backend --name <the app's name> --save-to-env <that file>`.
     The CLI writes `STIGMER_API_KEY` into the file and prints only where it
     went.
   - `stigmer embedding set --create-accounts-on-sign-in on --sign-in-role member`,
     so a user's Stigmer account is made the first time the app signs them in.
3. `stigmer app-handover --stack <nextjs|node|python|go|java> --agent <slug> --write .`
   writes the token route and the chat component, and says what to install.
4. Fit them into the app:
   - In the route, replace `currentUser` with the app's own session read (its
     auth library's way to get the signed-in user's id, email and name).
   - Put `<StigmerAgentChat />` on the page where their users would use the
     agent, and install what the handover said.
   - Start the app, open that page, and tell the person where to look.
5. **On this computer** (`stigmer up`), the handover is the development chat
   alone, with no token: there is nobody to sign in. Say that going live means
   running the agent on Stigmer Cloud or a server that signs people in, and
   running this step again there.

## 7. Bring others in

The last step is the person's, in the console: send them to
`<console>/settings/bring-others-in` (`<console>` is from step 1). There
they name their organization (Stigmer Cloud named it from their email), then
copy an invite link for their team and send it in their own chat or email. The
team sees the same agent, its runs and the files it made. On this computer
(`stigmer up`) nobody else can reach Stigmer, so say that bringing others in
needs Stigmer Cloud or a server that signs people in.

## After setup

The same tools keep working: make agents with manifests and `stigmer apply`,
run them with `stigmer run`, and read runs with `stigmer list runs --agent <agent>` and
`stigmer get session <id>`.

Once setup is done, and only then, offer once to keep Stigmer in their coding
agent for next time: Stigmer's plugin carries this guide as a skill and
Stigmer's MCP server (`stigmer mcp-server`) for making, running and reading
agents as typed tools. It is not needed for what was just done, and they can
say no. If this guide came from the plugin already, skip the offer. The line
for the tool you are in:

- Claude Code: `claude plugin install stigmer --marketplace stigmer/coding-agent-plugin`
- Codex: `codex plugin marketplace add stigmer/coding-agent-plugin`, then
  `codex plugin add stigmer@stigmer`
- Cursor: `git clone https://github.com/stigmer/coding-agent-plugin ~/.cursor/plugins/local/stigmer`,
  then Reload Window

With it installed, next time they only say "Set up Stigmer for this project",
or ask for what they want ("add an agent that drafts replies to tickets").
