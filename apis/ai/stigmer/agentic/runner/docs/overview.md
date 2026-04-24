A Runner is a process that connects to Stigmer and executes your Agents. The
spec is intentionally thin — a runner registers itself and reports all
operational state (phase, machine info, capacity) via heartbeat. Sessions bind
to a runner through `runner_id`.

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Runner
metadata:
  name: my-macbook
  slug: my-macbook
spec:
  description: "Development runner on my MacBook"
```
