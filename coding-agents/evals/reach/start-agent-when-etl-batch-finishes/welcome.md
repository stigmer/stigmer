What a good answer may also say. Never graded: leaving any of it out fails nothing.

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
