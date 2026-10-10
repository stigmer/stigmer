A PluginEval runs a plugin's own test cases. A plugin author writes them in the
plugin's `evals/` folder in Claude Code's plugin-eval format: each case is a
request a user might type, plus checks such as "the reply mentions the renamed
function", "the skill was used" or a pass-or-fail rubric for an AI judge.

An eval runs every case several times with the plugin and several times without
it, on each engine and model it names, and records per case the score with and
without the plugin, the difference the plugin makes, and whether every try
passed. Every try is a conversation, linked from the eval: in Stigmer Cloud the
eval's viewers open it, read-only; in open source the eval's creator owns it,
and the other viewers read its scores on the eval.

The plugin's editors start, cancel and delete evals; the plugin's viewers in
its own organization read them. The organization that installed the plugin
pays for every try. Start one from the plugin's Evals tab in the console or
with `stigmer plugin eval`; an eval is never authored as a manifest. The shape
below is what `get` returns.

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: PluginEval
metadata:
  name: pev_01j5q3k7m8r2s4tnz2hfp0q0h2
  org: acme
spec:
  plugin_id: plg_01j5q3k7m8r2s4tnz2hfp0q0a7
  plugin_digest: 3f1c0e9a7b2d4c6e8f0a1b3c5d7e9f1a2b4c6d8e0f1a3b5c7d9e1f2a4b6c8d0e
  targets:
    - harness: HARNESS_NATIVE
      model_name: claude-sonnet-4-6
  runs: 3
  max_cost_usd: 5
status:
  phase: plugin_eval_phase_completed
  aggregates:
    overall_score: 0.92
    cases_passed: 2
    cases_total: 3
    mean_delta: 0.58
  cost_usd: 1.37
```
