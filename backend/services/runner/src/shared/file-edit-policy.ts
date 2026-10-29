/**
 * The two rules of the approval gate that never need a person, for every
 * engine's gate: a built-in write to a secret-like path is refused outright,
 * and a built-in file write or delete flows unasked where the turn's file
 * review lets it. Both run before the default (`approval-policy.ts`
 * `resolveToolApproval`), so a call they settle is never asked.
 *
 * Pure decisions over a call's category, its arguments and the turn's
 * capture posture ({@link FileEditPosture}): what a gate does with the
 * answer (the message the model reads, the row, the blocked path's
 * recording) is the gate's. The Stigmer harness's gate (`middleware/approval-gate.ts`)
 * and the Claude gate (`activities/execute-claude/gate.ts`) both call them,
 * so the two engines can never disagree on which edit flows or which secret
 * is kept out.
 */

import { extractFilePath } from "./file-tools.js";
import { isSecretLikePath } from "./filereview/secret-paths.js";
import { isInOutputsFolder } from "./outputs.js";
import type { PolicySource } from "./approval-policy.js";
import type { ToolApprovalCategory } from "./tool-kind.js";

/** The turn's capture facts a file-edit decision reads; every field absent reads as "off". */
export interface FileEditPosture {
  /**
   * Apply-then-review capture mode (git workspaces). When true, a built-in
   * `write`/`delete` whose target path is capturable (git-tracked — see
   * {@link isCapturablePath}) FLOWS instead of interrupting: the edit is reviewed
   * post-hoc as a captured `FileChangeSet`, not gated before it runs. A gitignored
   * path is NOT capturable by the git substrate, so it stays gated unless
   * {@link captureIgnored} routes it into CAS capture. `shell` and MCP tools
   * are never bypassed by this flag. Off (the default) keeps the classic
   * true-pause gate for every mutation.
   */
  readonly fileCaptureMode?: boolean;
  /**
   * The turn's file review is off (`TurnWorkspace.fileReview` false): a
   * built-in `write`/`delete` FLOWS and is not reviewed, with no capture
   * bookkeeping. The secret-like write block still applies first, keyed on
   * {@link fileCaptureSubstrate}; `shell` and MCP tools are unaffected.
   * Absent or false keeps review's rules (capture, or the deny-gate).
   */
  readonly fileReviewOff?: boolean;
  /**
   * The workspace can capture file edits (`TurnWorkspace.captureSubstrate`),
   * whatever review says: the secret-like write block lets a secret-like path
   * through only where it holds and the path is git-capturable
   * ({@link isCapturablePath}). Absent falls back to {@link fileCaptureMode},
   * which implies it.
   */
  readonly fileCaptureSubstrate?: boolean;
  /**
   * Capturability predicate for {@link fileCaptureMode} and the secret-like write
   * block: given a tool's raw target path (as the model wrote it), resolves true
   * when the path would be captured by the git snapshot (tracked / not gitignored).
   * Injected by the engine's setup so the decision stays pure and testable, and
   * so the engine owns path normalization. Absent ⇒ nothing is bypassed (safe).
   */
  readonly isCapturablePath?: (rawPath: string) => Promise<boolean>;
  /**
   * Route gitignored `write`/`edit` edits into CAS capture (apply-then-review)
   * instead of the interrupt gate, applying the secret gate. When off, a
   * gitignored path stays on the interrupt gate exactly as before.
   *
   * True only for a gate whose engine observes the bytes it overwrites (the
   * Stigmer harness's CAS-observing backend, on its parent and every sub-agent
   * gate). A gate over an UNOBSERVED engine must keep this false: flowing its
   * gitignored edits would apply unobserved, unreviewable bytes.
   */
  readonly captureIgnored?: boolean;
  /**
   * Capture a file's pre-delete bytes so a CAS-owned (gitignored / non-git)
   * DELETE can flow under {@link captureIgnored} and be reviewed post-hoc
   * exactly like a write (issue #303). A delete is the one mutation an engine
   * backend cannot observe, so the gate captures at authorization time: the
   * file's bytes are still on disk here, and the turn boundary then reads
   * after=null and authors a `FILE_CHANGE_KIND_DELETE` with the same
   * discard-restores contract.
   *
   * Absent ⇒ deletes keep the interrupt-gate behavior (fail-closed: a delete
   * that cannot be captured cannot be reviewed, so it must be approved up
   * front).
   */
  readonly captureDeleteBefore?: (rawPath: string) => Promise<void>;
}

