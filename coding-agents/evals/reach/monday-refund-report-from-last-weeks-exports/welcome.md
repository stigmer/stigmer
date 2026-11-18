What a good answer may also say. Never graded: leaving any of it out fails nothing.

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
