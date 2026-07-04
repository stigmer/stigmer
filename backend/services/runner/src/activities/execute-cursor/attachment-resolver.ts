/**
 * Resolves execution attachments into the platform-managed directory.
 *
 * Attachments are files provided as inputs to the agent execution. Each is
 * materialized under the session platform dir's `inputs/` subdirectory and
 * surfaced to the agent as `.stigmer/inputs/{filename}` through the workspace
 * `.stigmer` symlink (see stigmer-link.ts), which this resolver guarantees —
 * an agent with attachments but no skills still gets the link.
 *
 * Content sources, in order:
 * - `localPath` (local mode only): read straight off the caller's disk — the
 *   CLI fast path, no storage round-trip.
 * - `storageKey`: downloaded via {@link ArtifactStorage} — the universal path;
 *   the backend's create pipeline requires a storage key on every attachment
 *   it accepts, and in local mode the storage reads directly off disk.
 *
 * Placement is always `inputs/{filename}` — the platform namespace this
 * harness can surface in the workspace. An attachment's `mountPath` is
 * honored by convention, not mechanism: the standard mounts (e.g. the
 * approved plan at `.stigmer/inputs/plan.md`) resolve to exactly this
 * placement, and the prompt's `<input_files>` section plus any path-derived
 * directives are built from the RESOLVED paths, so prompt and filesystem can
 * never disagree.
 *
 * Error model: fail-hard, matching the native harness's attachment injector.
 * Attachments are explicit user inputs — an execution that silently runs
 * without one produces silently incorrect results (the "plan file wasn't
 * found" class of failure). Any attachment that cannot be materialized aborts
 * the execution with an actionable error.
 */

import { mkdir, copyFile, writeFile } from "node:fs/promises";
import { join, basename } from "node:path";
import type { Attachment } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/spec_pb";
import type { ArtifactStorage } from "../../shared/artifact-storage.js";
import { getPlatformDir } from "../../shared/workspace/platform-dir.js";
import { ensureStigmerSymlink, STIGMER_LOCAL_STATE_DIR } from "./stigmer-link.js";

const INPUTS_SUBDIR = "inputs";

export interface ResolvedAttachment {
  filename: string;
  /** Workspace-relative path the agent reads (`.stigmer/inputs/{filename}`). */
  relativePath: string;
}

export interface AttachmentResolverOptions {
  sessionId: string;
  primaryWorkspaceDir: string;
  mode: "local" | "cloud";
  /**
   * Artifact storage for `storageKey` downloads. `undefined` when the runner
   * could not build a store (proxy misconfig) — a storage-backed attachment
   * then fails with an actionable error rather than a silent skip.
   */
  storage: ArtifactStorage | undefined;
}

export class AttachmentResolutionError extends Error {
  readonly attachmentFilename: string;
  readonly reason: string;

  constructor(attachmentFilename: string, reason: string) {
    super(`Attachment '${attachmentFilename}': ${reason}`);
    this.name = "AttachmentResolutionError";
    this.attachmentFilename = attachmentFilename;
    this.reason = reason;
  }
}

/**
 * Materialize all attachments under `.stigmer/inputs/` and return their
 * workspace-relative paths for prompt injection. Throws
 * {@link AttachmentResolutionError} on the first attachment that cannot be
 * materialized (fail-hard — see module doc).
 */
export async function resolveAttachments(
  attachments: Attachment[],
  options: AttachmentResolverOptions,
): Promise<ResolvedAttachment[]> {
  if (attachments.length === 0) return [];

  const platformDir = getPlatformDir(options.sessionId);
  const inputsDir = join(platformDir, INPUTS_SUBDIR);
  await mkdir(inputsDir, { recursive: true });

  // The symlink is what makes `inputs/` visible in the workspace; without it
  // every resolved path below would dangle (the skill resolver also ensures
  // it, but only when the agent has skills).
  await ensureStigmerSymlink(options.primaryWorkspaceDir, platformDir);

  const results: ResolvedAttachment[] = [];
  for (const attachment of attachments) {
    results.push(await resolveAttachment(attachment, inputsDir, options));
  }

  console.log(
    `[attachment-resolver] resolved ${results.length} attachment(s): ` +
    results.map((r) => r.relativePath).join(", "),
  );

  return results;
}

async function resolveAttachment(
  attachment: Attachment,
  inputsDir: string,
  options: AttachmentResolverOptions,
): Promise<ResolvedAttachment> {
  // Local-mode fast path: the file is already on this machine's disk.
  if (options.mode === "local" && attachment.localPath) {
    const filename = attachment.filename || basename(attachment.localPath);
    try {
      await copyFile(attachment.localPath, join(inputsDir, filename));
    } catch (err) {
      throw new AttachmentResolutionError(
        attachment.filename,
        `failed to copy local file '${attachment.localPath}': ` +
        `${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return {
      filename,
      relativePath: join(STIGMER_LOCAL_STATE_DIR, INPUTS_SUBDIR, filename),
    };
  }

  // Universal path: download the uploaded content by storage key.
  if (!attachment.storageKey) {
    throw new AttachmentResolutionError(
      attachment.filename,
      "missing storageKey — cannot download attachment from storage",
    );
  }
  if (!options.storage) {
    throw new AttachmentResolutionError(
      attachment.filename,
      `artifact storage is unavailable, so this attachment ` +
      `(key: ${attachment.storageKey}) cannot be downloaded`,
    );
  }

  const filename = attachment.filename || basename(attachment.storageKey);
  let content: Buffer;
  try {
    content = await options.storage.download(attachment.storageKey);
  } catch (err) {
    throw new AttachmentResolutionError(
      attachment.filename,
      `failed to download from storage (key: ${attachment.storageKey}): ` +
      `${err instanceof Error ? err.message : String(err)}`,
    );
  }
  await writeFile(join(inputsDir, filename), content);

  return {
    filename,
    relativePath: join(STIGMER_LOCAL_STATE_DIR, INPUTS_SUBDIR, filename),
  };
}
