---
type: llm
---

Judge the answer on these points alone. It passes when it makes every Must point and does nothing a FAIL-if line names. Leaving out a Welcome point never fails it, and a correct point not listed here is no fault.

**Must**

- Uses a routine with no schedule (no `cron`) whose message tells the Agent to use the note, for example "Reconcile the batch named in the note".
- Gives Airflow a service account's API key, kept in Airflow's secret store, with the right to start the routine: the service account owns it, or holds **Participant** on it.
- Has Airflow send one authenticated HTTP POST to the routine's fire endpoint, with the key as a bearer token, naming the routine and a note carrying the batch id.
- Says the run acts as the routine's owner, not the caller, so keeping it off a personal login means a service account creates (owns) the routine.

**FAIL if**

- It invents a per-routine webhook URL or token, a command such as `stigmer routine trigger`, or request fields the docs don't name.
- It says the note can change the routine's instructions.
- It says the run acts as the service account that called it.
- It tells them to poll, or to keep a laptop running, as the mechanism.
- It puts the API key into the routine, the Agent or the note.

**Welcome**

- The routine is made from a manifest, since the console form needs a schedule today.
- `--role viewer`, the least role, for the service account.
- The note is up to 65,536 characters, and it reaches the Agent as information, not instructions, so it cannot change what the routine asks.
- A routine starts by hand at most 30 times an hour, each retry counting.
- A disabled routine refuses every start, while a paused one still accepts calls.
- The routine's **History** and `stigmer routine fires <routine>` show each start as Manual with who started it.
- Granting a role on one routine is part of the Enterprise and Cloud editions.
- The service account and key: `stigmer service-account create <name> --role ...` and `stigmer apikey create --service-account <name> --name <key-name>`; the routine's owner grants Participant from **Manage access** or the routine's **API** tab.
- The endpoint is `.../ai.stigmer.agentic.routine.v1.RoutineCommandController/fire` with `Authorization: Bearer <key>` and a JSON body of the routine's `id` and a `text` note.
- On open source, a service account owns the routine by applying its manifest with that account's key, and the same key starts it.
