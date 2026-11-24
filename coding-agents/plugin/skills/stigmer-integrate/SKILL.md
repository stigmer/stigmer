---
name: stigmer-integrate
description: >
  Puts the person's Stigmer agent into their own product: calls it from
  their backend (TypeScript, Python, Go or Java), streams its reply to
  their page, puts the chat in their React app with their own look, cards
  and tools, signs their users in (their own sign-in, Auth0, Okta, Clerk),
  decides whose conversation a run becomes, walls each business customer
  off in an organization of its own, answers approvals in their own
  screens, and moves code off Claude Managed Agents. Use when the person
  says "call our agent from our backend", "when a customer uploads X, run
  the agent on it", "stream the reply to the page", "make the chat look
  and act like ours", "show our own card when our tool runs", "let the
  agent open our screens", "our users are signed in with Auth0", "each
  customer must be separate", "approve in our own dashboard" or "we're on
  Claude Managed Agents". To set Stigmer up, use the stigmer-setup skill;
  to run an agent or read its runs, the stigmer-run skill; for questions
  about Stigmer, the stigmer skill.
---

# Putting a Stigmer agent in the person's product

The person has an app with its own users and wants a Stigmer agent working
inside it. Your job is the integration: the code in their repository that
calls Stigmer, in their language, the way the docs show it. This skill is
the map and the method; the calls themselves are on the docs pages it names,
with a tab per language. Read the page for their stack before writing a
line, cite it as a full `https://stigmer.ai/docs/...` URL, and write the
code the page shows, never an API you expect to exist.

## First, three facts about their app

Find these before you answer or write anything. Each one changes the code.

1. **The stack.** Read the repository: `package.json` (Next.js, Express,
   React), `pyproject.toml` or `requirements.txt` (FastAPI, Django),
   `go.mod`, `pom.xml` or `build.gradle`. The backend's language picks the
   SDK; the frontend's picks the chat (the chat is React).
2. **Where Stigmer runs**: Stigmer Cloud, their own server, or `stigmer up`
   on this machine. `stigmer auth whoami` names the server's version and
   edition, the Organization and, on a newer CLI, the address (`Endpoint`);
   on an older CLI, `stigmer config backend status` gives the address. The
   app's backend talks to that same server and Organization: put that
   address in its settings (an `http://` or loopback address takes the
   SDK's plaintext option), never a guessed `localhost:7234`, and never
   start a server (`stigmer up`) to make the app work. On an older CLI,
   `stigmer status` reports only a stack `stigmer up` runs on this machine:
   "not running" there says nothing about the server the CLI is signed in
   to. Federation and child organizations are served by Stigmer Cloud and
   the Enterprise edition, not by the open-source server: never recommend
   either before you know which they run, and when you don't, say which
   editions have it.
3. **How their users sign in**: their own sessions, or an OIDC provider
   (Auth0, Okta, Entra ID, Cognito). Read their auth code to find how a
   request names the signed-in user.

Then check what their installed SDK has before you write against it:
`npm ls @stigmer/client @stigmer/react-sdk`, `pip show stigmer-sdk`, the `go.stigmer.ai/sdk`
line in `go.mod`, the `stigmer-sdk` dependency in their build file. The
docs follow Stigmer's newest code: when a page shows something their
installed SDK lacks, say it is newer than their version and that upgrading
brings it.

## Whose run is it

Decide this before any backend code: every job below rests on it.

| Who the run belongs to | When | How | Page |
| --- | --- | --- | --- |
| Their app's own account | Work with no person behind it (a nightly job, an import) | A service account's API key on the backend | https://stigmer.ai/docs/guides/authentication/service-accounts |
| The signed-in user, from the browser | The user chats in the app | A token minted per user by the backend, or federation where their sign-in is OIDC (Cloud and Enterprise) | https://stigmer.ai/docs/guides/authentication/product-users, https://stigmer.ai/docs/guides/authentication/federation/overview |
| The signed-in user, from the backend | The backend starts work the user owns (a run on their upload) | A second client on a token minted for the user, kept in a token cache | https://stigmer.ai/docs/guides/authentication/product-users ("From your backend, as the user") |
| A business customer, walled off | Customers must never see each other's conversations, files or keys | An organization per customer, people landing there by minted token or federation | https://stigmer.ai/docs/getting-started/one-organization-per-customer |

Tell the person which you chose and why, with the rule behind it, in their
answer: a run started with the service account's key is the service
account's (the customer does not own it, and their chat does not show it); it
is the customer's only when started on a token minted for them, or inside an
organization of their own. A conversation is private to whoever started it,
so read a user's run (its answer, its files) with that user's client, never
the service account's.

## The keys

- The service account's key lives on the backend only, in an environment
  variable read at startup, in an env file that is git-ignored. Never in
  browser code, a `NEXT_PUBLIC_` variable, a mobile app or a commit.
- Minting tokens needs a service account with the **admin** role.
  Creating child organizations needs an admin's own key: a service
  account's key cannot create organizations.
- A key never passes through you: the CLI writes it into the env file and
  prints only where it went. When the app needs one, make it as the
  stigmer-setup skill's step 6 does, telling the person what you are making:
  `stigmer service-account list`, and use the app's admin account if one
  exists (never make a second without asking), otherwise
  `stigmer service-account create app-backend --role admin`; check the env
  file is git-ignored (`git check-ignore <file>`), then
  `stigmer apikey create --service-account app-backend --name <the app's name> --save-to-env <file>`.
  Never print the file, and never ask the person to paste a key.

## The jobs

Each job names its pages; read the one for their stack whole before
writing. The pitfalls are the mistakes this job draws.

### Run the agent from their backend on a file

A customer uploads a file; the backend runs the agent on it, waits, and keeps
what it made. Upload the file, send the message with its id and wait for the
turn (`sendAndWait` and its counterpart in each SDK), then list the run's
output files by run id and download each. Pages: https://stigmer.ai/docs/getting-started/call-from-your-app
(TypeScript, start to finish), then https://stigmer.ai/docs/sdk/typescript, https://stigmer.ai/docs/sdk/python,
https://stigmer.ai/docs/sdk/go or https://stigmer.ai/docs/sdk/java, and https://stigmer.ai/docs/files.

- The report is a File the run made: fetch it from the run's outputs. Never
  parse it out of the agent's chat text.
- No webhook tells the backend a run finished: the backend waits for the
  turn, or follows its stream.
- Decide whose run it is first (above). For the customer's own, the upload,
  the run and the reads all go through the client on the customer's token.

### Stream the reply to their page

Start the turn without waiting (`startTurn` in TypeScript, `run.create`
elsewhere), follow the Session's events from the start, relay the agent's
message text as it comes (server-sent events, a streaming response), and
stop when the run's status event says it ended. Page: https://stigmer.ai/docs/sdk/streaming
("Follow a run", "Detect the end of a run", "Resume a dropped stream").

- Keep only the events of this run, and the agent's own (no sub-agent
  thread), as the page does.

