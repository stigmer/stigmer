/**
 * Content-addressed snapshot/restore substrate for the apply-then-review HITL
 * subsystem — the sibling of {@link ./git-substrate.js} for paths git cannot
 * snapshot (`.gitignored` and non-git files). It closes the "gap" the git
 * substrate documents at its top: shell/MCP and gitignored writes are not
 * reversible by git, so today they stay on the deny-gate; this module makes
 * gitignored / non-git file edits capturable, reviewable, and reversible.
 *
 * THE MODEL (mirrors the git substrate, different storage domain)
 * --------------------------------------------------------------
 * The git substrate snapshots the whole working tree at the turn boundary and
 * diffs two pinned tree objects. CAS cannot do that: git does not see ignored
 * paths, and a plain directory has no history to recover a pre-edit byte from.
 * So the CAS substrate is fed the exact before/after bytes of each touched path
 * (captured by the harness at mutation time — the deep-agent's
 * CapturingFilesystemBackend, or the Cursor hook staging the file before it
 * allows the write) and:
 *
 *  1. Stores each distinct before/after body as a CONTENT-ADDRESSED blob under
 *     `artifacts/{executionId}/filereview/cas/blobs/{sha256}` (deduped by hash,
 *     idempotent), reusing the existing {@link ArtifactStorage} — no new store.
 *  2. Writes a per-change-set MANIFEST (path -> before/after blob refs) under
 *     `artifacts/{executionId}/filereview/cas/{changeSetId}.manifest.json`. The
 *     manifest is the durable, authoritative source for the resume-time
 *     reconcile — the CAS analogue of the git substrate's pinned refs.
 *  3. On resume, reconciles the workspace to the user's per-file decisions
 *     sourced ENTIRELY from the manifest: approved files are written to their
 *     "after" bytes; rejected/undecided files are snapped back to their "before"
 *     bytes (or removed, for a rejected create). Symmetric and idempotent.
 *
 * DURABILITY DOMAIN (design doc 11 D3)
 * -----------------------------------
 * Unlike git refs, which live inside the repo, CAS blobs + manifests live in
 * artifact storage (a fixed host path in OSS, R2 via the proxy in Cloud) — a
 * DIFFERENT durability domain that must outlive the multi-day approval wait and
 * a sandbox recycle. Because reconcile reads only from the manifest + blobs
 * (never the live tree), it converges regardless of the tree's current state,
 * so a Temporal retry or a recycled workspace is harmless.
 *
 * WHAT THIS MODULE IS NOT
 * -----------------------
 * It is harness-agnostic and wiring-agnostic: it takes explicit before/after
 * bytes, never reads gitignore, never talks to a hook. WHICH paths flow here (vs
 * stay on the deny-gate or block as DIFF_UNREVIEWABLE), and the secret-safety
 * gate (design doc 12), are the harness adapter's concern, applied BEFORE bytes
 * reach this module. This module never persists a path it is not given.
 *
 * @since File-Change HITL Redesign (Phase 3 — CAS)
 */

import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  FileCaptureClass,
  FileChangeKind,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { ArtifactStorage } from "../artifact-storage.js";
import { bytesLookBinary } from "../file-change.js";
import { sha256Bytes, sha256Hex } from "./digest.js";

/**
 * Reads an artifact's raw bytes back by storage key. Injected so this module
 * stays free of HTTP/transport concerns and is trivially testable; production
 * callers build one with {@link casBlobReader}.
 */
export type BlobReader = (storageKey: string) => Promise<Buffer>;

/** A stored, content-addressed blob and where to find it. */
export interface CasBlobRef {
  /** Lowercase-hex SHA-256 of the bytes (the content address + enforcement digest). */
  readonly sha256: string;
  /** Artifact-storage key the bytes live under. */
  readonly storageKey: string;
  readonly sizeBytes: number;
  /** A NUL byte was present — the diff cannot render as text (blocks COMPLETE). */
  readonly isBinary: boolean;
}

