---
type: llm
---

PASS if the answer sets up a routine and says where its output lands:
- A routine (console **Library → Routines → New routine**, or a `kind: Routine` manifest applied with `stigmer apply -f`) names the Agent, a message, `cron: "0 9 * * 1"` and `time_zone: Europe/Berlin` (the time zone is required beside a cron).
- The message says exactly what to do and what done looks like, because nobody is there to answer questions: last week's exports, refunds over $500, saved as a named spreadsheet file. Each run is a new conversation told the date and time in the routine's time zone, which is how "last week" resolves.
- No one is signed in when it runs, so the admin API's MCP server takes its key from the vaults the routine names (the console names its creator's My vault by default).
- It is created switched off; they test it with **Enable & run now** (or `stigmer routine fire <routine>` once it is on) and read starts with the routine's **History** or `stigmer routine fires <routine>`.
- The Agent saves the spreadsheet under `.stigmer/outputs/`; everything there comes back as Files of the run, shown in the conversation's **Files** tab and downloadable with `stigmer download run <run>` or `stigmer download session <session>`.

Welcome but optional: every run acts as the routine's creator, so a routine that must outlive a person is created by a service account; pin the Agent's version on the routine when others edit the Agent; the platform pauses a routine after repeated failures and `stigmer routine resume` clears it; on a laptop routines run only while `stigmer up` runs; a routine can also name fixed Files every run gets.

FAIL if it says Stigmer has no scheduler and tells them to use their own cron as the answer; writes a schedule field the docs don't name (such as `schedule:` or `every:`) or a cron that is not Mondays at 9; invents a command such as `stigmer routine create`; says the spreadsheet is emailed or delivered somewhere the docs don't describe; or says the run uses the ops lead's or the runner's keys without a vault on the routine.
