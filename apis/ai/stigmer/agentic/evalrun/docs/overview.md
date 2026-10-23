An EvalRun runs test cases on an agent, optionally with and without a plugin.
Test cases live in a plugin's `evals/` folder, or in an Eval, the same folder
pushed on its own, in Claude Code's plugin-eval format: each case is a request a
user might type, plus checks such as "the reply mentions the renamed function",
"the skill was used" or a pass-or-fail rubric for an AI judge.

An eval run is about an agent or about a plugin:

- On an agent, it runs the cases of the plugins the agent attaches, at the
  versions the agent attaches, on the agent with its own instructions. It is
  stamped with the agent's version, so after a change to the agent a second eval
  run compares with the first, case by case. It also runs the cases of each Eval
  it names, at the version it names (the current one by default), their mocks
  standing in for the agent's own servers and its plugins'; an agent with no
  plugin runs Evals alone. Name a compared plugin and each case also runs
  without it, whether the agent attaches it or not: the difference says whether
  the plugin earns its place in the agent.
- On a plugin, it runs the plugin's own cases on the built-in assistant, with
  the plugin and without it, as Claude Code's `claude plugin eval` does.

Each case runs several times, on the subject's own model or on the models the
eval run names, and the result records per plugin, per Eval and per case the
score with and without the compared plugin, the difference, and whether every
try passed. Every try is a conversation, linked from the eval run: in Stigmer
Cloud the eval run's viewers open it, read-only; in open source the eval run's
creator owns it, and the other viewers read its scores on the eval run.

The subject's editors start, cancel and delete eval runs; its viewers in its own
organization read them. The subject's organization pays for every try. Start one
from an agent's or a plugin's Evals tab in the console or with
`stigmer eval run`; an eval run is never authored as a manifest. The shape below
is what `get` returns.

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: EvalRun
metadata:
  name: evr_01j5q3k7m8r2s4tnz2hfp0q0h2
  org: acme
spec:
  agent_id: agt_01j5q3k7m8r2s4tnz2hfp0q0a7
  agent_version: 9c2e4b7d1f3a5c7e9b1d3f5a7c9e1b3d5f7a9c1e3b5d7f9a1c3e5b7d9f1a3c5e
  compared_plugin_id: plg_01j5q3k7m8r2s4tnz2hfp0q0b3
  runs: 3
  max_cost_usd: 5
status:
  phase: eval_run_phase_completed
  agent_version_hash: 9c2e4b7d1f3a5c7e9b1d3f5a7c9e1b3d5f7a9c1e3b5d7f9a1c3e5b7d9f1a3c5e
  plugins:
    - plugin_id: plg_01j5q3k7m8r2s4tnz2hfp0q0b3
      plugin_slug: payroll
      plugin_digest: 3f1c0e9a7b2d4c6e8f0a1b3c5d7e9f1a2b4c6d8e0f1a3b5c7d9e1f2a4b6c8d0e
      attached: true
      compared: true
      aggregates:
        overall_score: 0.9
        cases_passed: 2
        cases_total: 3
        mean_delta: 0.4
  aggregates:
    overall_score: 0.9
    cases_passed: 2
    cases_total: 3
    mean_delta: 0.4
  cost_usd: 2.24
```
