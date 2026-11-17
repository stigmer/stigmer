---
type: llm
---

PASS if the answer shows the backend job the docs describe, in TypeScript/Node:
- a client from `createNodeClient` (`@stigmer/client/node`) with `baseUrl: "https://api.stigmer.ai"` and a service account's API key from the environment, the account and key made with `stigmer service-account create <name> --role ...` and `stigmer apikey create --service-account <name> --name ...` (a backend that only runs jobs can use `--role member`);
- the CSV uploaded as a File (`uploadFileFromPath(stigmer.file, { org, path })` or the file client's upload);
- `sendAndWait(stigmer, { org, sessionSpec: { agentRef: { org, slug: "expense-auditor" } }, message, fileIds: [file.metadata.id] })`, checking that the turn's `phase` is `completed` before using it;
- the Agent's outputs found with `stigmer.file.listAll({ org, runId: turn.runId })` and fetched through `stigmer.file.getDownloadUrl(id)` (a short-lived link), each keeping its `status.outputPath`.
Welcome but optional: that the Agent saves what it hands back in its outputs folder; that `sendAndWait` also returns when the Agent waits for a person's answer; one Organization per customer to keep customers' files apart; doing the work in a background job rather than holding the HTTP request open.

FAIL if the answer invents calls the docs don't name (such as `stigmer.agents.run`, `stigmer.run.wait`, a `report` field on the turn, or a webhook for completion); puts the key in front-end code; uses a person's own key as the backend's without mentioning a service account; tells them to parse the agent's chat text for the report instead of fetching the output files; or has them call the model provider and build the loop themselves.
