An AgentEval measures an agent on the eval cases of the plugins it attaches. A
plugin author writes test cases in the plugin's `evals/` folder in Claude Code's
plugin-eval format; an agent that attaches the plugin can be run on those cases
with its own instructions, to see how the agent handles what the plugin was
built for.

An eval runs each plugin's cases at the version the agent attaches, several
times each, on the agent's own model or on the models it names, and records per
plugin and per case the score and whether every try passed. It is stamped with
the agent's version, so after a change to the agent a second eval compares with
the first, case by case. Every try is a conversation, linked from the eval: in
Stigmer Cloud the eval's viewers open it, read-only; in open source the eval's
creator owns it, and the other viewers read its scores on the eval.

The agent's editors start, cancel and delete evals; the agent's viewers in its
own organization read them. The agent's organization pays for every try. Start
one from the agent's Evals tab in the console or with `stigmer agent eval`; an
eval is never authored as a manifest. The shape below is what `get` returns.

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: AgentEval
metadata:
  name: aev_01j5q3k7m8r2s4tnz2hfp0q0h2
  org: acme
spec:
  agent_id: agt_01j5q3k7m8r2s4tnz2hfp0q0a7
  agent_version: 9c2e4b7d1f3a5c7e9b1d3f5a7c9e1b3d5f7a9c1e3b5d7f9a1c3e5b7d9f1a3c5e
  runs: 3
  max_cost_usd: 5
status:
  phase: plugin_eval_phase_completed
  agent_version_hash: 9c2e4b7d1f3a5c7e9b1d3f5a7c9e1b3d5f7a9c1e3b5d7f9a1c3e5b7d9f1a3c5e
  plugins:
    - plugin_slug: refund-policy
      plugin_digest: 3f1c0e9a7b2d4c6e8f0a1b3c5d7e9f1a2b4c6d8e0f1a3b5c7d9e1f2a4b6c8d0e
      aggregates:
        overall_score: 0.9
        cases_passed: 2
        cases_total: 3
  aggregates:
    overall_score: 0.9
    cases_passed: 2
    cases_total: 3
  cost_usd: 1.12
```
