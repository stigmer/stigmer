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
 * Placement is the `inputs/` namespace — the platform directory every
 * harness surfaces in the workspace through the `.stigmer` link, and the
 * only place an attachment may land. An attachment names its place INSIDE
 * that namespace with `mountPath` (`inputs/<name>`, `inputs/<dir>/`,
 * `.stigmer/inputs/<name>`; a leading slash is stripped), or takes the
 * default `inputs/{filename}`. A `mountPath` outside the namespace is
 * refused with an actionable error, never relocated silently: a file
 * written into the user's own tree would be committed to the session's
 * write-back branch on completion (`git add -A`), and every real producer —
 * the CLI's directory attachments, the approved plan the console mounts —
 * already stays inside `inputs/` (S3 M1, Q-M1-2; the proto's `/workspace/…`
 * example is a doc issue). The prompt's `<input_files>` section and every
 * path-derived directive are built from the RESOLVED paths, so prompt and
 * filesystem can never disagree.
 *
 * Archives: an attachment marked `extract` is a ZIP whose entries land under
 * its mount as a DIRECTORY (`inputs/<mount>/<entry>`), validated and
 * decompressed by `attachment-zip.ts` (the #567 guards). Each entry is its
 * own {@link ResolvedAttachment} with no vision, no `renamedFrom` and no
 * `downloadUrl`: an image inside a ZIP has no attachment-level bytes, a
 * renamed mount directory is visible through every entry path, and the
 * stored object is the ZIP, not any listed file.
 *
 * Duplicate names are renamed, never overwritten (issue #364), in two passes:
 * explicit mount paths claim their exact targets first — two attachments
 * pinning the SAME path is a user contradiction no rename can honestly
 * resolve, so that alone still refuses — and default-derived names then
 * uniquify around everything already taken with the platform's `stem-2.ext`
 * rename (shared/attachment-naming.ts, the React composer's semantics),
 * disclosed in the prompt via {@link ResolvedAttachment.renamedFrom}.
 *
 * Error model: fail-hard. Attachments are explicit user inputs — an
 * execution that silently runs without one produces silently incorrect
 * results (the "plan file wasn't found" class of failure). Any attachment
 * that cannot be materialized aborts the execution with an actionable
 * {@link AttachmentResolutionError}; an archive that fails its guards
 * aborts with the guard's own `AttachmentValidationError`.
 *
 * Until S3 M1 this resolver ignored `mountPath` and could not extract; the
 * native harness's `attachment-injector.ts` did both and is retired at M2b
 * for this one pipeline (Q-S3-14).
 */

import { mkdir, copyFile, readFile, stat, writeFile } from "node:fs/promises";
import { join, basename, dirname, posix } from "node:path";
import type { Attachment } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/spec_pb";
import type { ArtifactStorage } from "./artifact-storage.js";
import { mintAttachmentDownloadUrl } from "./attachment-download-urls.js";
import { allocateUniqueName } from "./attachment-naming.js";
import { decompressEntry, parseAndValidateZip } from "./attachment-zip.js";
import {
  isVisionCandidate,
  type VisionBudget,
  type VisionDegradedReason,
  type VisionImage,
  type VisionOutcome,
} from "./attachment-vision.js";
import { getPlatformDir } from "./workspace/platform-dir.js";
import { ensureStigmerSymlink, STIGMER_LOCAL_STATE_DIR } from "./workspace/stigmer-link.js";

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
  /**
   * A download URL for the attachment's stored object, listed in the prompt's
   * `<input_files>` section so the agent can hand the file to a tool whose
   * backend cannot read the sandbox filesystem (issue #532). Minted whenever
   * the attachment has a `storageKey` and a usable storage — including on the
   * localPath fast path when an uploaded copy also exists. Absent when there
   * is nothing to mint or the mint failed (non-fatal — the policy, the
   * degrade log, and the prompt wording all live in
   * shared/attachment-download-urls.ts).
   */
  downloadUrl?: string;
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

  // Every place is decided before any bytes move: an explicit-path
  // contradiction refuses up front, and a default name never lands on a path
  // an explicit one claims (see module doc on duplicate handling).
  const places = resolvePlacements(attachments);
  const results: ResolvedAttachment[] = [];
  for (const attachment of attachments) {
    const place = places.get(attachment)!;
    if (attachment.extract) {
      results.push(...(await extractArchive(attachment, place, inputsDir, options)));
    } else {
      results.push(await resolveAttachment(attachment, place, inputsDir, options));
    }
  }

  console.log(
    `[attachment-resolver] resolved ${results.length} attachment(s): ` +
    results.map((r) => r.relativePath).join(", "),
  );

  return results;
}

async function resolveAttachment(
  attachment: Attachment,
  place: Placement,
  inputsDir: string,
  options: AttachmentResolverOptions,
): Promise<ResolvedAttachment> {
  const { relative, renamedFrom } = place;
  // The final basename is the canonical filename: after a duplicate rename
  // the original attachment.filename no longer names the file on disk, and
  // the vision label must match what the prompt lists.
  const filename = posix.basename(relative);
  await mkdir(dirname(join(inputsDir, relative)), { recursive: true });

  // Local-mode fast path: the file is already on this machine's disk.
  if (options.mode === "local" && attachment.localPath) {
    let vision: VisionOutcome | undefined;
    try {
      vision = await materializeLocalFile(attachment, filename, join(inputsDir, relative), options.visionBudget);
    } catch (err) {
      throw new AttachmentResolutionError(
        attachment.filename,
        `failed to copy local file '${attachment.localPath}': ` +
        `${err instanceof Error ? err.message : String(err)}`,
      );
    }
    // The fast path skips storage for the BYTES, but an uploaded copy (an
    // attachment carrying both localPath and storageKey) still supports the
    // URL hand-off — the mint rule is branch-independent.
    const downloadUrl = await mintAttachmentDownloadUrl(
      options.storage, attachment.storageKey, filename,
    );
    return {
      filename,
      relativePath: join(STIGMER_LOCAL_STATE_DIR, INPUTS_SUBDIR, relative),
      ...(renamedFrom !== undefined ? { renamedFrom } : {}),
      ...visionOutcomeFields(vision),
      ...(downloadUrl !== undefined ? { downloadUrl } : {}),
    };
  }

  // Universal path: download the uploaded content by storage key.
  const content = await downloadFromStorage(attachment, options);
  await writeFile(join(inputsDir, relative), content);

  // The bytes are already in hand for the file write — offer them to the
  // vision budget before they go out of scope (the sniff decides eligibility;
  // no pre-filter needed on this branch).
  const vision = options.visionBudget?.offer(filename, attachment.contentType, content);

  const downloadUrl = await mintAttachmentDownloadUrl(
    options.storage, attachment.storageKey, filename,
  );

  return {
    filename,
    relativePath: join(STIGMER_LOCAL_STATE_DIR, INPUTS_SUBDIR, relative),
    ...(renamedFrom !== undefined ? { renamedFrom } : {}),
    ...visionOutcomeFields(vision),
    ...(downloadUrl !== undefined ? { downloadUrl } : {}),
  };
}

/**
 * Extract an `extract` attachment's archive under its mount directory. The
 * bytes are read whole (an archive is never a vision candidate, so the local
 * fast path's lazy read has nothing to save), validated and decompressed by
 * the shared guards, and written entry by entry; the entries are the
 * resolved attachments (see the module doc for what they do not carry).
 */
async function extractArchive(
  attachment: Attachment,
  place: Placement,
  inputsDir: string,
  options: AttachmentResolverOptions,
): Promise<ResolvedAttachment[]> {
  const content = await bytesOf(attachment, options);
  const entries = parseAndValidateZip(content, attachment.filename);
  const mountDir = place.relative.replace(/\/+$/, "");
  const results: ResolvedAttachment[] = [];
  for (const entry of entries) {
    const bytes = await decompressEntry(entry, attachment.filename);
    const relative = posix.join(mountDir, entry.relativePath);
    const dest = join(inputsDir, relative);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, bytes);
    results.push({
      filename: posix.basename(entry.relativePath),
      relativePath: join(STIGMER_LOCAL_STATE_DIR, INPUTS_SUBDIR, relative),
    });
  }
  return results;
}

/** The attachment's bytes, from the local fast path or from storage. */
async function bytesOf(attachment: Attachment, options: AttachmentResolverOptions): Promise<Buffer> {
  if (options.mode === "local" && attachment.localPath) {
    try {
      return await readFile(attachment.localPath);
    } catch (err) {
      throw new AttachmentResolutionError(
        attachment.filename,
        `failed to read local file '${attachment.localPath}': ` +
        `${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  return downloadFromStorage(attachment, options);
}

async function downloadFromStorage(attachment: Attachment, options: AttachmentResolverOptions): Promise<Buffer> {
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
  try {
    return await options.storage.download(attachment.storageKey);
  } catch (err) {
    throw new AttachmentResolutionError(
      attachment.filename,
      `failed to download from storage (key: ${attachment.storageKey}): ` +
      `${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

// ── Placement ────────────────────────────────────────────────────────

/** Where an attachment lands, relative to the `inputs/` directory. */
interface Placement {
  readonly relative: string;
  /** Present when a default-derived name was uniquified (issue #364). */
  readonly renamedFrom?: string;
}

/**
 * The two-pass placement (see module doc): explicit mount paths first, each
 * resolved into the namespace and refused on a contradiction; then the
 * default-derived names, uniquified around every name already taken directly
 * under `inputs/`.
 */
function resolvePlacements(attachments: readonly Attachment[]): Map<Attachment, Placement> {
  const places = new Map<Attachment, Placement>();
  const claimed = new Map<string, Attachment>();

  for (const attachment of attachments) {
    if (!attachment.mountPath) continue;
    const relative = explicitPlacement(attachment);
    const existing = claimed.get(relative);
    if (existing) {
      throw new AttachmentResolutionError(
        attachment.filename,
        `mount path '${attachment.mountPath}' collides with attachment '${existing.filename}'. ` +
        "Set distinct mountPath values on the attachments to resolve this conflict.",
      );
    }
    claimed.set(relative, attachment);
    places.set(attachment, { relative });
  }

  const takenNames = new Set<string>();
  for (const relative of claimed.keys()) {
    if (!relative.includes("/")) takenNames.add(relative);
  }
  for (const attachment of attachments) {
    if (attachment.mountPath) continue;
    const { name, renamedFrom } = allocateUniqueName(
      safeInputName(attachment.filename || attachment.localPath || attachment.storageKey),
      takenNames,
    );
    places.set(attachment, renamedFrom !== undefined ? { relative: name, renamedFrom } : { relative: name });
  }
  return places;
}

/** The namespace prefixes an explicit `mountPath` may name, longest first. */
const INPUTS_NAMESPACE_PREFIXES = [`${STIGMER_LOCAL_STATE_DIR}/${INPUTS_SUBDIR}`, INPUTS_SUBDIR] as const;

/**
 * Resolve an explicit `mountPath` into a path relative to `inputs/`, or
 * refuse: empty after cleaning, outside the namespace, or climbing out of it.
 * A caller-supplied path is untrusted, so `..` is judged after normalization.
 */
function explicitPlacement(attachment: Attachment): string {
  const cleaned = attachment.mountPath.replace(/^\/+/, "").replace(/\/+$/, "");
  const prefix = INPUTS_NAMESPACE_PREFIXES.find((p) => cleaned === p || cleaned.startsWith(`${p}/`));
  if (prefix === undefined) {
    throw new AttachmentResolutionError(
      attachment.filename,
      `mount path '${attachment.mountPath}' is outside the attachment namespace. ` +
      `Attachments land under '${INPUTS_SUBDIR}/' (surfaced as '${STIGMER_LOCAL_STATE_DIR}/${INPUTS_SUBDIR}/'); ` +
      `set mountPath to '${INPUTS_SUBDIR}/<name>' or leave it empty for the default placement.`,
    );
  }
  const relative = posix.normalize(cleaned.slice(prefix.length).replace(/^\/+/, ""));
  if (relative === "" || relative === ".") {
    throw new AttachmentResolutionError(
      attachment.filename,
      `mount path '${attachment.mountPath}' names the inputs directory itself, not a place inside it`,
    );
  }
  if (relative === ".." || relative.startsWith("../") || posix.isAbsolute(relative)) {
    throw new AttachmentResolutionError(
      attachment.filename,
      `mount path '${attachment.mountPath}' escapes the attachment namespace`,
    );
  }
  return relative;
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
  dest: string,
  visionBudget: VisionBudget | undefined,
): Promise<VisionOutcome | undefined> {
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
