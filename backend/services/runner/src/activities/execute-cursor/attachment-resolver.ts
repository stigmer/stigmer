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
 * approved plan at `.stigmer/inputs/<slug>_<id>.plan.md`) resolve to exactly this
 * placement, and the prompt's `<input_files>` section plus any path-derived
 * directives are built from the RESOLVED paths, so prompt and filesystem can
 * never disagree.
 *
 * Duplicate filenames are renamed, never overwritten (issue #364): because
 * placement keys purely on the filename, two attachments with the same name
 * contend for one path — the later one takes the platform's `stem-2.ext`
 * rename (shared/attachment-naming.ts, same semantics as the deep-agent
 * injector and the React composer) and the rename is disclosed in the
 * prompt's `<input_files>` section via {@link ResolvedAttachment.renamedFrom}.
 *
 * Error model: fail-hard, matching the native harness's attachment injector.
 * Attachments are explicit user inputs — an execution that silently runs
 * without one produces silently incorrect results (the "plan file wasn't
 * found" class of failure). Any attachment that cannot be materialized aborts
 * the execution with an actionable error.
 */

import { mkdir, copyFile, readFile, stat, writeFile } from "node:fs/promises";
import { join, basename } from "node:path";
import type { Attachment } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/spec_pb";
import type { ArtifactStorage } from "../../shared/artifact-storage.js";
import { allocateUniqueName } from "../../shared/attachment-naming.js";
import {
  isVisionCandidate,
  type VisionBudget,
  type VisionDegradedReason,
  type VisionImage,
  type VisionOutcome,
} from "../../shared/attachment-vision.js";
import { getPlatformDir } from "../../shared/workspace/platform-dir.js";
import { ensureStigmerSymlink, STIGMER_LOCAL_STATE_DIR } from "../../shared/workspace/stigmer-link.js";

const INPUTS_SUBDIR = "inputs";

export interface ResolvedAttachment {
  /** The final on-disk basename — after any duplicate rename. */
  filename: string;
  /** Workspace-relative path the agent reads (`.stigmer/inputs/{filename}`). */
  relativePath: string;
  /**
   * The attachment's original filename, present only when a duplicate name
   * was renamed (shared/attachment-naming.ts) — rendered as disclosure in
   * the prompt's `<input_files>` section.
   */
  renamedFrom?: string;
  /** Present when the attachment was accepted into the turn's vision payload. */
  vision?: VisionImage;
  /**
   * Present when the attachment was plausibly an image but could not ride
   * inline (see {@link VisionDegradedReason}) — disclosed in the prompt so the
   * agent never silently ignores a photo the user believes it can see.
   * Attachments that were never image-shaped carry neither field.
   */
  visionDegraded?: VisionDegradedReason;
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
  /**
   * The turn's vision selector (attachment-vision.ts owns all policy).
   * `undefined` disables inline image delivery; file materialization is
   * identical either way — vision is strictly additive.
   */
  visionBudget?: VisionBudget;
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

  // Placement keys purely on the filename, so this set is the whole
  // collision domain — sequential resolution means each attachment sees
  // every name claimed before it (see module doc on duplicate handling).
  const takenNames = new Set<string>();
  const results: ResolvedAttachment[] = [];
  for (const attachment of attachments) {
    results.push(await resolveAttachment(attachment, inputsDir, takenNames, options));
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
  takenNames: Set<string>,
  options: AttachmentResolverOptions,
): Promise<ResolvedAttachment> {
  // Local-mode fast path: the file is already on this machine's disk.
  if (options.mode === "local" && attachment.localPath) {
    const { name: filename, renamedFrom } = allocateUniqueName(
      safeInputName(attachment.filename || attachment.localPath),
      takenNames,
    );
    let vision: VisionOutcome | undefined;
    try {
      vision = await materializeLocalFile(attachment, filename, inputsDir, options.visionBudget);
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
      ...(renamedFrom !== undefined ? { renamedFrom } : {}),
      ...visionOutcomeFields(vision),
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

  const { name: filename, renamedFrom } = allocateUniqueName(
    safeInputName(attachment.filename || attachment.storageKey),
    takenNames,
  );
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

  // The bytes are already in hand for the file write — offer them to the
  // vision budget before they go out of scope (the sniff decides eligibility;
  // no pre-filter needed on this branch).
  const vision = options.visionBudget?.offer(filename, attachment.contentType, content);

  return {
    filename,
    relativePath: join(STIGMER_LOCAL_STATE_DIR, INPUTS_SUBDIR, filename),
    ...(renamedFrom !== undefined ? { renamedFrom } : {}),
    ...visionOutcomeFields(vision),
  };
}

/**
 * Materialize a local-path attachment, reading the bytes only when they are
 * plausibly a vision candidate within the per-image cap — a 25 MB PDF (or an
 * oversized image, detected by stat) keeps the plain `copyFile` and never
 * enters memory. Returns the vision outcome, or `undefined` when vision is
 * disabled or the file is not a candidate.
 */
async function materializeLocalFile(
  attachment: Attachment,
  filename: string,
  inputsDir: string,
  visionBudget: VisionBudget | undefined,
): Promise<VisionOutcome | undefined> {
  const dest = join(inputsDir, filename);
  if (!visionBudget || !isVisionCandidate(attachment.contentType, filename)) {
    await copyFile(attachment.localPath, dest);
    return undefined;
  }
  // Blind-model check BEFORE the size check: a blind model's oversized image
  // must report the honest model_no_vision reason, never too_large's "resend
  // smaller" advice — and an in-cap image needn't be read at all.
  if (visionBudget.modelCannotSee()) {
    await copyFile(attachment.localPath, dest);
    return visionBudget.offerBlind();
  }
  const info = await stat(attachment.localPath);
  if (visionBudget.exceedsImageCap(info.size)) {
    await copyFile(attachment.localPath, dest);
    return visionBudget.offerOversized();
  }
  const content = await readFile(attachment.localPath);
  await writeFile(dest, content);
  return visionBudget.offer(filename, attachment.contentType, content);
}

function visionOutcomeFields(
  outcome: VisionOutcome | undefined,
): Pick<ResolvedAttachment, "vision" | "visionDegraded"> {
  if (outcome === undefined || outcome.kind === "skipped") return {};
  return outcome.kind === "accepted"
    ? { vision: outcome.image }
    : { visionDegraded: outcome.reason };
}

/**
 * Reduce a caller-influenced name to a single, safe path component for writing
 * under the inputs dir. The name (an attachment's original filename, or a
 * storage key's tail) is untrusted — a value like `../../evil.md` would steer
 * the write outside `.stigmer/inputs/`. Taking the basename strips any path
 * structure; the residual `.`/`..`/empty cases (which basename does not strip)
 * are rejected loudly so the write target is always a real file inside inputs.
 */
function safeInputName(raw: string): string {
  const name = basename(raw);
  if (name === "" || name === "." || name === "..") {
    throw new AttachmentResolutionError(
      raw,
      `'${raw}' does not yield a usable filename for materialization`,
    );
  }
  return name;
}
