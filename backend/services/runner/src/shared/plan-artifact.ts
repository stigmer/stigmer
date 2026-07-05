/**
 * Plan-mode artifact publishing.
 *
 * When an execution runs in Plan mode (InteractionMode.PLAN), the agent's final
 * message IS the plan. We publish that text as a first-class plan markdown
 * ExecutionArtifact so the UI can render a reviewable Plan card with
 * copy/download, and a follow-up "Implement" execution can reference it
 * deterministically.
 *
 * The artifact is named from the plan's own title — a hyphenated slug of its
 * leading `# H1`, a `_<hash>` discriminator, and a `.plan.md` suffix (e.g.
 * `plan-card-ux-cleanup_a1b2c3d4.plan.md`), so a downloaded plan lands as a
 * recognizable file and the card, plan tab, and saved file all agree on one
 * name. A plan with no derivable title falls back to a bare `<hash>.plan.md`.
 *
 * The `_<hash>` discriminator (first 8 hex of the plan content's SHA-256) is
 * NOT for storage uniqueness — storage keys are already execution-scoped
 * (`artifacts/{execId}/<name>`). It exists because the artifact BASENAME is a
 * user-facing shared namespace: downloads save under it (see the artifact
 * download disposition) and the artifact list surfaces it, so two same-titled
 * plans would otherwise collide in the user's Downloads folder and read
 * identically in the list. Deriving it from content (not a random or
 * execution-scoped value) keeps naming honestly idempotent — identical content
 * yields an identical name, so a finalize retry re-uploads to the same key,
 * while any real edit yields a distinct one. This refines DD-23 §D3 ("no
 * uniqueness hash"), which was correct about storage but overlooked the
 * download/list basename namespace introduced by DD-23 §D1.
 *
 * This is deliberately a single, harness-agnostic helper:
 * - The native (deepagents) harness already auto-publishes files an agent
 *   writes (InlinePublisher), but Plan mode is read-only, so there is no file to
 *   publish — the plan lives only in the final message.
 * - The Cursor harness has no artifact pipeline at all.
 *
 * Publishing the final message here, at finalization, gives both harnesses an
 * identical, durable plan artifact derived from the single source of truth (the
 * final AI message). It mirrors the InlinePublisher "publish a derived artifact"
 * pattern: one immutable artifact, published once, never a parallel copy that
 * can drift.
 *
 * The plan content is NOT duplicated as a separate stored blob beyond this
 * artifact — the chat message remains the live/streamed view; the artifact is
 * the durable/exportable view, detected by convention (a FILE artifact whose
 * name satisfies {@link isPlanArtifactName}).
 */

import { createHash } from "node:crypto";
import { create } from "@bufbuild/protobuf";
import type { AgentExecutionStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ExecutionArtifactSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/artifact_pb";
import {
  ExecutionArtifactKind,
  MessageType,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { ArtifactStorage } from "./artifact-storage.js";
import { utcTimestamp } from "./status.js";

/**
 * Legacy plan filename. Detection-only: {@link isPlanArtifactName} still
 * accepts this exact name so plans published before named artifacts existed
 * keep working. It is NEVER freshly emitted — a titleless plan now falls back
 * to a bare `<hash>.plan.md` (see {@link planArtifactName}).
 */
export const PLAN_ARTIFACT_NAME = "plan.md";

/**
 * Suffix every named plan artifact carries. The UI keys plan detection on this
 * suffix, so it must stay in sync with the SDK's `PLAN_ARTIFACT_SUFFIX`
 * (`sdk/react/src/library/detect-plan-artifact.ts`). The two cannot share a
 * module — the runner and the browser SDK have disjoint module graphs — so the
 * constant is duplicated by design, mirroring {@link PLAN_ARTIFACT_NAME}.
 */
export const PLAN_ARTIFACT_SUFFIX = ".plan.md";

/** Longest slug we derive from a plan title before the `_<id>.plan.md` tail. */
const MAX_PLAN_SLUG_LENGTH = 60;

/** Hex length of the content-hash discriminator appended to named plans. */
const PLAN_ID_LENGTH = 8;

/**
 * Reports whether an artifact filename is a plan: the legacy exact name, or any
 * `*.plan.md`. Kept in sync with the SDK's `isPlanArtifactName`.
 */
export function isPlanArtifactName(name: string): boolean {
  return name === PLAN_ARTIFACT_NAME || name.endsWith(PLAN_ARTIFACT_SUFFIX);
}

// Plan-title extraction, mirrored from the SDK so the runner's derived filename
// and the card's displayed title agree on one title from one source (the plan's
// leading `# H1`). These three patterns are a verbatim copy of
// `sdk/react/src/internal/markdown-components.tsx`
// (`ENCLOSING_MARKDOWN_FENCE_RE`, `ENCLOSING_BARE_FENCE_RE`, `LEADING_H1_RE`)
// and MUST stay in sync with it — a fence-wrapped plan whose title the card
// unwraps must slug to that same title here, never to the fallback.
const ENCLOSING_MARKDOWN_FENCE_RE =
  /^(`{3,})[ \t]*(?:markdown|md)[ \t]*\r?\n([\s\S]*?)\r?\n\1[ \t]*$/i;
const ENCLOSING_BARE_FENCE_RE = /^(`{3,})[ \t]*\r?\n([\s\S]*?)\r?\n\1[ \t]*$/;
const LEADING_H1_RE = /^#[ \t]+(.+?)[ \t]*(?:\r?\n+|$)/;

/**
 * The plan's title: the leading `# H1` of the plan text, after the same
 * plan-scoped enclosing-fence unwrap (tagged ```markdown``` or a bare ``` `)
 * the document renderers apply. `undefined` when the plan has no leading H1.
 */
function extractPlanTitle(planText: string): string | undefined {
  const trimmed = planText.trim();
  let body = trimmed;
  const tagged = ENCLOSING_MARKDOWN_FENCE_RE.exec(trimmed);
  if (tagged) {
    body = tagged[2];
  } else {
    const bare = ENCLOSING_BARE_FENCE_RE.exec(trimmed);
    if (bare) body = bare[2];
  }
  const h1 = LEADING_H1_RE.exec(body.trim());
  return h1 ? h1[1] : undefined;
}

/**
 * Strips a leading "Plan" LABEL from a title, e.g. `Plan: Create X` -> `Create
 * X`. The separator (`:` or a dash) is REQUIRED: this removes a redundant label
 * (a plan document already announces itself via the `.plan.md` suffix and the
 * Plan card framing) without ever clipping a real title word — a bare `\bplan\b`
 * would wrongly turn "Plan card UX cleanup" into "card UX cleanup".
 *
 * Deliberately runner/filename-only and NOT mirrored into the SDK's title
 * extraction: display surfaces render the message's own `# H1` faithfully
 * (`extractLeadingH1` is general-purpose and render-time-only), so the clean
 * title is fixed at the source — the plan-mode prompt tells the model not to
 * prefix titles with "Plan:". This strip is the durable-artifact safety net for
 * when the model (or the enforcement-less Cursor harness) drifts.
 */
function stripPlanLabel(title: string): string {
  return title.replace(/^plan\s*[:\u2013\u2014-]\s*/i, "");
}

/**
 * Slugifies a plan title into a filename-safe stem: lowercase, every run of
 * non-alphanumerics collapsed to `-`, trimmed of leading/trailing `-`, and
 * capped at {@link MAX_PLAN_SLUG_LENGTH}. Returns `""` for a title with no
 * alphanumerics (e.g. only punctuation), which selects the fallback name.
 */
function slugifyPlanTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_PLAN_SLUG_LENGTH)
    .replace(/-+$/g, "");
}

