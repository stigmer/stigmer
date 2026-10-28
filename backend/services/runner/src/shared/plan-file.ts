/**
 * The plan a Plan-mode turn returns: a File of the turn.
 *
 * When a turn runs in Plan mode (InteractionMode.PLAN), the agent's final
 * message IS the plan, and Plan mode denies the agent's own writes. So the
 * runtime writes that text into the turn's outputs folder itself
 * ({@link savePlanOutput}), and the one outputs collector (`outputs.ts`)
 * returns it as a File of the turn like anything the agent saved: one path
 * for every file a turn returns, on every engine. The building turn finds it
 * among a message's Files by its name ({@link isPlanFileName}).
 *
 * The File is named from the plan's own title: a hyphenated slug of its
 * leading `# H1`, a `_<hash>` discriminator, and a `.plan.md` suffix (e.g.
 * `plan-card-ux-cleanup_a1b2c3d4.plan.md`), so a downloaded plan lands as a
 * recognizable file and the card, plan tab, and saved file all agree on one
 * name. A plan with no derivable title falls back to a bare `<hash>.plan.md`.
 *
 * The `_<hash>` discriminator (first 8 hex of the plan content's SHA-256)
 * exists because the basename is a user-facing shared namespace: downloads
 * save under it and the Files list surfaces it, so two same-titled plans
 * would otherwise collide in the user's Downloads folder and read
 * identically in the list. Deriving it from content keeps naming honestly
 * idempotent: identical content yields an identical name (and the collector
 * then sees an unchanged output and returns no second File), while any real
 * edit yields a distinct one.
 *
 * The write is made beside the outputs folder and then renamed into it, as
 * the collector's own index is written: a runner killed mid-write leaves a
 * stray file outside the folder, never half a plan that the next turn would
 * return as an output.
 */

import { createHash } from "node:crypto";
import { join } from "node:path";
import { agentFs } from "./agent-fs.js";
import { OUTPUTS_SUBDIR } from "./outputs.js";
import { getPlatformDir } from "./workspace/platform-dir.js";

/**
 * Legacy plan filename. Detection-only: {@link isPlanFileName} still
 * accepts this exact name so plans returned before named plans existed
 * keep working. It is NEVER freshly emitted — a titleless plan now falls back
 * to a bare `<hash>.plan.md` (see {@link planFileName}).
 */
export const PLAN_FILE_NAME = "plan.md";

/**
 * Suffix every named plan File carries. The UI keys plan detection on this
 * suffix, so it must stay in sync with the SDK's `PLAN_FILE_SUFFIX`
 * (`sdk/react/src/library/detect-plan-file.ts`). The two cannot share a
 * module — the runner and the browser SDK have disjoint module graphs — so the
 * constant is duplicated by design, mirroring {@link PLAN_FILE_NAME}.
 */
export const PLAN_FILE_SUFFIX = ".plan.md";

/** Longest slug we derive from a plan title before the `_<id>.plan.md` tail. */
const MAX_PLAN_SLUG_LENGTH = 60;

/** Hex length of the content-hash discriminator appended to named plans. */
const PLAN_ID_LENGTH = 8;

/**
 * Reports whether a filename is a plan: the legacy exact name, or any
 * `*.plan.md`. Kept in sync with the SDK's `isPlanFileName`.
 */
export function isPlanFileName(name: string): boolean {
  return name === PLAN_FILE_NAME || name.endsWith(PLAN_FILE_SUFFIX);
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
 * prefix titles with "Plan:". This strip is the saved file's safety net for
 * when the model drifts.
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
 * Derives the plan File's name from its text: `<slug>_<id>.plan.md`
 * when the plan opens with a titled `# H1`, else a bare `<id>.plan.md`. The
 * `<id>` is the first {@link PLAN_ID_LENGTH} hex of the content's SHA-256 — a
 * user-facing discriminator for the shared download/list basename namespace,
 * not a storage-uniqueness device (see the module doc).
 */
export function planFileName(planText: string): string {
  const id = createHash("sha256")
    .update(planText, "utf-8")
    .digest("hex")
    .slice(0, PLAN_ID_LENGTH);
  const title = extractPlanTitle(planText);
  const slug = title ? slugifyPlanTitle(stripPlanLabel(title)) : "";
  return slug.length > 0
    ? `${slug}_${id}${PLAN_FILE_SUFFIX}`
    : `${id}${PLAN_FILE_SUFFIX}`;
}

/** Where the plan is written before it is renamed into the outputs folder: in the platform folder, beside `outputs/`. */
export const PLAN_STAGING_FILE = "plan.next";

/**
 * Writes `planText` into the session's outputs folder as
 * `<planFileName(planText)>`, staged beside the folder and renamed in,
 * so the collector returns it as a File of the turn. An empty plan writes
 * nothing. Returns the name written, or `undefined` for an empty plan.
 * Throws on a failed write; the caller decides that a plan never fails a turn.
 */
export async function savePlanOutput(opts: {
  readonly sessionId: string;
  readonly planText: string;
}): Promise<string | undefined> {
  const { sessionId, planText } = opts;
  if (planText.trim().length === 0) return undefined;
  const platformDir = getPlatformDir(sessionId);
  const name = planFileName(planText);
  const staging = join(platformDir, PLAN_STAGING_FILE);
  await agentFs().writeFile(staging, planText);
  await agentFs().rename(staging, join(platformDir, OUTPUTS_SUBDIR, name));
  return name;
}
