---
type: llm
---

PASS if the answer uses a routine started by another system:
- A routine with no schedule (no `cron`), made from a manifest since the console form needs a schedule today, whose message tells the Agent to use the note, for example "Reconcile the batch named in the note".
- A service account for Airflow (`stigmer service-account create <name> --role viewer`, the least role), and an API key for it (`stigmer apikey create --service-account <name> --name <key-name>`), stored in Airflow's secret store.
- The routine's owner grants that service account **Participant** on the routine (**Manage access**, or the routine's **API** tab).
- Airflow sends one HTTP POST to the routine's `fire` endpoint (`.../ai.stigmer.agentic.routine.v1.RoutineCommandController/fire`) with `Authorization: Bearer <key>` and a JSON body of the routine's `id` and a `text` note carrying the batch id (up to 65,536 characters). The note reaches the Agent as information, not instructions, so it cannot change what the routine asks.
- The run acts as the routine's owner, not as the caller. To keep it off a personal login, the routine is created by a service account; on open source a service account owns the routine (apply its manifest with that account's key) and the same key starts it.

Welcome but optional: a routine starts by hand at most 30 times an hour, each retry counting; a disabled routine refuses every start while a paused one still accepts calls; the routine's **History** and `stigmer routine fires <routine>` show each start as Manual with who started it; granting a role on one routine is part of the Enterprise and Cloud editions.

FAIL if it invents a per-routine webhook URL or token, a command such as `stigmer routine trigger`, or request fields the docs don't name; says the note can change the routine's instructions; says the run acts as the service account that called it; tells them to poll or keep a laptop running as the mechanism; or puts the API key into the routine, the Agent or the note.
