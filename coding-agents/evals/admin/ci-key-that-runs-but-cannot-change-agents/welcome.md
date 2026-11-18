What a good answer may also say. Never graded: leaving any of it out fails nothing.

- Setting `STIGMER_ORG` in the workflow beside `STIGMER_API_KEY`.
- Members may still create Agents of their own while the Organization's **Members can create agents** policy is on, which an admin turns off under **Settings > Organization preferences**.
- The key expires in 90 days unless told otherwise.
- A service account's key speaks for the service account, not the person, and keeps working when they leave.
- The CLI route: `stigmer service-account create <name> --role member`, then `stigmer apikey create --service-account <name> --name <key-name>`, with a name such as `ci-runner`.
- Member runs the Agents because their default Organization general access gives Members Viewer on them (run, not change).
- Naming where the raw key was saved, for example the file `--save-to-env` wrote.
