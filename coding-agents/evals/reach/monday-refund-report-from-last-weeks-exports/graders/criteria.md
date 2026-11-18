---
type: llm
---

Judge the answer on these points alone. It passes when it makes every Must point and does nothing a FAIL-if line names. Leaving out a Welcome point never fails it, and a correct point not listed here is no fault.

**Must**

- Sets up a routine that names the Agent, a message, and Mondays at 09:00 Berlin time (for example in the console, or a `kind: Routine` manifest with a cron and `time_zone: Europe/Berlin`).
- Says the routine is created switched off and has to be turned on, for example with **Enable & run now**, which also tests it.
- Says no one is signed in when it runs, so the admin API's MCP server takes its key from the vaults the routine names.
- Says the spreadsheet comes back as a File of the run that she downloads, for example from the conversation's **Files** tab or with `stigmer download run`.

**FAIL if**

- It says Stigmer has no scheduler and tells them to use their own cron as the answer.
- It writes a schedule field the docs don't name (such as `schedule:` or `every:`), or a cron that is not Mondays at 9.
- It invents a command such as `stigmer routine create`.
- It says the spreadsheet is emailed or delivered somewhere the docs don't describe.
- It says the run uses the ops lead's or the runner's keys without a vault on the routine.

**Welcome**

- The message says exactly what to do and what done looks like, because nobody is there to answer questions: last week's exports, refunds over $500, saved as a named spreadsheet file.
- Each run is a new conversation told the date and time in the routine's time zone, which is how "last week" resolves.
- The console names its creator's My vault on the routine by default.
- `stigmer routine fire <routine>` starts it once it is on, and the routine's **History** or `stigmer routine fires <routine>` shows each start.
- Every run acts as the routine's creator, so a routine that must outlive a person is created by a service account.
- Pin the Agent's version on the routine when others edit the Agent.
- The platform pauses a routine after repeated failures, and `stigmer routine resume` clears it.
- On a laptop, routines run only while `stigmer up` runs.
- A routine can also name fixed Files every run gets.
- The console route is **Library → Routines → New routine**; a manifest is applied with `stigmer apply -f`, its cron `0 9 * * 1`, and a time zone is required beside a cron.
- The Agent saves the spreadsheet under `.stigmer/outputs/`, and everything there comes back as Files of the run; `stigmer download session <session>` also fetches it.
