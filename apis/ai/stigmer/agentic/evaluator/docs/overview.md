An Evaluator switches AI grading on for one agent. While it is enabled, Stigmer
sends a sample of the agent's completed runs to an AI judge with two standard
rubrics, "did the task" and "made nothing up", and records the verdict as a
score on each graded run. The sample rate and a monthly spending limit bound
how many runs are graded and what grading costs.

You switch grading on from the agent's Quality tab in the console; an
evaluator is never authored as a manifest. The shape below is what `get` and
`getByAgent` return.

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Evaluator
metadata:
  name: evl_01j5q3k7m8r2s4tnz2hfp0q0h2
  org: acme
spec:
  agent_id: agt_01j5q3k7m8r2s4tnz2hfp0q0a7
  enabled: true
  sample_rate: 0.1
  monthly_limit_usd: 10
status:
  period: 2026-10
  spent_usd: 1.84
  reserved_usd: 0.25
  graded: 41
  not_graded: 2
```
