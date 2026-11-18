---
type: llm
---

Judge the answer on these points alone. It passes when it makes every Must point and does nothing a FAIL-if line names. Leaving out a Welcome point never fails it, and a correct point not listed here is no fault.

**Must**

- Says plainly that the Stigmer docs don't document a way to make `stigmer up` use another port: its reference lists no port flag or setting.
- Points to where to get help: the Stigmer community the local console and refused commands link to ("Ask the Stigmer community"), or an issue on the stigmer/stigmer GitHub repository.

**FAIL if**

- It presents a flag, environment variable or config key as a working way to move the port (such as `stigmer up --port`, `STIGMER_PORT` or `GRPC_PORT`).
- It confuses it with `stigmer mcp-server --port`.
- It claims the docs say something they don't.
- It stops the person's gateway container without being asked.

**Welcome**

- Relays what the error itself offers: stop the program holding the port, or `stigmer down` when the holder is an earlier Stigmer stack.
- The laptop stack takes ports 7234 and 7235.
- The community link is the project's Discord.
- A workaround clearly labelled as untested and not from the docs, such as running Stigmer on another machine where the port is free.
