// `stigmer file upload <path>…` — upload files on disk as Files and print
// the id each one is named by from then on.
//
// Uploading is the one act on a File that no registry verb names: get, list,
// delete and download ride the generic verbs (`stigmer get file <id>`,
// `stigmer list files`), so this group holds only the upload, the `stigmer
// routine` shape. `push` is not the word: it publishes a version under a
// digest and a tag, and a File has neither.
//
// Thin handler: resolve credentials, the organization (a conversation's own
// when `--session` names one) and the target, delegate to resources/file,
// render the result. Heavy modules are lazy-imported so `--help` stays fast.

import type { Command } from "commander";
import { ensureAuthenticated, resolveOrganization } from "../config/index.js";
import { UsageError } from "../errors/index.js";
import type { OutputFlags } from "../output/index.js";
import { addResultFlags, globalOrg, resultFormat } from "./shared.js";

interface UploadFlags extends OutputFlags {
  session?: string;
}

export function registerFile(program: Command): void {
  const file = program.command("file").description("upload files to name in conversations and routines");

  const upload = file
    .command("upload <paths...>")
    .description("upload files as Files and print the id each is named by (a folder is refused)")
    .option(
      "--session <id>",
      "upload into this conversation, as its Files from the start; omitted, they are your own, kept for reuse",
    )
    .action((paths: string[], options: UploadFlags, command: Command) => runUpload(paths, options, command));
  addResultFlags(upload);
}

async function runUpload(paths: string[], options: UploadFlags, command: Command): Promise<void> {
  const format = resultFormat(options);

  const [{ connectBackend }, { isSessionId }, { renderUploadedFiles, uploadFiles }, { renderResult }, { requireOrganization }] =
    await Promise.all([
      import("../backend.js"),
      import("../resources/reference.js"),
      import("../resources/file.js"),
      import("../output/command-result.js"),
      import("../client/single-org.js"),
    ]);

  const sessionId = options.session ?? "";
  if (options.session !== undefined && !isSessionId(sessionId)) {
    throw new UsageError(`invalid session ID: ${sessionId}\n\nA conversation is named by its ID (e.g., ses_01abc123)`);
  }

  const client = connectBackend();
  ensureAuthenticated(client.config);

  let org: string;
  if (sessionId !== "") {
    // A conversation names its own organization, and its Files live there
    // whatever the context organization is.
    org = (await client.stigmer.session.get(sessionId)).metadata?.org ?? "";
  } else {
    org = resolveOrganization(client.config, globalOrg(command));
    await requireOrganization(client.stigmer, org, [
      "stigmer file upload <path> --org <org>",
      "stigmer config context set --org <org>",
    ]);
  }

  const progress = (line: string): void => {
    if (format !== "json" && format !== "quiet") process.stderr.write(`${line}\n`);
  };
  const uploaded = await uploadFiles(client.stigmer, paths, { org, sessionId }, progress);
  renderResult(renderUploadedFiles(uploaded, sessionId), format);
}
