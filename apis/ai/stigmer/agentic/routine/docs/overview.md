A Routine is a saved agent invocation: the agent and the message each run
starts from, an optional cron expression in the classic 5-field form (or an
`@daily`-style shorthand), the IANA time zone the routine keeps, and whether
it is enabled. Each run starts a fresh conversation with the current date and
time in the routine's time zone appended to the message, so the agent knows
when it is. Every run acts as the routine's owner, the account that created
it, and only the owner changes what it runs. Firing observations (next fire
time, last run, failure streak, and any platform pause reason) live in
status; applying a manifest never touches them. Disabling a routine stops it
while keeping the routine and its history; deleting it, or its agent, stops
it permanently without touching past runs.

A routine with a `cron` runs on its schedule. `fire` runs it once,
immediately, with an optional `text` the run receives after the message,
marked as information from whoever started it rather than instructions. Its
owner and the Participants the owner grants may fire it. A fire records on
status but does not feed the failure streak; a disabled routine refuses, and
a platform-paused routine may still be fired, which is how its owner tests a
fix before `resume`.

In the open-source edition, schedules fire while `stigmer up` is running.
The daemon is user-session scoped: after a reboot, nothing fires until you
run `stigmer up` again. A fire missed while the daemon (or your laptop) was
down lands within the 60-minute catch-up window once it returns, and is
skipped entirely after that.

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Routine
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