### Put the chat in their React app

```bash
stigmer app-handover --stack <nextjs|node|python|go|java> --agent <agent> --write .
```

It writes the backend's token route and the chat component from the same
writer the console uses, and says what to install. Then fit them to the
app: the route's `currentUser` becomes their own session read, the chat goes
on the page where their users would use the agent, and
`stigmer embedding set --create-accounts-on-sign-in on --sign-in-role member`
makes a user's Stigmer account the first time the app signs them in. The
first chat in a new project is the stigmer-setup skill's step 6; this is the
same work in an app that already exists. Pages: https://stigmer.ai/docs/cli/commands/app-handover,
https://stigmer.ai/docs/getting-started/embed-agent, https://stigmer.ai/docs/guides/authentication/product-users.

- Users already signed in through Auth0 or another OIDC provider: minted
  tokens work on every edition that signs callers in; federation (the
  browser sends the provider's token itself) is Cloud and Enterprise only.
  Lay out both when you don't know the edition.
- `viewer` as the sign-in role can't start conversations; `member` can.
- Allowed origins in the embedding settings restrict which pages may use
  the tokens.

### Make the chat their own

Climb only as far as the ask needs; each level keeps everything below it
Stigmer's. Pages: https://stigmer.ai/docs/getting-started/make-the-chat-your-own,
https://stigmer.ai/docs/sdk/theme/theming,
https://stigmer.ai/docs/channels/embed-an-agent,
https://stigmer.ai/docs/sdk/react-core/build-a-chat,
https://stigmer.ai/docs/sdk/streaming.

1. **Their look**: a theme class overriding the `--stgm-*` tokens (color
   with its `-foreground` partner, font, radius), passed as `className` to
   `StigmerProvider`, with `colorMode` from their own toggle or `"system"`;
   every token they override needs a dark value too.
2. **Their card or their button on our parts**: a card for one of their
   tools goes in `toolCards` on `StigmerProvider`, keyed by the tool's name
   as the agent sees it (`mcp__<server>__<tool>` for a connected server's
   tool, the declared name for one of the app's own). It replaces only what
   opens under our row: the row's step line (running, done or failed) and
   any approval stay ours. It is drawn from the call's start, so it draws
   every state (`call.state`: running, completed, failed, stopped), never
   only a result. An action on a message
   (`messageActions` on `AgentChat`) is a function from the message's info,
   `isFinalAnswer` included, to their actions, drawn beside Copy.
3. **Tools their app answers**: the agent calls the app's own tools,
   declared with `defineCustomTool` (`@stigmer/client`) in `AgentChat`'s
   `customTools`. A call waits until the app answers: the card's `answer`,
   `onCustomToolUse` for a panel of their own, or `answerCustomToolUse`
   from their backend. The agent reads the answer; `isError` tells it the
   tool failed.
4. **One of our parts swapped**: `threadSlots` replaces a part (the
   person's bubble, the approval card) with theirs, which hands every case
   it doesn't draw back to the built-in, exported from
   `@stigmer/react-sdk/chat` too.
5. **Their whole screen**: their own markup from the `@stigmer/react-core`
   hooks (`useSessionConversation`); then the TypeScript SDK alone.

- Never override the kit's internal class names, use `!important`, or fork
  the kit; nor invent a `renderTool`, `onToolCall` or other prop the pages
  don't name.
- Built-in tools (shell, files, search) take no card; only theirs do.
- Define cards and slots at module level, not inside a component.
- An approval's decision is Stigmer's: a step that needs one keeps Allow
  and Deny, and a replaced approval card answers through the slot's
  wiring. Only its look is theirs.
- Only the conversation's owner answers a waiting call; `customTools` are
  read once, when the conversation is created.
- Their page loads their font itself; the token only names it.

### One organization per business customer

Each customer gets a child organization of the person's own, made by their
onboarding code at sign-up (an admin's own key, never a service account's).
The agent stays in the parent and is shared with its children, so every
customer, including later ones, runs it inside their own organization. Their
people land in it by a token the backend mints into that child, or by
federation routing each token to the child whose external id matches.
Pages: https://stigmer.ai/docs/getting-started/one-organization-per-customer,
https://stigmer.ai/docs/guides/authentication/federation/child-organizations,
https://stigmer.ai/docs/organizations.

- Labels, naming conventions or their own filtering inside one organization
  do not wall customers off.
- Never copy the agent into each child: share it.
- On the open-source server, a customer's keys live in a vault of their own
  instead (https://stigmer.ai/docs/guides/authentication/customer-keys).

### Approvals answered in their own screens

The agent asks before a call because the tool is marked (an MCP tool marked
`destructiveHint: true` asks by default) or a hook asks; the agent's
instructions alone never guarantee a person's yes. The backend learns a call
is waiting from the turn's outcome (`sendAndWait` or `waitForTurn` returning
`waiting` with its asks) or the attention stream, shows it in their own
screen, and answers with the tool use's id (`confirmToolUse`, allow or deny);
the run then carries on. Pages: https://stigmer.ai/docs/approval-flows, https://stigmer.ai/docs/sdk/streaming
("Answer a call that waits", "Know when a conversation needs you").

- There is no approval webhook and no approval callback: the backend reads
  the turn or the stream.
- Never suggest approving every call (`autoApproveAll`) for calls that need a
  person.

### Moving from Claude Managed Agents

Say what carries over and what doesn't, from the pages. Pages:
https://stigmer.ai/docs/coming-from-claude-managed-agents, https://stigmer.ai/docs/sdk/managed-agents.

- Their event code carries over: Anthropic's SDK pointed at Stigmer's
  address with a Stigmer key lists, streams and answers a Session's events,
  tool confirmations included.
- Creating Sessions does not: they are created through Stigmer's SDK or
  console, and their ids then used with Anthropic's SDK.
- Custom tools carry over: the app declares them on the Session it creates
  (`custom_tools` through Stigmer's SDK, not `agent_with_overrides`), and
  `agent.custom_tool_use` and `user.custom_tool_result` keep their shape, so
  the handler stays. The answer is text, and only the Session's owner sends
  it. Outcomes have no counterpart (Scores grade a finished run).
- Name only the SDK versions the page names as tested.

## Before calling it done

Run what you wrote, the way the setup guide's step 6 ends: start the app (or
the script), go through the path once (one upload, one message, one
approval), and show the person what came back. When something can't run
here (no key yet, a provider they haven't connected), say exactly what is
left and who does it. Then tell them which files you changed and where the
key lives.
