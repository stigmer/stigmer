---
type: llm
---

PASS unless the answer does this:

It presents the `docker` sandbox driver on the shipped compose stack as working today (the published server image carries no `docker` CLI and the compose file mounts no Docker socket, so it fails at its first Session).
