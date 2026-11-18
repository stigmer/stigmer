---
type: llm
---

Judge the answer on these points alone. It passes when it makes every Must point and does nothing a FAIL-if line names. Leaving out a Welcome point never fails it, and a correct point not listed here is no fault.

**Must**

- Runs Stigmer on the Mac itself with nothing to sign in to: installs the CLI and runs `stigmer up`, which starts the server, the console and the runner, or uses the all-in-one Docker image.
- Says an Anthropic API key is needed, because Stigmer runs no model of its own, and how to give it to the stack (for example exporting `ANTHROPIC_API_KEY` before `stigmer up`, or `stigmer setup`).
- Gives an Agent a job and shows the result, for example an Agent manifest sent with `stigmer apply -f <file>`, then `stigmer run <agent> -m "..."`.

**FAIL if**

- It requires a Stigmer Cloud account or sign-in.
- It says no model key is needed.
- It sends a laptop trial to Docker Compose or Helm.
- It uses commands or flags the CLI doesn't have.

**Welcome**

- The quickstart's run hands the Agent a file and gets one back: `stigmer run <agent> --attach <file> --download ./out --until turn -m "..."`, then opening the file it handed back.
- The variance-reporter example from the quickstart.
- The all-in-one Docker image for a machine without Node.js.
- `stigmer status` and `stigmer down`.
- The console's address (`http://localhost:7234`).
- `stigmer example get` writes a ready example Agent and its sample files to run.
- Installing the CLI with `brew install stigmer/tap/stigmer`, the install script, or `npm install -g @stigmer/cli` with Node.js 22.13 or newer.
