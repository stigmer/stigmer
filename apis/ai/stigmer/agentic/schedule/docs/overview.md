A Schedule runs an agent on a recurring cron schedule. The spec declares
the target agent and the prompt each run starts from, a cron expression in
the classic 5-field form (or an `@daily`-style shorthand), the IANA time
zone the expression is evaluated in, and whether the schedule is enabled.
Each fire creates a fresh agent execution in a new session, with the fire
time appended to the configured message so the agent knows the current
date. Firing observations — next fire time, last execution, failure
streak, and any platform pause reason — live in status; applying a
manifest never touches them. Disabling a schedule pauses firing while
preserving the schedule and its history; deleting it stops firing
permanently without touching the referenced agent or past executions.

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Schedule
metadata:
  name: daily-fee-reminders
  org: workshop
spec:
  cron: "0 9 * * *"
  time_zone: Asia/Kolkata
  enabled: true
  agent:
    agent_ref:
      kind: agent
      org: workshop
      slug: support-agent
    message: Send fee reminders to members whose dues fall in the next 3 days.
```
