// `stigmer resume [session-id-or-text]` — re-open an existing session. Thin
// handler: classify the argument (Go's executeResumeSmart), then delegate to the
// resume orchestrator. Resource IDs that aren't sessions are redirected to `run`;
// text/0-arg would open the session picker (a separate, not-yet-wired task).

import type { Command } from "commander";
import { ensureAuthenticated, resolveOrganization } from "../config/index.js";
import { UsageError } from "../errors/index.js";
import { interactiveBrowseEnabled } from "../resources/picker/tty.js";
import { globalOrg } from "./shared.js";

interface ResumeFlags {
  verbose?: boolean;
  mode?: string;
  json?: boolean;
}

export function registerResume(program: Command): void {
  program
    .command("resume [reference]")
    .description("resume an existing session by ID")
    .option("-v, --verbose", "show all execution events")
    .option("--mode <mode>", 'follow-up interaction mode: "agent" (default) or "plan" (read-only)')
    .option("--json", "stream events as newline-delimited JSON")
    .action((reference: string | undefined, options: ResumeFlags, command: Command) =>
      runResume(reference, options, command),
    );
}

async function runResume(reference: string | undefined, options: ResumeFlags, command: Command): Promise<void> {
  const { validateMode } = await import("../resources/run/prepare.js");
  // Call through a plain signature: TS forbids assertion functions reached via a
  // destructured dynamic-import binding (TS2775); we only need the throw-on-invalid
  // side effect here, not the narrowing.
  (validateMode as (mode: string) => void)(options.mode ?? "");

  const { connectBackend } = await import("../backend.js");
  const client = connectBackend();
  ensureAuthenticated(client.config);
  const org = resolveOrganization(client.config, globalOrg(command));
  if (org === "") {
    throw new UsageError(
      "organization not set\n\nSet it with:\n  stigmer config context set --org <org>\n  stigmer resume --org <org> ...",
    );
  }

  const outputMode = options.json === true ? "json" : "inline";
  const mode = (options.mode ?? "") as import("../resources/run/prepare.js").RunMode;

  if (reference === undefined) {
    if (interactiveBrowseEnabled(outputMode)) {
      await browseAndResumeSession("", client, org, mode, outputMode);
      return;
    }
    throw browseUnavailableError();
  }

  const { isSessionId, isAgentId, isWorkflowId, isScheduleId, hasResourceIdPrefix, validateResourceId } = await import(
    "../resources/reference.js"
  );

  // Agent/workflow IDs belong to `run`.
  if (isAgentId(reference) || isWorkflowId(reference)) {
    throw new UsageError(`Resource IDs like "${reference}" are not sessions\n\nTo run a resource:\n  stigmer run ${reference}`);
  }

  // Schedule IDs belong to `schedule resume` (clearing a platform pause).
  if (isScheduleId(reference)) {
    throw new UsageError(
      `Resource IDs like "${reference}" are not sessions\n\nTo resume a paused schedule:\n  stigmer schedule resume ${reference}`,
    );
  }

  if (isSessionId(reference)) {
    if (validateResourceId(reference) !== null) {
      throw new UsageError(
        `Incomplete session ID: ${reference}\n\nProvide the full session ID (e.g. ses_01abc123xyz456789012345678)`,
      );
    }
    const { openSession } = await import("../resources/run/resume.js");
    await openSession({ client, sessionId: reference, org, mode, outputMode });
    return;
  }

  // Any other resource-ID prefix is not a session.
  if (hasResourceIdPrefix(reference)) {
    throw new UsageError(
      `Resource IDs like "${reference}" are not sessions\n\n` +
        "To resume a session, provide a session ID (ses_…) or search text:\n" +
        "  stigmer resume <session-id>",
    );
  }

  // Bare text → interactive session picker (pre-filtered by the text) on a TTY;
  // otherwise actionable guidance.
  if (interactiveBrowseEnabled(outputMode)) {
    await browseAndResumeSession(reference, client, org, mode, outputMode);
    return;
  }
  throw browseUnavailableError(reference);
}

// Mount the session picker; on selection, re-open the chosen session through the
// existing resume orchestrator. Cancel (Esc/Ctrl+C → undefined) returns cleanly
// so the command exits 0. Loaded lazily to honor the DD-001 boundary.
async function browseAndResumeSession(
  initialQuery: string,
  client: import("../client/index.js").BackendClient,
  org: string,
  mode: import("../resources/run/prepare.js").RunMode,
  outputMode: "inline" | "json",
): Promise<void> {
  const { pickSession } = await import("../resources/picker/ink.js");
  const selected = await pickSession({ client: client.stigmer, initialQuery });
  if (selected === undefined) return;
  const sessionId = selected.metadata?.id ?? "";
  if (sessionId === "") return;
  const { openSession } = await import("../resources/run/resume.js");
  await openSession({ client, sessionId, org, mode, outputMode });
}

function browseUnavailableError(query?: string): UsageError {
  const head =
    query === undefined || query === ""
      ? "Interactive session browsing requires an interactive terminal"
      : `Searching sessions for "${query}" requires an interactive terminal`;
  return new UsageError(`${head}\n\nSpecify a full session ID:\n  stigmer resume <session-id>`);
}