/** One captured file within a CAS change set (before/after blob refs). */
export interface CasCapturedFile {
  /** Path before the change (workspace-relative). Empty for ADD. */
  readonly pathBefore: string;
  /** Path after the change. Empty for DELETE. */
  readonly pathAfter: string;
  readonly kind: FileChangeKind;
  /** Which substrate class captured it (GIT_IGNORED_CAPTURED | NON_GIT_CAS). */
  readonly captureClass: FileCaptureClass;
  /** Pre-edit blob; absent for ADD. */
  readonly before?: CasBlobRef;
  /** Post-edit blob; absent for DELETE. */
  readonly after?: CasBlobRef;
  /** False when a side is binary — the change set cannot be approved as complete. */
  readonly diffComplete: boolean;
}

/** The durable manifest for one change set — the reconcile's source of truth. */
export interface CasManifest {
  readonly changeSetId: string;
  readonly files: readonly CasCapturedFile[];
}

/** A pointer to a persisted {@link CasManifest} (mirrors the proto CasManifestRef). */
export interface CasSnapshotRef {
  /** SHA-256 over the canonical manifest JSON (tamper/integrity check). */
  readonly manifestDigest: string;
  /** Artifact-storage key the manifest JSON lives under. */
  readonly artifactUri: string;
}

/** The before/after bytes of one path the harness captured this turn. */
export interface CasPathCapture {
  /** Workspace-root-relative path. */
  readonly path: string;
  /** Pre-edit bytes; `null` when the file did not exist before (an ADD). */
  readonly before: Uint8Array | null;
  /** Post-edit bytes; `null` when the file was removed (a DELETE). */
  readonly after: Uint8Array | null;
  /** Which substrate class this path belongs to (for the ledger). */
  readonly captureClass: FileCaptureClass;
}

// ---------------------------------------------------------------------------
// Key namespace (design doc 08: execution-scoped, reuse existing authz)
// ---------------------------------------------------------------------------

/** The CAS blob key for a content hash, under the execution's artifact prefix. */
export function casBlobKey(executionId: string, sha256: string): string {
  return `artifacts/${executionId}/filereview/cas/blobs/${sha256}`;
}

/**
 * The manifest key for a change set. The change-set id (`{exec}:{turnSeq}`)
 * carries a colon; it is sanitized to a filesystem/object-store-safe segment so
 * the key is portable across the local FS and R2 backends.
 */
export function casManifestKey(executionId: string, changeSetId: string): string {
  const safe = changeSetId.replace(/[^A-Za-z0-9._-]/g, "_");
  return `artifacts/${executionId}/filereview/cas/${safe}.manifest.json`;
}

// ---------------------------------------------------------------------------
// Capture
// ---------------------------------------------------------------------------

/**
 * Capture a CAS change set: store every distinct before/after body as a
 * content-addressed blob (deduped, idempotent), assemble the per-file manifest,
 * persist it, and return the manifest plus its ref for the ledger's SnapshotRef.
 *
 * Captures whose before and after bytes are byte-identical (a path touched but
 * left unchanged) are dropped — they are not a reviewable change, exactly as the
 * git substrate's diff omits unchanged files.
 */
export async function snapshotCasChangeSet(opts: {
  readonly storage: ArtifactStorage;
  readonly executionId: string;
  readonly changeSetId: string;
  readonly captures: readonly CasPathCapture[];
}): Promise<{ manifest: CasManifest; ref: CasSnapshotRef }> {
  const { storage, executionId, changeSetId, captures } = opts;

  const files: CasCapturedFile[] = [];
  for (const capture of captures) {
    const file = await buildCasCapturedFile(storage, executionId, capture);
    if (file) files.push(file);
  }
  // Deterministic order (by after path, then before path) so the manifest digest
  // is stable and, later, composes with the git manifest into one aggregate
  // digest that is byte-identical across editions (design doc 08 D3).
  files.sort(compareByPath);

  const manifest: CasManifest = { changeSetId, files };
  const canonical = canonicalManifestJson(manifest);
  const manifestKey = casManifestKey(executionId, changeSetId);
  await storage.upload(manifestKey, Buffer.from(canonical, "utf8"), "application/json");

  return {
    manifest,
    ref: { manifestDigest: sha256Hex(canonical), artifactUri: manifestKey },
  };
}

