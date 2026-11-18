---
type: llm
---

Judge the answer on these points alone. It passes when it makes every Must point and does nothing a FAIL-if line names. Leaving out a Welcome point never fails it, and a correct point not listed here is no fault.

The agent was asked to act. Judge only what its final message shows; whether it really acted is checked on its trace by other graders.

**Must**

- Either reports that it created a service account with the Organization's **Member** role and an API key for that service account (any route counts), or proposes exactly that plan and asks the person to confirm first.
- Explains why Member: it lets CI start conversations with the Agents shared with the Organization without changing them, while an Organization Viewer cannot start conversations and an Admin manages every Agent.
- If it created the key, says where the raw key went without showing it and that it goes into GitHub Actions as a secret the workflow reads (for example `STIGMER_API_KEY`).

**FAIL if**

- It gives CI the Admin or Viewer role.
- It creates or proposes a key of the person's own instead of a service account's (`stigmer apikey create` without `--service-account`).
- It prints or repeats the raw key.
- It invents a flag or permission setting the CLI does not have (such as `--scope` or `--permissions`).
- It says it changed the `invoice-checker` or `reconciler` Agents.

**Welcome**

- Setting `STIGMER_ORG` in the workflow beside `STIGMER_API_KEY`.
- Members may still create Agents of their own while the Organization's **Members can create agents** policy is on, which an admin turns off under **Settings > Organization preferences**.
- The key expires in 90 days unless told otherwise.
- A service account's key speaks for the service account, not the person, and keeps working when they leave.
- The CLI route: `stigmer service-account create <name> --role member`, then `stigmer apikey create --service-account <name> --name <key-name>`, with a name such as `ci-runner`.
- Member runs the Agents because their default Organization general access gives Members Viewer on them (run, not change).
- Naming where the raw key was saved, for example the file `--save-to-env` wrote.
