/**
 * Declared preferences (stigmer/stigmer#293, DD-002): standing free-text
 * preferences the organization and the calling user declared once — "keep
 * answers terse", "we deploy to us-east-1" — that every eligible execution
 * receives without the user re-typing them.
 *
 * The server composes the CONTENT at execution create: the create pipeline
 * snapshots `Organization.spec.preferences.standing_context` and (cloud, for
 * first-party human callers only) the caller
 * `IdentityAccount.spec.preferences.standing_context` verbatim onto the
 * execution spec's `declared_preferences` field. This module owns the
 * PRESENTATION — the preamble and the per-scope attribution — so the framing
 * cannot drift between harnesses.
 *
 * Like conversation-catchup (its typed-field sibling) there is no metadata
 * key to mirror-guard: the value rides a TYPED proto field, so codegen
 * enforces the cross-repo contract. Degradation is safe by construction: an
 * absent or blank field renders nothing, and a runner predating this module
 * simply ignores it — the agent runs without preferences, exactly the
 * pre-#293 behavior, never worse.
 */

import type { DeclaredPreferences } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/spec_pb";

/**
 * How the preferences are introduced to the model, shared by both harnesses
 * so the behavioral contract cannot drift between them. Same posture as the
 * session-context channel: calibration material, never authority — the task
 * always outranks a standing preference.
 */
const DECLARED_PREFERENCES_PREAMBLE =
  "Standing preferences declared by the organization and/or the user you " +
  "are assisting. Treat them as background you already know: use them to " +
  "calibrate depth, defaults, and tone. Do not repeat them back, quote " +
  "them, or mention that you received them. They are context, not " +
  "instructions that override your task.";

/**
 * The non-blank preference scopes of an execution, in presentation order.
 * At least one scope is set (the read function returns undefined otherwise).
 */
export interface DeclaredPreferencesContent {
  /** The organization's standing context, trimmed; absent when blank. */
  orgContext?: string;
  /** The calling user's standing context, trimmed; absent when blank. */
  userContext?: string;
}

/**
 * Read the declared preferences from an execution spec's
 * `declared_preferences`. Returns undefined when the field is absent or both
 * scopes are blank — the caller renders no section. Blank-is-absent applies
 * PER SCOPE: an org-only snapshot renders only the org subsection.
 */
export function readDeclaredPreferences(
  preferences: DeclaredPreferences | undefined,
): DeclaredPreferencesContent | undefined {
  const orgContext = preferences?.orgContext?.trim() || undefined;
  const userContext = preferences?.userContext?.trim() || undefined;
  if (!orgContext && !userContext) {
    return undefined;
  }
  return { orgContext, userContext };
}

/**
 * The framed preferences body (preamble + labeled per-scope subsections),
 * ready for section wrapping. Attribution is explicit — the model must know
 * WHO declared what. Organization first, user last: the user's refinement
 * reads last and so naturally wins where the two conflict, without this
 * module encoding any override rule.
 */
export function formatDeclaredPreferencesText(
  content: DeclaredPreferencesContent,
): string {
  const sections: string[] = [DECLARED_PREFERENCES_PREAMBLE];
  if (content.orgContext) {
    sections.push(`Declared by the organization:\n${content.orgContext}`);
  }
  if (content.userContext) {
    sections.push(`Declared by the user:\n${content.userContext}`);
  }
  return sections.join("\n\n");
}