/**
 * Derives the plan artifact's filename from its text: `<slug>_<id>.plan.md`
 * when the plan opens with a titled `# H1`, else a bare `<id>.plan.md`. The
 * `<id>` is the first {@link PLAN_ID_LENGTH} hex of the content's SHA-256 — a
 * user-facing discriminator for the shared download/list basename namespace,
 * not a storage-uniqueness device (see the module doc).
 */
export function planArtifactName(planText: string): string {
  const id = createHash("sha256")
    .update(planText, "utf-8")
    .digest("hex")
    .slice(0, PLAN_ID_LENGTH);
  const title = extractPlanTitle(planText);
  const slug = title ? slugifyPlanTitle(stripPlanLabel(title)) : "";
  return slug.length > 0
    ? `${slug}_${id}${PLAN_ARTIFACT_SUFFIX}`
    : `${id}${PLAN_ARTIFACT_SUFFIX}`;
}

/**
 * Sandbox path recorded on the artifact for a given filename. Routes under
 * `.stigmer/` (the session platform dir), so it never pollutes the user's
 * workspace, and a follow-up execution can reference it via workspace file
 * refs if desired.
 */
export function planArtifactSandboxPath(name: string): string {
  return `.stigmer/plans/${name}`;
}

/**
 * Returns the text of the last AI message in a completed status, trimmed.
 * Returns `undefined` when there is no AI message with content — the plan was
 * empty and nothing should be published.
 */
export function extractFinalPlanText(status: AgentExecutionStatus): string | undefined {
  for (let i = status.messages.length - 1; i >= 0; i--) {
    const msg = status.messages[i];
    if (msg.type === MessageType.MESSAGE_AI && msg.content.trim().length > 0) {
      return msg.content;
    }
  }
  return undefined;
}

/**
 * Publishes `planText` as a plan ExecutionArtifact (named from its title —
 * see {@link planArtifactName}) and registers it on `status.artifacts`.
 * Idempotent: re-publishing replaces any existing plan artifact — matched by
 * {@link isPlanArtifactName}, not exact name, so a re-plan whose title changed
 * still supersedes rather than appends — preserving a single source of truth.
 *
 * Fire-and-forget by contract: a plan that fails to upload must never fail the
 * execution. Errors are logged and swallowed.
 */
export async function publishPlanArtifact(opts: {
  readonly status: AgentExecutionStatus;
  readonly executionId: string;
  readonly planText: string;
  readonly artifactStorage: ArtifactStorage;
}): Promise<void> {
  const { status, executionId, planText, artifactStorage } = opts;

  if (planText.trim().length === 0) {
    return;
  }

  try {
    const content = Buffer.from(planText, "utf-8");
    const contentHash = createHash("sha256").update(content).digest("hex");
    const name = planArtifactName(planText);
    const storageKey = `artifacts/${executionId}/${name}`;

    await artifactStorage.upload(storageKey, content, "text/markdown");

    const artifact = create(ExecutionArtifactSchema, {
      name,
      sandboxPath: planArtifactSandboxPath(name),
      kind: ExecutionArtifactKind.FILE,
      sizeBytes: BigInt(content.length),
      storageKey,
      createdAt: utcTimestamp(),
      contentHash,
    });

    const existingIdx = status.artifacts.findIndex((a) => isPlanArtifactName(a.name));
    if (existingIdx >= 0) {
      status.artifacts[existingIdx] = artifact;
    } else {
      status.artifacts.push(artifact);
    }

    console.log(
      `[plan-artifact] execution=${executionId} — published ${name} ` +
      `(${content.length} bytes, hash=${contentHash.slice(0, 12)})`,
    );
  } catch (err) {
    console.warn(
      `[plan-artifact] execution=${executionId} — ` +
      `failed to publish plan (non-fatal): ${err}`,
    );
  }
}