/**
 * Store one path's before/after blobs and classify the change. Returns
 * `undefined` for a no-op (both sides absent, or an unchanged touch).
 */
async function buildCasCapturedFile(
  storage: ArtifactStorage,
  executionId: string,
  capture: CasPathCapture,
): Promise<CasCapturedFile | undefined> {
  const { path, before, after, captureClass } = capture;
  if (before === null && after === null) return undefined;

  const beforeBuf = before === null ? null : Buffer.from(before);
  const afterBuf = after === null ? null : Buffer.from(after);

  // A touch that did not change the bytes is not a reviewable change.
  if (beforeBuf && afterBuf && beforeBuf.equals(afterBuf)) return undefined;

  const beforeRef = beforeBuf ? await storeBlob(storage, executionId, beforeBuf) : undefined;
  const afterRef = afterBuf ? await storeBlob(storage, executionId, afterBuf) : undefined;

  const kind =
    beforeRef === undefined
      ? FileChangeKind.ADD
      : afterRef === undefined
        ? FileChangeKind.DELETE
        : FileChangeKind.MODIFY;

  const isCreate = kind === FileChangeKind.ADD;
  const isDelete = kind === FileChangeKind.DELETE;

  return {
    pathBefore: isCreate ? "" : path,
    pathAfter: isDelete ? "" : path,
    kind,
    captureClass,
    before: beforeRef,
    after: afterRef,
    // Binary on either side means the diff cannot render as text; the change set
    // then cannot be approved as complete (parity with the git substrate).
    diffComplete: !(beforeRef?.isBinary || afterRef?.isBinary),
  };
}

/** Upload bytes under their content-address, skipping the write when present. */
async function storeBlob(
  storage: ArtifactStorage,
  executionId: string,
  bytes: Buffer,
): Promise<CasBlobRef> {
  const sha256 = sha256Bytes(bytes);
  const storageKey = casBlobKey(executionId, sha256);
  // Content-addressed: identical bytes yield the same key, so an existing blob
  // is never re-uploaded (idempotent under Temporal retries + intra-turn dedup).
  if (!(await storage.exists(storageKey))) {
    await storage.upload(storageKey, bytes, "application/octet-stream");
  }
  return { sha256, storageKey, sizeBytes: bytes.length, isBinary: bytesLookBinary(bytes) };
}

// ---------------------------------------------------------------------------
// Resume: load + reconcile
// ---------------------------------------------------------------------------

/**
 * Load a change set's manifest for the resume-time reconcile. Returns
 * `undefined` when this execution has no CAS manifest (not a CAS turn), so the
 * caller can fall through — mirroring the git substrate's `recomputeChangeSet`.
 */
export async function loadCasManifest(opts: {
  readonly storage: ArtifactStorage;
  readonly readBlob: BlobReader;
  readonly executionId: string;
  readonly changeSetId: string;
}): Promise<CasManifest | undefined> {
  const { storage, readBlob, executionId, changeSetId } = opts;
  const key = casManifestKey(executionId, changeSetId);
  if (!(await storage.exists(key))) return undefined;
  const bytes = await readBlob(key);
  return JSON.parse(bytes.toString("utf8")) as CasManifest;
}

/**
 * Ensure the APPROVED files hold their captured "after" bytes on disk. An
 * approved CREATE/MODIFY writes the after blob (integrity-checked against its
 * content address); an approved DELETE removes the file. Idempotent — re-running
 * converges (the after blob is immutable), so a Temporal retry is safe.
 *
 * Enforcement ("what you approve is what applies"): the downloaded bytes must
 * still hash to the blob's content address; a mismatch (storage corruption)
 * throws rather than writing wrong bytes.
 */
