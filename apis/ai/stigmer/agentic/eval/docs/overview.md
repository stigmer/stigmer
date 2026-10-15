An Eval is a set of test cases for an agent: an `evals/` folder in Claude Code's
plugin-eval format, pushed whole. Each case is a request a user might type, plus
checks such as "the reply mentions the renamed function" or a pass-or-fail
rubric for an AI judge.

Every push of a changed folder is a new version, reachable by its digest or by a
tag; pushing the same folder again changes nothing. An eval is visible to its
whole organization by default, or kept private to its owner. Push one with
`stigmer push eval`, and get a version back with `stigmer download eval`.
Running an eval on an agent is coming. The shape below is what `get` returns.

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
