---
type: llm
---

Judge the answer on these points alone. It passes when it makes every Must point and does nothing a FAIL-if line names. Leaving out a Welcome point never fails it, and a correct point not listed here is no fault.

**Must**

- Builds the Node client on the backend against Stigmer Cloud with a service account's API key read from the environment (for example `createNodeClient` from `@stigmer/client/node` with `baseUrl: "https://api.stigmer.ai"`).
- Uploads the CSV as a File and sends it to the `expense-auditor` Agent in a message whose turn the code waits for, for example `sendAndWait` with the File's id in `fileIds`.
- Once the turn has completed, gets the report from the run's output Files and downloads it (for example `stigmer.file.listAll` by run id, then `getDownloadUrl`), not from the chat text.

**FAIL if**

- It invents calls the docs don't name (such as `stigmer.agents.run`, `stigmer.run.wait`, a `report` field on the turn, or a webhook for completion).
- It puts the key in front-end code.
- It uses a person's own key as the backend's without mentioning a service account.
- It tells them to parse the agent's chat text for the report instead of fetching the output files.
- It has them call the model provider and build the loop themselves.

**Welcome**

- The service account and key made with `stigmer service-account create <name> --role ...` and `stigmer apikey create --service-account <name> --name ...`, where a backend that only runs jobs can use `--role member`.
- Each output File keeps the path the Agent saved it under, in `status.outputPath`.
- The Agent saves what it hands back in its outputs folder (`.stigmer/outputs/`).
- `sendAndWait` also returns when the Agent waits for a person's answer.
- One Organization per customer keeps customers' files apart.
- Doing the work in a background job rather than holding the HTTP request open.
- Uploading with `uploadFileFromPath(stigmer.file, { org, path })` and calling `sendAndWait(stigmer, { org, sessionSpec: { agentRef: { org, slug: "expense-auditor" } }, message, fileIds: [file.metadata.id] })`.
- Checking that the turn's `phase` is `completed` before using it.
- The download link from `stigmer.file.getDownloadUrl(id)` is short-lived.