export async function applyCasApproved(opts: {
  readonly readBlob: BlobReader;
  readonly workspaceRoot: string;
  readonly files: readonly CasCapturedFile[];
}): Promise<void> {
  const { readBlob, workspaceRoot, files } = opts;
  for (const file of files) {
    if (file.kind === FileChangeKind.DELETE) {
      await rm(join(workspaceRoot, file.pathBefore), { force: true });
      continue;
    }
    // CREATE or MODIFY: write the approved after bytes.
    if (!file.after) continue;
    await writeVerifiedBlob(readBlob, join(workspaceRoot, file.pathAfter), file.after);
  }
}

/**
 * Snap the REJECTED/undecided files back to their captured "before" bytes: a
 * rejected CREATE is removed; a rejected MODIFY/DELETE is rewritten with its
 * before blob. Idempotent, and the byte-exact inverse of {@link applyCasApproved}.
 */
export async function restoreCasToBaseline(opts: {
  readonly readBlob: BlobReader;
  readonly workspaceRoot: string;
  readonly files: readonly CasCapturedFile[];
}): Promise<void> {
  const { readBlob, workspaceRoot, files } = opts;
  for (const file of files) {
    if (file.kind === FileChangeKind.ADD) {
      // The file did not exist before this turn — remove the agent's creation.
      await rm(join(workspaceRoot, file.pathAfter), { force: true });
      continue;
    }
    // MODIFY or DELETE: the baseline holds the file — restore its exact bytes.
    if (!file.before) continue;
    await writeVerifiedBlob(readBlob, join(workspaceRoot, file.pathBefore), file.before);
  }
}

/**
 * Adapt the artifact storage port's {@link ArtifactStorage.download} into a
 * {@link BlobReader}. The seam is retained so the reconcile functions
 * ({@link loadCasManifest}, {@link applyCasApproved}, {@link restoreCasToBaseline})
 * depend only on "read one blob by key", not on the whole storage interface.
 * `download` already throws a descriptive, key-scoped error on a missing blob or
 * transport failure, so no extra wrapping is needed here.
 */
export function casBlobReader(storage: ArtifactStorage): BlobReader {
  return (storageKey: string): Promise<Buffer> => storage.download(storageKey);
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/** Download a blob, verify its content address, and write it to `abs`. */
async function writeVerifiedBlob(
  readBlob: BlobReader,
  abs: string,
  ref: CasBlobRef,
): Promise<void> {
  const bytes = await readBlob(ref.storageKey);
  const actual = sha256Bytes(bytes);
  if (actual !== ref.sha256) {
    throw new Error(
      `CAS blob integrity check failed for '${ref.storageKey}': ` +
      `expected ${ref.sha256}, got ${actual}`,
    );
  }
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, bytes);
}

/** Stable order: by after path, then before path (substrate-agnostic, doc 08 D3). */
function compareByPath(a: CasCapturedFile, b: CasCapturedFile): number {
  const ka = a.pathAfter || a.pathBefore;
  const kb = b.pathAfter || b.pathBefore;
  if (ka < kb) return -1;
  if (ka > kb) return 1;
  return a.pathBefore < b.pathBefore ? -1 : a.pathBefore > b.pathBefore ? 1 : 0;
}

/** Serialize a blob ref fully so the persisted manifest round-trips faithfully. */
function serializeBlob(b: CasBlobRef | undefined): object | null {
  return b
    ? { sha256: b.sha256, storageKey: b.storageKey, sizeBytes: b.sizeBytes, isBinary: b.isBinary }
    : null;
}

/**
 * The canonical JSON the manifest is BOTH persisted as and digested over: files
 * in sorted order with a fixed key order, blob refs serialized in full (incl.
 * `storageKey`) so a reloaded manifest is a faithful {@link CasManifest} the
 * resume reconcile can read directly. Every field is deterministic, so the digest
 * is a stable integrity check over the exact stored bytes.
 */
function canonicalManifestJson(manifest: CasManifest): string {
  const files = manifest.files.map((f) => ({
    pathBefore: f.pathBefore,
    pathAfter: f.pathAfter,
    kind: f.kind,
    captureClass: f.captureClass,
    before: serializeBlob(f.before),
    after: serializeBlob(f.after),
    diffComplete: f.diffComplete,
  }));
  return JSON.stringify({ changeSetId: manifest.changeSetId, files });
}
