What a good answer may also say. Never graded: leaving any of it out fails nothing.

- The service account and key made with `stigmer service-account create <name> --role ...` and `stigmer apikey create --service-account <name> --name ...`, where a backend that only runs jobs can use `--role member`.
- Each output File keeps the path the Agent saved it under, in `status.outputPath`.
- The Agent saves what it hands back in its outputs folder (`.stigmer/outputs/`).
- `sendAndWait` also returns when the Agent waits for a person's answer.
- One Organization per customer keeps customers' files apart.
- Doing the work in a background job rather than holding the HTTP request open.
- Uploading with `uploadFileFromPath(stigmer.file, { org, path })` and calling `sendAndWait(stigmer, { org, sessionSpec: { agentRef: { org, slug: "expense-auditor" } }, message, fileIds: [file.metadata.id] })`.
- Checking that the turn's `phase` is `completed` before using it.
- The download link from `stigmer.file.getDownloadUrl(id)` is short-lived.
