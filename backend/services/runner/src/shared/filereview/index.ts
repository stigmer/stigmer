/**
 * The runner's file-review producer: harness-agnostic digest + event authoring
 * for the apply-then-review HITL subsystem. Consumed by both the Cursor and
 * deep-agent harnesses to author identical ledger entries.
 */

export {
  aggregateDigest,
  fileChangeKindName,
  fileDigest,
  sha256Bytes,
  sha256Hex,
  type FileDigestInput,
} from "./digest.js";

export {
  appendFileReviewEvents,
  buildBaselineCapturedEvent,
  buildCandidateCapturedEvent,
  buildCapturedFileChange,
  buildFailedEvent,
  buildReconciledEvent,
  eventId,
  hasCandidateCaptured,
  type CapturedChangeInput,
  type ChangeSetContext,
} from "./events.js";

export {
  applyCaptureDecisions,
  captureBaselineToLedger,
  captureCandidateToLedger,
  type CaptureResumeResult,
} from "./capture.js";

export {
  captureProgressDelta,
  isGitWorkTree,
  type GitProgressDelta,
  type GitProgressEntry,
} from "./git-substrate.js";

export {
  buildFileChangeProgress,
  captureFileChangeProgress,
  createGitProgressSubstrate,
  createHybridProgressSubstrate,
  newProgressCaptureState,
  PROGRESS_CAPTURE_MIN_INTERVAL_MS,
  PROGRESS_MAX_ENTRIES,
  shouldCaptureProgress,
  type ProgressCapture,
  type ProgressCaptureState,
  type ProgressDelta,
  type ProgressEntry,
  type ProgressSubstrate,
} from "./progress.js";

export {
  createCasProgressSubstrate,
  type CasTouchedReader,
  type CasTouchedSnapshot,
} from "./cas-progress.js";

export {
  countLineChanges,
  LINE_COUNT_MAX_BYTES,
  type LineChangeCounts,
} from "./line-counts.js";

export {
  applyCasApproved,
  casBlobKey,
  casBlobReader,
  casManifestKey,
  classifyCasChange,
  loadCasManifest,
  restoreCasToBaseline,
  snapshotCasChangeSet,
  type BlobReader,
  type CasBlobRef,
  type CasCapturedFile,
  type CasChangeClassification,
  type CasManifest,
  type CasPathCapture,
  type CasSnapshotRef,
} from "./cas-substrate.js";

export {
  isSecretLikePath,
  partitionIgnoredPathsBySecret,
  SECRET_BASENAME_PATTERNS,
  SECRET_PATH_PATTERNS,
  type CasSecretPartition,
} from "./secret-paths.js";
