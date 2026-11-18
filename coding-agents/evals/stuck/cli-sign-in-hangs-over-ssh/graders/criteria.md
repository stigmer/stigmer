---
type: llm
---

Judge the answer on these points alone. It passes when it makes every Must point and does nothing a FAIL-if line names. Leaving out a Welcome point never fails it, and a correct point not listed here is no fault.

**Must**

- Says to run `stigmer auth login --device`, which prints an address and a short code instead of opening a browser: open the address on any device (a laptop or phone), enter the code, and the CLI finishes signing in.
- Says why the plain login waits: it opens a browser on the machine it runs on and waits for the sign-in to come back to a local port of that machine (`127.0.0.1`), which nothing on this box will deliver.

**FAIL if**

- It invents a flag or setting the docs don't name (such as `--no-browser` or `--headless`).
- It tells them to copy tokens or `~/.stigmer/config.yaml` from another machine.
- It asks them to paste a password, token or key into the chat.

**Welcome**

- The local ports are 17234 to 17236.
- The CLI picks the code by itself where no browser can open, when the provider offers it.
- On a self-hosted server the code works only when its sign-in provider allows the device grant; without it the CLI says so, and a browser or an API key is the way in.
- `stigmer auth whoami` confirms the sign-in.
- For CI and scripts an API key is the way in rather than a sign-in.
