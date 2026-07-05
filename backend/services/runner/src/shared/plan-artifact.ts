/**
 * Plan-mode artifact publishing.
 *
 * When an execution runs in Plan mode (InteractionMode.PLAN), the agent's final
 * message IS the plan. We publish that text as a first-class plan markdown
 * ExecutionArtifact so the UI can render a reviewable Plan card with
 * copy/download, and a follow-up "Implement" execution can reference it
 * deterministically.
 *
 * The artifact is named from the plan's own title — a slug of its leading
 * `# H1` plus a `.plan.md` suffix (e.g. `plan_card_ux_cleanup.plan.md`), so a
 * downloaded plan lands as a recognizable file and the card, plan tab, and
 * saved file all agree on one name. A plan with no derivable title falls back
 * to the legacy {@link PLAN_ARTIFACT_NAME}.
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
 * Legacy/fallback plan filename, used when a plan has no derivable `# H1`
 * title. Detection ({@link isPlanArtifactName}) still accepts this exact name
 * so plans published before named artifacts existed keep working.
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

/** Longest slug we derive from a plan title before the `.plan.md` suffix. */
const MAX_PLAN_SLUG_LENGTH = 60;

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
 * Slugifies a plan title into a filename-safe stem: lowercase, every run of
 * non-alphanumerics collapsed to `_`, trimmed of leading/trailing `_`, and
 * capped at {@link MAX_PLAN_SLUG_LENGTH}. Returns `""` for a title with no
 * alphanumerics (e.g. only punctuation), which selects the fallback name.
 */
function slugifyPlanTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, MAX_PLAN_SLUG_LENGTH)
    .replace(/_+$/g, "");
}

/**
 * Derives the plan artifact's filename from its text: `<slug>.plan.md` when the
 * plan opens with a titled `# H1`, else the legacy {@link PLAN_ARTIFACT_NAME}.
 * No uniqueness hash is needed — storage keys are execution-scoped.
 */
export function planArtifactName(planText: string): string {
  const title = extractPlanTitle(planText);
  if (!title) return PLAN_ARTIFACT_NAME;
  const slug = slugifyPlanTitle(title);
  return slug.length > 0 ? `${slug}${PLAN_ARTIFACT_SUFFIX}` : PLAN_ARTIFACT_NAME;
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
