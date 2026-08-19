A Memory is a single fact the platform remembers about a person. An agent
proposes it during a session with the `remember` tool; it becomes active only
after the person it is about confirms it. Confirmed memories are recalled
into that person's future agent executions as background context. Every
memory is individually listable, editable, and deletable.

Memories are system-generated — you never author one as a manifest. The
shape below is what `get` and `list` return.

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Memory
metadata:
  name: prefers-terse-answers
  org: acme
spec:
  content: "Prefers terse answers with code examples over long explanations."
  subject_identity_account_id: ida_01j5q3k7m8r2s4tnz2hfp0q0c3
  provenance:
    agent_id: agt_01j5q3k7m8r2s4tnz2hfp0q0d7
    session_id: ses_01j5q3k7m8r2s4tnz2hfp0q0e1
    agent_execution_id: aex_01j5q3k7m8r2s4tnz2hfp0q0f5
    tool_call_id: call_9f2c1a
status:
  lifecycle_state: lifecycle_state_confirmed
```