/**
 * The secret-like path a built-in WRITE must never reach, or undefined when
 * the call is not blocked: the write is never applied and never surfaced for
 * approval, and the caller records the path (the turn boundary authors a
 * content-less DIFF_UNREVIEWABLE entry from it).
 *
 * The cases, keyed on the workspace's substrate and never on review: where
 * the workspace can capture and the path is git-tracked it flows (in capture
 * mode git reviews it; with review off it is an ordinary tracked file, a
 * committed `.env.example`, say); a gitignored or non-git one is blocked
 * whether or not a CAS observer backs the gate (`captureIgnored` would
 * capture it, and its content must not surface anywhere), and whether or not
 * review is on; with no substrate (the classic no-storage deny-gate) it is
 * blocked. A delete carries no content, so a secret-like delete needs no
 * block: a human may still approve it on the card (its bytes are simply never
 * captured).
 */
export async function blockedSecretPath(
  posture: FileEditPosture,
  args: Record<string, unknown>,
  serverSlug: string,
  category: ToolApprovalCategory | undefined,
): Promise<string | undefined> {
  if (serverSlug || category !== "write") return undefined;
  const path = extractFilePath(args);
  if (path === null || !isSecretLikePath(path)) return undefined;
  const substrate = posture.fileCaptureSubstrate ?? posture.fileCaptureMode ?? false;
  if (substrate && posture.isCapturablePath && (await posture.isCapturablePath(path))) return undefined;
  return path;
}

/**
 * What the model reads when a secret-like write is refused: the path is named
 * (a filename is not itself the secret); the content is never echoed. One
 * sentence for every engine's gate.
 */
export function secretBlockMessage(toolName: string, path: string): string {
  return (
    `Tool '${toolName}' was blocked for security: '${path}' matches a ` +
    `secret-like path Stigmer will not capture for review. Nothing was written.`
  );
}

/**
 * Whether a built-in file write or delete flows unasked, and under which
 * source: `outputs` for one inside the outputs folder wherever a workspace
 * edit would flow unasked (capture mode, or review off), never captured,
 * since it comes back as a File; `file_review_off` when the turn's review is
 * off (nothing is captured; a secret-like write was already blocked);
 * `file_capture` when capture reviews it ({@link captureFlows}). `undefined`
 * sends the call to the default: shell and MCP tools always, and a file
 * edit in a turn with review on that capture cannot hold, an outputs one
 * included (the classic gate asks a person for every write).
 */
export async function fileEditFlow(
  posture: FileEditPosture,
  args: Record<string, unknown>,
  serverSlug: string,
  category: ToolApprovalCategory | undefined,
): Promise<PolicySource | undefined> {
  if (serverSlug || (category !== "write" && category !== "delete")) return undefined;
  if ((posture.fileReviewOff || posture.fileCaptureMode) && inOutputsFolder(args)) return "outputs";
  if (posture.fileReviewOff) return "file_review_off";
  return (await captureFlows(posture, args, serverSlug, category)) ? "file_capture" : undefined;
}

/**
 * Capture mode (git workspaces): whether a built-in file mutation flows
 * during the turn, to be reviewed after it through the file-review ledger
 * (apply-then-review), doing the bookkeeping that review needs. shell and MCP
 * tools (serverSlug present) never flow here.
 *
 *  - A git-tracked path flows: the git substrate reviews it.
 *  - A gitignored or non-git path flows only on a gate whose engine observes
 *    what it overwrites (`captureIgnored`): a write (secret-like ones were
 *    already blocked), its before-bytes already held by the observer; or a
 *    delete that is not secret-like, whose before-bytes are captured NOW
 *    (issue #303: the one moment they still exist). A secret-like delete
 *    stays on the gate: a human may approve it, but its bytes must never
 *    enter CAS.
 *
 * Any other gate answers false, and the default decides. A path inside the
 * outputs folder is never captured: it comes back as a File, and review
 * would hold nothing the person does not already get.
 */
export async function captureFlows(
  posture: FileEditPosture,
  args: Record<string, unknown>,
  serverSlug: string,
  category: ToolApprovalCategory | undefined,
): Promise<boolean> {
  if (!posture.fileCaptureMode || !posture.isCapturablePath || serverSlug) return false;
  if (category !== "write" && category !== "delete") return false;
  const path = extractFilePath(args);
  if (path === null || isInOutputsFolder(path)) return false;
  if (await posture.isCapturablePath(path)) return true;
  if (!posture.captureIgnored) return false;
  if (category === "write") return true;
  if (posture.captureDeleteBefore && !isSecretLikePath(path)) {
    await posture.captureDeleteBefore(path);
    return true;
  }
  return false;
}

/** Whether a built-in file call's path lies inside the outputs folder (`outputs.ts`). */
function inOutputsFolder(args: Record<string, unknown>): boolean {
  const path = extractFilePath(args);
  return path !== null && isInOutputsFolder(path);
}
