---
type: llm
---

PASS if the answer says to run `stigmer auth login --device`, which prints an address and a short code instead of opening a browser: open the address on any device (a laptop or phone), enter the code, and the CLI finishes signing in; and explains why the plain login waits: it opens a browser on the machine it runs on and receives the sign-in on a local port of that machine (`127.0.0.1`, ports 17234 to 17236). Welcome but optional: the CLI picks the code by itself where no browser can open, when the provider offers it; `stigmer auth whoami` confirms the sign-in; for CI and scripts an API key is the way in rather than a sign-in.

FAIL if it invents a flag or setting the docs don't name (such as `--no-browser` or `--headless`), tells them to copy tokens or `~/.stigmer/config.yaml` from another machine, or asks them to paste a password, token or key into the chat.
