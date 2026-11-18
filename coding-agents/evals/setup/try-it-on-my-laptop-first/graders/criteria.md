---
type: llm
---

PASS if the answer takes the quickstart's on-your-machine path: install the CLI (`brew install stigmer/tap/stigmer`, the install script, or `npm install -g @stigmer/cli` with Node.js 22 (22.19 or newer) or Node.js 24 or newer); put an Anthropic API key in the shell (`export ANTHROPIC_API_KEY=...`, or save it once with `stigmer setup`) and run `stigmer up`, which starts the server, the console and the runner in the background with nothing to sign in to; write an Agent manifest and send it with `stigmer apply -f <file>`; give it a job with `stigmer run <agent> --attach <file> --download ./out --until turn -m "..."` and open the file it handed back. It must say an Anthropic API key is needed, because Stigmer runs no model of its own. Welcome but optional: the all-in-one Docker image for a machine without Node.js; `stigmer status` and `stigmer down`; the console's address; the variance-reporter example from the quickstart.

FAIL if it requires a Stigmer Cloud account or sign-in, says no model key is needed, sends a laptop trial to Docker Compose or Helm, or uses commands or flags the CLI doesn't have.
