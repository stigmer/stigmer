An Eval is a set of test cases for an agent: an `evals/` folder in Claude Code's
plugin-eval format, pushed whole. Each case is a request a user might type, plus
checks such as "the reply mentions the renamed function" or a pass-or-fail
rubric for an AI judge.

Every push of a changed folder is a new version, reachable by its digest or by a
tag; pushing the same folder again changes nothing. An eval is visible to its
whole organization by default, or kept private to its owner. Push one with
`stigmer push eval`, and get a version back with `stigmer download eval`.

Run an eval on an agent with `stigmer eval run --agent <agent> --eval <eval>`,
or pick it on the agent's Evals tab. Its cases run on the agent with its own
instructions and the plugins it attaches; a mock folder stands in for the
agent's server of that name, or a plugin's server by the name the turn gives it
(`plugin_<plugin>_<server>`), and a mock that names no server of the agent is
listed as not used. The eval run is stamped with the eval's version, so its
results stay tied to the cases that produced them. Whoever may view an eval may
run it on an agent they may edit. The eval run is the agent's: every viewer of
the agent in its organization reads its results, the cases' names, mocks and
conversations included, so running a private eval shares what those tries show
with them. The shape below is what `get` returns.

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Eval
metadata:
  name: support-agent-evals
  slug: support-agent-evals
  org: acme
  version:
    id: 3f1c0e9a7b2d4c6e8f0a1b3c5d7e9f1a2b4c6d8e0f1a3b5c7d9e1f2a4b6c8d0e
    message: 9c2e4b7
spec:
  tag: stable
status:
  digest: 3f1c0e9a7b2d4c6e8f0a1b3c5d7e9f1a2b4c6d8e0f1a3b5c7d9e1f2a4b6c8d0e
  case_count: 2
  case_tags: [refunds]
  cases:
    - case_name: refund-within-policy
      path: refund-within-policy
      case_tags: [refunds]
    - case_name: escalates-angry-customer
      path: escalates-angry-customer
  mock_servers: [billing]
```
