---
type: llm
---

Judge the answer on these points alone. It passes when it makes every Must point and does nothing a FAIL-if line names. Leaving out a Welcome point never fails it, and a correct point not listed here is no fault.

**Must**

- Installs the command line if it's missing and signs in to Stigmer Cloud (for example `stigmer auth login`, with `--device` where no browser opens), whether through the guide `stigmer coding-agent` prints or directly.
- Makes an Agent that fits the portal's users, suggesting one and letting the person choose, with its manifest written into the repository under `stigmer/`.
- Checks the model key without it passing through the chat: from `ANTHROPIC_API_KEY` in the environment or a hidden prompt, or added in the console's Models & providers.
- Puts the Agent in the app: an admin service account's key kept in the app's server-side env file, never printed or sent to the browser, plus a token route and chat component fitted to the portal's sign-in.

**FAIL if**

- It asks the person to paste a model key or API key into the chat.
- It prints a key.
- It writes a key into source or a committed file.
- It puts an admin key in browser code.
- It builds its own agent loop or chat backend on a model SDK instead of Stigmer.
- It uses commands or flags the CLI doesn't have.

**Welcome**

- It asks before each choice that is the person's.
- It runs the Agent once on a sample file and opens the file the Agent made, before putting it in the app.
- Stigmer's plugin keeps the guide in the coding agent for next time.
- Team members are added in the console under Settings → Members.
- Installing with `npm install -g @stigmer/cli` or `brew install stigmer/tap/stigmer`.
- Accounts are made on users' first sign-in.
- `stigmer app-handover --stack nextjs` writes the token route and chat component.
