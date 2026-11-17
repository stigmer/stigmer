---
type: llm
---

The docs don't say how to run the local stack on another port: the `stigmer up` reference lists no port flag or setting. The docs should say there which ports `stigmer up` takes and whether they can be changed.

PASS if the answer says plainly that the Stigmer docs don't document a way to make `stigmer up` use another port; relays what the error itself offers (stop the program holding the port, or `stigmer down` when the holder is an earlier Stigmer stack); and points to where to get help: the Stigmer community the local console links to ("Ask the Stigmer community", the project's Discord) or an issue on the stigmer/stigmer GitHub repository. Welcome but optional: a workaround clearly labelled as untested and not from the docs, such as running Stigmer on another machine where the port is free.

FAIL if it presents a flag, environment variable or config key as a working way to move the port (such as `stigmer up --port`, `STIGMER_PORT` or `GRPC_PORT`), confuses it with `stigmer mcp-server --port`, claims the docs say something they don't, or stops the person's gateway container without being asked.
