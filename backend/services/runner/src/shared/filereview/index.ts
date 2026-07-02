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

export { isGitWorkTree } from "./git-substrate.js";

export {
  applyCasApproved,
  casBlobKey,
  casBlobReader,
  casManifestKey,
  loadCasManifest,
  restoreCasToBaseline,
  snapshotCasChangeSet,
  type BlobReader,
  type CasBlobRef,
  type CasCapturedFile,
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
