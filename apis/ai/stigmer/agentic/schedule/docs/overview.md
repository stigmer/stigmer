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

`trigger` fires a schedule once, immediately (`stigmer schedule trigger`).
The manual fire runs through the schedule's own clock, so it records on
status and its outcome feeds the failure streak exactly like a cron fire;
a disabled or platform-paused schedule refuses instead of firing.

In the open-source edition, schedules fire while `stigmer up` is running.
The daemon is user-session scoped: after a reboot, nothing fires until you
run `stigmer up` again. A fire missed while the daemon (or your laptop)
was down lands within the 60-minute catch-up window once it returns, and
is skipped entirely after that.

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
