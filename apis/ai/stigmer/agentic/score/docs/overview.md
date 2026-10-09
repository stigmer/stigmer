A Score is one grade of a finished run. A run carries a score for each thing
measured, its metric: a person's thumbs up or down on the final answer
(`feedback`), and the free checks Stigmer runs when a run completes
(`run-health`). Anyone who
can see the run sees its scores.

Scores are written by people rating a run and by the platform — you never
author one as a manifest. The shape below is what `get` and the list
methods return.

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Score
metadata:
  name: scr_01j5q3k7m8r2s4tnz2hfp0q0g9
  org: acme
spec:
  run_id: run_01j5q3k7m8r2s4tnz2hfp0q0f5
  session_id: ses_01j5q3k7m8r2s4tnz2hfp0q0e1
  metric: run-health
  source: score_source_check
  evaluator_version: 3f6c0e2a
  passed: false
  criteria:
    - name: no-repeated-calls
      result: criterion_result_passed
    - name: last-action-succeeded
      result: criterion_result_failed
      reason: "ended on a failed action: create_ticket (step 7)"
    - name: structured-output-delivered
      result: criterion_result_not_applicable
status:
  state: score_state_graded
```
